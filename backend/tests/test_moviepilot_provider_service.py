import pytest
from sqlalchemy import delete, select

from app.core.database import async_session_maker, ensure_subscription_columns, ensure_tables_exist
from app.models.models import MediaType, Subscription
from app.services.moviepilot_provider_service import MoviePilotProviderService


class FakeMoviePilotClient:
    def __init__(self) -> None:
        self.created_payloads: list[dict] = []
        self.subscribe_items: list[dict] = []

    async def create_subscribe(self, payload: dict) -> dict:
        self.created_payloads.append(payload)
        return {"success": True, "message": "ok", "data": {"id": 88}}

    async def list_subscribes(self) -> list[dict]:
        return self.subscribe_items


def test_build_subscribe_payload_maps_tv_scope_to_moviepilot_schema() -> None:
    service = MoviePilotProviderService(client_factory=FakeMoviePilotClient)

    payload = service.build_subscribe_payload(
        {
            "title": "Slow Horses",
            "year": "2024",
            "media_type": MediaType.TV,
            "tmdb_id": 95480,
            "douban_id": "35295566",
            "poster_path": "/poster.jpg",
            "tv_scope": "episode_range",
            "tv_season_number": 3,
            "tv_episode_start": 2,
            "tv_episode_end": 5,
            "moviepilot_quality": "WEB-DL",
            "moviepilot_resolution": "1080p",
            "moviepilot_include": "官方中字",
            "moviepilot_exclude": "CAM",
            "moviepilot_save_path": "/incoming/pt/tv",
        }
    )

    assert payload["name"] == "Slow Horses"
    assert payload["type"] == "tv"
    assert payload["tmdbid"] == 95480
    assert payload["doubanid"] == "35295566"
    assert payload["season"] == 3
    assert payload["start_episode"] == 2
    assert payload["total_episode"] == 5
    assert payload["quality"] == "WEB-DL"
    assert payload["resolution"] == "1080p"
    assert payload["include"] == "官方中字"
    assert payload["exclude"] == "CAM"
    assert payload["save_path"] == "/incoming/pt/tv"


@pytest.mark.asyncio
async def test_create_moviepilot_subscription_persists_external_id() -> None:
    await ensure_tables_exist("subscriptions")
    await ensure_subscription_columns()
    fake_client = FakeMoviePilotClient()
    service = MoviePilotProviderService(client_factory=lambda: fake_client)

    async with async_session_maker() as db:
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 7654321))
        await db.commit()

        created = await service.create_subscription(
            db,
            {
                "title": "Provider Test Movie",
                "media_type": MediaType.MOVIE,
                "tmdb_id": 7654321,
                "year": "2026",
                "moviepilot_save_path": "/incoming/pt/movie",
            },
        )

        assert created.provider == "moviepilot"
        assert created.external_system == "moviepilot"
        assert created.external_subscription_id == "88"
        assert created.external_status == "created"

        result = await db.execute(
            select(Subscription).where(Subscription.tmdb_id == 7654321)
        )
        persisted = result.scalar_one()
        assert persisted.external_subscription_id == "88"
        assert fake_client.created_payloads[0]["save_path"] == "/incoming/pt/movie"

        await db.delete(persisted)
        await db.commit()


@pytest.mark.asyncio
async def test_sync_subscriptions_updates_local_external_status() -> None:
    await ensure_tables_exist("subscriptions")
    await ensure_subscription_columns()
    fake_client = FakeMoviePilotClient()
    fake_client.subscribe_items = [
        {"id": 88, "name": "Provider Sync Movie", "state": "R"},
        {"id": 99, "name": "Untracked Movie", "state": "N"},
    ]
    service = MoviePilotProviderService(client_factory=lambda: fake_client)

    async with async_session_maker() as db:
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 7654322))
        local = Subscription(
            title="Provider Sync Movie",
            media_type=MediaType.MOVIE,
            tmdb_id=7654322,
            provider="moviepilot",
            external_system="moviepilot",
            external_subscription_id="88",
            external_status="created",
        )
        db.add(local)
        await db.commit()

        result = await service.sync_subscriptions(db)

        assert result["updated_count"] == 1
        assert result["items"] == fake_client.subscribe_items

        refreshed = await db.get(Subscription, local.id)
        assert refreshed is not None
        assert refreshed.external_status == "R"

        await db.delete(refreshed)
        await db.commit()
