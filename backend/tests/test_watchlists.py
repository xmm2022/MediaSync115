"""片单 API 测试。"""

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
