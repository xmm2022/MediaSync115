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
