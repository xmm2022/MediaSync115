"""片单服务：补缺订阅等。"""

import logging
from typing import Any

from sqlalchemy import select

from app.core.database import async_session_maker
from app.core.timezone_utils import beijing_now
from app.models.models import MediaType
from app.models.watchlist import Watchlist, WatchlistItem
from app.services.chart_subscription_service import (
    _create_subscription_if_not_exists,
    load_existing_subscription_keys,
)
from app.services.operation_log_service import operation_log_service

logger = logging.getLogger(__name__)


async def fill_watchlist_missing_subscriptions(
    watchlist_id: int,
    *,
    only_unsubscribed: bool = True,
) -> dict[str, Any]:
    """为片单中尚未订阅的条目创建订阅。"""
    async with async_session_maker() as db:
        watchlist = await db.get(Watchlist, watchlist_id)
        if not watchlist:
            return {"success": False, "message": "片单不存在"}

        result = await db.execute(
            select(WatchlistItem).where(WatchlistItem.watchlist_id == watchlist_id)
        )
        items = list(result.scalars().all())

    new_count = 0
    existing_count = 0
    failed_count = 0
    skipped_count = 0

    existing_keys: set[tuple[int, MediaType]] = set()
    if only_unsubscribed and items:
        pairs = [
            (
                item.tmdb_id,
                MediaType.TV if item.media_type == "tv" else MediaType.MOVIE,
            )
            for item in items
        ]
        existing_keys = await load_existing_subscription_keys(pairs)

    for item in items:
        media_enum = MediaType.TV if item.media_type == "tv" else MediaType.MOVIE
        if only_unsubscribed and (item.tmdb_id, media_enum) in existing_keys:
            existing_count += 1
            continue

        try:
            created = await _create_subscription_if_not_exists(
                tmdb_id=item.tmdb_id,
                media_type=media_enum,
                title=item.title,
                year=item.year,
                rating=item.rating,
                overview="",
                poster_path=item.poster_path,
                douban_id=None,
            )
            if created:
                new_count += 1
            else:
                existing_count += 1
        except Exception as exc:
            logger.warning("片单补缺订阅失败: %s — %s", item.title, exc)
            failed_count += 1

    return {
        "success": True,
        "watchlist_id": watchlist_id,
        "watchlist_name": watchlist.name,
        "total_items": len(items),
        "new_subscriptions": new_count,
        "existing_subscriptions": existing_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "message": f"片单「{watchlist.name}」补缺完成：新增 {new_count}，已有 {existing_count}，失败 {failed_count}",
    }


async def run_auto_fill_watchlists() -> dict[str, Any]:
    """为所有启用自动填充的片单补齐缺失订阅。"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(Watchlist.id, Watchlist.name)
            .where(Watchlist.auto_fill_enabled == True)  # noqa: E712
            .order_by(Watchlist.updated_at.desc())
        )
        watchlists = [(int(row.id), str(row.name or "")) for row in result.all()]

    if not watchlists:
        return {
            "success": True,
            "skipped": True,
            "message": "没有启用自动填充的片单",
            "watchlists_processed": 0,
        }

    started_at = beijing_now().isoformat()
    results: list[dict[str, Any]] = []
    total_new = 0
    total_existing = 0
    total_failed = 0

    for watchlist_id, watchlist_name in watchlists:
        try:
            result = await fill_watchlist_missing_subscriptions(watchlist_id)
        except Exception as exc:
            logger.exception("片单自动填充失败: %s — %s", watchlist_name, exc)
            total_failed += 1
            results.append(
                {
                    "watchlist_id": watchlist_id,
                    "watchlist_name": watchlist_name,
                    "success": False,
                    "error": str(exc),
                }
            )
            continue

        total_new += int(result.get("new_subscriptions") or 0)
        total_existing += int(result.get("existing_subscriptions") or 0)
        total_failed += int(result.get("failed") or 0)
        if result.get("success") is False:
            total_failed += 1
        results.append(result)

    message = (
        f"片单自动填充完成：处理 {len(watchlists)} 个片单，"
        f"新增 {total_new}，已有 {total_existing}，失败 {total_failed}"
    )
    await operation_log_service.log_background_event(
        source_type="background_task",
        module="watchlist",
        action="watchlist.auto_fill.finish",
        status="success" if total_failed == 0 else "warning",
        message=message,
        extra={
            "watchlists_processed": len(watchlists),
            "total_new": total_new,
            "total_existing": total_existing,
            "total_failed": total_failed,
        },
    )
    return {
        "success": True,
        "message": message,
        "started_at": started_at,
        "finished_at": beijing_now().isoformat(),
        "watchlists_processed": len(watchlists),
        "total_new": total_new,
        "total_existing": total_existing,
        "total_failed": total_failed,
        "watchlists": results,
    }


async def get_watchlist_item_status_map() -> dict[str, Any]:
    """返回片单条目状态映射，供探索页展示。"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(WatchlistItem, Watchlist.name, Watchlist.id)
            .join(Watchlist, Watchlist.id == WatchlistItem.watchlist_id)
            .order_by(WatchlistItem.added_at.desc())
        )
        rows = result.all()

    item_map: dict[str, list[dict[str, Any]]] = {}
    for item, watchlist_name, watchlist_id in rows:
        key = f"{item.media_type}:{item.tmdb_id}"
        item_map.setdefault(key, []).append(
            {
                "watchlist_id": watchlist_id,
                "watchlist_name": watchlist_name,
                "item_id": item.id,
            }
        )

    return {"item_map": item_map}
