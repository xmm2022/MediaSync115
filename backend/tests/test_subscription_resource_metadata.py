from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.resource_metadata import (
    build_hdhive_keyword,
    build_pansou_keyword,
    build_tg_keyword,
    determine_resource_type,
    extract_resource_name,
    is_already_received_error,
    is_likely_115_share_identifier,
    is_retryable_transfer_error,
    is_video_filename,
    normalize_hdhive_subscription_items,
    split_share_link_and_receive_code,
)


ROOT = Path(__file__).resolve().parents[2]


def test_resource_type_and_name_extraction() -> None:
    assert determine_resource_type("magnet:?xt=urn:btih:ABC") == "magnet"
    assert determine_resource_type("ed2k://|file|a.mkv|1|hash|/") == "ed2k"
    assert determine_resource_type("https://115.com/s/demo") == "pan115"

    assert extract_resource_name({"resource_name": "资源 A"}) == "资源 A"
    assert extract_resource_name({"title": "标题 B"}) == "标题 B"
    assert extract_resource_name({}) == "未命名资源"


def test_keyword_builders_keep_existing_title_year_behavior() -> None:
    assert build_pansou_keyword("剧集", 2026) == "剧集 2026"
    assert build_pansou_keyword("剧集", None) == "剧集"
    assert build_hdhive_keyword(" 剧集 ", None) == "剧集"
    assert build_tg_keyword("剧集", 2026) == "剧集 2026"


def test_normalize_hdhive_subscription_items_fills_transfer_fields() -> None:
    assert normalize_hdhive_subscription_items(
        [
            {"share_link": "https://115.com/s/a", "resource_name": "资源 A"},
            "bad",
        ]
    ) == [
        {
            "share_link": "https://115.com/s/a",
            "resource_name": "资源 A",
            "pan115_share_link": "https://115.com/s/a",
            "name": "资源 A",
        }
    ]


def test_split_share_link_and_receive_code_reads_supported_hints() -> None:
    assert split_share_link_and_receive_code("abc123-defg") == ("abc123", "defg")
    assert split_share_link_and_receive_code(
        "https://115.com/s/abc?password=Q1w2"
    ) == (
        "https://115.com/s/abc?password=Q1w2",
        "Q1w2",
    )
    assert split_share_link_and_receive_code(
        "链接：https://115.com/s/abc 提取码：z9Y8"
    ) == (
        "链接：https://115.com/s/abc 提取码：z9Y8",
        "z9Y8",
    )
    assert split_share_link_and_receive_code("") == ("", "")


def test_video_and_transfer_classifiers_keep_existing_tokens() -> None:
    assert is_video_filename("Movie.MKV")
    assert not is_video_filename("poster.jpg")

    assert is_likely_115_share_identifier("abc123-defg")
    assert is_likely_115_share_identifier("https://115cdn.com/s/abc")
    assert not is_likely_115_share_identifier("https://example.com/s/abc")

    assert is_retryable_transfer_error("share_api_method_not_allowed")
    assert is_retryable_transfer_error("code=404")
    assert is_retryable_transfer_error("请求太频繁")
    assert not is_retryable_transfer_error("invalid receive code")

    assert is_already_received_error("4200045")
    assert is_already_received_error("already received")
    assert not is_already_received_error("timeout")


def test_resource_metadata_module_does_not_import_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_metadata.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
