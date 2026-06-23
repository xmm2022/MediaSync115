import pytest

from app.models.models import MediaType, Subscription


@pytest.mark.asyncio
async def test_create_and_list_subscription_source(async_client):
    from app.core.database import async_session_maker, ensure_tables_exist

    await ensure_tables_exist()
    async with async_session_maker() as db:
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
        },
    )
    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["source_type"] == "manual_pan115_share"
    assert payload["receive_code"] == "abcd"

    list_response = await async_client.get(f"/api/subscriptions/{sub_id}/sources")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["display_name"] == "Manual API"
