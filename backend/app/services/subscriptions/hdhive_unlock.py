from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any


NormalizeItems = Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
ExtractResourceUrl = Callable[[dict[str, Any]], str]
NormalizeShareUrl = Callable[[str], str]
UnlockResource = Callable[[str], Awaitable[dict[str, Any]]]
Sleep = Callable[[float], Awaitable[None]]


def build_hdhive_unlock_context(
    *,
    enabled: bool,
    max_points_per_item: int,
    budget_total: int,
    threshold_inclusive: bool,
    max_unlocks_per_run: int = 1,
    consecutive_failed_limit: int = 3,
    request_interval_seconds: float = 0.35,
) -> dict[str, Any]:
    return {
        "enabled": enabled,
        "max_points_per_item": max_points_per_item,
        "budget_total": budget_total,
        "budget_left": budget_total,
        "threshold_inclusive": threshold_inclusive,
        "max_unlocks_per_run": max_unlocks_per_run,
        "consecutive_failed_limit": consecutive_failed_limit,
        "consecutive_failed_count": 0,
        "request_interval_seconds": request_interval_seconds,
        "stopped_by_circuit": False,
        "stopped_reason": "",
        "stats": {
            "attempted": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "points_spent": 0,
        },
    }


async def prepare_hdhive_locked_resources(
    resources: list[dict[str, Any]],
    context: dict[str, Any],
    traces: list[dict[str, Any]],
    *,
    normalize_items: NormalizeItems,
    extract_resource_url: ExtractResourceUrl,
    normalize_share_url: NormalizeShareUrl,
    unlock_resource: UnlockResource,
    sleep: Sleep = asyncio.sleep,
) -> list[dict[str, Any]]:
    normalized_items = normalize_items(resources)
    if not normalized_items:
        return normalized_items

    enabled = bool(context.get("enabled", False))
    max_points = int(context.get("max_points_per_item", 10) or 10)
    budget_total = int(context.get("budget_total", 30) or 30)
    budget_left = int(context.get("budget_left", budget_total) or budget_total)
    threshold_inclusive = bool(context.get("threshold_inclusive", True))
    max_unlocks_per_run = max(1, int(context.get("max_unlocks_per_run", 1) or 1))
    traces.append(
        {
            "step": "hdhive_unlock_policy",
            "status": "info",
            "message": (
                "HDHive 解锁策略已加载"
                if enabled
                else "HDHive 自动积分解锁未启用，锁定资源将跳过自动解锁"
            ),
            "payload": {
                "enabled": enabled,
                "max_points_per_item": max_points,
                "budget_total": budget_total,
                "budget_left": budget_left,
                "threshold_inclusive": threshold_inclusive,
                "max_unlocks_per_run": max_unlocks_per_run,
            },
        }
    )

    stats = context.setdefault(
        "stats",
        {
            "attempted": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "points_spent": 0,
        },
    )
    local_attempted = 0
    local_success = 0
    local_failed = 0
    local_skipped = 0
    local_points_spent = 0
    for item in normalized_items:
        if not isinstance(item, dict):
            continue
        if str(item.get("source_service") or "").strip().lower() != "hdhive":
            continue

        if extract_resource_url(item):
            continue

        slug = str(item.get("slug") or "").strip()
        unlock_points = safe_int(item.get("unlock_points"), default=0)
        locked = bool(item.get("hdhive_locked")) or (
            unlock_points > 0 and not extract_resource_url(item)
        )
        if not locked:
            continue

        skip_reason = ""
        if not enabled:
            skip_reason = "disabled"
        elif not slug:
            skip_reason = "missing_slug"
        elif unlock_points < 0:
            skip_reason = "invalid_unlock_points"
        elif unlock_points > 0 and not allow_unlock_by_threshold(
            unlock_points, max_points, threshold_inclusive
        ):
            skip_reason = "over_threshold"
        elif context.get("stopped_by_circuit"):
            skip_reason = "circuit_open"
        elif unlock_points > 0 and unlock_points > int(
            context.get("budget_left", 0) or 0
        ):
            skip_reason = "budget_exceeded"

        if skip_reason:
            local_skipped += 1
            stats["skipped"] = int(stats.get("skipped") or 0) + 1
            traces.append(
                {
                    "step": "hdhive_unlock_item_skip",
                    "status": "warning",
                    "message": f"跳过资源解锁: {slug or 'unknown'} ({skip_reason})",
                    "payload": {
                        "slug": slug,
                        "unlock_points": unlock_points,
                        "reason": skip_reason,
                        "budget_left": int(context.get("budget_left", 0) or 0),
                    },
                }
            )
            continue

        traces.append(
            {
                "step": "hdhive_unlock_item_start",
                "status": "info",
                "message": f"开始自动解锁资源: {slug}",
                "payload": {
                    "slug": slug,
                    "unlock_points": unlock_points,
                    "budget_remaining_before": int(
                        context.get("budget_left", 0) or 0
                    ),
                },
            }
        )

        stats["attempted"] = int(stats.get("attempted") or 0) + 1
        local_attempted += 1
        try:
            unlock_result = await unlock_resource(slug)
            unlock_message = str(unlock_result.get("message") or "").strip()
            share_link = normalize_share_url(
                str(unlock_result.get("share_link") or "").strip()
            )
            if share_link:
                item["pan115_share_link"] = share_link
                item["share_link"] = share_link
                item["pan115_savable"] = True
                context["budget_left"] = max(
                    0, int(context.get("budget_left", 0) or 0) - unlock_points
                )
                context["consecutive_failed_count"] = 0
                stats["success"] = int(stats.get("success") or 0) + 1
                stats["points_spent"] = (
                    int(stats.get("points_spent") or 0) + unlock_points
                )
                local_success += 1
                local_points_spent += unlock_points
                traces.append(
                    {
                        "step": "hdhive_unlock_item_done",
                        "status": "success",
                        "message": f"资源解锁成功: {slug}",
                        "payload": {
                            "slug": slug,
                            "unlock_points": unlock_points,
                            "budget_remaining_after": int(
                                context.get("budget_left", 0) or 0
                            ),
                        },
                    }
                )
                if local_success >= max_unlocks_per_run:
                    traces.append(
                        {
                            "step": "hdhive_unlock_stop",
                            "status": "info",
                            "message": (
                                f"已达到本次最多解锁 {max_unlocks_per_run} 条资源，"
                                "停止继续解锁"
                            ),
                            "payload": {
                                "reason": "max_unlocks_reached",
                                "max_unlocks_per_run": max_unlocks_per_run,
                                "unlocked_count": local_success,
                            },
                        }
                    )
                    break
            else:
                context["consecutive_failed_count"] = (
                    int(context.get("consecutive_failed_count", 0) or 0) + 1
                )
                stats["failed"] = int(stats.get("failed") or 0) + 1
                local_failed += 1
                traces.append(
                    {
                        "step": "hdhive_unlock_item_failed",
                        "status": "failed",
                        "message": f"资源解锁失败: {slug}",
                        "payload": {
                            "slug": slug,
                            "unlock_points": unlock_points,
                            "error": unlock_message or "解锁后未获取可转存链接",
                        },
                    }
                )
                if should_stop_unlocking_on_message(unlock_message):
                    context["stopped_by_circuit"] = True
                    context["stopped_reason"] = unlock_message or "unlock_error"
        except Exception as exc:
            context["consecutive_failed_count"] = (
                int(context.get("consecutive_failed_count", 0) or 0) + 1
            )
            stats["failed"] = int(stats.get("failed") or 0) + 1
            local_failed += 1
            message = str(exc)[:300]
            traces.append(
                {
                    "step": "hdhive_unlock_item_failed",
                    "status": "failed",
                    "message": f"资源解锁失败: {slug}",
                    "payload": {
                        "slug": slug,
                        "unlock_points": unlock_points,
                        "error": message,
                    },
                }
            )
            if should_stop_unlocking_on_message(message):
                context["stopped_by_circuit"] = True
                context["stopped_reason"] = message

        failed_count = int(context.get("consecutive_failed_count", 0) or 0)
        if failed_count >= int(context.get("consecutive_failed_limit", 3) or 3):
            context["stopped_by_circuit"] = True
            if not str(context.get("stopped_reason") or "").strip():
                context["stopped_reason"] = f"连续失败 {failed_count} 次"

        if context.get("stopped_by_circuit"):
            traces.append(
                {
                    "step": "hdhive_unlock_stop",
                    "status": "warning",
                    "message": "触发 HDHive 解锁熔断，本订阅剩余锁定资源停止自动解锁",
                    "payload": {
                        "reason": str(context.get("stopped_reason") or "unknown"),
                        "consecutive_failed_count": int(
                            context.get("consecutive_failed_count", 0) or 0
                        ),
                        "budget_left": int(context.get("budget_left", 0) or 0),
                    },
                }
            )
            break

        await sleep(float(context.get("request_interval_seconds", 0.35) or 0.35))

    traces.append(
        {
            "step": "hdhive_unlock_summary",
            "status": "info",
            "message": (
                f"HDHive 自动解锁汇总: 尝试 {local_attempted}，"
                f"成功 {local_success}，失败 {local_failed}，"
                f"跳过 {local_skipped}，消耗 {local_points_spent} 积分"
            ),
            "payload": {
                "attempted": local_attempted,
                "success": local_success,
                "failed": local_failed,
                "skipped": local_skipped,
                "points_spent": local_points_spent,
                "total_attempted": int(stats.get("attempted") or 0),
                "total_success": int(stats.get("success") or 0),
                "total_failed": int(stats.get("failed") or 0),
                "total_skipped": int(stats.get("skipped") or 0),
                "total_points_spent": int(stats.get("points_spent") or 0),
                "budget_left": int(context.get("budget_left", 0) or 0),
                "unlocked_count": local_success,
                "stopped_by_circuit": bool(context.get("stopped_by_circuit")),
            },
        }
    )
    return normalized_items


def allow_unlock_by_threshold(
    unlock_points: int, threshold: int, inclusive: bool
) -> bool:
    if inclusive:
        return unlock_points <= threshold
    return unlock_points < threshold


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def should_stop_unlocking_on_message(message: str) -> bool:
    text = str(message or "").lower()
    if not text:
        return False
    stop_tokens = (
        "积分不足",
        "余额不足",
        "token",
        "unauthorized",
        "forbidden",
        "cookie",
        "登录",
        "认证",
    )
    return any(token in text for token in stop_tokens)
