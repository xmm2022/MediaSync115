from fastapi.testclient import TestClient


def test_twilight_config_route_returns_masked_runtime_status(client: TestClient) -> None:
    response = client.get("/api/twilight/config")

    assert response.status_code == 200
    data = response.json()
    assert "enabled" in data
    assert "api_key_configured" in data
    assert "twilight_api_key" not in data


def test_twilight_health_route_delegates_to_client(client: TestClient, monkeypatch) -> None:
    from app.api import twilight as twilight_api

    class FakeClient:
        def __init__(self, *, base_url: str, api_key: str = "") -> None:
            assert base_url == "http://twilight.local:5000"
            assert api_key == "key-secret"

        async def health(self):
            return {"status": "ok"}

        async def api_key_status(self):
            return {"active": True, "expired_at": -1}

    monkeypatch.setattr(twilight_api.runtime_settings_service, "get_twilight_base_url", lambda: "http://twilight.local:5000")
    monkeypatch.setattr(twilight_api.runtime_settings_service, "get_twilight_api_key", lambda: "key-secret")
    monkeypatch.setattr(twilight_api, "TwilightClient", FakeClient)

    response = client.get("/api/twilight/health")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "health": {"status": "ok"},
        "api_key_status": {"active": True, "expired_at": -1},
    }
