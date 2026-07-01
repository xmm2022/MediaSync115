from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.subscriptions.auto_transfer_context import (
    build_auto_transfer_tv_missing_context,
)


ROOT = Path(__file__).resolve().parents[2]


def _tv_subscription() -> SimpleNamespace:
    return SimpleNamespace(
        id=11,
        title="测试剧集",
        media_type="tv",
        tmdb_id=12345,
        tv_include_specials=False,
        tv_season_number=None,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_scope="all",
        tv_follow_mode="missing",
    )


def _movie_subscription() -> SimpleNamespace:
    return SimpleNamespace(
        id=12,
        title="测试电影",
        media_type="movie",
        tmdb_id=23456,
        tv_include_specials=False,
        tv_season_number=None,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_scope="all",
        tv_follow_mode="missing",
    )


async def _run_context(
    sub: SimpleNamespace,
    *,
    snapshot: dict[str, Any] | None = None,
    fetch_result: dict[str, Any] | None = None,
    logs: list[dict[str, Any]] | None = None,
) -> Any:
    async def fetch_tv_missing_status(**kwargs: Any) -> dict[str, Any]:
        assert kwargs["tmdb_id"] == sub.tmdb_id
        return fetch_result or {"status": "error", "message": "未配置"}

    async def create_step_log(**kwargs: Any) -> None:
        if logs is not None:
            logs.append(kwargs)

    return await build_auto_transfer_tv_missing_context(
        sub=sub,
        tv_missing_snapshot=snapshot,
        fetch_tv_missing_status=fetch_tv_missing_status,
        create_step_log=create_step_log,
    )


def test_build_auto_transfer_tv_missing_context_fetches_and_logs_success() -> None:
    logs: list[dict[str, Any]] = []
    context = asyncio.run(
        _run_context(
            _tv_subscription(),
            fetch_result={
                "status": "ok",
                "counts": {"aired": 10, "existing": 8},
                "missing_episodes": [[1, 2], [1, 3], ["bad"], [2, "4"]],
            },
            logs=logs,
        )
    )

    assert context.is_tv_subscription is True
    assert context.tv_missing_enabled is True
    assert context.missing_episodes == {(1, 2), (1, 3), (2, 4)}
    assert [row["step"] for row in logs] == [
        "tv_missing_fetch_start",
        "tv_missing_fetch_done",
    ]
    assert logs[1]["payload"] == {
        "aired_count": 10,
        "existing_count": 8,
        "missing_count": 3,
    }


def test_build_auto_transfer_tv_missing_context_reuses_snapshot_without_fetch_or_logs() -> None:
    logs: list[dict[str, Any]] = []

    async def fetch_tv_missing_status(**kwargs: Any) -> dict[str, Any]:
        raise AssertionError(f"不应重新获取缺集状态: {kwargs}")

    async def create_step_log(**kwargs: Any) -> None:
        logs.append(kwargs)

    context = asyncio.run(
        build_auto_transfer_tv_missing_context(
            sub=_tv_subscription(),
            tv_missing_snapshot={
                "status": "ok",
                "counts": {"aired": 2, "existing": 1},
                "missing_episodes": [[1, 2]],
            },
            fetch_tv_missing_status=fetch_tv_missing_status,
            create_step_log=create_step_log,
        )
    )

    assert context.is_tv_subscription is True
    assert context.tv_missing_enabled is True
    assert context.missing_episodes == {(1, 2)}
    assert logs == []


def test_build_auto_transfer_tv_missing_context_logs_failed_fresh_fetch() -> None:
    logs: list[dict[str, Any]] = []
    context = asyncio.run(
        _run_context(
            _tv_subscription(),
            fetch_result={"status": "failed", "message": "TMDB 不可用"},
            logs=logs,
        )
    )

    assert context.is_tv_subscription is True
    assert context.tv_missing_enabled is False
    assert context.missing_episodes == set()
    assert [row["step"] for row in logs] == [
        "tv_missing_fetch_start",
        "tv_missing_fetch_failed",
    ]
    assert logs[1]["payload"] == {"status": "failed", "message": "TMDB 不可用"}


def test_build_auto_transfer_tv_missing_context_skips_non_tv_subscription() -> None:
    logs: list[dict[str, Any]] = []
    context = asyncio.run(
        _run_context(
            _movie_subscription(),
            fetch_result={"status": "ok", "missing_episodes": [[1, 1]]},
            logs=logs,
        )
    )

    assert context.is_tv_subscription is False
    assert context.tv_missing_enabled is False
    assert context.missing_episodes == set()
    assert logs == []


def test_auto_transfer_context_module_does_not_import_service_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_context.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "tv_missing_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
