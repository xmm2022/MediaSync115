from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_metadata import (
    build_hdhive_keyword,
    build_pansou_keyword,
    build_tg_keyword,
)


SearchPansouByTmdb = Callable[
    [int, str, int | None],
    Awaitable[dict[str, Any]],
]
SearchPansouByKeyword = Callable[[str], Awaitable[Any]]
NormalizePansouResources = Callable[[Any], list[dict[str, Any]]]
FetchHDHiveByTmdb = Callable[[int], Awaitable[list[dict[str, Any]]]]
FetchHDHiveByKeyword = Callable[..., Awaitable[list[dict[str, Any]]]]
NormalizeHDHiveItems = Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
PreferHDHiveFree = Callable[[], bool]
SortHDHiveFreeFirst = Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
SearchTgByKeyword = Callable[..., Awaitable[list[dict[str, Any]]]]
OfflineTransferEnabled = Callable[[], bool]
SearchSeedhubMagnets = Callable[..., Awaitable[list[dict[str, Any]]]]
SearchButailingMagnets = Callable[..., Awaitable[list[dict[str, Any]]]]
LogOfflineSourceFetch = Callable[..., Awaitable[None]]


@dataclass(frozen=True)
class ResourceFetcherDependencies:
    search_pansou_by_tmdb: SearchPansouByTmdb
    search_pansou_by_keyword: SearchPansouByKeyword
    normalize_pansou_resources: NormalizePansouResources
    get_hdhive_tv_pan115: FetchHDHiveByTmdb
    get_hdhive_movie_pan115: FetchHDHiveByTmdb
    get_hdhive_by_keyword: FetchHDHiveByKeyword
    normalize_hdhive_items: NormalizeHDHiveItems
    prefer_hdhive_free: PreferHDHiveFree
    sort_hdhive_free_first: SortHDHiveFreeFirst
    search_tg_by_keyword: SearchTgByKeyword
    offline_transfer_enabled: OfflineTransferEnabled
    search_seedhub_magnets: SearchSeedhubMagnets
    search_butailing_magnets: SearchButailingMagnets
    log_offline_source_fetch: LogOfflineSourceFetch


async def fetch_from_pansou(
    sub: Any,
    *,
    dependencies: ResourceFetcherDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    traces: list[dict[str, Any]] = []
    media_type = _media_type_label(sub)

    tmdb_id = getattr(sub, "tmdb_id", None)
    if tmdb_id is not None:
        try:
            traces.append(
                {
                    "step": "fetch_pansou_tmdb_start",
                    "status": "info",
                    "message": "开始通过 tmdb_id 调用 Pansou",
                    "payload": {"tmdb_id": tmdb_id, "media_type": media_type},
                }
            )
            pansou_result = await dependencies.search_pansou_by_tmdb(
                tmdb_id,
                media_type,
                getattr(sub, "tv_season_number", None)
                if media_type == "tv"
                else None,
            )
            pansou_list = list(pansou_result.get("list") or [])
            if pansou_list:
                traces.append(
                    {
                        "step": "fetch_pansou_tmdb_done",
                        "status": "success",
                        "message": f"Pansou(TMDB) 返回 {len(pansou_list)} 条候选资源",
                        "payload": {"count": len(pansou_list)},
                    }
                )
                return pansou_list, traces
            traces.append(
                {
                    "step": "fetch_pansou_tmdb_empty",
                    "status": "warning",
                    "message": "Pansou(TMDB) 未命中资源，尝试关键词兜底",
                }
            )
        except Exception as exc:
            traces.append(
                {
                    "step": "fetch_pansou_tmdb_failed",
                    "status": "warning",
                    "message": "Pansou(TMDB) 请求失败，尝试关键词兜底",
                    "payload": {"error": str(exc)[:300]},
                }
            )

    keyword = build_pansou_keyword(
        str(getattr(sub, "title", "") or ""),
        getattr(sub, "year", None),
    )
    if not keyword:
        traces.append(
            {
                "step": "fetch_pansou_keyword_skip",
                "status": "warning",
                "message": "缺少关键词，无法执行 Pansou 兜底搜索",
            }
        )
        return [], traces
    traces.append(
        {
            "step": "fetch_pansou_keyword_start",
            "status": "info",
            "message": "开始通过关键词调用 Pansou",
            "payload": {"keyword": keyword},
        }
    )
    payload = await dependencies.search_pansou_by_keyword(keyword)
    resources = dependencies.normalize_pansou_resources(payload)
    traces.append(
        {
            "step": "fetch_pansou_keyword_done",
            "status": "success" if resources else "warning",
            "message": f"Pansou(关键词) 返回 {len(resources)} 条候选资源",
            "payload": {"count": len(resources)},
        }
    )
    return resources, traces


async def fetch_from_hdhive(
    sub: Any,
    *,
    dependencies: ResourceFetcherDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    traces: list[dict[str, Any]] = []
    resources: list[dict[str, Any]] = []
    media_type = _media_type_label(sub)
    tmdb_id = getattr(sub, "tmdb_id", None)

    if tmdb_id is not None:
        try:
            traces.append(
                {
                    "step": "fetch_hdhive_tmdb_start",
                    "status": "info",
                    "message": "开始通过 tmdb_id 调用 HDHive",
                    "payload": {
                        "tmdb_id": tmdb_id,
                        "media_type": _media_type_value(sub),
                    },
                }
            )
            if media_type == "tv":
                resources = await dependencies.get_hdhive_tv_pan115(tmdb_id)
            else:
                resources = await dependencies.get_hdhive_movie_pan115(tmdb_id)
            resources = dependencies.normalize_hdhive_items(resources)
            if dependencies.prefer_hdhive_free():
                resources = dependencies.sort_hdhive_free_first(resources)
            traces.append(
                {
                    "step": "fetch_hdhive_tmdb_done",
                    "status": "success" if resources else "warning",
                    "message": f"HDHive(TMDB) 返回 {len(resources)} 条候选资源",
                    "payload": {"count": len(resources)},
                }
            )
            if resources:
                return resources, traces
        except Exception as exc:
            traces.append(
                {
                    "step": "fetch_hdhive_tmdb_failed",
                    "status": "warning",
                    "message": "HDHive(TMDB) 请求失败，尝试关键词兜底",
                    "payload": {"error": str(exc)[:300]},
                }
            )

    keyword = build_hdhive_keyword(
        str(getattr(sub, "title", "") or ""),
        getattr(sub, "year", None),
    )
    if not keyword:
        traces.append(
            {
                "step": "fetch_hdhive_keyword_skip",
                "status": "warning",
                "message": "缺少关键词，无法执行 HDHive 兜底搜索",
            }
        )
        return [], traces

    traces.append(
        {
            "step": "fetch_hdhive_keyword_start",
            "status": "info",
            "message": "开始通过关键词调用 HDHive",
            "payload": {"keyword": keyword},
        }
    )
    keyword_resources = await dependencies.get_hdhive_by_keyword(
        keyword,
        media_type=media_type,
    )
    keyword_resources = dependencies.normalize_hdhive_items(keyword_resources)
    if dependencies.prefer_hdhive_free():
        keyword_resources = dependencies.sort_hdhive_free_first(keyword_resources)
    traces.append(
        {
            "step": "fetch_hdhive_keyword_done",
            "status": "success" if keyword_resources else "warning",
            "message": f"HDHive(关键词) 返回 {len(keyword_resources)} 条候选资源",
            "payload": {"count": len(keyword_resources)},
        }
    )
    return keyword_resources, traces


async def fetch_from_tg(
    sub: Any,
    *,
    dependencies: ResourceFetcherDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    traces: list[dict[str, Any]] = []
    keyword = build_tg_keyword(
        str(getattr(sub, "title", "") or ""),
        getattr(sub, "year", None),
    )
    if not keyword:
        traces.append(
            {
                "step": "fetch_tg_keyword_skip",
                "status": "warning",
                "message": "缺少关键词，无法执行 Telegram 搜索",
            }
        )
        return [], traces

    traces.append(
        {
            "step": "fetch_tg_keyword_start",
            "status": "info",
            "message": "开始通过关键词调用 Telegram 频道搜索",
            "payload": {"keyword": keyword},
        }
    )
    resources = await dependencies.search_tg_by_keyword(
        keyword,
        media_type=_media_type_label(sub),
    )
    traces.append(
        {
            "step": "fetch_tg_keyword_done",
            "status": "success" if resources else "warning",
            "message": f"Telegram 返回 {len(resources)} 条候选资源",
            "payload": {"count": len(resources)},
        }
    )
    return resources, traces


async def fetch_offline_magnets(
    sub: Any,
    *,
    dependencies: ResourceFetcherDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """离线转存启用时，从 SeedHub / 不太灵并发抓取磁力资源。"""
    if not dependencies.offline_transfer_enabled():
        return [], []

    traces: list[dict[str, Any]] = []
    keyword = build_pansou_keyword(
        str(getattr(sub, "title", "") or ""),
        getattr(sub, "year", None),
    )
    media_type = _media_type_label(sub)

    async def _seedhub() -> list[dict[str, Any]]:
        if not keyword:
            return []
        return await dependencies.search_seedhub_magnets(keyword, limit=20)

    async def _butailing() -> list[dict[str, Any]]:
        if not keyword:
            return []
        return await dependencies.search_butailing_magnets(
            keyword,
            media_type=media_type,
        )

    seedhub_result, butailing_result = await asyncio.gather(
        _seedhub(),
        _butailing(),
        return_exceptions=True,
    )

    merged: list[dict[str, Any]] = []
    for label, result in [
        ("SeedHub", seedhub_result),
        ("不太灵", butailing_result),
    ]:
        if isinstance(result, BaseException):
            traces.append(
                {
                    "step": "fetch_offline_magnet_error",
                    "status": "warning",
                    "message": f"{label} 磁力抓取失败: {str(result)[:200]}",
                }
            )
            await dependencies.log_offline_source_fetch(
                source_type="background_task",
                module="subscriptions",
                action="subscription.item.fetch_offline_source",
                status="warning",
                message=f"[{sub.title}] 离线来源 {label} 抓取失败：{str(result)[:200]}",
                extra={
                    "subscription_id": sub.id,
                    "title": sub.title,
                    "source": label,
                    "error": str(result)[:300],
                },
            )
        elif result:
            merged.extend(result)
            traces.append(
                {
                    "step": "fetch_offline_magnet_done",
                    "status": "info",
                    "message": f"{label} 磁力资源 {len(result)} 条",
                    "payload": {"source": label, "count": len(result)},
                }
            )
            await dependencies.log_offline_source_fetch(
                source_type="background_task",
                module="subscriptions",
                action="subscription.item.fetch_offline_source",
                status="success",
                message=f"[{sub.title}] 离线来源 {label} 返回 {len(result)} 条磁力资源",
                extra={
                    "subscription_id": sub.id,
                    "title": sub.title,
                    "source": label,
                    "count": len(result),
                },
            )

    if merged:
        traces.append(
            {
                "step": "fetch_offline_magnet_summary",
                "status": "success",
                "message": f"离线磁力资源合计 {len(merged)} 条",
                "payload": {"total": len(merged)},
            }
        )

    return merged, traces


def _media_type_value(sub: Any) -> str:
    media_type = getattr(sub, "media_type", None)
    return str(getattr(media_type, "value", media_type) or "")


def _media_type_label(sub: Any) -> str:
    return "tv" if _media_type_value(sub) == "tv" else "movie"
