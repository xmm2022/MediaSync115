from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.emby_service import emby_service
from app.services.operation_log_service import operation_log_service
from app.services.subscription_cleanup_policy import (
    has_upcoming_episodes_in_subscription_scope,
)
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
from app.services.tv_missing_service import tv_missing_service


DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
RunEvaluatePreScanCleanup = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class PreScanCleanupRuntimeDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    create_step_log: CreateStepLog
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes
    run_evaluate_pre_scan_cleanup: RunEvaluatePreScanCleanup


def build_default_pre_scan_cleanup_runtime_dependencies(
    *,
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
    create_step_log: CreateStepLog,
    check_feiniu_movie_status: CheckFeiniuMovieStatus,
) -> PreScanCleanupRuntimeDependencies:
    return PreScanCleanupRuntimeDependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
        check_feiniu_movie_status=check_feiniu_movie_status,
        log_background_event=operation_log_service.log_background_event,
        get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
        run_evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup_flow,
    )


async def evaluate_pre_scan_cleanup_with_runtime_adapter(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupRuntimeDependencies,
) -> dict[str, Any]:
    return await dependencies.run_evaluate_pre_scan_cleanup(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        dependencies=PreScanCleanupDependencies(
            delete_subscription_with_records=(
                dependencies.delete_subscription_with_records
            ),
            create_step_log=dependencies.create_step_log,
            log_background_event=dependencies.log_background_event,
            get_movie_status_by_tmdb=dependencies.get_movie_status_by_tmdb,
            check_feiniu_movie_status=dependencies.check_feiniu_movie_status,
            get_tv_missing_status=dependencies.get_tv_missing_status,
            has_upcoming_episodes=dependencies.has_upcoming_episodes,
        ),
    )
