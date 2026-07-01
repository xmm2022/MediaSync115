import pytest
from sqlalchemy import delete, select

from app.models.models import (
    MediaType,
    Subscription,
    SubscriptionSource,
    SubscriptionSourceFile,
)


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
