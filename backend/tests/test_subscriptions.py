"""
订阅 API 测试
"""
import pytest
from fastapi.testclient import TestClient


class TestSubscriptions:
    """订阅功能测试类"""

    def test_list_subscriptions(self, client: TestClient) -> None:
        """测试获取订阅列表"""
        response = client.get("/api/subscriptions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert isinstance(data["items"], list)
        assert isinstance(data["douban_id_map"], dict)
        assert isinstance(data["imdb_id_map"], dict)

    def test_create_subscription_validation(self, client: TestClient) -> None:
        """测试创建订阅参数验证"""
        # 缺少必填参数
        response = client.post("/api/subscriptions", json={})
        assert response.status_code == 422

    def test_create_and_delete_subscription(self, client: TestClient) -> None:
        """测试创建和删除订阅"""
        # 创建订阅
        payload = {
            "title": "Test Movie",
            "media_type": "movie",
            "tmdb_id": 12345,
            "auto_download": False
        }
        response = client.post("/api/subscriptions", json=payload)
        assert response.status_code == 200
        created = response.json()
        assert created["title"] == "Test Movie"

        # 删除订阅
        sub_id = created["id"]
        response = client.delete(f"/api/subscriptions/{sub_id}")
        assert response.status_code == 200

    def test_get_subscription_detail(self, client: TestClient) -> None:
        """测试获取订阅详情"""
        # 先创建订阅
        payload = {
            "title": "Test TV Show",
            "media_type": "tv",
            "tmdb_id": 67890,
            "auto_download": False
        }
        response = client.post("/api/subscriptions", json=payload)
        created = response.json()
        sub_id = created["id"]

        # 获取详情
        response = client.get(f"/api/subscriptions/{sub_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == sub_id

        # 清理
        client.delete(f"/api/subscriptions/{sub_id}")
