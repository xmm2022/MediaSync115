from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.resource_fetchers import (
    ResourceFetcherDependencies,
    fetch_from_hdhive,
    fetch_from_pansou,
    fetch_from_tg,
    fetch_offline_magnets,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(
    *,
    title: str = "测试标题",
    year: str | None = "2024",
    media_type: MediaType = MediaType.MOVIE,
    tmdb_id: int | None = 1001,
    tv_season_number: int | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=41,
        title=title,
        year=year,
        media_type=media_type,
        tmdb_id=tmdb_id,
        tv_season_number=tv_season_number,
    )


def _dependencies(**overrides: Any) -> ResourceFetcherDependencies:
    values: dict[str, Any] = {
        "search_pansou_by_tmdb": _unexpected_async,
        "search_pansou_by_keyword": _unexpected_async,
        "normalize_pansou_resources": _unexpected_sync,
        "get_hdhive_tv_pan115": _unexpected_async,
        "get_hdhive_movie_pan115": _unexpected_async,
        "get_hdhive_by_keyword": _unexpected_async,
        "normalize_hdhive_items": _unexpected_sync,
        "prefer_hdhive_free": _unexpected_sync,
        "sort_hdhive_free_first": _unexpected_sync,
        "search_tg_by_keyword": _unexpected_async,
        "offline_transfer_enabled": lambda: False,
        "search_seedhub_magnets": _unexpected_async,
        "search_butailing_magnets": _unexpected_async,
        "log_offline_source_fetch": _unexpected_async,
    }
    values.update(overrides)
    return ResourceFetcherDependencies(**values)


@pytest.mark.asyncio
async def test_fetch_from_pansou_returns_tmdb_hits_without_keyword_fallback() -> None:
    tmdb_calls: list[tuple[int, str, int | None]] = []

    async def search_pansou_by_tmdb(
        tmdb_id: int,
        media_type: str,
        season_number: int | None,
    ) -> dict[str, Any]:
        tmdb_calls.append((tmdb_id, media_type, season_number))
        return {"list": [{"share_link": "https://115.com/s/tmdb"}]}

    resources, traces = await fetch_from_pansou(
        _sub(tmdb_id=123),
        dependencies=_dependencies(search_pansou_by_tmdb=search_pansou_by_tmdb),
    )

    assert resources == [{"share_link": "https://115.com/s/tmdb"}]
    assert tmdb_calls == [(123, "movie", None)]
    assert [trace["step"] for trace in traces] == [
        "fetch_pansou_tmdb_start",
        "fetch_pansou_tmdb_done",
    ]


@pytest.mark.asyncio
async def test_fetch_from_pansou_falls_back_to_keyword_when_tmdb_empty() -> None:
    keyword_calls: list[str] = []

    async def search_pansou_by_tmdb(
        _tmdb_id: int,
        media_type: str,
        season_number: int | None,
    ) -> dict[str, Any]:
        assert media_type == "tv"
        assert season_number == 2
        return {"list": []}

    async def search_pansou_by_keyword(keyword: str) -> dict[str, Any]:
        keyword_calls.append(keyword)
        return {"raw": [{"url": "https://115.com/s/keyword"}]}

    def normalize_pansou_resources(payload: dict[str, Any]) -> list[dict[str, Any]]:
        assert payload == {"raw": [{"url": "https://115.com/s/keyword"}]}
        return [{"share_link": "https://115.com/s/keyword"}]

    resources, traces = await fetch_from_pansou(
        _sub(
            title="测试剧集",
            year="2026",
            media_type=MediaType.TV,
            tmdb_id=456,
            tv_season_number=2,
        ),
        dependencies=_dependencies(
            search_pansou_by_tmdb=search_pansou_by_tmdb,
            search_pansou_by_keyword=search_pansou_by_keyword,
            normalize_pansou_resources=normalize_pansou_resources,
        ),
    )

    assert resources == [{"share_link": "https://115.com/s/keyword"}]
    assert keyword_calls == ["测试剧集 2026"]
    assert [trace["step"] for trace in traces] == [
        "fetch_pansou_tmdb_start",
        "fetch_pansou_tmdb_empty",
        "fetch_pansou_keyword_start",
        "fetch_pansou_keyword_done",
    ]


@pytest.mark.asyncio
async def test_fetch_from_hdhive_normalizes_and_sorts_tmdb_hits() -> None:
    sort_calls: list[list[dict[str, Any]]] = []

    async def get_hdhive_tv_pan115(tmdb_id: int) -> list[dict[str, Any]]:
        assert tmdb_id == 789
        return [{"share_link": "https://115.com/s/raw", "free": False}]

    def normalize_hdhive_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assert items == [{"share_link": "https://115.com/s/raw", "free": False}]
        return [{"share_link": "https://115.com/s/normalized", "free": False}]

    def sort_hdhive_free_first(
        resources: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        sort_calls.append(resources)
        return [{"share_link": "https://115.com/s/free", "free": True}]

    resources, traces = await fetch_from_hdhive(
        _sub(media_type=MediaType.TV, tmdb_id=789),
        dependencies=_dependencies(
            get_hdhive_tv_pan115=get_hdhive_tv_pan115,
            normalize_hdhive_items=normalize_hdhive_items,
            prefer_hdhive_free=lambda: True,
            sort_hdhive_free_first=sort_hdhive_free_first,
        ),
    )

    assert resources == [{"share_link": "https://115.com/s/free", "free": True}]
    assert sort_calls == [[{"share_link": "https://115.com/s/normalized", "free": False}]]
    assert [trace["step"] for trace in traces] == [
        "fetch_hdhive_tmdb_start",
        "fetch_hdhive_tmdb_done",
    ]


@pytest.mark.asyncio
async def test_fetch_from_tg_skips_when_keyword_is_empty() -> None:
    resources, traces = await fetch_from_tg(
        _sub(title="", year=None, tmdb_id=None),
        dependencies=_dependencies(),
    )

    assert resources == []
    assert traces == [
        {
            "step": "fetch_tg_keyword_skip",
            "status": "warning",
            "message": "缺少关键词，无法执行 Telegram 搜索",
        }
    ]


@pytest.mark.asyncio
async def test_fetch_offline_magnets_skips_when_disabled() -> None:
    resources, traces = await fetch_offline_magnets(
        _sub(),
        dependencies=_dependencies(offline_transfer_enabled=lambda: False),
    )

    assert resources == []
    assert traces == []


@pytest.mark.asyncio
async def test_fetch_offline_magnets_merges_success_and_logs_failures() -> None:
    logs: list[dict[str, Any]] = []

    async def search_seedhub_magnets(
        keyword: str,
        *,
        limit: int,
    ) -> list[dict[str, Any]]:
        assert keyword == "测试电影 2025"
        assert limit == 20
        return [{"magnet": "magnet:?xt=urn:btih:seedhub"}]

    async def search_butailing_magnets(
        keyword: str,
        *,
        media_type: str,
    ) -> list[dict[str, Any]]:
        assert keyword == "测试电影 2025"
        assert media_type == "movie"
        raise RuntimeError("butailing down")

    async def log_offline_source_fetch(**kwargs: Any) -> None:
        logs.append(kwargs)

    resources, traces = await fetch_offline_magnets(
        _sub(title="测试电影", year="2025", media_type=MediaType.MOVIE),
        dependencies=_dependencies(
            offline_transfer_enabled=lambda: True,
            search_seedhub_magnets=search_seedhub_magnets,
            search_butailing_magnets=search_butailing_magnets,
            log_offline_source_fetch=log_offline_source_fetch,
        ),
    )

    assert resources == [{"magnet": "magnet:?xt=urn:btih:seedhub"}]
    assert [trace["step"] for trace in traces] == [
        "fetch_offline_magnet_done",
        "fetch_offline_magnet_error",
        "fetch_offline_magnet_summary",
    ]
    assert logs[0]["status"] == "success"
    assert logs[0]["extra"] == {
        "subscription_id": 41,
        "title": "测试电影",
        "source": "SeedHub",
        "count": 1,
    }
    assert logs[1]["status"] == "warning"
    assert logs[1]["extra"]["source"] == "不太灵"
    assert logs[1]["extra"]["error"] == "butailing down"


def test_resource_fetchers_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_fetchers.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "operation_log_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "seedhub_service" not in source
    assert "butailing_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source


async def _unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected async dependency call")


def _unexpected_sync(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected sync dependency call")
