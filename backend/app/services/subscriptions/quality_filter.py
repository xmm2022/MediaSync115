from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SubscriptionQualityPreferences:
    preferred_resolutions: list[str]
    preferred_hdr: list[str]
    preferred_codec: list[str]
    exclude_labels: list[str]
    preferred_audio: list[str]
    preferred_subtitles: list[str]
    min_size_gb: float | None
    max_size_gb: float | None


def build_subscription_quality_filter(
    preferences: SubscriptionQualityPreferences,
) -> dict[str, Any]:
    preferred_formats = (preferences.preferred_hdr or []) + (
        preferences.preferred_codec or []
    )
    return {
        "preferred_resolutions": preferences.preferred_resolutions or None,
        "preferred_formats": preferred_formats or None,
        "exclude_labels": preferences.exclude_labels or None,
        "preferred_languages": preferences.preferred_audio or None,
        "preferred_subtitles": preferences.preferred_subtitles or None,
        "min_size_gb": preferences.min_size_gb,
        "max_size_gb": preferences.max_size_gb,
    }
