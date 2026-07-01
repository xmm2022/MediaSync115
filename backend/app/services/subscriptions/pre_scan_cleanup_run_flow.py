from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.services.subscriptions.run_lifecycle_logs import (
    build_subscription_auto_cleaned_event_kwargs,
    build_subscription_auto_cleaned_step,
)


@dataclass(frozen=True, slots=True)
class PreScanCleanupRunResult:
    deleted: bool
    tv_missing_snapshot: Any | None
    cleanup_result: dict[str, Any]


@dataclass(frozen=True, slots=True)
class PreScanCleanupRunDependencies:
    evaluate_pre_scan_cleanup: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]


async def run_pre_scan_cleanup_for_subscription(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupRunDependencies,
) -> PreScanCleanupRunResult:
    cleanup_result = await dependencies.evaluate_pre_scan_cleanup(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
    )
    tv_missing_snapshot = cleanup_result.get("tv_missing_snapshot")
    if not cleanup_result.get("deleted"):
        return PreScanCleanupRunResult(
            deleted=False,
            tv_missing_snapshot=tv_missing_snapshot,
            cleanup_result=cleanup_result,
        )

    subscription_id = int(sub.id)
    subscription_title = str(sub.title)

    await dependencies.apply_cleanup_stats(sub.media_type)
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        **build_subscription_auto_cleaned_step(),
    )
    await dependencies.log_background_event(
        **build_subscription_auto_cleaned_event_kwargs(
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            channel=channel,
            trace_id=run_id,
        )
    )
    await db.commit()

    return PreScanCleanupRunResult(
        deleted=True,
        tv_missing_snapshot=tv_missing_snapshot,
        cleanup_result=cleanup_result,
    )
