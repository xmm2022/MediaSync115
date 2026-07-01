from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.subscriptions.run_completion import (
    apply_hdhive_unlock_stats,
    apply_run_finalize_error,
    build_run_finalize_failed_message,
    build_run_finalize_failed_payload,
    build_run_finish_event_extra,
    build_run_finish_event_message,
    build_run_finish_step_payload,
    complete_run_result,
)
from app.services.subscriptions.run_summary import (
    build_run_message,
    resolve_run_status,
)


@dataclass(frozen=True, slots=True)
class RunFinalizeResult:
    status: Any
    message: str
    finished_at: datetime
    finalize_error: str


@dataclass(frozen=True, slots=True)
class RunFinalizeDependencies:
    log_background_event: Callable[..., Awaitable[None]]
    create_execution_log: Callable[..., Awaitable[None]]
    create_step_log: Callable[..., Awaitable[None]]
    prune_step_logs: Callable[[Any], Awaitable[None]]
    now: Callable[[], datetime]


async def finalize_subscription_run(
    *,
    db: Any,
    channel: str,
    run_id: str,
    result: dict[str, Any],
    started_at: datetime,
    hdhive_unlock_context: dict[str, Any],
    success_status: Any,
    failed_status: Any,
    partial_status: Any,
    dependencies: RunFinalizeDependencies,
) -> RunFinalizeResult:
    status = resolve_run_status(
        result["failed_count"],
        result["checked_count"],
        result["auto_failed_count"],
        success_status=success_status,
        failed_status=failed_status,
        partial_status=partial_status,
    )
    unlock_stats = hdhive_unlock_context.get("stats", {})
    apply_hdhive_unlock_stats(result, unlock_stats)
    message = build_run_message(result)
    finished_at = dependencies.now()
    complete_run_result(
        result,
        status_value=status.value,
        message=message,
        finished_at=finished_at,
    )

    await dependencies.log_background_event(
        source_type="background_task",
        module="subscriptions",
        action="subscription.check.finish",
        status=status.value,
        message=build_run_finish_event_message(channel, result),
        trace_id=run_id,
        extra=build_run_finish_event_extra(channel, result),
    )

    finalize_error = ""
    try:
        await dependencies.create_execution_log(
            db,
            channel=channel,
            status=status,
            message=message,
            checked_count=result["checked_count"],
            new_resource_count=result["new_resource_count"],
            failed_count=result["failed_count"],
            details=result["errors"],
            started_at=started_at,
            finished_at=finished_at,
        )
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            step="run_finish",
            status=status.value,
            message=message,
            payload=build_run_finish_step_payload(result),
        )
        await dependencies.prune_step_logs(db)
        await db.commit()
    except Exception as exc:
        finalize_error = str(exc)
        await db.rollback()
        apply_run_finalize_error(
            result,
            summary_message=message,
            finalize_error=finalize_error,
            success_status_value=success_status.value,
            partial_status_value=partial_status.value,
        )

        try:
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                step="run_finalize_failed",
                status="warning",
                message=build_run_finalize_failed_message(finalize_error),
                payload=build_run_finalize_failed_payload(
                    finalize_error,
                    status_before_finalize=status.value,
                ),
            )
            await db.commit()
        except Exception:
            await db.rollback()

    return RunFinalizeResult(
        status=status,
        message=result["message"],
        finished_at=finished_at,
        finalize_error=finalize_error,
    )
