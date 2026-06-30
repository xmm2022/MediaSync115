import pytest
from sqlalchemy import delete, select

from app.core.database import async_session_maker, ensure_subscription_columns, ensure_tables_exist
from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
from app.services.job_registry import job_registry
from app.services.moviepilot_provider_service import MoviePilotProviderService


class FakeMoviePilotClient:
    def __init__(self) -> None:
        self.created_payloads: list[dict] = []
        self.download_payloads: list[dict] = []
        self.subscribe_items: list[dict] = []
        self.download_items: list[dict] = []
        self.transfer_payload: dict = {"success": True, "data": {"list": [], "total": 0}}

    async def create_subscribe(self, payload: dict) -> dict:
        self.created_payloads.append(payload)
        return {"success": True, "message": "ok", "data": {"id": 88}}

    async def add_download(self, payload: dict) -> dict:
        self.download_payloads.append(payload)
        return {"success": True, "data": {"download_id": "did-1"}}

    async def list_subscribes(self) -> list[dict]:
        return self.subscribe_items

    async def list_downloads(self, name: str | None = None) -> list[dict]:
        return self.download_items

    async def transfer_history(self, *, title: str = "", page: int = 1, count: int = 50) -> dict:
        return self.transfer_payload


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


def test_build_download_payload_extracts_context_shape() -> None:
    service = MoviePilotProviderService(client_factory=FakeMoviePilotClient)

    payload = service.build_download_payload(
        {
            "item": {
                "media_info": {
                    "title": "Dune",
                    "type": "movie",
                    "tmdb_id": 438631,
                    "year": "2021",
                },
                "torrent_info": {
                    "title": "Dune.2021.1080p",
                    "enclosure": "https://example.test/dune.torrent",
                    "page_url": "https://example.test/detail",
                    "site_name": "SiteA",
                    "size": 1024,
                    "seeders": 8,
                },
            },
            "save_path": "/downloads/movie",
        }
    )

    assert payload["media_in"]["tmdb_id"] == 438631
    assert payload["torrent_in"]["title"] == "Dune.2021.1080p"
    assert payload["torrent_in"]["enclosure"] == "https://example.test/dune.torrent"
    assert payload["torrent_in"]["page_url"] == "https://example.test/detail"
    assert payload["torrent_in"]["site_name"] == "SiteA"
    assert payload["torrent_in"]["seeders"] == 8
    assert payload["save_path"] == "/downloads/movie"


def test_build_download_payload_falls_back_to_tmdbid_without_media_info() -> None:
    service = MoviePilotProviderService(client_factory=FakeMoviePilotClient)

    payload = service.build_download_payload(
        {
            "title": "Dune",
            "tmdb_id": 438631,
            "torrent": {
                "name": "Dune.2021.2160p",
                "torrent_url": "https://example.test/dune-4k.torrent",
                "source": "SiteB",
            },
        }
    )

    assert "media_in" not in payload
    assert payload["tmdbid"] == 438631
    assert payload["torrent_in"]["title"] == "Dune.2021.2160p"
    assert payload["torrent_in"]["enclosure"] == "https://example.test/dune-4k.torrent"
    assert payload["torrent_in"]["site_name"] == "SiteB"


@pytest.mark.asyncio
async def test_push_download_delegates_to_client() -> None:
    fake_client = FakeMoviePilotClient()
    service = MoviePilotProviderService(client_factory=lambda: fake_client)

    response = await service.push_download(
        {
            "tmdb_id": 438631,
            "torrent": {
                "title": "Dune.2021",
                "enclosure": "https://example.test/dune.torrent",
            },
        }
    )

    assert response["success"] is True
    assert fake_client.download_payloads[0]["torrent_in"]["title"] == "Dune.2021"


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


@pytest.mark.asyncio
async def test_sync_active_downloads_creates_and_updates_download_record() -> None:
    await ensure_tables_exist("subscriptions")
    await ensure_subscription_columns()
    fake_client = FakeMoviePilotClient()
    fake_client.download_items = [
        {
            "hash": "abc123",
            "title": "Provider Download Movie",
            "name": "Provider.Download.Movie.2026.1080p",
            "state": "downloading",
            "progress": 42.5,
            "save_path": "/incoming/pt",
        }
    ]
    service = MoviePilotProviderService(client_factory=lambda: fake_client)

    async with async_session_maker() as db:
        await db.execute(delete(DownloadRecord).where(DownloadRecord.offline_info_hash == "abc123"))
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 7654323))
        local = Subscription(
            title="Provider Download Movie",
            media_type=MediaType.MOVIE,
            tmdb_id=7654323,
            provider="moviepilot",
            external_system="moviepilot",
            external_subscription_id="188",
            external_status="R",
        )
        db.add(local)
        await db.commit()

        first = await service.sync_active_downloads(db)
        second = await service.sync_active_downloads(db)

        assert first["created_count"] == 1
        assert first["updated_count"] == 0
        assert second["created_count"] == 0
        assert second["updated_count"] == 1

        result = await db.execute(
            select(DownloadRecord).where(DownloadRecord.offline_info_hash == "abc123")
        )
        record = result.scalar_one()
        assert record.subscription_id == local.id
        assert record.resource_name == "Provider.Download.Movie.2026.1080p"
        assert record.resource_type == "moviepilot"
        assert record.status == MediaStatus.DOWNLOADING
        assert record.offline_status == "downloading"

        await db.delete(record)
        await db.delete(local)
        await db.commit()


@pytest.mark.asyncio
async def test_sync_transfer_history_marks_download_record_completed() -> None:
    await ensure_tables_exist("subscriptions")
    await ensure_subscription_columns()
    fake_client = FakeMoviePilotClient()
    fake_client.transfer_payload = {
        "success": True,
        "data": {
            "list": [
                {
                    "id": 9,
                    "title": "Provider Transfer Movie",
                    "download_hash": "done123",
                    "torrent_name": "Provider.Transfer.Movie.2026.1080p",
                    "src": "/incoming/pt/file.mkv",
                    "dest": "/media/Movies/file.mkv",
                    "status": True,
                    "errmsg": "",
                }
            ],
            "total": 1,
        },
    }
    service = MoviePilotProviderService(client_factory=lambda: fake_client)

    async with async_session_maker() as db:
        await db.execute(delete(DownloadRecord).where(DownloadRecord.offline_info_hash == "done123"))
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 7654324))
        local = Subscription(
            title="Provider Transfer Movie",
            media_type=MediaType.MOVIE,
            tmdb_id=7654324,
            provider="moviepilot",
            external_system="moviepilot",
            external_subscription_id="288",
            external_status="R",
        )
        db.add(local)
        await db.commit()
        record = DownloadRecord(
            subscription_id=local.id,
            resource_name="Provider.Transfer.Movie.2026.1080p",
            resource_url="done123",
            resource_type="moviepilot",
            offline_info_hash="done123",
            offline_status="downloading",
            status=MediaStatus.DOWNLOADING,
        )
        db.add(record)
        await db.commit()

        result = await service.sync_transfer_history(db)

        assert result["updated_count"] == 1

        refreshed = await db.get(DownloadRecord, record.id)
        assert refreshed is not None
        assert refreshed.status == MediaStatus.COMPLETED
        assert refreshed.offline_status == "transfer_success"
        assert refreshed.completed_at is not None
        assert refreshed.error_message is None

        await db.delete(refreshed)
        await db.delete(local)
        await db.commit()


@pytest.mark.asyncio
async def test_moviepilot_sync_job_key_runs_provider(monkeypatch) -> None:
    from app.services import moviepilot_provider_service as provider_module

    async def fake_sync(db):
        assert db is not None
        return {"success": True, "download_created_count": 1}

    monkeypatch.setattr(
        provider_module.moviepilot_provider_service,
        "sync_execution_state",
        fake_sync,
    )

    assert "moviepilot.sync" in job_registry.list_keys()
    job = job_registry.get("moviepilot.sync")
    assert job is not None

    result = await job()

    assert result == {"success": True, "download_created_count": 1}
