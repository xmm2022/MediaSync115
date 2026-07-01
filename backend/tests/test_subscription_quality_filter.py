from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_subscription_quality_filter_merges_hdr_and_codec_preferences() -> None:
    quality_filter = build_subscription_quality_filter(
        SubscriptionQualityPreferences(
            preferred_resolutions=["2160p", "1080p"],
            preferred_hdr=["HDR10", "Dolby Vision"],
            preferred_codec=["HEVC", "AV1"],
            exclude_labels=[],
            preferred_audio=[],
            preferred_subtitles=[],
            min_size_gb=None,
            max_size_gb=None,
        )
    )

    assert quality_filter["preferred_resolutions"] == ["2160p", "1080p"]
    assert quality_filter["preferred_formats"] == [
        "HDR10",
        "Dolby Vision",
        "HEVC",
        "AV1",
    ]
    assert quality_filter["exclude_labels"] is None


def test_build_subscription_quality_filter_converts_empty_lists_to_none() -> None:
    quality_filter = build_subscription_quality_filter(
        SubscriptionQualityPreferences(
            preferred_resolutions=[],
            preferred_hdr=[],
            preferred_codec=[],
            exclude_labels=[],
            preferred_audio=[],
            preferred_subtitles=[],
            min_size_gb=0,
            max_size_gb=None,
        )
    )

    assert quality_filter == {
        "preferred_resolutions": None,
        "preferred_formats": None,
        "exclude_labels": None,
        "preferred_languages": None,
        "preferred_subtitles": None,
        "min_size_gb": 0,
        "max_size_gb": None,
    }


def test_build_subscription_quality_filter_preserves_language_subtitle_and_size_values() -> None:
    quality_filter = build_subscription_quality_filter(
        SubscriptionQualityPreferences(
            preferred_resolutions=["1080p"],
            preferred_hdr=[],
            preferred_codec=["H264"],
            exclude_labels=["CAM", "TS"],
            preferred_audio=["国语", "粤语"],
            preferred_subtitles=["简中"],
            min_size_gb=2.5,
            max_size_gb=12.0,
        )
    )

    assert quality_filter == {
        "preferred_resolutions": ["1080p"],
        "preferred_formats": ["H264"],
        "exclude_labels": ["CAM", "TS"],
        "preferred_languages": ["国语", "粤语"],
        "preferred_subtitles": ["简中"],
        "min_size_gb": 2.5,
        "max_size_gb": 12.0,
    }


def test_quality_filter_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/quality_filter.py"
    ).read_text(encoding="utf-8")

    forbidden_tokens = [
        "subscription_service",
        "runtime_settings_service",
        "AsyncSession",
        "app.models",
        "app.api",
    ]
    for token in forbidden_tokens:
        assert token not in source
