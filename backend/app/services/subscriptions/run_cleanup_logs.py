from __future__ import annotations

from typing import Any


def build_cleanup_after_transfer_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    trace_id: str,
    cleanup_stats: dict[str, Any],
) -> dict[str, Any]:
    cleanup_message = str(
        cleanup_stats.get("cleanup_message") or "订阅已自动清理"
    )
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.cleanup_after_transfer",
        "status": "success",
        "message": (
            f"[{subscription_title}] 转存完成后自动清理订阅：{cleanup_message}"
        ),
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "reason": cleanup_stats.get("cleanup_step"),
        },
    }


def build_cleanup_after_transfer_step(
    cleanup_stats: dict[str, Any],
) -> dict[str, Any]:
    cleanup_payload = cleanup_stats.get("cleanup_payload")
    return {
        "step": str(
            cleanup_stats.get("cleanup_step")
            or "subscription_cleanup_after_transfer"
        ),
        "status": "success",
        "message": str(
            cleanup_stats.get("cleanup_message") or "订阅已自动清理"
        ),
        "payload": cleanup_payload if isinstance(cleanup_payload, dict) else None,
    }


def build_fixed_source_movie_cleanup_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    trace_id: str,
) -> dict[str, Any]:
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.cleanup_after_fixed_source",
        "status": "success",
        "message": f"[{subscription_title}] 电影固定来源转存完成，自动删除订阅",
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "reason": "movie_fixed_source_transferred",
        },
    }


def build_fixed_source_movie_cleanup_step(fixed_saved: int) -> dict[str, Any]:
    return {
        "step": "subscription_cleanup_movie_fixed_source",
        "status": "success",
        "message": "电影固定来源转存完成，订阅已自动清理",
        "payload": {"fixed_saved": fixed_saved},
    }
