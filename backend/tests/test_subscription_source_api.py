import pytest
from sqlalchemy import delete, select

from app.models.models import MediaType, Subscription, SubscriptionSource


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
            await db.execute(
                delete(SubscriptionSource).where(
                    SubscriptionSource.subscription_id.in_(existing_ids)
                )
            )
        await db.execute(delete(SubscriptionSource).where(SubscriptionSource.share_url.like("%abc123%")))
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

    list_response = await async_client.get(f"/api/subscriptions/{sub_id}/sources")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["display_name"] == "Manual API"
    assert data["items"][0]["selected_file_ids"] == ["fid2", "fid3"]
