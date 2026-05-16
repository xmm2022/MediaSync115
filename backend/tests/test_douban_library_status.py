"""豆瓣探索媒体库角标辅助函数测试"""

from app.services.douban_explore_service import (
    TMDB_SYNC_PRIME_MAX_ITEMS_PER_SECTION,
    _build_backfill_candidates_from_items,
    library_status_sync_prime_limit,
)


class TestDoubanLibraryStatusHelpers:
    """豆瓣条目 TMDB 解析上限与候选构建"""

    def test_library_status_sync_prime_limit_caps_at_max(self) -> None:
        assert library_status_sync_prime_limit(0) == 0
        assert library_status_sync_prime_limit(5) == 5
        assert (
            library_status_sync_prime_limit(100)
            == TMDB_SYNC_PRIME_MAX_ITEMS_PER_SECTION
        )

    def test_build_backfill_candidates_skips_resolved_items(self) -> None:
        items = [
            {
                "douban_id": "1",
                "title": "Resolved",
                "media_type": "movie",
                "tmdb_id": 42,
            },
            {
                "douban_id": "2",
                "title": "Pending",
                "media_type": "tv",
                "year": "2020",
            },
        ]
        candidates = _build_backfill_candidates_from_items(items)
        assert len(candidates) == 1
        assert candidates[0]["douban_id"] == "2"
        assert candidates[0]["title"] == "Pending"
        assert candidates[0]["media_type"] == "tv"
