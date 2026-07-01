"""豆瓣探索媒体库角标辅助函数测试"""

from app.services.douban_explore_service import (
    DOUBAN_LIBRARY_BADGE_TMDB_SYNC_CAP,
    _build_subject_tmdb_cache_key,
    _build_backfill_candidates_from_items,
    _build_tmdb_cache_key,
    _douban_subject_tmdb_cache,
    _hydrate_tmdb_ids_from_cache,
    _hydrate_tmdb_ids_from_db,
    _set_subject_tmdb_cache,
    _set_tmdb_id_cache,
    _tmdb_id_cache,
    library_status_sync_prime_limit,
)


class TestDoubanLibraryStatusHelpers:
    """豆瓣条目 TMDB 解析上限与候选构建"""

    def test_library_status_sync_prime_limit_caps_at_max(self) -> None:
        assert library_status_sync_prime_limit(0) == 0
        assert library_status_sync_prime_limit(5) == 5
        assert (
            library_status_sync_prime_limit(100) == DOUBAN_LIBRARY_BADGE_TMDB_SYNC_CAP
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

    def test_backfill_candidates_are_deduped_by_subject_before_title(self) -> None:
        items = [
            {
                "douban_id": "subject-a",
                "title": "Same Title",
                "media_type": "movie",
                "year": "2024",
            },
            {
                "douban_id": "subject-b",
                "title": "Same Title",
                "media_type": "movie",
                "year": "2024",
            },
        ]

        candidates = _build_backfill_candidates_from_items(items)

        assert len(candidates) == 2
        assert {item["cache_key"] for item in candidates} == {
            _build_subject_tmdb_cache_key("subject-a", "movie"),
            _build_subject_tmdb_cache_key("subject-b", "movie"),
        }

    def test_title_cache_does_not_hydrate_items_with_douban_id(self) -> None:
        _tmdb_id_cache.clear()
        _douban_subject_tmdb_cache.clear()
        title_cache_key = _build_tmdb_cache_key("Same Title", "2024", "movie")
        _set_tmdb_id_cache(title_cache_key, 111, persist=False)

        items = [
            {
                "douban_id": "subject-b",
                "title": "Same Title",
                "media_type": "movie",
                "year": "2024",
            },
            {
                "title": "Same Title",
                "media_type": "movie",
                "year": "2024",
            },
        ]

        _hydrate_tmdb_ids_from_cache(items)

        assert items[0].get("tmdb_id") is None
        assert items[1]["tmdb_id"] == 111

    def test_subject_cache_still_hydrates_items_with_douban_id(self) -> None:
        _tmdb_id_cache.clear()
        _douban_subject_tmdb_cache.clear()
        subject_cache_key = _build_subject_tmdb_cache_key("subject-a", "movie")
        _set_subject_tmdb_cache(subject_cache_key, 222, persist=False)

        items = [
            {
                "douban_id": "subject-a",
                "title": "Same Title",
                "media_type": "movie",
                "year": "2024",
            }
        ]

        _hydrate_tmdb_ids_from_cache(items)

        assert items[0]["tmdb_id"] == 222
        assert items[0]["mapping_status"] == "resolved"

    async def test_db_hydrate_does_not_fallback_to_title_mapping_for_subject(
        self,
        monkeypatch,
    ) -> None:
        async def fake_get_subject_mapping(douban_id: str, media_type: str):
            assert douban_id == "subject-b"
            return False, None

        async def fake_get_title_mapping(title: str, year: str, media_type: str):
            raise AssertionError("title mapping must not be queried for subject items")

        monkeypatch.setattr(
            "app.services.douban_explore_service."
            "douban_tmdb_mapping_service.get_subject_mapping",
            fake_get_subject_mapping,
        )
        monkeypatch.setattr(
            "app.services.douban_explore_service."
            "douban_tmdb_mapping_service.get_title_mapping",
            fake_get_title_mapping,
        )
        items = [
            {
                "douban_id": "subject-b",
                "title": "Same Title",
                "media_type": "movie",
                "year": "2024",
            }
        ]

        hits = await _hydrate_tmdb_ids_from_db(items)

        assert hits == 0
        assert items[0].get("tmdb_id") is None
