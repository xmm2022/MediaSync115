from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription,
    should_scan_fixed_sources,
)


ROOT = Path(__file__).resolve().parents[2]


def _subscription(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "id": 101,
        "tmdb_id": 9001,
        "title": "Fixed Source Show",
        "media_type": MediaType.TV,
        "auto_download": True,
        "tv_scope": "episode_range",
        "tv_season_number": 1,
        "tv_episode_start": 2,
        "tv_episode_end": 5,
        "tv_follow_mode": "new",
        "tv_include_specials": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _source(source_id: int, name: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=source_id,
        display_name=name,
        share_url=f"https://115.com/s/{name}",
    )


def test_should_scan_fixed_sources_requires_supported_media_tmdb_and_auto_download() -> None:
    assert should_scan_fixed_sources(_subscription()) is True
    assert should_scan_fixed_sources(_subscription(auto_download=False)) is False
    assert (
        should_scan_fixed_sources(
            _subscription(auto_download=False),
            force_auto_download=True,
        )
        is True
    )
    assert should_scan_fixed_sources(_subscription(tmdb_id=None)) is False
    assert (
        should_scan_fixed_sources(_subscription(media_type=MediaType.COLLECTION))
        is False
    )


@pytest.mark.asyncio
async def test_scan_fixed_sources_skips_before_loading_sources_when_policy_is_false() -> None:
    calls: list[str] = []

    async def list_sources(_db: Any, _subscription_id: int) -> list[Any]:
        calls.append("list_sources")
        return [_source(1, "unused")]

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: object(),
        get_parent_folder_id=lambda: "0",
        resolve_quality_filter=lambda _sub: {},
        get_tv_missing_status=_unexpected_tv_missing,
        scan_manual_source=_unexpected_scan,
        create_step_log=_unexpected_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-1",
        channel="all",
        sub=_subscription(auto_download=False),
        dependencies=dependencies,
    )

    assert result == {"saved": 0, "failed": 0, "checked": 0}
    assert calls == []


@pytest.mark.asyncio
async def test_scan_fixed_sources_logs_warning_when_tv_missing_status_is_unavailable() -> None:
    logs: list[dict[str, Any]] = []

    async def list_sources(_db: Any, subscription_id: int) -> list[Any]:
        assert subscription_id == 101
        return [_source(10, "source-a"), _source(11, "source-b")]

    async def get_tv_missing_status(tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
        assert tmdb_id == 9001
        assert kwargs == {
            "include_specials": False,
            "season_number": 1,
            "episode_start": 2,
            "episode_end": 5,
            "aired_only": True,
        }
        return {"status": "error", "message": "Emby unavailable"}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: object(),
        get_parent_folder_id=lambda: "target-folder",
        resolve_quality_filter=lambda _sub: {"preferred_resolutions": ["1080p"]},
        get_tv_missing_status=get_tv_missing_status,
        scan_manual_source=_unexpected_scan,
        create_step_log=create_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-1",
        channel="priority",
        sub=_subscription(),
        dependencies=dependencies,
    )

    assert result == {"saved": 0, "failed": 0, "checked": 2}
    assert logs == [
        {
            "run_id": "run-1",
            "channel": "priority",
            "subscription_id": 101,
            "subscription_title": "Fixed Source Show",
            "step": "fixed_source_missing_status_unavailable",
            "status": "warning",
            "message": "固定来源跳过：缺集状态不可用（Emby unavailable）",
        }
    ]


@pytest.mark.asyncio
async def test_scan_fixed_sources_accumulates_success_and_failure_per_source() -> None:
    logs: list[dict[str, Any]] = []
    scan_calls: list[tuple[int, set[tuple[int, int]], dict[str, Any]]] = []
    pan_service = object()

    async def list_sources(_db: Any, _subscription_id: int) -> list[Any]:
        return [_source(20, "ok-source"), _source(21, "bad-source")]

    async def scan_manual_source(
        _db: Any,
        *,
        source: Any,
        subscription: Any,
        pan_service: Any,
        parent_folder_id: str,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any],
    ) -> dict[str, Any]:
        assert subscription.id == 101
        assert pan_service is not None
        assert parent_folder_id == "target-folder"
        scan_calls.append((source.id, set(missing_episodes), dict(quality_filter)))
        if source.id == 21:
            raise RuntimeError("share expired")
        return {"status": "success", "transferred_count": 3, "selected_count": 4}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: pan_service,
        get_parent_folder_id=lambda: "target-folder",
        resolve_quality_filter=lambda _sub: {"preferred_resolutions": ["2160p"]},
        get_tv_missing_status=_unexpected_tv_missing,
        scan_manual_source=scan_manual_source,
        create_step_log=create_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-2",
        channel="all",
        sub=_subscription(),
        tv_missing_snapshot={
            "status": "ok",
            "missing_episodes": [[1, 2], ["1", "3"], ["bad"], [2, "x"]],
        },
        dependencies=dependencies,
    )

    assert result == {"saved": 3, "failed": 1, "checked": 2}
    assert scan_calls == [
        (20, {(1, 2), (1, 3)}, {"preferred_resolutions": ["2160p"]}),
        (21, {(1, 2), (1, 3)}, {"preferred_resolutions": ["2160p"]}),
    ]
    assert [entry["step"] for entry in logs] == [
        "fixed_source_scan_start",
        "fixed_source_scan_done",
        "fixed_source_scan_start",
        "fixed_source_scan_failed",
    ]
    assert logs[1]["payload"] == {
        "source_id": 20,
        "status": "success",
        "transferred_count": 3,
        "selected_count": 4,
    }
    assert logs[3]["message"] == "固定来源扫描失败：share expired"


@pytest.mark.asyncio
async def test_scan_fixed_sources_movie_path_skips_tv_missing_status() -> None:
    scan_calls: list[set[tuple[int, int]]] = []

    async def list_sources(_db: Any, _subscription_id: int) -> list[Any]:
        return [_source(30, "movie-source")]

    async def scan_manual_source(
        _db: Any,
        *,
        source: Any,
        subscription: Any,
        pan_service: Any,
        parent_folder_id: str,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any],
    ) -> dict[str, Any]:
        assert source.id == 30
        assert subscription.media_type == MediaType.MOVIE
        assert pan_service is not None
        assert parent_folder_id == "movie-target"
        assert quality_filter == {"preferred_formats": ["HDR10"]}
        scan_calls.append(set(missing_episodes))
        return {"status": "success", "transferred_count": 2}

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: object(),
        get_parent_folder_id=lambda: "movie-target",
        resolve_quality_filter=lambda _sub: {"preferred_formats": ["HDR10"]},
        get_tv_missing_status=_unexpected_tv_missing,
        scan_manual_source=scan_manual_source,
        create_step_log=create_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-movie",
        channel="all",
        sub=_subscription(media_type=MediaType.MOVIE),
        dependencies=dependencies,
    )

    assert result == {"saved": 2, "failed": 0, "checked": 1}
    assert scan_calls == [set()]


def test_fixed_source_scan_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/fixed_source_scan.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "Pan115Service" not in source
    assert "subscription_source_service" not in source
    assert "AsyncSession" not in source
    assert "app.api" not in source


async def _unexpected_tv_missing(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise AssertionError("tv missing status should not be requested")


async def _unexpected_scan(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise AssertionError("fixed source scan should not run")


async def _unexpected_step_log(*_args: Any, **_kwargs: Any) -> None:
    raise AssertionError("step log should not be written")
