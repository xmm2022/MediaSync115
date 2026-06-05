"""从预设目录或 TMDB 链接导入片单。"""

import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.subscriptions import sanitize_poster_path
from app.core.config import settings
from app.models.watchlist import Watchlist, WatchlistItem
from app.services.watchlist_import_catalog import (
    ImportCatalogItem,
    get_import_catalog,
    resolve_catalog_item,
)
from app.services.tmdb_service import tmdb_service

logger = logging.getLogger(__name__)

SUPPORTED_IMPORT_SOURCES: list[dict[str, str]] = [
    {
        "type": "tmdb_list",
        "label": "TMDB 片单",
        "description": "TMDB 用户创建的公开片单（/list/ID）",
        "example_url": "https://www.themoviedb.org/list/634",
    },
    {
        "type": "tmdb_collection",
        "label": "TMDB 合集",
        "description": "TMDB 官方影视合集，如漫威、哈利波特（/collection/ID）",
        "example_url": "https://www.themoviedb.org/collection/9485",
    },
    {
        "type": "tmdb_keyword",
        "label": "TMDB 关键词",
        "description": "按 TMDB 关键词聚合的电影列表（/keyword/ID）",
        "example_url": "https://www.themoviedb.org/keyword/210024",
    },
]

_URL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("tmdb_list", re.compile(r"(?:themoviedb\.org|tmdb\.org)/list/(\d+)", re.I)),
    ("tmdb_collection", re.compile(r"(?:themoviedb\.org|tmdb\.org)/collection/(\d+)", re.I)),
    ("tmdb_keyword", re.compile(r"(?:themoviedb\.org|tmdb\.org)/keyword/(\d+)", re.I)),
]

_DISCOVER_MAX_PAGES = 8
_LIST_SEARCH_MIN_ITEMS = 5
_WATCH_REGION_FALLBACKS = ("CN", "HK", "TW", "US")


def parse_tmdb_import_reference(
    raw: str,
    *,
    source_type: str | None = None,
) -> tuple[str, int]:
    """解析 TMDB 导入来源，返回 (source_type, source_id)。"""
    text = str(raw or "").strip()
    if not text:
        raise ValueError("请填写 TMDB 链接或 ID")

    for detected_type, pattern in _URL_PATTERNS:
        matched = pattern.search(text)
        if matched:
            resolved_type = str(source_type or detected_type).strip() or detected_type
            if resolved_type != detected_type:
                raise ValueError(f"链接类型为 {detected_type}，与所选类型不一致")
            return detected_type, int(matched.group(1))

    if text.isdigit():
        normalized_type = str(source_type or "").strip()
        if normalized_type not in {item["type"] for item in SUPPORTED_IMPORT_SOURCES}:
            raise ValueError("仅填写 ID 时需选择导入类型")
        return normalized_type, int(text)

    raise ValueError("无法识别 TMDB 链接或 ID，请检查格式")


def _normalize_year(raw_date: Any) -> str | None:
    value = str(raw_date or "").strip()
    if len(value) >= 4 and value[:4].isdigit():
        return value[:4]
    return None


def _normalize_list_item(raw: dict[str, Any], *, default_media_type: str | None = None) -> dict[str, Any] | None:
    media_type = str(raw.get("media_type") or default_media_type or "").strip().lower()
    if media_type not in {"movie", "tv"}:
        if raw.get("title"):
            media_type = "movie"
        elif raw.get("name"):
            media_type = "tv"
        else:
            return None

    tmdb_id = raw.get("id")
    if tmdb_id is None:
        return None
    try:
        tmdb_id = int(tmdb_id)
    except (TypeError, ValueError):
        return None

    title = str(raw.get("title") or raw.get("name") or "").strip()
    if not title:
        return None

    vote_average = raw.get("vote_average")
    rating = float(vote_average) if vote_average is not None else None
    date_value = raw.get("release_date") or raw.get("first_air_date")

    return {
        "tmdb_id": tmdb_id,
        "media_type": media_type,
        "title": title,
        "poster_path": sanitize_poster_path(raw.get("poster_path")),
        "year": _normalize_year(date_value),
        "rating": rating,
    }


def _dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[int, str]] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        key = (int(item["tmdb_id"]), str(item["media_type"]))
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


async def _fetch_tmdb_list_items(source_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = await tmdb_service.get_list_detail(source_id)
    meta = {
        "source_type": "tmdb_list",
        "source_id": source_id,
        "name": str(payload.get("name") or f"TMDB 片单 {source_id}").strip(),
        "description": str(payload.get("description") or "").strip() or None,
    }
    rows = payload.get("items") if isinstance(payload.get("items"), list) else []
    items = [normalized for raw in rows if (normalized := _normalize_list_item(raw))]
    return meta, items


async def _fetch_tmdb_collection_items(source_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = await tmdb_service.get_collection_detail(source_id)
    meta = {
        "source_type": "tmdb_collection",
        "source_id": source_id,
        "name": str(payload.get("name") or f"TMDB 合集 {source_id}").strip(),
        "description": str(payload.get("overview") or "").strip() or None,
    }
    rows = payload.get("parts") if isinstance(payload.get("parts"), list) else []
    items: list[dict[str, Any]] = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        normalized = _normalize_list_item({**raw, "media_type": "movie"})
        if normalized:
            items.append(normalized)
    return meta, items


async def _fetch_tmdb_keyword_items(source_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    keyword_name = ""
    items: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    while page <= total_pages and page <= 10:
        payload = await tmdb_service.get_keyword_movies(source_id, page=page)
        if page == 1 and isinstance(payload.get("keyword"), dict):
            keyword_name = str(payload["keyword"].get("name") or "").strip()
        rows = payload.get("results") if isinstance(payload.get("results"), list) else []
        for raw in rows:
            normalized = _normalize_list_item({**raw, "media_type": "movie"})
            if normalized:
                items.append(normalized)
        total_pages = max(1, int(payload.get("total_pages") or 1))
        page += 1

    meta = {
        "source_type": "tmdb_keyword",
        "source_id": source_id,
        "name": keyword_name or f"TMDB 关键词 {source_id}",
        "description": f"TMDB 关键词：{keyword_name}" if keyword_name else None,
    }
    return meta, items


async def _fetch_by_tmdb_reference(source_type: str, reference: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    resolved_type, source_id = parse_tmdb_import_reference(reference, source_type=source_type)
    if resolved_type == "tmdb_list":
        return await _fetch_tmdb_list_items(source_id)
    if resolved_type == "tmdb_collection":
        return await _fetch_tmdb_collection_items(source_id)
    if resolved_type == "tmdb_keyword":
        return await _fetch_tmdb_keyword_items(source_id)
    raise ValueError(f"不支持的导入类型: {resolved_type}")


def _normalize_provider_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _build_watch_region_candidates(preferred: str | None = None) -> list[str]:
    candidates: list[str] = []
    for code in [str(preferred or "").strip().upper(), *_WATCH_REGION_FALLBACKS]:
        if code and code not in candidates:
            candidates.append(code)
    return candidates or ["US"]


async def _pick_watch_region(preferred: str | None = None) -> str:
    """选择 TMDB 有 watch provider 数据的地区。CN 在 TMDB 上通常为空。"""
    for region in _build_watch_region_candidates(preferred):
        payload = await tmdb_service.get_watch_providers("movie", watch_region=region)
        rows = payload.get("results") if isinstance(payload.get("results"), list) else []
        if rows:
            return region
    return _build_watch_region_candidates(preferred)[-1]


async def _resolve_provider_ids(
    provider_names: list[str],
    *,
    watch_region: str,
    fallback_provider_ids: list[int] | None = None,
) -> str:
    normalized_names = [
        _normalize_provider_name(name)
        for name in provider_names
        if str(name or "").strip()
    ]
    matched_ids: set[int] = set()

    for media_type in ("movie", "tv"):
        payload = await tmdb_service.get_watch_providers(media_type, watch_region=watch_region)
        rows = payload.get("results") if isinstance(payload.get("results"), list) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            provider_id = row.get("provider_id")
            provider_name = _normalize_provider_name(str(row.get("provider_name") or ""))
            if provider_id is None or not provider_name:
                continue
            for target in normalized_names:
                if target in provider_name or provider_name in target:
                    matched_ids.add(int(provider_id))

    if not matched_ids:
        for provider_id in fallback_provider_ids or []:
            probe_params = {
                "with_watch_providers": str(provider_id),
                "sort_by": "popularity.desc",
            }
            movie_payload = await tmdb_service.discover_movies(
                page=1,
                watch_region=watch_region,
                extra_params=probe_params,
            )
            if int(movie_payload.get("total_results") or 0) > 0:
                matched_ids.add(int(provider_id))
                continue
            tv_payload = await tmdb_service.discover_tv(
                page=1,
                watch_region=watch_region,
                extra_params=probe_params,
            )
            if int(tv_payload.get("total_results") or 0) > 0:
                matched_ids.add(int(provider_id))

    if not matched_ids:
        joined_names = "、".join(provider_names)
        raise ValueError(
            f"在 TMDB 地区 {watch_region} 未找到「{joined_names}」的片库数据，"
            "请尝试在设置中调整 TMDB 地区，或使用「高级」导入。"
        )
    return "|".join(str(item) for item in sorted(matched_ids))


async def _discover_by_provider(
    provider_names: list[str],
    *,
    media: str,
    fallback_provider_ids: list[int] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    preferred_region = settings.TMDB_REGION or "CN"
    watch_region = await _pick_watch_region(preferred_region)
    provider_filter = await _resolve_provider_ids(
        provider_names,
        watch_region=watch_region,
        fallback_provider_ids=fallback_provider_ids,
    )
    extra_params = {
        "with_watch_providers": provider_filter,
        "with_watch_monetization_types": "flatrate|free|ads",
        "sort_by": "popularity.desc",
    }
    items: list[dict[str, Any]] = []
    scopes = ["movie", "tv"] if media == "both" else [media]
    for scope in scopes:
        page = 1
        total_pages = 1
        while page <= total_pages and page <= _DISCOVER_MAX_PAGES:
            if scope == "movie":
                payload = await tmdb_service.discover_movies(
                    page=page,
                    watch_region=watch_region,
                    extra_params=extra_params,
                )
            else:
                payload = await tmdb_service.discover_tv(
                    page=page,
                    watch_region=watch_region,
                    extra_params=extra_params,
                )
            rows = payload.get("results") if isinstance(payload.get("results"), list) else []
            for raw in rows:
                normalized = _normalize_list_item(raw, default_media_type=scope)
                if normalized:
                    items.append(normalized)
            total_pages = max(1, int(payload.get("total_pages") or 1))
            page += 1
    return watch_region, _dedupe_items(items)


async def _resolve_list_id_by_search(queries: list[str]) -> tuple[int, str]:
    best_id = 0
    best_name = ""
    best_count = 0
    for query in queries:
        text = str(query or "").strip()
        if not text:
            continue
        payload = await tmdb_service.search_lists(text, page=1)
        rows = payload.get("results") if isinstance(payload.get("results"), list) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            list_id = row.get("id")
            item_count = int(row.get("item_count") or 0)
            if list_id is None or item_count < _LIST_SEARCH_MIN_ITEMS:
                continue
            if item_count > best_count:
                best_count = item_count
                best_id = int(list_id)
                best_name = str(row.get("name") or "").strip()
    if best_id <= 0:
        joined = "、".join(q for q in queries if str(q or "").strip())
        raise ValueError(
            f"未在 TMDB 找到匹配的社区片单（已尝试：{joined}）。"
            "可在「高级」中手动粘贴 TMDB 片单链接导入。"
        )
    return best_id, best_name


async def _fetch_catalog_items(
    catalog_item: ImportCatalogItem,
    *,
    reference: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    fetcher = str(catalog_item.get("fetcher") or "").strip()
    label = str(catalog_item.get("label") or "导入片单").strip()
    description = str(catalog_item.get("description") or "").strip() or None

    if fetcher == "watch_provider":
        provider_names = catalog_item.get("provider_names") or []
        if not isinstance(provider_names, list):
            provider_names = []
        fallback_ids = catalog_item.get("fallback_provider_ids") or []
        if not isinstance(fallback_ids, list):
            fallback_ids = []
        media = str(catalog_item.get("media") or "both").strip()
        watch_region, items = await _discover_by_provider(
            [str(name) for name in provider_names],
            media=media,
            fallback_provider_ids=[int(item) for item in fallback_ids],
        )
        preferred_region = settings.TMDB_REGION or "CN"
        region_hint = watch_region
        if preferred_region and preferred_region.upper() != watch_region:
            region_hint = f"{watch_region}（已自 {preferred_region} 回退）"
        meta = {
            "source_type": "watch_provider",
            "source_id": None,
            "source_key": catalog_item["key"],
            "watch_region": watch_region,
            "name": label,
            "description": f"{description or label}（TMDB 片库地区：{region_hint}）",
        }
        if not items:
            raise ValueError(
                f"「{label}」在 TMDB 地区 {watch_region} 没有可导入的片库条目，"
                "请尝试调整 TMDB 地区或使用「高级」导入。"
            )
        return meta, items

    if fetcher == "tmdb_list":
        list_id = int(catalog_item["list_id"])
        meta, items = await _fetch_tmdb_list_items(list_id)
        meta["source_key"] = catalog_item["key"]
        meta["name"] = label
        if description:
            meta["description"] = description
        return meta, items

    if fetcher == "tmdb_list_search":
        queries = catalog_item.get("search_queries") or []
        list_id, list_name = await _resolve_list_id_by_search(queries if isinstance(queries, list) else [])
        meta, items = await _fetch_tmdb_list_items(list_id)
        meta["source_key"] = catalog_item["key"]
        meta["source_type"] = "tmdb_list"
        meta["source_id"] = list_id
        meta["name"] = label
        meta["description"] = list_name or description
        return meta, items

    if fetcher == "tmdb_reference":
        source_type = str(catalog_item.get("source_type") or "").strip()
        if not str(reference or "").strip():
            raise ValueError("请填写 TMDB 链接或 ID")
        meta, items = await _fetch_by_tmdb_reference(source_type, str(reference))
        meta["source_key"] = catalog_item["key"]
        return meta, items

    raise ValueError(f"不支持的导入方式: {fetcher}")


async def preview_catalog_import(
    *,
    source_key: str,
    reference: str | None = None,
) -> dict[str, Any]:
    """预览预设目录导入内容。"""
    _, catalog_item = resolve_catalog_item(source_key)
    meta, items = await _fetch_catalog_items(catalog_item, reference=reference)
    sample = items[:12]
    return {
        **meta,
        "source_key": source_key,
        "source_label": catalog_item.get("label"),
        "item_count": len(items),
        "movie_count": sum(1 for item in items if item["media_type"] == "movie"),
        "tv_count": sum(1 for item in items if item["media_type"] == "tv"),
        "sample_items": sample,
        "items": items,
    }


async def preview_tmdb_import(
    *,
    source_type: str,
    reference: str,
) -> dict[str, Any]:
    """预览 TMDB 链接导入（兼容旧接口）。"""
    meta, items = await _fetch_by_tmdb_reference(source_type, reference)
    sample = items[:12]
    return {
        **meta,
        "item_count": len(items),
        "movie_count": sum(1 for item in items if item["media_type"] == "movie"),
        "tv_count": sum(1 for item in items if item["media_type"] == "tv"),
        "sample_items": sample,
        "items": items,
    }


async def import_catalog_to_watchlist(
    db: AsyncSession,
    *,
    source_key: str,
    reference: str | None = None,
    watchlist_id: int | None = None,
    name: str | None = None,
    description: str | None = None,
    auto_fill_enabled: bool = False,
) -> dict[str, Any]:
    """将预设目录片单导入本地片单。"""
    _, catalog_item = resolve_catalog_item(source_key)
    preview = await preview_catalog_import(source_key=source_key, reference=reference)
    items: list[dict[str, Any]] = preview.get("items") or []
    if not items:
        raise ValueError("来源没有可导入的影视条目")

    if watchlist_id is None:
        watchlist_name = str(name or preview.get("name") or "导入片单").strip()
        if not watchlist_name:
            raise ValueError("片单名称不能为空")
        watchlist = Watchlist(
            name=watchlist_name[:120],
            description=str(description or preview.get("description") or "").strip() or None,
            auto_fill_enabled=bool(auto_fill_enabled),
        )
        db.add(watchlist)
        await db.flush()
    else:
        watchlist = await db.get(Watchlist, watchlist_id)
        if not watchlist:
            raise ValueError("目标片单不存在")
        if name:
            watchlist.name = str(name).strip()[:120]
        if description is not None:
            watchlist.description = str(description).strip() or None
        if auto_fill_enabled:
            watchlist.auto_fill_enabled = True

    existing_keys: set[tuple[int, str]] = set()
    if watchlist_id is not None:
        result = await db.execute(
            select(WatchlistItem.tmdb_id, WatchlistItem.media_type).where(
                WatchlistItem.watchlist_id == watchlist.id
            )
        )
        existing_keys = {(int(row[0]), str(row[1])) for row in result.all()}

    added = 0
    skipped = 0
    source_note = f"import:{preview.get('source_key') or source_key}"
    for item in items:
        key = (int(item["tmdb_id"]), str(item["media_type"]))
        if key in existing_keys:
            skipped += 1
            continue
        db.add(
            WatchlistItem(
                watchlist_id=watchlist.id,
                tmdb_id=key[0],
                media_type=key[1],
                title=item["title"],
                poster_path=item.get("poster_path"),
                year=item.get("year"),
                rating=item.get("rating"),
                notes=source_note,
            )
        )
        existing_keys.add(key)
        added += 1

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("导入失败：片单中存在重复条目，请重试") from None
    await db.refresh(watchlist)

    source_label = str(preview.get("source_label") or catalog_item.get("label") or source_key)
    return {
        "success": True,
        "watchlist_id": watchlist.id,
        "watchlist_name": watchlist.name,
        "source_key": source_key,
        "source_type": preview.get("source_type"),
        "source_id": preview.get("source_id"),
        "source_label": source_label,
        "added": added,
        "skipped": skipped,
        "failed": 0,
        "total_source_items": len(items),
        "message": (
            f"已从「{source_label}」导入 {added} 部"
            f"（来源共 {len(items)} 部，跳过 {skipped} 部）"
        ),
    }


async def import_tmdb_to_watchlist(
    db: AsyncSession,
    *,
    source_type: str,
    reference: str,
    watchlist_id: int | None = None,
    name: str | None = None,
    description: str | None = None,
    auto_fill_enabled: bool = False,
) -> dict[str, Any]:
    """将 TMDB 片单导入本地片单（兼容旧接口）。"""
    preview = await preview_tmdb_import(source_type=source_type, reference=reference)
    items: list[dict[str, Any]] = preview.get("items") or []
    if not items:
        raise ValueError("TMDB 来源没有可导入的影视条目")

    if watchlist_id is None:
        watchlist_name = str(name or preview.get("name") or "导入片单").strip()
        if not watchlist_name:
            raise ValueError("片单名称不能为空")
        watchlist = Watchlist(
            name=watchlist_name[:120],
            description=str(description or preview.get("description") or "").strip() or None,
            auto_fill_enabled=bool(auto_fill_enabled),
        )
        db.add(watchlist)
        await db.flush()
    else:
        watchlist = await db.get(Watchlist, watchlist_id)
        if not watchlist:
            raise ValueError("目标片单不存在")
        if name:
            watchlist.name = str(name).strip()[:120]
        if description is not None:
            watchlist.description = str(description).strip() or None
        if auto_fill_enabled:
            watchlist.auto_fill_enabled = True

    existing_keys: set[tuple[int, str]] = set()
    if watchlist_id is not None:
        result = await db.execute(
            select(WatchlistItem.tmdb_id, WatchlistItem.media_type).where(
                WatchlistItem.watchlist_id == watchlist.id
            )
        )
        existing_keys = {(int(row[0]), str(row[1])) for row in result.all()}

    added = 0
    skipped = 0
    for item in items:
        key = (int(item["tmdb_id"]), str(item["media_type"]))
        if key in existing_keys:
            skipped += 1
            continue
        db.add(
            WatchlistItem(
                watchlist_id=watchlist.id,
                tmdb_id=key[0],
                media_type=key[1],
                title=item["title"],
                poster_path=item.get("poster_path"),
                year=item.get("year"),
                rating=item.get("rating"),
                notes=f"TMDB:{preview['source_type']}:{preview['source_id']}",
            )
        )
        existing_keys.add(key)
        added += 1

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("导入失败：片单中存在重复条目，请重试") from None
    await db.refresh(watchlist)

    source_label = next(
        (src["label"] for src in SUPPORTED_IMPORT_SOURCES if src["type"] == preview["source_type"]),
        preview["source_type"],
    )
    return {
        "success": True,
        "watchlist_id": watchlist.id,
        "watchlist_name": watchlist.name,
        "source_type": preview["source_type"],
        "source_id": preview["source_id"],
        "source_label": source_label,
        "added": added,
        "skipped": skipped,
        "failed": 0,
        "total_source_items": len(items),
        "message": (
            f"已从 {source_label} 导入 {added} 部"
            f"（来源共 {len(items)} 部，跳过 {skipped} 部）"
        ),
    }


def list_import_catalog() -> list[dict[str, Any]]:
    """对外暴露导入目录。"""
    return get_import_catalog()
