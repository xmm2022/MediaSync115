from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import delete

from app.core.database import async_session_maker, ensure_tables_exist
from app.core.timezone_utils import beijing_now
from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
from app.services.subscriptions.run_loader import (
    load_active_subscription_snapshots,
    snapshot_from_active_subscription_row,
)


ROOT = Path(__file__).resolve().parents[2]


def test_snapshot_from_active_subscription_row_keeps_existing_conversions() -> None:
    row = SimpleNamespace(
        id="7",
        tmdb_id="123",
        douban_id=456,
        title=None,
        media_type=MediaType.TV,
        year=2026,
        auto_download=1,
        tv_scope=None,
        tv_season_number="2",
        tv_episode_start="3",
        tv_episode_end="12",
        tv_follow_mode=None,
        tv_include_specials=0,
        has_successful_transfer=1,
    )

    snapshot = snapshot_from_active_subscription_row(row)

    assert snapshot.id == 7
    assert snapshot.tmdb_id == 123
    assert snapshot.douban_id == "456"
    assert snapshot.title == ""
    assert snapshot.media_type == MediaType.TV
    assert snapshot.year == "2026"
    assert snapshot.auto_download is True
    assert snapshot.tv_scope == "all"
    assert snapshot.tv_season_number == 2
    assert snapshot.tv_episode_start == 3
    assert snapshot.tv_episode_end == 12
    assert snapshot.tv_follow_mode == "missing"
    assert snapshot.tv_include_specials is False
    assert snapshot.has_successful_transfer is True


@pytest.mark.asyncio
async def test_load_active_subscription_snapshots_filters_local_scope_and_transfer_state() -> None:
    await ensure_tables_exist("subscriptions", "download_records")

    marker = uuid4().hex[:10]
    base_tmdb = 970000 + (uuid4().int % 10000)
    tmdb_ids = [base_tmdb + offset for offset in range(7)]

    async with async_session_maker() as db:
        await db.execute(delete(DownloadRecord).where(DownloadRecord.resource_url.like(f"%{marker}%")))
        await db.execute(delete(Subscription).where(Subscription.title.like(f"Run Loader {marker}%")))
        await db.commit()

        local_empty_provider = Subscription(
            title=f"Run Loader {marker} Empty Provider",
            media_type=MediaType.MOVIE,
            tmdb_id=tmdb_ids[0],
            is_active=True,
            provider="",
            external_system="",
            auto_download=False,
        )
        local_completed_at = Subscription(
            title=f"Run Loader {marker} Completed At",
            media_type=MediaType.MOVIE,
            tmdb_id=tmdb_ids[1],
            is_active=True,
            provider="mediasync115",
            external_system="mediasync115",
        )
        local_completed_status = Subscription(
            title=f"Run Loader {marker} Completed Status",
            media_type=MediaType.TV,
            tmdb_id=tmdb_ids[2],
            is_active=True,
            provider="mediasync115",
            external_system=None,
            tv_scope="season",
            tv_season_number=1,
        )
        local_offline_completed_status = Subscription(
            title=f"Run Loader {marker} Offline Completed",
            media_type=MediaType.MOVIE,
            tmdb_id=tmdb_ids[3],
            is_active=True,
            provider="mediasync115",
            external_system="",
        )
        external_moviepilot = Subscription(
            title=f"Run Loader {marker} MoviePilot",
            media_type=MediaType.MOVIE,
            tmdb_id=tmdb_ids[4],
            is_active=True,
            provider="moviepilot",
            external_system="moviepilot",
        )
        external_anirss = Subscription(
            title=f"Run Loader {marker} AniRSS",
            media_type=MediaType.TV,
            tmdb_id=tmdb_ids[5],
            is_active=True,
            provider="anirss",
            external_system="anirss",
        )
        inactive_local = Subscription(
            title=f"Run Loader {marker} Inactive",
            media_type=MediaType.MOVIE,
            tmdb_id=tmdb_ids[6],
            is_active=False,
            provider="mediasync115",
            external_system="mediasync115",
        )
        db.add_all(
            [
                local_empty_provider,
                local_completed_at,
                local_completed_status,
                local_offline_completed_status,
                external_moviepilot,
                external_anirss,
                inactive_local,
            ]
        )
        await db.flush()
        db.add_all(
            [
                DownloadRecord(
                    subscription_id=local_completed_at.id,
                    resource_name="completed-at.mkv",
                    resource_url=f"https://example.test/{marker}/completed-at",
                    resource_type="pan115",
                    status=MediaStatus.PENDING,
                    completed_at=beijing_now(),
                ),
                DownloadRecord(
                    subscription_id=local_completed_status.id,
                    resource_name="completed-status.mkv",
                    resource_url=f"https://example.test/{marker}/completed-status",
                    resource_type="pan115",
                    status=MediaStatus.COMPLETED,
                ),
                DownloadRecord(
                    subscription_id=local_offline_completed_status.id,
                    resource_name="offline-completed-status.mkv",
                    resource_url=f"https://example.test/{marker}/offline-completed-status",
                    resource_type="pan115",
                    status=MediaStatus.OFFLINE_COMPLETED,
                ),
            ]
        )
        await db.commit()

        try:
            snapshots = await load_active_subscription_snapshots(db)
            ids = [snapshot.id for snapshot in snapshots]
            by_tmdb = {
                snapshot.tmdb_id: snapshot
                for snapshot in snapshots
                if snapshot.tmdb_id in tmdb_ids
            }

            assert ids == sorted(ids)
            assert set(by_tmdb) == set(tmdb_ids[:4])
            assert by_tmdb[tmdb_ids[0]].has_successful_transfer is False
            assert by_tmdb[tmdb_ids[1]].has_successful_transfer is True
            assert by_tmdb[tmdb_ids[2]].has_successful_transfer is True
            assert by_tmdb[tmdb_ids[3]].has_successful_transfer is True
        finally:
            await db.execute(delete(DownloadRecord).where(DownloadRecord.resource_url.like(f"%{marker}%")))
            await db.execute(delete(Subscription).where(Subscription.title.like(f"Run Loader {marker}%")))
            await db.commit()


def test_run_loader_module_stays_inside_db_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_loader.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "app.api" not in source
