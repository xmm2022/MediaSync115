"""演职员关注 API 测试。"""

from datetime import date

from fastapi.testclient import TestClient

from app.services.person_follow_service import is_upcoming_credit


class TestPersonFollowUpcomingCredit:
    """新作日期判定测试"""

    def test_is_upcoming_credit_after_today(self) -> None:
        today = date(2026, 6, 5)
        assert is_upcoming_credit("2026-06-06", ref_date=today) is True

    def test_is_upcoming_credit_not_today_or_past(self) -> None:
        today = date(2026, 6, 5)
        assert is_upcoming_credit("2026-06-05", ref_date=today) is False
        assert is_upcoming_credit("1990-01-01", ref_date=today) is False
        assert is_upcoming_credit("", ref_date=today) is False
        assert is_upcoming_credit(None, ref_date=today) is False


class TestPersonFollows:
    """演职员关注测试类"""

    def test_toggle_person_follow(self, client: TestClient) -> None:
        payload = {
            "tmdb_person_id": 525,
            "name": "Christopher Nolan",
            "known_for_department": "Directing",
        }
        response = client.post("/api/person-follows/toggle", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["followed"] is True
        follow_id = data["item"]["id"]

        response = client.get("/api/person-follows/status-map")
        assert response.status_code == 200
        assert "525" in response.json()["person_id_map"]

        response = client.post("/api/person-follows/toggle", json=payload)
        assert response.status_code == 200
        assert response.json()["followed"] is False

        response = client.get("/api/person-follows")
        assert response.status_code == 200
        assert all(item["id"] != follow_id for item in response.json())
