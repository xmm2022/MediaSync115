from pathlib import Path

import pytest
from sqlalchemy import delete, select

from app.models.models import (
    MediaType,
    Subscription,
    SubscriptionSource,
    SubscriptionSourceFile,
)


ROOT = Path(__file__).resolve().parents[2]


def test_subscription_source_api_does_not_call_service_quality_filter_wrapper():
    source = (ROOT / "backend/app/api/subscriptions.py").read_text(
        encoding="utf-8"
    )

    assert "subscription_service._resolve_subscription_quality_filter" not in source
    assert "resolve_subscription_quality_filter_with_runtime_adapter" in source


async def _delete_sources_by_ids(db, source_ids: list[int]) -> None:
    if not source_ids:
        return
    await db.execute(
        delete(SubscriptionSourceFile).where(
            SubscriptionSourceFile.source_id.in_(source_ids)
        )
    )
    await db.execute(
        delete(SubscriptionSource).where(SubscriptionSource.id.in_(source_ids))
    )


async def _delete_subscription_by_tmdb(db, tmdb_id: int) -> None:
    subscription_ids = [
        int(row[0])
        for row in (
            await db.execute(select(Subscription.id).where(Subscription.tmdb_id == tmdb_id))
        ).all()
    ]
    if subscription_ids:
        source_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(SubscriptionSource.id).where(
                        SubscriptionSource.subscription_id.in_(subscription_ids)
                    )
                )
            ).all()
        ]
        await _delete_sources_by_ids(db, source_ids)
    await db.execute(delete(Subscription).where(Subscription.tmdb_id == tmdb_id))


@pytest.mark.asyncio
async def test_create_and_list_subscription_source(async_client):
    from app.core.database import async_session_maker, ensure_tables_exist

    await ensure_tables_exist()
    async with async_session_maker() as db:
        existing_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id == 3003)
                )
            ).all()
        ]
        if existing_ids:
            existing_source_ids = [
                int(row[0])
                for row in (
                    await db.execute(
                        select(SubscriptionSource.id).where(
                            SubscriptionSource.subscription_id.in_(existing_ids)
                        )
                    )
                ).all()
            ]
            if existing_source_ids:
                await db.execute(
                    delete(SubscriptionSourceFile).where(
                        SubscriptionSourceFile.source_id.in_(existing_source_ids)
                    )
                )
            await db.execute(
                delete(SubscriptionSource).where(
                    SubscriptionSource.subscription_id.in_(existing_ids)
                )
            )
        duplicate_source_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(SubscriptionSource.id).where(
                        SubscriptionSource.share_url.like("%abc123%")
                    )
                )
            ).all()
        ]
        if duplicate_source_ids:
            await db.execute(
                delete(SubscriptionSourceFile).where(
                    SubscriptionSourceFile.source_id.in_(duplicate_source_ids)
                )
            )
        await db.execute(
            delete(SubscriptionSource).where(SubscriptionSource.share_url.like("%abc123%"))
        )
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 3003))
        await db.commit()
        sub = Subscription(
            tmdb_id=3003,
            title="Show API",
            media_type=MediaType.TV,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        sub_id = sub.id

    create_response = await async_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert create_response.status_code == 200

    create_response = await async_client.post(
        f"/api/subscriptions/{sub_id}/sources",
        json={
            "share_url": "https://115.com/s/abc123?password=abcd",
            "receive_code": "",
            "display_name": "Manual API",
            "selected_file_ids": ["fid2", "fid2", "fid3"],
        },
    )
    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["source_type"] == "manual_pan115_share"
    assert payload["receive_code"] == "abcd"
    assert payload["selected_file_ids"] == ["fid2", "fid3"]
    source_id = payload["id"]

    async with async_session_maker() as db:
        db.add_all(
            [
                SubscriptionSourceFile(
                    source_id=source_id,
                    share_file_id="fid2",
                    file_name="Show.S01E02.1080p.mkv",
                    file_size=2000,
                    season_number=1,
                    episode_number=2,
                    fingerprint="fid:fid2",
                    status="seen",
                ),
                SubscriptionSourceFile(
                    source_id=source_id,
                    share_file_id="fid3",
                    file_name="Show.S01E03.1080p.mkv",
                    file_size=3000,
                    season_number=1,
                    episode_number=3,
                    fingerprint="fid:fid3",
                    status="transferred",
                ),
            ]
        )
        await db.commit()

    list_response = await async_client.get(f"/api/subscriptions/{sub_id}/sources")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["display_name"] == "Manual API"
    assert data["items"][0]["selected_file_ids"] == ["fid2", "fid3"]
    assert [item["share_file_id"] for item in data["items"][0]["files"]] == [
        "fid2",
        "fid3",
    ]

    patch_response = await async_client.patch(
        f"/api/subscriptions/{sub_id}/sources/{source_id}",
        json={"selected_file_ids": ["fid3", "fid3"]},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["selected_file_ids"] == ["fid3"]

    clear_response = await async_client.patch(
        f"/api/subscriptions/{sub_id}/sources/{source_id}",
        json={"selected_file_ids": []},
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["selected_file_ids"] == []


@pytest.mark.asyncio
async def test_scan_subscription_source_allows_movie_sources(async_client, monkeypatch):
    from app.api import subscriptions as subscriptions_api
    from app.core.database import async_session_maker, ensure_tables_exist

    await ensure_tables_exist()
    async with async_session_maker() as db:
        await _delete_subscription_by_tmdb(db, 4004)
        await db.commit()
        sub = Subscription(
            tmdb_id=4004,
            title="Movie API",
            media_type=MediaType.MOVIE,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        sub_id = sub.id

    login_response = await async_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert login_response.status_code == 200

    source_response = await async_client.post(
        f"/api/subscriptions/{sub_id}/sources",
        json={
            "share_url": "https://115.com/s/movie4004?password=abcd",
            "receive_code": "",
            "display_name": "Movie API Source",
        },
    )
    assert source_response.status_code == 200
    source_id = source_response.json()["id"]

    async def fake_scan_manual_pan115_source(
        db,
        *,
        source,
        subscription,
        pan_service,
        parent_folder_id,
        missing_episodes,
        quality_filter,
    ):
        assert subscription.media_type == MediaType.MOVIE
        assert missing_episodes == set()
        return {"status": "success", "selected_count": 1, "transferred_count": 1}

    monkeypatch.setattr(
        subscriptions_api.subscription_source_service,
        "scan_manual_pan115_source",
        fake_scan_manual_pan115_source,
    )

    scan_response = await async_client.post(
        f"/api/subscriptions/{sub_id}/sources/{source_id}/scan"
    )

    assert scan_response.status_code == 200
    assert scan_response.json()["stats"]["transferred_count"] == 1
