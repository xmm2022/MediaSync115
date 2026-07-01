from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_candidates import (
    filter_resources_excluding_urls,
    merge_auto_save_stats,
    should_continue_link_fallback,
)


CreateStepLog = Callable[..., Awaitable[None]]
AutoSaveResources = Callable[..., Awaitable[dict[str, Any]]]
LoadSubscriptionResourceUrls = Callable[[Any, int], Awaitable[set[str]]]
FetchResources = Callable[
    ...,
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]
StoreNewResources = Callable[
    [Any, int, list[dict[str, Any]]],
    Awaitable[dict[str, Any]],
]


@dataclass(frozen=True)
class LinkFallbackDependencies:
    create_step_log: CreateStepLog
    auto_save_resources: AutoSaveResources
    load_subscription_resource_urls: LoadSubscriptionResourceUrls
    fetch_resources: FetchResources
    store_new_resources: StoreNewResources


def _initial_stats() -> dict[str, Any]:
    return {
        "saved": 0,
        "failed": 0,
        "errors": [],
        "subscription_completed": False,
        "cleanup_step": "",
        "cleanup_message": "",
        "cleanup_payload": {},
        "remaining_missing_count": None,
        "link_fallback_rounds": 0,
    }


async def _create_subscription_step_log(
    dependencies: LinkFallbackDependencies,
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    **kwargs: Any,
) -> None:
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=sub.id,
        subscription_title=sub.title,
        **kwargs,
    )


async def auto_save_records_with_link_fallback(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    transfer_source: str,
    dependencies: LinkFallbackDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    enable_link_refetch: bool = True,
    max_rounds: int = 6,
) -> dict[str, Any]:
    """转存资源；链接失败或剧集仍缺集时，补充搜索下一条链接继续尝试。"""
    merged = _initial_stats()
    pending_records = list(records or [])
    if not pending_records:
        return merged

    last_stats: dict[str, Any] | None = None
    last_attempted_count = 0

    for round_idx in range(max_rounds):
        if not pending_records:
            break

        last_attempted_count = len(pending_records)
        source_label = transfer_source if round_idx == 0 else f"{transfer_source}_fallback"
        await _create_subscription_step_log(
            dependencies,
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            step="auto_transfer_batch_start",
            status="info",
            message=(
                f"开始转存 {last_attempted_count} 个资源"
                + (f"（补充搜索第 {round_idx} 轮）" if round_idx else "")
            ),
            payload={
                "transfer_source": source_label,
                "round": round_idx,
                "count": last_attempted_count,
            },
        )
        last_stats = await dependencies.auto_save_resources(
            db,
            run_id,
            channel,
            sub,
            pending_records,
            source=source_label,
            tv_missing_snapshot=tv_missing_snapshot,
        )
        merge_auto_save_stats(merged, last_stats)
        merged["link_fallback_rounds"] = round_idx
        pending_records = []

        if not should_continue_link_fallback(
            sub.media_type,
            last_stats,
            attempted_count=last_attempted_count,
        ):
            break

        if not enable_link_refetch:
            break
        if round_idx + 1 >= max_rounds:
            await _create_subscription_step_log(
                dependencies,
                db,
                run_id=run_id,
                channel=channel,
                sub=sub,
                step="auto_transfer_link_fallback_limit",
                status="warning",
                message=f"已达链接回退上限（{max_rounds} 轮），停止继续搜索",
            )
            break

        await _create_subscription_step_log(
            dependencies,
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            step="auto_transfer_link_fallback_fetch",
            status="info",
            message="当前链接未转存成功，正在搜索下一条可用资源",
            payload={"round": round_idx + 1},
        )
        exclude_urls = await dependencies.load_subscription_resource_urls(db, sub.id)
        resources, fetch_trace, source_attempt_info = await dependencies.fetch_resources(
            channel,
            sub,
            hdhive_unlock_context,
            source_order=source_order,
            exclude_urls=exclude_urls,
        )
        for trace in fetch_trace:
            raw_payload = trace.get("payload")
            await _create_subscription_step_log(
                dependencies,
                db,
                run_id=run_id,
                channel=channel,
                sub=sub,
                step=str(trace.get("step") or "fetch_trace"),
                status=str(trace.get("status") or "info"),
                message=str(trace.get("message") or ""),
                payload=raw_payload if isinstance(raw_payload, dict) else None,
            )

        resources = filter_resources_excluding_urls(resources, exclude_urls)
        if not resources:
            await _create_subscription_step_log(
                dependencies,
                db,
                run_id=run_id,
                channel=channel,
                sub=sub,
                step="auto_transfer_link_fallback_empty",
                status="warning",
                message="未搜索到新的可用链接，停止回退尝试",
                payload={
                    "round": round_idx + 1,
                    "excluded_url_count": len(exclude_urls),
                    "summary": source_attempt_info.get("summary", ""),
                },
            )
            break

        store_stats = await dependencies.store_new_resources(db, sub.id, resources)
        pending_records = list(store_stats.get("created_records") or [])
        await _create_subscription_step_log(
            dependencies,
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            step="auto_transfer_link_fallback_stored",
            status="success" if pending_records else "warning",
            message=(
                f"补充搜索完成，新增 {len(pending_records)} 条待转存资源"
                if pending_records
                else "补充搜索未获得新链接（可能均已尝试过）"
            ),
            payload={
                "round": round_idx + 1,
                "new_count": len(pending_records),
                "fetched_count": len(resources),
                "summary": source_attempt_info.get("summary", ""),
            },
        )
        if not pending_records:
            break

    return merged
