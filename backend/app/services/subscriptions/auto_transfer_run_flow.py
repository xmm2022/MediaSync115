from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.run_cleanup_logs import (
    build_cleanup_after_transfer_event_kwargs,
    build_cleanup_after_transfer_step,
)
from app.services.subscriptions.run_transfer_logs import (
    build_auto_transfer_done_event_kwargs,
    build_auto_transfer_done_step,
    build_auto_transfer_skip_step,
    build_auto_transfer_start_event_kwargs,
    build_auto_transfer_start_step,
    build_auto_transfer_summary_step,
)


@dataclass(frozen=True, slots=True)
class AutoTransferRunResult:
    sub_saved_count: int
    sub_failed_transfer_count: int
    cleanup_after_auto: dict[str, Any] | None
    retry_records: list[Any]


@dataclass(frozen=True, slots=True)
class AutoTransferRunDependencies:
    select_retry_records: Callable[..., Awaitable[list[Any]]]
    auto_save_records_with_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
    apply_auto_transfer_stats: Callable[[dict[str, Any], str], Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]


async def _create_subscription_step_log(
    *,
    db: Any,
    run_id: str,
    channel: str,
    subscription_id: int,
    subscription_title: str,
    dependencies: AutoTransferRunDependencies,
    step_payload: dict[str, Any],
) -> None:
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        **step_payload,
    )


async def _run_transfer_source(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: Sequence[Any],
    transfer_source: str,
    tv_missing_snapshot: Any,
    hdhive_unlock_context: dict[str, Any],
    source_order: list[str],
    dependencies: AutoTransferRunDependencies,
    enable_link_refetch: bool = True,
) -> dict[str, Any]:
    subscription_id = int(sub.id)
    subscription_title = str(sub.title)

    await _create_subscription_step_log(
        db=db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        dependencies=dependencies,
        step_payload=build_auto_transfer_start_step(
            transfer_source,
            len(records),
        ),
    )
    await dependencies.log_background_event(
        **build_auto_transfer_start_event_kwargs(
            transfer_source=transfer_source,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            trace_id=run_id,
            record_count=len(records),
        )
    )

    transfer_kwargs: dict[str, Any] = {
        "transfer_source": transfer_source,
        "tv_missing_snapshot": tv_missing_snapshot,
        "hdhive_unlock_context": hdhive_unlock_context,
        "source_order": source_order,
    }
    if not enable_link_refetch:
        transfer_kwargs["enable_link_refetch"] = False

    stats = await dependencies.auto_save_records_with_link_fallback(
        db,
        run_id,
        channel,
        sub,
        list(records),
        **transfer_kwargs,
    )

    await _create_subscription_step_log(
        db=db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        dependencies=dependencies,
        step_payload=build_auto_transfer_done_step(
            transfer_source,
            stats,
        ),
    )
    await dependencies.log_background_event(
        **build_auto_transfer_done_event_kwargs(
            transfer_source=transfer_source,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            trace_id=run_id,
            stats=stats,
        )
    )
    return stats


async def run_auto_transfer_for_subscription(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    should_auto_download: bool,
    force_auto_download: bool,
    duplicate_urls: Iterable[str],
    created_records: Iterable[Any],
    tv_missing_snapshot: Any,
    hdhive_unlock_context: dict[str, Any],
    source_order: list[str],
    dependencies: AutoTransferRunDependencies,
) -> AutoTransferRunResult:
    subscription_id = int(sub.id)
    subscription_title = str(sub.title)
    new_records = list(created_records or [])

    if not should_auto_download:
        await _create_subscription_step_log(
            db=db,
            run_id=run_id,
            channel=channel,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            dependencies=dependencies,
            step_payload=build_auto_transfer_skip_step(),
        )
        return AutoTransferRunResult(
            sub_saved_count=0,
            sub_failed_transfer_count=0,
            cleanup_after_auto=None,
            retry_records=[],
        )

    retry_records = await dependencies.select_retry_records(
        db=db,
        subscription_id=subscription_id,
        auto_download=bool(sub.auto_download),
        force_auto_download=force_auto_download,
        duplicate_urls=list(duplicate_urls or []),
        created_records=new_records,
    )

    sub_saved_count = 0
    sub_failed_transfer_count = 0
    cleanup_after_auto: dict[str, Any] | None = None

    if new_records:
        new_auto_stats = await _run_transfer_source(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=new_records,
            transfer_source="new",
            tv_missing_snapshot=tv_missing_snapshot,
            hdhive_unlock_context=hdhive_unlock_context,
            source_order=source_order,
            dependencies=dependencies,
        )
        sub_saved_count += int(new_auto_stats.get("saved") or 0)
        sub_failed_transfer_count += int(new_auto_stats.get("failed") or 0)
        await dependencies.apply_auto_transfer_stats(new_auto_stats, "new")
        if new_auto_stats.get("subscription_completed"):
            cleanup_after_auto = new_auto_stats

    if retry_records and cleanup_after_auto is None:
        retry_auto_stats = await _run_transfer_source(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=retry_records,
            transfer_source="retry",
            tv_missing_snapshot=tv_missing_snapshot,
            hdhive_unlock_context=hdhive_unlock_context,
            source_order=source_order,
            dependencies=dependencies,
            enable_link_refetch=False,
        )
        sub_saved_count += int(retry_auto_stats.get("saved") or 0)
        sub_failed_transfer_count += int(retry_auto_stats.get("failed") or 0)
        await dependencies.apply_auto_transfer_stats(retry_auto_stats, "retry")
        if retry_auto_stats.get("subscription_completed"):
            cleanup_after_auto = retry_auto_stats

    await _create_subscription_step_log(
        db=db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        dependencies=dependencies,
        step_payload=build_auto_transfer_summary_step(
            sub_saved_count=sub_saved_count,
            sub_failed_transfer_count=sub_failed_transfer_count,
            new_record_count=len(new_records),
            retry_record_count=len(retry_records),
        ),
    )

    if cleanup_after_auto is not None:
        await dependencies.delete_subscription_with_records(db, subscription_id)
        await dependencies.log_background_event(
            **build_cleanup_after_transfer_event_kwargs(
                subscription_id=subscription_id,
                subscription_title=subscription_title,
                trace_id=run_id,
                cleanup_stats=cleanup_after_auto,
            )
        )
        await _create_subscription_step_log(
            db=db,
            run_id=run_id,
            channel=channel,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            dependencies=dependencies,
            step_payload=build_cleanup_after_transfer_step(cleanup_after_auto),
        )
        await dependencies.apply_cleanup_stats(sub.media_type)

    return AutoTransferRunResult(
        sub_saved_count=sub_saved_count,
        sub_failed_transfer_count=sub_failed_transfer_count,
        cleanup_after_auto=cleanup_after_auto,
        retry_records=retry_records,
    )
