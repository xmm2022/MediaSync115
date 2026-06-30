from fastapi.testclient import TestClient


def test_moviepilot_config_route_returns_runtime_status(client: TestClient) -> None:
    response = client.get("/api/moviepilot/config")

    assert response.status_code == 200
    data = response.json()
    assert "enabled" in data
    assert "password_configured" in data
    assert "moviepilot_password" not in data


def test_moviepilot_search_route_delegates_to_service(client: TestClient, monkeypatch) -> None:
    from app.api import moviepilot as moviepilot_api

    async def fake_search(keyword: str):
        assert keyword == "Dune"
        return [{"title": "Dune", "year": "2021"}]

    monkeypatch.setattr(moviepilot_api.moviepilot_provider_service, "search_title", fake_search)

    response = client.post("/api/moviepilot/search", json={"keyword": "Dune"})

    assert response.status_code == 200
    assert response.json()["items"] == [{"title": "Dune", "year": "2021"}]


def test_moviepilot_create_subscription_route_delegates_to_service(
    client: TestClient, monkeypatch
) -> None:
    from app.api import moviepilot as moviepilot_api

    class Created:
        id = 321
        title = "Dune"
        media_type = "movie"
        tmdb_id = 438631
        douban_id = None
        provider = "moviepilot"
        external_system = "moviepilot"
        external_subscription_id = "88"
        external_status = "created"

    async def fake_create(db, payload):
        assert payload["title"] == "Dune"
        assert payload["media_type"] == "movie"
        return Created()

    monkeypatch.setattr(
        moviepilot_api.moviepilot_provider_service,
        "create_subscription",
        fake_create,
    )

    response = client.post(
        "/api/moviepilot/subscriptions",
        json={"title": "Dune", "media_type": "movie", "tmdb_id": 438631},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": 321,
        "title": "Dune",
        "media_type": "movie",
        "tmdb_id": 438631,
        "douban_id": None,
        "provider": "moviepilot",
        "external_system": "moviepilot",
        "external_subscription_id": "88",
        "external_status": "created",
    }


def test_moviepilot_download_route_delegates_to_service(
    client: TestClient, monkeypatch
) -> None:
    from app.api import moviepilot as moviepilot_api

    async def fake_push(payload):
        assert payload["title"] == "Dune"
        assert payload["tmdb_id"] == 438631
        assert payload["torrent"]["enclosure"] == "https://example.test/dune.torrent"
        return {"success": True, "data": {"download_id": "d1"}}

    monkeypatch.setattr(
        moviepilot_api.moviepilot_provider_service,
        "push_download",
        fake_push,
    )

    response = client.post(
        "/api/moviepilot/downloads",
        json={
            "title": "Dune",
            "media_type": "movie",
            "tmdb_id": 438631,
            "torrent": {
                "title": "Dune.2021",
                "enclosure": "https://example.test/dune.torrent",
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "data": {"download_id": "d1"}}


def test_moviepilot_sync_route_updates_local_metadata(
    client: TestClient, monkeypatch
) -> None:
    from app.api import moviepilot as moviepilot_api

    async def fake_sync(db):
        return {
            "subscriptions": {"items": [{"id": 88, "state": "R"}], "updated_count": 1},
            "downloads": {"items": [{"hash": "abc"}], "created_count": 1, "updated_count": 0, "skipped_count": 0},
            "transfer_history": {"items": [], "created_count": 0, "updated_count": 0, "skipped_count": 0},
            "updated_count": 1,
            "download_created_count": 1,
            "download_updated_count": 0,
            "transfer_created_count": 0,
            "transfer_updated_count": 0,
        }

    monkeypatch.setattr(
        moviepilot_api.moviepilot_provider_service,
        "sync_execution_state",
        fake_sync,
    )

    response = client.post("/api/moviepilot/subscriptions/sync")

    assert response.status_code == 200
    assert response.json()["updated_count"] == 1
    assert response.json()["download_created_count"] == 1
    assert response.json()["downloads"]["items"] == [{"hash": "abc"}]
