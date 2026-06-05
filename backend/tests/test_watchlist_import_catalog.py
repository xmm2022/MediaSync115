"""片单导入目录测试。"""

import pytest

from app.services.watchlist_import_catalog import get_import_catalog, resolve_catalog_item
from app.services.watchlist_import_service import parse_tmdb_import_reference


class TestWatchlistImportCatalog:
    """导入目录结构测试"""

    def test_catalog_has_streaming_and_awards(self) -> None:
        categories = get_import_catalog()
        keys = {item["key"] for item in categories}
        assert "streaming" in keys
        assert "awards" in keys
        assert "advanced" in keys

    def test_resolve_netflix_source(self) -> None:
        category_key, item = resolve_catalog_item("netflix")
        assert category_key == "streaming"
        assert item["fetcher"] == "watch_provider"
        assert "Netflix" in item["provider_names"]

    def test_resolve_oscar_source(self) -> None:
        category_key, item = resolve_catalog_item("oscar_best_picture")
        assert category_key == "awards"
        assert item["fetcher"] == "tmdb_list"
        assert item["list_id"] == 101353

    def test_resolve_unknown_source(self) -> None:
        with pytest.raises(ValueError):
            resolve_catalog_item("not-exists")


class TestWatchlistImportParse:
    """导入来源解析测试"""

    def test_parse_list_url(self) -> None:
        source_type, source_id = parse_tmdb_import_reference(
            "https://www.themoviedb.org/list/634"
        )
        assert source_type == "tmdb_list"
        assert source_id == 634
