from app.services.archive_subdir_config import (
    normalize_archive_subdirs,
    resolve_movie_category,
    resolve_tv_category,
)


class TestArchiveSubdirConfig:
    """归档二级目录配置测试"""

    def test_resolve_movie_category_cn(self) -> None:
        detail = {"origin_country": ["CN"]}
        assert resolve_movie_category(detail) == "华语电影"

    def test_resolve_movie_category_foreign_fallback(self) -> None:
        detail = {"origin_country": ["US"]}
        assert resolve_movie_category(detail) == "外语电影"

    def test_resolve_tv_category_by_genre(self) -> None:
        detail = {"genres": [{"id": 16, "name": "Animation"}], "origin_country": ["CN"]}
        assert resolve_tv_category(detail) == "动漫"

    def test_resolve_tv_category_by_country(self) -> None:
        detail = {"genres": [{"id": 18, "name": "Drama"}], "origin_country": ["KR"]}
        assert resolve_tv_category(detail) == "日韩剧"

    def test_custom_movie_category_name(self) -> None:
        subdirs = normalize_archive_subdirs(
            {
                "movie_categories": [
                    {
                        "id": "cn",
                        "name": "华语片",
                        "enabled": True,
                        "match_countries": ["CN"],
                    },
                    {
                        "id": "foreign",
                        "name": "其他电影",
                        "enabled": True,
                        "is_fallback": True,
                    },
                ]
            }
        )
        detail = {"origin_country": ["CN"]}
        assert resolve_movie_category(detail, subdirs) == "华语片"

    def test_reject_duplicate_enabled_names(self) -> None:
        try:
            normalize_archive_subdirs(
                {
                    "movie_categories": [
                        {"id": "a", "name": "重复", "enabled": True, "match_countries": ["CN"]},
                        {"id": "b", "name": "重复", "enabled": True, "match_countries": ["US"]},
                        {"id": "c", "name": "其他", "enabled": True, "is_fallback": True},
                    ]
                }
            )
            assert False, "should raise ValueError"
        except ValueError as exc:
            assert "不能重复" in str(exc)
