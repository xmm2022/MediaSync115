"""片单 API 测试。"""

import pytest
from fastapi.testclient import TestClient


class TestWatchlists:
    """片单功能测试类"""

    def test_create_list_and_delete_watchlist(self, client: TestClient) -> None:
        response = client.post(
            "/api/watchlists",
            json={"name": "测试片单", "description": "说明", "auto_fill_enabled": True},
        )
        assert response.status_code == 200
        created = response.json()
        assert created["name"] == "测试片单"
        watchlist_id = created["id"]

        response = client.get("/api/watchlists")
        assert response.status_code == 200
        assert any(item["id"] == watchlist_id for item in response.json())

        response = client.delete(f"/api/watchlists/{watchlist_id}")
        assert response.status_code == 200

    def test_add_and_remove_watchlist_item(self, client: TestClient) -> None:
        response = client.post("/api/watchlists", json={"name": "诺兰片单"})
        watchlist_id = response.json()["id"]

        response = client.post(
            f"/api/watchlists/{watchlist_id}/items",
            json={
                "tmdb_id": 27205,
                "media_type": "movie",
                "title": "Inception",
                "year": "2010",
            },
        )
        assert response.status_code == 200
        item_id = response.json()["id"]

        response = client.get(f"/api/watchlists/{watchlist_id}")
        assert response.status_code == 200
        detail = response.json()
        assert detail["item_count"] == 1
        assert detail["items"][0]["title"] == "Inception"

        response = client.delete(f"/api/watchlists/{watchlist_id}/items/{item_id}")
        assert response.status_code == 200

        client.delete(f"/api/watchlists/{watchlist_id}")

    def test_import_preview_accepts_catalog_source_key(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fake_preview_catalog_import(
            *,
            source_key: str,
            reference: str | None = None,
        ):
            assert source_key == "oscar_best_picture"
            assert reference is None
            return {"source_key": source_key, "item_count": 1, "items": [{"id": 1}]}

        monkeypatch.setattr(
            "app.api.watchlists.preview_catalog_import",
            fake_preview_catalog_import,
        )

        response = client.post(
            "/api/watchlists/import/preview",
            json={"source_key": "oscar_best_picture"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["source_key"] == "oscar_best_picture"
        assert "items" not in payload

    def test_import_accepts_catalog_source_key(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fake_import_catalog_to_watchlist(db, **kwargs):
            assert kwargs["source_key"] == "oscar_best_picture"
            assert kwargs["name"] == "奥斯卡最佳影片"
            return {"watchlist_id": 123, "source_key": kwargs["source_key"], "added": 1}

        monkeypatch.setattr(
            "app.api.watchlists.import_catalog_to_watchlist",
            fake_import_catalog_to_watchlist,
        )

        response = client.post(
            "/api/watchlists/import",
            json={"source_key": "oscar_best_picture", "name": "奥斯卡最佳影片"},
        )

        assert response.status_code == 200
        assert response.json()["source_key"] == "oscar_best_picture"
