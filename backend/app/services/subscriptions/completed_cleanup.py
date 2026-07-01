from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import or_, select
from sqlalchemy.exc import OperationalError

from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
from app.services.subscription_cleanup_policy import (
    build_tv_missing_status_kwargs,
    evaluate_movie_cleanup,
    evaluate_tv_cleanup,
    normalize_tv_follow_mode,
)

logger = logging.getLogger(__name__)

DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[Any]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class CompletedCleanupDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes
    sleep: Sleep = asyncio.sleep


def _media_type_value(sub: Any) -> str | None:
    media_type = getattr(sub, "media_type", None)
    value = getattr(media_type, "value", media_type)
    return str(value) if value is not None else None


def _media_type_detail_value(sub: Any) -> str:
    media_type = getattr(sub, "media_type", None)
    return str(media_type.value) if hasattr(media_type, "value") else str(media_type)


def _is_local_mediasync_subscription(sub: Any) -> bool:
    provider = str(getattr(sub, "provider", "") or "mediasync115").strip()
    external_system = str(getattr(sub, "external_system", "") or "").strip()
    return provider in {"", "mediasync115"} and external_system in {
        "",
        "mediasync115",
    }


async def cleanup_completed_subscriptions(
    db: Any,
    *,
    dependencies: CompletedCleanupDependencies,
) -> dict[str, Any]:
    result: dict[str, Any] = {"deleted_count": 0, "details": []}
    pending_log_payloads: list[dict[str, Any]] = []

    for retry in range(3):
        try:
            result, pending_log_payloads = await _delete_completed_subscriptions_once(
                db,
                dependencies=dependencies,
            )
            if result["deleted_count"] > 0:
                await db.commit()
            break
        except OperationalError as exc:
            await db.rollback()
            if not _is_retryable_commit_error(exc) or retry >= 2:
                raise
            delay = 1.0 * (2 ** retry)
            logger.warning(
                "订阅清理 commit 遇到数据库并发冲突，%0.1fs 后重试（%d/3）",
                delay,
                retry + 1,
            )
            await dependencies.sleep(delay)

    if result["deleted_count"] > 0:
        logger.info(
            "离线完成触发订阅清理，共删除 %d 项订阅",
            result["deleted_count"],
        )

        for payload in pending_log_payloads:
            try:
                await dependencies.log_background_event(
                    source_type="background_task",
                    module="subscriptions",
                    action="subscription.item.cleanup_offline_completed",
                    status="success",
                    message=f"[{payload['title']}] 离线完成触发清理：{payload['reason']}，自动删除订阅",
                    extra=payload,
                )
            except Exception:
                logger.exception("写订阅清理操作日志失败: %s", payload.get("title"))
    return result


def _is_retryable_commit_error(exc: OperationalError) -> bool:
    message = str(exc).lower()
    return any(
        token in message
        for token in (
            "deadlock detected",
            "could not serialize access",
            "lock timeout",
        )
    )


async def _delete_completed_subscriptions_once(
    db: Any,
    *,
    dependencies: CompletedCleanupDependencies,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    result: dict[str, Any] = {"deleted_count": 0, "details": []}

    has_successful_transfer = (
        select(DownloadRecord.id)
        .where(
            DownloadRecord.subscription_id == Subscription.id,
            or_(
                DownloadRecord.completed_at.is_not(None),
                DownloadRecord.status.in_(
                    (MediaStatus.COMPLETED, MediaStatus.OFFLINE_COMPLETED)
                ),
            ),
        )
        .exists()
        .label("has_successful_transfer")
    )

    subs_result = await db.execute(
        select(
            Subscription.id,
            Subscription.tmdb_id,
            Subscription.title,
            Subscription.media_type,
            Subscription.tv_scope,
            Subscription.tv_season_number,
            Subscription.tv_episode_start,
            Subscription.tv_episode_end,
            Subscription.tv_follow_mode,
            Subscription.tv_include_specials,
            has_successful_transfer,
        )
        .where(
            Subscription.is_active == True,  # noqa: E712
            or_(
                Subscription.provider.is_(None),
                Subscription.provider == "",
                Subscription.provider == "mediasync115",
            ),
            or_(
                Subscription.external_system.is_(None),
                Subscription.external_system == "",
                Subscription.external_system == "mediasync115",
            ),
        )
        .order_by(Subscription.id.asc())
    )

    pending_log_payloads: list[dict[str, Any]] = []
    for row in subs_result.all():
        sub_id = int(row.id)
        title = str(row.title or "")
        sub_has_transfer = bool(row.has_successful_transfer)
        should_delete, reason = await evaluate_subscription_cleanup_eligibility(
            row,
            has_successful_transfer=sub_has_transfer,
            dependencies=dependencies,
        )

        if should_delete:
            await dependencies.delete_subscription_with_records(db, sub_id)
            result["deleted_count"] += 1
            detail = {
                "subscription_id": sub_id,
                "title": title,
                "media_type": _media_type_detail_value(row),
                "reason": reason,
            }
            result["details"].append(detail)
            pending_log_payloads.append(
                {
                    "subscription_id": sub_id,
                    "title": title,
                    "reason": reason,
                }
            )

    return result, pending_log_payloads


async def _subscription_has_successful_transfer(
    db: Any, subscription_id: int
) -> bool:
    exists_clause = (
        select(DownloadRecord.id)
        .where(
            DownloadRecord.subscription_id == subscription_id,
            or_(
                DownloadRecord.completed_at.is_not(None),
                DownloadRecord.status.in_(
                    (MediaStatus.COMPLETED, MediaStatus.OFFLINE_COMPLETED)
                ),
            ),
        )
        .exists()
    )
    result = await db.execute(select(exists_clause))
    return bool(result.scalar())


async def evaluate_subscription_cleanup_eligibility(
    sub: Any,
    *,
    has_successful_transfer: bool,
    dependencies: CompletedCleanupDependencies,
) -> tuple[bool, str]:
    if _media_type_value(sub) == MediaType.MOVIE.value:
        emby_exists = False
        feiniu_exists = False
        if getattr(sub, "tmdb_id", None) is not None:
            try:
                movie_status = await dependencies.get_movie_status_by_tmdb(sub.tmdb_id)
                emby_exists = str(movie_status.get("status") or "") == "ok" and bool(
                    movie_status.get("exists")
                )
            except Exception:
                logger.exception("订阅清理检查 Emby 电影失败: %s", sub.title)
            feiniu_movie = await dependencies.check_feiniu_movie_status(sub.tmdb_id)
            feiniu_exists = bool(
                feiniu_movie.get("checked") and feiniu_movie.get("exists")
            )
        return evaluate_movie_cleanup(
            has_successful_transfer=has_successful_transfer,
            emby_exists=emby_exists,
            feiniu_exists=feiniu_exists,
        )

    if (
        _media_type_value(sub) != MediaType.TV.value
        or getattr(sub, "tmdb_id", None) is None
    ):
        return False, ""

    try:
        tv_kwargs = build_tv_missing_status_kwargs(sub)
        tv_missing_result = await dependencies.get_tv_missing_status(
            sub.tmdb_id,
            **tv_kwargs,
        )
        follow_mode = normalize_tv_follow_mode(sub.tv_follow_mode)
        has_upcoming = False
        if follow_mode == "new":
            has_upcoming = await dependencies.has_upcoming_episodes(sub.tmdb_id, sub)
        return evaluate_tv_cleanup(
            tv_missing_result,
            follow_mode=follow_mode,
            has_upcoming_episodes=has_upcoming,
        )
    except Exception:
        logger.exception("订阅清理检查剧集状态失败: %s", sub.title)
        return False, ""


async def cleanup_single_subscription(
    db: Any,
    subscription_id: int,
    *,
    dependencies: CompletedCleanupDependencies,
) -> dict[str, Any]:
    sub_result = await db.execute(
        select(Subscription).where(Subscription.id == subscription_id)
    )
    sub = sub_result.scalar_one_or_none()
    if sub is None:
        return {"deleted": False, "reason": "订阅不存在"}
    if not sub.is_active:
        return {"deleted": False, "reason": "订阅未激活"}
    if not _is_local_mediasync_subscription(sub):
        return {
            "deleted": False,
            "reason": "外部渠道订阅不参与 MediaSync115 自动清理",
        }

    sub_has_transfer = await _subscription_has_successful_transfer(db, sub.id)
    should_delete, reason = await evaluate_subscription_cleanup_eligibility(
        sub,
        has_successful_transfer=sub_has_transfer,
        dependencies=dependencies,
    )

    if not should_delete:
        return {"deleted": False, "reason": ""}

    await dependencies.delete_subscription_with_records(db, sub.id)
    await db.commit()
    await dependencies.log_background_event(
        source_type="api",
        module="subscriptions",
        action="subscription.item.cleanup_manual",
        status="success",
        message=f"[{sub.title}] 手动触发清理：{reason}，自动删除订阅",
        extra={
            "subscription_id": sub.id,
            "title": sub.title,
            "reason": reason,
        },
    )
    logger.info(
        "单订阅清理完成: id=%d title=%s reason=%s",
        sub.id,
        sub.title,
        reason,
    )
    return {"deleted": True, "reason": reason}
