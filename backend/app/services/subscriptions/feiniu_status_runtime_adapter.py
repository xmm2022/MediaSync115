from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.feiniu_service import feiniu_service
from app.services.feiniu_sync_index_service import feiniu_sync_index_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.tmdb_service import tmdb_service


logger = logging.getLogger(__name__)

GetFeiniuUrl = Callable[[], str]
GetIndexedMovieStatus = Callable[[int], Awaitable[dict[str, Any] | None]]
GetLiveMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetIndexedTvExistingEpisodes = Callable[[int], Awaitable[dict[str, Any] | None]]
GetLiveTvEpisodeStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetTvDetail = Callable[[int], Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class FeiniuStatusRuntimeDependencies:
    get_feiniu_url: GetFeiniuUrl
    get_indexed_movie_status: GetIndexedMovieStatus
    get_live_movie_status: GetLiveMovieStatus
    get_indexed_tv_existing_episodes: GetIndexedTvExistingEpisodes
    get_live_tv_episode_status: GetLiveTvEpisodeStatus
    get_tv_detail: GetTvDetail
    logger: Any


def build_default_feiniu_status_runtime_dependencies() -> (
    FeiniuStatusRuntimeDependencies
):
    return FeiniuStatusRuntimeDependencies(
        get_feiniu_url=runtime_settings_service.get_feiniu_url,
        get_indexed_movie_status=feiniu_sync_index_service.get_movie_status,
        get_live_movie_status=feiniu_service.get_movie_status_by_tmdb,
        get_indexed_tv_existing_episodes=(
            feiniu_sync_index_service.get_tv_existing_episodes
        ),
        get_live_tv_episode_status=(
            feiniu_service.get_tv_episode_status_by_tmdb
        ),
        get_tv_detail=tmdb_service.get_tv_detail,
        logger=logger,
    )


async def check_feiniu_movie_status_with_runtime_adapter(
    tmdb_id: int,
    *,
    dependencies: FeiniuStatusRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_feiniu_status_runtime_dependencies()
    )
    if not current_dependencies.get_feiniu_url().strip():
        return {"checked": False}
    try:
        indexed_result = await current_dependencies.get_indexed_movie_status(
            tmdb_id
        )
        if indexed_result is not None:
            if str(indexed_result.get("status") or "") == "ok" and bool(
                indexed_result.get("exists")
            ):
                return {
                    "checked": True,
                    "exists": True,
                    "item_ids": indexed_result.get("item_ids") or [],
                }
            return {
                "checked": True,
                "exists": False,
                "item_ids": [],
            }
        live_result = await current_dependencies.get_live_movie_status(tmdb_id)
        if str(live_result.get("status") or "") == "ok" and bool(
            live_result.get("exists")
        ):
            return {
                "checked": True,
                "exists": True,
                "item_ids": live_result.get("item_ids") or [],
            }
        if str(live_result.get("status") or "") == "not_logged_in":
            return {"checked": False}
        return {
            "checked": str(live_result.get("status") or "") == "ok",
            "exists": False,
            "item_ids": [],
        }
    except Exception:
        current_dependencies.logger.exception(
            "飞牛电影状态查询失败: tmdb_id=%s",
            tmdb_id,
        )
        return {"checked": False}


async def check_feiniu_tv_missing_status_with_runtime_adapter(
    tmdb_id: int,
    *,
    dependencies: FeiniuStatusRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_feiniu_status_runtime_dependencies()
    )
    if not current_dependencies.get_feiniu_url().strip():
        return {"checked": False}
    try:
        indexed_result = (
            await current_dependencies.get_indexed_tv_existing_episodes(tmdb_id)
        )
        feiniu_result = (
            indexed_result
            if indexed_result is not None
            else await current_dependencies.get_live_tv_episode_status(tmdb_id)
        )
        status_text = str(feiniu_result.get("status") or "")
        if status_text not in ("ok",):
            return {"checked": False}

        feiniu_existing = feiniu_result.get("existing_episodes") or set()
        feiniu_existing_pairs = (
            {
                (int(p[0]), int(p[1]))
                for p in feiniu_existing
                if isinstance(p, (list, tuple)) and len(p) == 2
            }
            if isinstance(feiniu_existing, (list, set))
            else feiniu_existing
        )

        tmdb_detail = await current_dependencies.get_tv_detail(tmdb_id)
        seasons = (
            tmdb_detail.get("seasons")
            if isinstance(tmdb_detail, dict)
            else []
        )
        if not isinstance(seasons, list):
            seasons = []
        tmdb_pairs: set[tuple[int, int]] = set()
        for season in seasons:
            if not isinstance(season, dict):
                continue
            sn = season.get("season_number")
            ec = season.get("episode_count")
            if sn is None or ec is None:
                continue
            sn = int(sn)
            ec = int(ec)
            if sn == 0:
                continue
            for ep in range(1, ec + 1):
                tmdb_pairs.add((sn, ep))

        if not tmdb_pairs:
            return {"checked": False}

        missing = tmdb_pairs - feiniu_existing_pairs
        return {"checked": True, "missing_count": len(missing)}
    except Exception:
        current_dependencies.logger.exception(
            "飞牛剧集缺集状态查询失败: tmdb_id=%s",
            tmdb_id,
        )
        return {"checked": False}
