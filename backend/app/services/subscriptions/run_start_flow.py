from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.subscriptions.run_counters import set_checked_count
from app.services.subscriptions.run_state import (
    build_initial_run_result,
    build_start_progress_payload,
)


@dataclass(frozen=True, slots=True)
class SubscriptionRunStartDependencies:
    log_background_event: Callable[..., Awaitable[None]]
    create_step_log: Callable[..., Awaitable[None]]
    load_active_subscriptions: Callable[[Any], Awaitable[list[Any]]]
    build_hdhive_unlock_context: Callable[[], dict[str, Any]]
    resolve_source_order: Callable[[str], list[str]]
    now: Callable[[], datetime]
    make_run_id: Callable[[], str]


@dataclass(frozen=True, slots=True)
class SubscriptionRunStartResult:
    run_id: str
    started_at: datetime
    result: dict[str, Any]
    hdhive_unlock_context: dict[str, Any]
    source_order: list[str]
    subscriptions: list[Any]


async def start_subscription_run(
    *,
    db: Any,
    channel: str,
    force_auto_download: bool,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None,
    dependencies: SubscriptionRunStartDependencies,
) -> SubscriptionRunStartResult:
    run_id = dependencies.make_run_id()
    started_at = dependencies.now()

    await dependencies.log_background_event(
        source_type="background_task",
        module="subscriptions",
        action="subscription.check.start",
        status="info",
        message=f"订阅检查任务启动（频道：{channel}）",
        trace_id=run_id,
        extra={
            "channel": channel,
            "force_auto_download": force_auto_download,
        },
    )

    result = build_initial_run_result(channel, run_id, started_at)
    hdhive_unlock_context = dependencies.build_hdhive_unlock_context()
    source_order = dependencies.resolve_source_order(channel)

    subscriptions = await dependencies.load_active_subscriptions(db)
    set_checked_count(result, len(subscriptions))
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        step="run_start",
        status="info",
        message=f"开始本轮检查，共有 {len(subscriptions)} 个订阅需要处理",
        payload={
            "checked_count": len(subscriptions),
            "source_order": source_order,
            "scope": {
                "is_active": True,
                "exclude_transferred_success": False,
                "cleanup_enabled": True,
            },
        },
    )
    if progress_callback:
        await progress_callback(build_start_progress_payload(result))

    return SubscriptionRunStartResult(
        run_id=run_id,
        started_at=started_at,
        result=result,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        subscriptions=subscriptions,
    )
