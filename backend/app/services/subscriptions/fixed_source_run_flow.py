from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.run_cleanup_logs import (
    build_fixed_source_movie_cleanup_event_kwargs,
    build_fixed_source_movie_cleanup_step,
)


@dataclass(frozen=True, slots=True)
class FixedSourceRunResult:
    sub_saved_count_delta: int
    sub_failed_transfer_count_delta: int
    fixed_source_stats: dict[str, Any] | None
    movie_cleanup_applied: bool


@dataclass(frozen=True, slots=True)
class FixedSourceRunDependencies:
    should_scan_fixed_sources: Callable[..., bool]
    scan_fixed_sources_for_subscription: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
    apply_fixed_source_transfer_stats: Callable[[int, int], Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]


def _media_type_value(sub: Any) -> Any:
    media_type = getattr(sub, "media_type", None)
    return getattr(media_type, "value", media_type)


def _zero_result() -> FixedSourceRunResult:
    return FixedSourceRunResult(
        sub_saved_count_delta=0,
        sub_failed_transfer_count_delta=0,
        fixed_source_stats=None,
        movie_cleanup_applied=False,
    )


async def run_fixed_source_for_subscription(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    cleanup_after_auto: dict[str, Any] | None,
    force_auto_download: bool,
    tv_missing_snapshot: dict[str, Any] | None,
    dependencies: FixedSourceRunDependencies,
) -> FixedSourceRunResult:
    if cleanup_after_auto is not None:
        return _zero_result()

    if not dependencies.should_scan_fixed_sources(
        sub,
        force_auto_download=force_auto_download,
    ):
        return _zero_result()

    fixed_source_stats = await dependencies.scan_fixed_sources_for_subscription(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        tv_missing_snapshot=tv_missing_snapshot,
        force_auto_download=force_auto_download,
    )
    fixed_saved = int(fixed_source_stats.get("saved") or 0)
    fixed_failed = int(fixed_source_stats.get("failed") or 0)

    await dependencies.apply_fixed_source_transfer_stats(
        fixed_saved,
        fixed_failed,
    )

    movie_cleanup_applied = False
    if _media_type_value(sub) == "movie" and fixed_saved > 0:
        subscription_id = int(sub.id)
        subscription_title = str(sub.title)
        await dependencies.delete_subscription_with_records(db, subscription_id)
        await dependencies.log_background_event(
            **build_fixed_source_movie_cleanup_event_kwargs(
                subscription_id=subscription_id,
                subscription_title=subscription_title,
                trace_id=run_id,
            )
        )
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            **build_fixed_source_movie_cleanup_step(fixed_saved),
        )
        await dependencies.apply_cleanup_stats(sub.media_type)
        movie_cleanup_applied = True

    return FixedSourceRunResult(
        sub_saved_count_delta=fixed_saved,
        sub_failed_transfer_count_delta=fixed_failed,
        fixed_source_stats=fixed_source_stats,
        movie_cleanup_applied=movie_cleanup_applied,
    )
