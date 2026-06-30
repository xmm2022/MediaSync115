"""
搜索 API 测试
"""
from fastapi.testclient import TestClient


class TestSearch:
    """搜索功能测试类"""

    def test_search_without_query(self, client: TestClient) -> None:
        """测试无查询参数的搜索"""
        response = client.get("/api/search")
        assert response.status_code == 422

    def test_search_with_query(self, client: TestClient, monkeypatch) -> None:
        """测试正常搜索"""
        from app.api import search as search_api

        async def fake_search_multi(query: str, page: int = 1):
            return {
                "page": page,
                "total_results": 1,
                "items": [
                    {
                        "id": 1,
                        "tmdb_id": 1,
                        "media_type": "movie",
                        "title": query,
                    }
                ],
            }

        monkeypatch.setattr(search_api.tmdb_service, "search_multi", fake_search_multi)
        response = client.get("/api/search?query=batman")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total_results" in data
        assert isinstance(data["items"], list)

    def test_search_pagination(self, client: TestClient, monkeypatch) -> None:
        """测试搜索分页"""
        from app.api import search as search_api

        async def fake_search_multi(query: str, page: int = 1):
            return {
                "page": page,
                "total_results": 0,
                "items": [],
            }

        monkeypatch.setattr(search_api.tmdb_service, "search_multi", fake_search_multi)
        response = client.get("/api/search?query=batman&page=1")
        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 1

    def test_explore_popular(self, client: TestClient, monkeypatch) -> None:
        """测试热门榜单"""
        from app.api import search as search_api

        async def fake_fetch_popular_section(source, refresh):
            return {
                "key": source["key"],
                "title": source["title"],
                "items": [],
                "fetched_at": "2026-06-27T00:00:00+08:00",
                "total": 0,
            }

        monkeypatch.setattr(
            search_api,
            "_fetch_popular_section",
            fake_fetch_popular_section,
        )
        response = client.get("/api/search/explore/popular")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    def test_explore_sections(self, client: TestClient, monkeypatch) -> None:
        """测试探索分类"""
        from app.api import search as search_api

        async def fake_fetch_douban_section(source, limit, refresh, client=None):
            return {
                "key": source["key"],
                "title": source["title"],
                "tag": source["tag"],
                "source_url": source["url"],
                "fetched_at": "2026-06-27T00:00:00+08:00",
                "total": 0,
                "items": [],
            }

        monkeypatch.setattr(
            search_api,
            "fetch_douban_section",
            fake_fetch_douban_section,
        )
        response = client.get("/api/search/explore/sections?source=douban")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["sections"], list)

    def test_tmdb_explore_sections_returns_upstream_error_detail(
        self, client: TestClient, monkeypatch
    ) -> None:
        """TMDB 全部 section 失败时应把上游原因返回给前端"""
        from app.api import search as search_api

        async def fake_fetch_tmdb_section(source, limit, refresh, client=None):
            raise RuntimeError(
                "Server error '502 Bad Gateway': Couldn't connect to the backend server"
            )

        monkeypatch.setattr(search_api, "fetch_tmdb_section", fake_fetch_tmdb_section)

        response = client.get("/api/search/explore/sections?source=tmdb")

        assert response.status_code == 502
        assert "Couldn't connect to the backend server" in response.json()["detail"]

    def test_tmdb_recommendations_maps_items(self, client: TestClient, monkeypatch) -> None:
        from app.api import search as search_api

        async def fake_get_recommendations(media_type: str, tmdb_id: int, page: int = 1):
            assert media_type == "movie"
            assert tmdb_id == 438631
            assert page == 2
            return {
                "page": 2,
                "total_pages": 5,
                "total_results": 1,
                "results": [
                    {
                        "id": 11,
                        "title": "Dune: Part Two",
                        "poster_path": "/poster.jpg",
                        "vote_average": 8.2,
                        "release_date": "2024-03-01",
                        "overview": "Arrakis continues.",
                    }
                ],
            }

        monkeypatch.setattr(
            search_api.tmdb_service,
            "get_recommendations",
            fake_get_recommendations,
        )

        response = client.get("/api/search/movie/438631/recommendations?page=2")

        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 2
        assert data["total_pages"] == 5
        assert data["items"][0]["tmdb_id"] == 11
        assert data["items"][0]["media_type"] == "movie"
        assert data["items"][0]["poster_url"].endswith("/poster.jpg")
