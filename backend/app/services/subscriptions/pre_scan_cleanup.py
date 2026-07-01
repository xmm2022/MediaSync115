from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.services.subscription_cleanup_policy import (
    build_tv_missing_status_kwargs,
    evaluate_tv_cleanup,
    normalize_tv_follow_mode,
)

DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]


@dataclass(frozen=True)
class PreScanCleanupDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    create_step_log: CreateStepLog
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes


def _media_type_value(sub: Any) -> str | None:
    media_type = getattr(sub, "media_type", None)
    value = getattr(media_type, "value", media_type)
    return str(value) if value is not None else None


def _empty_result() -> dict[str, Any]:
    return {"deleted": False, "tv_missing_snapshot": None}


async def evaluate_pre_scan_cleanup(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupDependencies,
) -> dict[str, Any]:
    if _media_type_value(sub) == "movie":
        return await _evaluate_movie_cleanup(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=dependencies,
        )

    if _media_type_value(sub) != "tv" or sub.tmdb_id is None:
        return _empty_result()

    return await _evaluate_tv_cleanup(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        dependencies=dependencies,
    )


async def _evaluate_movie_cleanup(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupDependencies,
) -> dict[str, Any]:
    if sub.has_successful_transfer:
        await dependencies.delete_subscription_with_records(db, sub.id)
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="subscription_cleanup_movie_transferred",
            status="success",
            message="电影已有转存记录，无需重复处理",
            payload={"reason": "successful_transfer"},
        )
        await dependencies.log_background_event(
            source_type="background_task",
            module="subscriptions",
            action="subscription.item.cleanup_pre_scan",
            status="success",
            message=f"[{sub.title}] 预扫描清理：电影已有成功转存记录，自动删除订阅",
            trace_id=run_id,
            extra={
                "subscription_id": sub.id,
                "title": sub.title,
                "reason": "successful_transfer",
            },
        )
        return {"deleted": True}

    if sub.tmdb_id is None:
        return _empty_result()

    movie_status = await dependencies.get_movie_status_by_tmdb(sub.tmdb_id)
    status_text = str(movie_status.get("status") or "")
    if status_text == "ok":
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="movie_emby_check_done",
            status="info",
            message="已检查媒体库中电影的入库状态",
            payload={
                "tmdb_id": sub.tmdb_id,
                "exists": bool(movie_status.get("exists")),
                "matched_count": len(movie_status.get("item_ids") or []),
            },
        )
        if bool(movie_status.get("exists")):
            await dependencies.delete_subscription_with_records(db, sub.id)
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="subscription_cleanup_movie_emby_exists",
                status="success",
                message="电影已在媒体库中，无需继续订阅",
                payload={
                    "tmdb_id": sub.tmdb_id,
                    "matched_item_ids": movie_status.get("item_ids") or [],
                },
            )
            await dependencies.log_background_event(
                source_type="background_task",
                module="subscriptions",
                action="subscription.item.cleanup_pre_scan",
                status="success",
                message=f"[{sub.title}] 预扫描清理：电影已存在于 Emby，自动删除订阅",
                trace_id=run_id,
                extra={
                    "subscription_id": sub.id,
                    "title": sub.title,
                    "reason": "emby_exists",
                    "tmdb_id": sub.tmdb_id,
                },
            )
            return {"deleted": True}
    elif status_text:
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="movie_emby_check_failed",
            status="warning",
            message=f"媒体库查询失败，暂跳过自动清理：{movie_status.get('message') or '未知错误'}",
            payload={"tmdb_id": sub.tmdb_id, "status": status_text},
        )

    feiniu_movie_status = await dependencies.check_feiniu_movie_status(sub.tmdb_id)
    if feiniu_movie_status.get("checked") and feiniu_movie_status.get("exists"):
        await dependencies.delete_subscription_with_records(db, sub.id)
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="subscription_cleanup_movie_feiniu_exists",
            status="success",
            message="电影已在飞牛媒体库中，无需继续订阅",
            payload={
                "tmdb_id": sub.tmdb_id,
                "matched_item_ids": feiniu_movie_status.get("item_ids") or [],
            },
        )
        await dependencies.log_background_event(
            source_type="background_task",
            module="subscriptions",
            action="subscription.item.cleanup_pre_scan",
            status="success",
            message=f"[{sub.title}] 预扫描清理：电影已存在于飞牛，自动删除订阅",
            trace_id=run_id,
            extra={
                "subscription_id": sub.id,
                "title": sub.title,
                "reason": "feiniu_exists",
                "tmdb_id": sub.tmdb_id,
            },
        )
        return {"deleted": True}

    return _empty_result()


async def _evaluate_tv_cleanup(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupDependencies,
) -> dict[str, Any]:
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=sub.id,
        subscription_title=sub.title,
        step="tv_missing_fetch_start",
        status="info",
        message="正在检查剧集的缺集状态",
        payload={"tmdb_id": sub.tmdb_id},
    )
    tv_kwargs = build_tv_missing_status_kwargs(sub)
    tv_missing_result = await dependencies.get_tv_missing_status(
        sub.tmdb_id,
        **tv_kwargs,
    )
    status_text = str(tv_missing_result.get("status") or "")
    if status_text == "ok":
        counts = (
            tv_missing_result.get("counts")
            if isinstance(tv_missing_result.get("counts"), dict)
            else {}
        )
        missing_count = int(counts.get("missing") or 0)
        follow_mode = normalize_tv_follow_mode(sub.tv_follow_mode)
        has_upcoming = False
        if follow_mode == "new":
            has_upcoming = await dependencies.has_upcoming_episodes(sub.tmdb_id, sub)
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="tv_missing_fetch_done",
            status="success",
            message=f"缺集检查完成：共 {int(counts.get('aired') or 0)} 集，已有 {int(counts.get('existing') or 0)} 集，缺失 {missing_count} 集",
            payload={
                "aired_count": int(counts.get("aired") or 0),
                "existing_count": int(counts.get("existing") or 0),
                "missing_count": missing_count,
                "follow_mode": follow_mode,
                "has_upcoming_episodes": has_upcoming,
            },
        )
        should_cleanup, cleanup_reason = evaluate_tv_cleanup(
            tv_missing_result,
            follow_mode=follow_mode,
            has_upcoming_episodes=has_upcoming,
        )
        if should_cleanup:
            await dependencies.delete_subscription_with_records(db, sub.id)
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="subscription_cleanup_tv_no_missing",
                status="success",
                message=cleanup_reason or "剧集已全部入库，无需继续订阅",
                payload={
                    "tmdb_id": sub.tmdb_id,
                    "missing_count": 0,
                    "follow_mode": follow_mode,
                },
            )
            await dependencies.log_background_event(
                source_type="background_task",
                module="subscriptions",
                action="subscription.item.cleanup_pre_scan",
                status="success",
                message=f"[{sub.title}] 预扫描清理：{cleanup_reason}，自动删除订阅",
                trace_id=run_id,
                extra={
                    "subscription_id": sub.id,
                    "title": sub.title,
                    "reason": cleanup_reason,
                    "tmdb_id": sub.tmdb_id,
                },
            )
            return {"deleted": True, "tv_missing_snapshot": tv_missing_result}
        return {"deleted": False, "tv_missing_snapshot": tv_missing_result}

    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=sub.id,
        subscription_title=sub.title,
        step="tv_missing_fetch_failed",
        status="warning",
        message=f"缺集检查失败，暂跳过自动清理：{tv_missing_result.get('message') or '未知错误'}",
        payload={"tmdb_id": sub.tmdb_id, "status": status_text or "unknown"},
    )
    return _empty_result()
