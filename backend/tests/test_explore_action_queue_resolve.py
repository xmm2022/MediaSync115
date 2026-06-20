"""探索转存队列路由解析测试。"""

import pytest

from app.services.explore_action_queue_service import ExploreActionQueueService


class TestExploreActionQueueResolveRoute:
    """_resolve_route 应严格区分 TMDB 与豆瓣来源。"""

    @pytest.mark.asyncio
    async def test_tmdb_source_uses_explicit_tmdb_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _fail_resolve(**_kwargs):
            raise AssertionError("douban resolve should not be called for tmdb source")

        monkeypatch.setattr(
            "app.services.explore_action_queue_service.resolve_douban_explore_item",
            _fail_resolve,
        )

        result = await ExploreActionQueueService._resolve_route(
            {
                "source": "tmdb",
                "media_type": "movie",
                "tmdb_id": 550,
                "title": "搏击俱乐部",
            }
        )
        assert result == {"media_type": "movie", "tmdb_id": 550, "douban_id": ""}

    @pytest.mark.asyncio
    async def test_douban_source_re_resolves_without_stale_tmdb_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _mock_resolve(**kwargs):
            assert kwargs.get("tmdb_id") is None
            assert kwargs.get("douban_id") == "1292052"
            assert kwargs.get("title") == "肖申克的救赎"
            return {
                "resolved": True,
                "media_type": "movie",
                "tmdb_id": 278,
            }

        monkeypatch.setattr(
            "app.services.explore_action_queue_service.resolve_douban_explore_item",
            _mock_resolve,
        )

        result = await ExploreActionQueueService._resolve_route(
            {
                "source": "douban",
                "media_type": "movie",
                "id": "1292052",
                "tmdb_id": 999999,
                "title": "肖申克的救赎",
                "year": "1994",
            }
        )
        assert result == {"media_type": "movie", "tmdb_id": 278, "douban_id": "1292052"}

    @pytest.mark.asyncio
    async def test_tmdb_source_requires_valid_id(self) -> None:
        with pytest.raises(ValueError, match="缺少有效的 TMDB ID"):
            await ExploreActionQueueService._resolve_route(
                {
                    "source": "tmdb",
                    "media_type": "movie",
                    "title": "未知电影",
                }
            )
