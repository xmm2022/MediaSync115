from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.feiniu_service import feiniu_service
from app.services.feiniu_sync_index_service import feiniu_sync_index_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.tmdb_service import tmdb_service
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    FeiniuStatusRuntimeDependencies,
    build_default_feiniu_status_runtime_dependencies,
    check_feiniu_movie_status_with_runtime_adapter,
    check_feiniu_tv_missing_status_with_runtime_adapter,
    logger as feiniu_status_logger,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeLogger:
    def __init__(self) -> None:
        self.exceptions: list[tuple[str, tuple[Any, ...]]] = []

    def exception(self, message: str, *args: Any) -> None:
        self.exceptions.append((message, args))


def _dependencies(**overrides: Any) -> FeiniuStatusRuntimeDependencies:
    async def unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("unexpected async dependency call")

    values: dict[str, Any] = {
        "get_feiniu_url": lambda: "http://feiniu.test",
        "get_indexed_movie_status": unexpected_async,
        "get_live_movie_status": unexpected_async,
        "get_indexed_tv_existing_episodes": unexpected_async,
        "get_live_tv_episode_status": unexpected_async,
        "get_tv_detail": unexpected_async,
        "logger": FakeLogger(),
    }
    values.update(overrides)
    return FeiniuStatusRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_movie_status_skips_downstream_when_feiniu_url_is_blank() -> None:
    result = await check_feiniu_movie_status_with_runtime_adapter(
        101,
        dependencies=_dependencies(get_feiniu_url=lambda: "   "),
    )

    assert result == {"checked": False}


@pytest.mark.asyncio
async def test_tv_missing_status_skips_downstream_when_feiniu_url_is_blank() -> None:
    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        202,
        dependencies=_dependencies(get_feiniu_url=lambda: ""),
    )

    assert result == {"checked": False}


@pytest.mark.asyncio
async def test_movie_status_uses_indexed_result_and_preserves_item_ids() -> None:
    async def get_indexed_movie_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 303
        return {"status": "ok", "exists": True, "item_ids": ["fn-1"]}

    result = await check_feiniu_movie_status_with_runtime_adapter(
        303,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
        ),
    )

    assert result == {
        "checked": True,
        "exists": True,
        "item_ids": ["fn-1"],
    }


@pytest.mark.asyncio
async def test_movie_status_treats_indexed_miss_as_authoritative() -> None:
    live_calls = 0

    async def get_indexed_movie_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 404
        return {"status": "ok", "exists": False}

    async def get_live_movie_status(_tmdb_id: int) -> dict[str, Any]:
        nonlocal live_calls
        live_calls += 1
        return {"status": "ok", "exists": True, "item_ids": ["live-1"]}

    result = await check_feiniu_movie_status_with_runtime_adapter(
        404,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
            get_live_movie_status=get_live_movie_status,
        ),
    )

    assert result == {
        "checked": True,
        "exists": False,
        "item_ids": [],
    }
    assert live_calls == 0


@pytest.mark.asyncio
async def test_movie_status_live_not_logged_in_returns_unchecked() -> None:
    async def get_indexed_movie_status(_tmdb_id: int) -> None:
        return None

    async def get_live_movie_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 505
        return {"status": "not_logged_in", "exists": False}

    result = await check_feiniu_movie_status_with_runtime_adapter(
        505,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
            get_live_movie_status=get_live_movie_status,
        ),
    )

    assert result == {"checked": False}


@pytest.mark.asyncio
async def test_tv_missing_status_uses_indexed_pairs_and_tmdb_seasons() -> None:
    async def get_indexed_tv_existing_episodes(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 606
        return {
            "status": "ok",
            "existing_episodes": [[1, 1], [1, 3], ["bad"], ["2", "1"]],
        }

    async def get_tv_detail(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 606
        return {
            "seasons": [
                {"season_number": 0, "episode_count": 10},
                {"season_number": 1, "episode_count": 3},
                {"season_number": 2, "episode_count": 1},
            ]
        }

    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        606,
        dependencies=_dependencies(
            get_indexed_tv_existing_episodes=get_indexed_tv_existing_episodes,
            get_tv_detail=get_tv_detail,
        ),
    )

    assert result == {"checked": True, "missing_count": 1}


@pytest.mark.asyncio
async def test_tv_missing_status_falls_back_to_live_when_indexed_empty() -> None:
    async def get_indexed_tv_existing_episodes(_tmdb_id: int) -> None:
        return None

    async def get_live_tv_episode_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 707
        return {"status": "ok", "existing_episodes": {(1, 1)}}

    async def get_tv_detail(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 707
        return {"seasons": [{"season_number": 1, "episode_count": 2}]}

    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        707,
        dependencies=_dependencies(
            get_indexed_tv_existing_episodes=get_indexed_tv_existing_episodes,
            get_live_tv_episode_status=get_live_tv_episode_status,
            get_tv_detail=get_tv_detail,
        ),
    )

    assert result == {"checked": True, "missing_count": 1}


@pytest.mark.asyncio
async def test_movie_status_logs_exception_and_returns_unchecked() -> None:
    fake_logger = FakeLogger()

    async def get_indexed_movie_status(_tmdb_id: int) -> dict[str, Any]:
        raise RuntimeError("index unavailable")

    result = await check_feiniu_movie_status_with_runtime_adapter(
        808,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
            logger=fake_logger,
        ),
    )

    assert result == {"checked": False}
    assert fake_logger.exceptions == [
        ("飞牛电影状态查询失败: tmdb_id=%s", (808,))
    ]


@pytest.mark.asyncio
async def test_tv_missing_status_logs_exception_and_returns_unchecked() -> None:
    fake_logger = FakeLogger()

    async def get_indexed_tv_existing_episodes(_tmdb_id: int) -> dict[str, Any]:
        raise RuntimeError("index unavailable")

    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        909,
        dependencies=_dependencies(
            get_indexed_tv_existing_episodes=get_indexed_tv_existing_episodes,
            logger=fake_logger,
        ),
    )

    assert result == {"checked": False}
    assert fake_logger.exceptions == [
        ("飞牛剧集缺集状态查询失败: tmdb_id=%s", (909,))
    ]


def test_default_runtime_dependencies_bind_existing_services() -> None:
    dependencies = build_default_feiniu_status_runtime_dependencies()

    assert dependencies.get_feiniu_url.__self__ is runtime_settings_service
    assert (
        dependencies.get_feiniu_url.__func__
        is type(runtime_settings_service).get_feiniu_url
    )
    assert dependencies.get_indexed_movie_status.__self__ is feiniu_sync_index_service
    assert (
        dependencies.get_indexed_movie_status.__func__
        is type(feiniu_sync_index_service).get_movie_status
    )
    assert dependencies.get_live_movie_status.__self__ is feiniu_service
    assert (
        dependencies.get_live_movie_status.__func__
        is type(feiniu_service).get_movie_status_by_tmdb
    )
    assert (
        dependencies.get_indexed_tv_existing_episodes.__self__
        is feiniu_sync_index_service
    )
    assert (
        dependencies.get_indexed_tv_existing_episodes.__func__
        is type(feiniu_sync_index_service).get_tv_existing_episodes
    )
    assert dependencies.get_live_tv_episode_status.__self__ is feiniu_service
    assert (
        dependencies.get_live_tv_episode_status.__func__
        is type(feiniu_service).get_tv_episode_status_by_tmdb
    )
    assert dependencies.get_tv_detail.__self__ is tmdb_service
    assert dependencies.get_tv_detail.__func__ is type(tmdb_service).get_tv_detail
    assert dependencies.logger is feiniu_status_logger


def test_feiniu_status_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/feiniu_status_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
