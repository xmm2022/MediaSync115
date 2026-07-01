"""
订阅 API 测试
"""
from uuid import uuid4

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

    def test_preview_tv_missing_status(self, client: TestClient, monkeypatch) -> None:
        """测试未创建订阅时按 TV 范围预览缺集状态"""
        from app.api import subscriptions as subscriptions_api

        captured = {}

        async def fake_get_tv_missing_status(tmdb_id: int, **kwargs):
            captured["tmdb_id"] = tmdb_id
            captured.update(kwargs)
            return {
                "status": "ok",
                "message": "缺集状态计算完成",
                "aired_episodes": [[1, 1], [1, 2]],
                "existing_episodes": [[1, 1]],
                "missing_episodes": [[1, 2]],
                "missing_by_season": {"1": [2]},
                "counts": {"aired": 2, "existing": 1, "missing": 1},
            }

        monkeypatch.setattr(
            subscriptions_api.tv_missing_service,
            "get_tv_missing_status",
            fake_get_tv_missing_status,
        )

        response = client.get(
            "/api/subscriptions/missing-status/tv/preview/67890",
            params={
                "tv_scope": "episode_range",
                "tv_season_number": 1,
                "tv_episode_start": 2,
                "tv_episode_end": 3,
                "tv_follow_mode": "new",
                "tv_include_specials": True,
                "refresh": True,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["tmdb_id"] == 67890
        assert data["missing_episodes"] == [[1, 2]]
        assert captured == {
            "tmdb_id": 67890,
            "include_specials": True,
            "refresh": True,
            "season_number": 1,
            "episode_start": 2,
            "episode_end": 3,
            "aired_only": True,
        }

    def test_list_tv_missing_status_keeps_successful_transfer_rows(
        self,
        client: TestClient,
        monkeypatch,
    ) -> None:
        """已有完成下载记录的订阅仍应由缺集服务决定是否进入待处理列表"""
        from app.api import subscriptions as subscriptions_api

        tmdb_id = 930000 + (uuid4().int % 100000)
        title = f"Missing Overview Completed Transfer {tmdb_id}"

        async def fake_get_tv_missing_statuses(tmdb_ids, **kwargs):
            assert tmdb_id in tmdb_ids
            return {
                tmdb_id: {
                    "status": "ok",
                    "message": "缺集状态计算完成",
                    "missing_by_season": {"1": [2]},
                    "counts": {"aired": 2, "existing": 1, "missing": 1},
                }
            }

        monkeypatch.setattr(
            subscriptions_api.tv_missing_service,
            "get_tv_missing_statuses",
            fake_get_tv_missing_statuses,
        )

        create_response = client.post(
            "/api/subscriptions",
            json={
                "title": title,
                "media_type": "tv",
                "tmdb_id": tmdb_id,
                "auto_download": True,
            },
        )
        assert create_response.status_code == 200
        subscription = create_response.json()
        sub_id = subscription["id"]

        download_response = client.post(
            f"/api/subscriptions/{sub_id}/downloads",
            json={
                "resource_name": f"{title}.S01E01.mkv",
                "resource_url": "https://example.test/s01e01.mkv",
                "resource_type": "pan115",
            },
        )
        assert download_response.status_code == 200
        download_id = download_response.json()["id"]
        update_response = client.put(
            f"/api/subscriptions/{sub_id}/downloads/{download_id}",
            json={"status": "completed"},
        )
        assert update_response.status_code == 200

        response = client.get(
            "/api/subscriptions/missing-status/tv",
            params={"only_missing": True, "limit": 1000},
        )

        assert response.status_code == 200
        items = response.json()["items"]
        matched = [item for item in items if item["subscription_id"] == sub_id]
        assert len(matched) == 1
        assert matched[0]["missing_count"] == 1
        assert matched[0]["missing_by_season"] == {"1": [2]}

        client.delete(f"/api/subscriptions/{sub_id}")
