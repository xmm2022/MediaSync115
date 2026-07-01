from __future__ import annotations

from pathlib import Path

import pytest

from app.models.models import MediaType
from app.services import subscription_service as subscription_service_module
from app.services.subscriptions.snapshot import SubscriptionSnapshot


ROOT = Path(__file__).resolve().parents[2]


def _snapshot() -> SubscriptionSnapshot:
    return SubscriptionSnapshot(
        id=1,
        tmdb_id=123,
        douban_id="db123",
        title="Example",
        media_type=MediaType.TV,
        year="2026",
        auto_download=True,
        tv_scope="all",
        tv_season_number=1,
        tv_episode_start=1,
        tv_episode_end=12,
        tv_follow_mode="missing",
        tv_include_specials=False,
        has_successful_transfer=True,
    )


def test_subscription_snapshot_keeps_existing_fields() -> None:
    snapshot = _snapshot()

    assert snapshot.id == 1
    assert snapshot.tmdb_id == 123
    assert snapshot.douban_id == "db123"
    assert snapshot.title == "Example"
    assert snapshot.media_type == MediaType.TV
    assert snapshot.year == "2026"
    assert snapshot.auto_download is True
    assert snapshot.tv_scope == "all"
    assert snapshot.tv_season_number == 1
    assert snapshot.tv_episode_start == 1
    assert snapshot.tv_episode_end == 12
    assert snapshot.tv_follow_mode == "missing"
    assert snapshot.tv_include_specials is False
    assert snapshot.has_successful_transfer is True


def test_subscription_snapshot_remains_slotted() -> None:
    snapshot = _snapshot()

    with pytest.raises(AttributeError):
        snapshot.extra = "not allowed"


def test_subscription_service_reexports_subscription_snapshot() -> None:
    assert subscription_service_module.SubscriptionSnapshot is SubscriptionSnapshot


def test_snapshot_module_does_not_import_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/snapshot.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.api" not in source
