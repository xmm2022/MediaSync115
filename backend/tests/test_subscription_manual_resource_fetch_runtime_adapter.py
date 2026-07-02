from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.models.models import MediaType
from app.services import subscription_service as subscription_service_module
from app.services.subscription_service import SubscriptionService
from app.services.subscriptions.manual_resource_fetch_runtime_adapter import (
    ManualResourceFetchRuntimeDependencies,
    build_default_manual_resource_fetch_runtime_dependencies,
    fetch_resources_for_media_with_runtime_adapter,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> ManualResourceFetchRuntimeDependencies:
    async def fetch_resources(
        _channel: str,
        _sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return [], [], {}

    values: dict[str, Any] = {
        "snapshot_class": SubscriptionSnapshot,
        "tv_media_type": MediaType.TV,
        "movie_media_type": MediaType.MOVIE,
        "fetch_resources": fetch_resources,
    }
    values.update(overrides)
    return ManualResourceFetchRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_adapter_builds_tv_snapshot_and_calls_fetch_resources() -> None:
    calls: list[tuple[str, SubscriptionSnapshot]] = []
    marker = ([{"name": "资源"}], [{"trace": "ok"}], {"summary": "ok"})

    async def fetch_resources(
        channel: str,
        sub: SubscriptionSnapshot,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        calls.append((channel, sub))
        return marker

    result = await fetch_resources_for_media_with_runtime_adapter(
        media_type="tv",
        tmdb_id=1001,
        douban_id="db1",
        title="剧名",
        year="2026",
        season_number=2,
        dependencies=_dependencies(fetch_resources=fetch_resources),
    )

    assert result is marker
    assert len(calls) == 1
    channel, snapshot = calls[0]
    assert channel == "all"
    assert isinstance(snapshot, SubscriptionSnapshot)
    assert snapshot.id == 0
    assert snapshot.tmdb_id == 1001
    assert snapshot.douban_id == "db1"
    assert snapshot.title == "剧名"
    assert snapshot.media_type is MediaType.TV
    assert snapshot.year == "2026"
    assert snapshot.auto_download is False
    assert snapshot.tv_scope == "all"
    assert snapshot.tv_season_number == 2
    assert snapshot.tv_episode_start is None
    assert snapshot.tv_episode_end is None
    assert snapshot.tv_follow_mode == "missing"
    assert snapshot.tv_include_specials is False
    assert snapshot.has_successful_transfer is False


@pytest.mark.asyncio
async def test_adapter_maps_non_tv_media_type_to_movie_and_normalizes_blank_title() -> None:
    snapshots: list[SubscriptionSnapshot] = []

    async def fetch_resources(
        _channel: str,
        sub: SubscriptionSnapshot,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        snapshots.append(sub)
        return [], [], {}

    await fetch_resources_for_media_with_runtime_adapter(
        media_type="movie",
        title="",
        dependencies=_dependencies(fetch_resources=fetch_resources),
    )
    await fetch_resources_for_media_with_runtime_adapter(
        media_type="unknown",
        title=None,  # type: ignore[arg-type]
        dependencies=_dependencies(fetch_resources=fetch_resources),
    )

    assert [snapshot.media_type for snapshot in snapshots] == [
        MediaType.MOVIE,
        MediaType.MOVIE,
    ]
    assert [snapshot.title for snapshot in snapshots] == ["", ""]


def test_default_dependencies_bind_snapshot_media_types_and_fetch_callback() -> None:
    async def fetch_resources(
        _channel: str,
        _sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return [], [], {}

    dependencies = build_default_manual_resource_fetch_runtime_dependencies(
        fetch_resources=fetch_resources,
    )

    assert dependencies.snapshot_class is SubscriptionSnapshot
    assert dependencies.tv_media_type is MediaType.TV
    assert dependencies.movie_media_type is MediaType.MOVIE
    assert dependencies.fetch_resources is fetch_resources


@pytest.mark.asyncio
async def test_subscription_service_wrapper_passes_public_arguments_and_fetch_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = SubscriptionService()
    dependencies_marker = object()
    builder_kwargs: dict[str, Any] = {}
    adapter_kwargs: dict[str, Any] = {}
    marker = ([{"name": "资源"}], [], {"summary": "ok"})

    def fake_builder(**kwargs: Any) -> object:
        builder_kwargs.update(kwargs)
        return dependencies_marker

    async def fake_fetch_resources_for_media_with_runtime_adapter(
        **kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        adapter_kwargs.update(kwargs)
        return marker

    monkeypatch.setattr(
        subscription_service_module,
        "build_default_manual_resource_fetch_runtime_dependencies",
        fake_builder,
    )
    monkeypatch.setattr(
        subscription_service_module,
        "fetch_resources_for_media_with_runtime_adapter",
        fake_fetch_resources_for_media_with_runtime_adapter,
    )

    result = await service.fetch_resources_for_media(
        media_type="tv",
        tmdb_id=1001,
        douban_id="db1",
        title="剧名",
        year="2026",
        season_number=2,
    )

    assert result is marker
    assert adapter_kwargs == {
        "media_type": "tv",
        "tmdb_id": 1001,
        "douban_id": "db1",
        "title": "剧名",
        "year": "2026",
        "season_number": 2,
        "dependencies": dependencies_marker,
    }
    fetch_callback = builder_kwargs["fetch_resources"]
    assert fetch_callback.__self__ is service
    assert fetch_callback.__func__ is service._fetch_resources.__func__


def test_manual_resource_fetch_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
