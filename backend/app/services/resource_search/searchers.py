from __future__ import annotations

import asyncio
from typing import Any

from app.services.pansou_service import pansou_service
from app.services.resource_search.keywords import build_pansou_keyword_candidates
from app.services.resource_search.pansou import normalize_pansou_pan115_list
from app.services.runtime_settings_service import runtime_settings_service
from app.services.tmdb_service import tmdb_service


async def load_media_payload(tmdb_id: int, media_type: str) -> dict:
    try:
        if media_type == "tv":
            payload = await tmdb_service.get_tv_detail(tmdb_id)
        else:
            payload = await tmdb_service.get_movie_detail(tmdb_id)
    except ValueError:
        return {}
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


async def search_pansou_pan115_resources(
    tmdb_id: int, media_type: str, season: int | None = None
) -> dict[str, Any]:
    pansou_service.set_base_url(runtime_settings_service.get_pansou_base_url())
    media_payload = await load_media_payload(tmdb_id, media_type)

    keyword_candidates = build_pansou_keyword_candidates(
        media_payload, media_type, tmdb_id, season
    )
    selected_keyword = (
        keyword_candidates[0] if keyword_candidates else f"TMDB {tmdb_id}"
    )
    attempted_keywords: list[str] = []
    attempts: list[dict[str, Any]] = []

    async def try_pansou_keyword(keyword: str) -> dict[str, Any] | None:
        try:
            pansou_payload = await pansou_service.search_115(keyword, res="results")
            pansou_list = normalize_pansou_pan115_list(pansou_payload)
            return {
                "keyword": keyword,
                "list": pansou_list,
                "status": "ok",
                "count": len(pansou_list),
            }
        except Exception as exc:
            attempts.append(
                {
                    "service": "pansou",
                    "keyword": keyword,
                    "status": "error",
                    "error": str(exc),
                }
            )
            return None

    tasks = [try_pansou_keyword(keyword) for keyword in keyword_candidates]
    attempted_keywords = list(keyword_candidates)
    for coro in asyncio.as_completed(tasks):
        result = await coro
        if result and result["list"]:
            attempts.append(
                {
                    "service": "pansou",
                    "keyword": result["keyword"],
                    "status": "ok",
                    "count": result["count"],
                }
            )
            return {
                "keyword": result["keyword"],
                "list": result["list"],
                "attempted_keywords": attempted_keywords,
                "keyword_hit_index": keyword_candidates.index(result["keyword"]),
                "attempts": attempts,
            }
        if result:
            attempts.append(
                {
                    "service": "pansou",
                    "keyword": result["keyword"],
                    "status": "ok",
                    "count": 0,
                }
            )

    return {
        "keyword": selected_keyword,
        "list": [],
        "attempted_keywords": attempted_keywords,
        "keyword_hit_index": None,
        "attempts": attempts,
    }

