import pytest


@pytest.mark.asyncio
async def test_subscription_list_includes_source_summary(async_client):
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.models.models import MediaType, Subscription
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        sub = Subscription(
            tmdb_id=4004,
            title="Show Summary",
            media_type=MediaType.TV,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=sub.id,
            share_url="https://115.com/s/summary?password=abcd",
            receive_code="",
            display_name="Summary Source",
        )
        await db.commit()

    login_response = await async_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert login_response.status_code == 200

    response = await async_client.get(
        "/api/subscriptions",
        params={"media_type": "tv"},
    )
    assert response.status_code == 200
    data = response.json()
    item = next(row for row in data["items"] if row["tmdb_id"] == 4004)
    assert item["source_summary"]["total"] == 1
    assert item["source_summary"]["enabled"] == 1
    assert item["sources"][0]["display_name"] == "Summary Source"
