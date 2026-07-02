from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.emby_service import emby_service
from app.services.operation_log_service import operation_log_service
from app.services.subscription_delete_service import (
    delete_subscription_with_records_with_default_service,
)
from app.services.subscription_cleanup_policy import (
    has_upcoming_episodes_in_subscription_scope,
)
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
    cleanup_completed_subscriptions as cleanup_completed_subscriptions_flow,
    cleanup_single_subscription as cleanup_single_subscription_flow,
)
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
)
from app.services.tv_missing_service import tv_missing_service


DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[Any]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
Sleep = Callable[[float], Awaitable[None]]
RunCleanupCompletedSubscriptions = Callable[..., Awaitable[dict[str, Any]]]
RunCleanupSingleSubscription = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class CompletedCleanupRuntimeDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes
    sleep: Sleep
    run_cleanup_completed_subscriptions: RunCleanupCompletedSubscriptions
    run_cleanup_single_subscription: RunCleanupSingleSubscription


def build_default_completed_cleanup_runtime_dependencies(
    *,
    delete_subscription_with_records: DeleteSubscriptionWithRecords | None = None,
    check_feiniu_movie_status: CheckFeiniuMovieStatus | None = None,
) -> CompletedCleanupRuntimeDependencies:
    return CompletedCleanupRuntimeDependencies(
        delete_subscription_with_records=(
            delete_subscription_with_records
            if delete_subscription_with_records is not None
            else delete_subscription_with_records_with_default_service
        ),
        check_feiniu_movie_status=(
            check_feiniu_movie_status
            if check_feiniu_movie_status is not None
            else check_feiniu_movie_status_with_runtime_adapter
        ),
        log_background_event=operation_log_service.log_background_event,
        get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
        sleep=asyncio.sleep,
        run_cleanup_completed_subscriptions=cleanup_completed_subscriptions_flow,
        run_cleanup_single_subscription=cleanup_single_subscription_flow,
    )


def build_completed_cleanup_dependencies(
    dependencies: CompletedCleanupRuntimeDependencies,
) -> CompletedCleanupDependencies:
    return CompletedCleanupDependencies(
        delete_subscription_with_records=dependencies.delete_subscription_with_records,
        log_background_event=dependencies.log_background_event,
        get_movie_status_by_tmdb=dependencies.get_movie_status_by_tmdb,
        check_feiniu_movie_status=dependencies.check_feiniu_movie_status,
        get_tv_missing_status=dependencies.get_tv_missing_status,
        has_upcoming_episodes=dependencies.has_upcoming_episodes,
        sleep=dependencies.sleep,
    )


async def cleanup_completed_subscriptions_with_runtime_adapter(
    db: Any,
    *,
    dependencies: CompletedCleanupRuntimeDependencies,
) -> dict[str, Any]:
    return await dependencies.run_cleanup_completed_subscriptions(
        db,
        dependencies=build_completed_cleanup_dependencies(dependencies),
    )


async def cleanup_single_subscription_with_runtime_adapter(
    db: Any,
    subscription_id: int,
    *,
    dependencies: CompletedCleanupRuntimeDependencies,
) -> dict[str, Any]:
    return await dependencies.run_cleanup_single_subscription(
        db,
        subscription_id,
        dependencies=build_completed_cleanup_dependencies(dependencies),
    )
