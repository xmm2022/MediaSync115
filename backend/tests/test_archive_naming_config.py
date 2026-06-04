from app.services.archive_naming_config import (
    DEFAULT_ARCHIVE_NAMING,
    extract_naming_media_tags,
    normalize_archive_naming,
    render_archive_name,
)


class TestArchiveNamingConfig:
    """归档命名格式配置测试"""

    def test_default_movie_file(self) -> None:
        name = render_archive_name(
            None,
            "movie_file",
            title="黑客帝国",
            year="1999",
            ext=".mkv",
        )
        assert name == "黑客帝国 (1999).mkv"

    def test_default_tv_file(self) -> None:
        name = render_archive_name(
            None,
            "tv_file",
            title="绝命毒师",
            year="2008",
            season=1,
            episode=2,
            ext=".mkv",
        )
        assert name == "绝命毒师 (2008) - S01E02.mkv"

    def test_custom_movie_folder(self) -> None:
        naming = normalize_archive_naming(
            {"movie_folder": "{title}.{year}"}
        )
        folder = render_archive_name(
            naming,
            "movie_folder",
            title="Inception",
            year="2010",
        )
        assert folder == "Inception.2010"

    def test_cleanup_empty_year_parentheses(self) -> None:
        name = render_archive_name(
            None,
            "movie_file",
            title="无名",
            year="",
            ext=".mp4",
        )
        assert name == "无名.mp4"

    def test_custom_tv_season_folder(self) -> None:
        naming = normalize_archive_naming({"tv_season_folder": "Season {season2}"})
        folder = render_archive_name(
            naming,
            "tv_season_folder",
            title="",
            season=3,
        )
        assert folder == "Season 03"

    def test_reject_invalid_template_chars(self) -> None:
        try:
            normalize_archive_naming({"movie_file": "bad/name{ext}"})
            assert False, "should raise"
        except ValueError:
            pass

    def test_extract_quality_tags_from_filename(self) -> None:
        tags = extract_naming_media_tags(
            "The.Matrix.1999.2160p.HDR10.HEVC.WEB-DL.Atmos.mkv"
        )
        assert tags["resolution"] == "4K"
        assert tags["hdr"] == "HDR10"
        assert tags["codec"] == "HEVC"
        assert tags["source"] == "WEB-DL"
        assert tags["audio"] == "Atmos"
        assert tags["format"] == "4K HDR10 HEVC"
        assert "4K" in tags["formats"]
        assert "HDR10" in tags["formats"]

    def test_render_with_tmdb_and_quality_vars(self) -> None:
        naming = normalize_archive_naming(
            {"movie_file": "{title} [{tmdb_id}] {format}{ext}"}
        )
        name = render_archive_name(
            naming,
            "movie_file",
            title="黑客帝国",
            year="1999",
            ext=".mkv",
            tmdb_id=603,
            source_filename="The.Matrix.1999.2160p.HDR10.HEVC.WEB-DL.mkv",
        )
        assert name == "黑客帝国 [603] 4K HDR10 HEVC.mkv"
