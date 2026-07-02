from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions import (
    runtime_preferences_adapter as preferences_runtime_module,
)
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    RuntimePreferencesDependencies,
    build_default_runtime_preferences_dependencies,
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.source_attempts import resolve_source_order


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> RuntimePreferencesDependencies:
    def run_resolve_source_order(
        priority: list[str],
        *,
        tg_ready: bool,
    ) -> list[str]:
        return [source for source in priority if source != "tg" or tg_ready]

    def build_quality_filter(
        preferences: SubscriptionQualityPreferences,
    ) -> dict[str, Any]:
        return build_subscription_quality_filter(preferences)

    values: dict[str, Any] = {
        "get_resource_priority": lambda: ["tg", "pansou", "hdhive"],
        "get_tg_api_id": lambda: "123",
        "get_tg_api_hash": lambda: "hash",
        "get_tg_session": lambda: "session",
        "get_tg_channel_usernames": lambda: ["channel"],
        "get_resource_preferred_resolutions": lambda: ["2160p"],
        "get_resource_preferred_hdr": lambda: ["HDR10"],
        "get_resource_preferred_codec": lambda: ["H265"],
        "get_resource_exclude_tags": lambda: ["CAM"],
        "get_resource_preferred_audio": lambda: ["zh"],
        "get_resource_preferred_subtitles": lambda: ["chs"],
        "get_resource_min_size_gb": lambda: 1.5,
        "get_resource_max_size_gb": lambda: 60.0,
        "run_resolve_source_order": run_resolve_source_order,
        "build_quality_filter": build_quality_filter,
    }
    values.update(overrides)
    return RuntimePreferencesDependencies(**values)


def test_runtime_adapter_resolves_source_order_with_injected_tg_readiness() -> None:
    calls: list[tuple[list[str], bool]] = []

    def run_resolve_source_order(
        priority: list[str],
        *,
        tg_ready: bool,
    ) -> list[str]:
        calls.append((priority, tg_ready))
        return ["tg", "pansou"] if tg_ready else ["pansou"]

    result = resolve_source_order_with_runtime_adapter(
        "all",
        dependencies=_dependencies(
            get_resource_priority=lambda: ["tg", "pansou"],
            get_tg_api_id=lambda: " 123 ",
            get_tg_api_hash=lambda: " hash ",
            get_tg_session=lambda: " session ",
            get_tg_channel_usernames=lambda: ["channel"],
            run_resolve_source_order=run_resolve_source_order,
        ),
    )

    assert result == ["tg", "pansou"]
    assert calls == [(["tg", "pansou"], True)]


def test_runtime_adapter_marks_tg_unready_when_required_settings_are_blank() -> None:
    calls: list[tuple[list[str], bool]] = []

    def run_resolve_source_order(
        priority: list[str],
        *,
        tg_ready: bool,
    ) -> list[str]:
        calls.append((priority, tg_ready))
        return ["tg"] if tg_ready else ["pansou"]

    result = resolve_source_order_with_runtime_adapter(
        "all",
        dependencies=_dependencies(
            get_resource_priority=lambda: ["tg", "pansou"],
            get_tg_api_id=lambda: "123",
            get_tg_api_hash=lambda: " ",
            get_tg_session=lambda: "session",
            get_tg_channel_usernames=lambda: ["channel"],
            run_resolve_source_order=run_resolve_source_order,
        ),
    )

    assert result == ["pansou"]
    assert calls == [(["tg", "pansou"], False)]


def test_runtime_adapter_builds_quality_filter_from_injected_preferences() -> None:
    captured: dict[str, Any] = {}

    def build_quality_filter(
        preferences: SubscriptionQualityPreferences,
    ) -> dict[str, Any]:
        captured["preferences"] = preferences
        return {"preferred_resolutions": preferences.preferred_resolutions}

    result = resolve_subscription_quality_filter_with_runtime_adapter(
        SimpleNamespace(title="测试"),
        dependencies=_dependencies(
            get_resource_preferred_resolutions=lambda: ["1080p"],
            get_resource_preferred_hdr=lambda: ["Dolby Vision"],
            get_resource_preferred_codec=lambda: ["AV1"],
            get_resource_exclude_tags=lambda: ["TC"],
            get_resource_preferred_audio=lambda: ["ja"],
            get_resource_preferred_subtitles=lambda: ["cht"],
            get_resource_min_size_gb=lambda: 2.0,
            get_resource_max_size_gb=lambda: 40.0,
            build_quality_filter=build_quality_filter,
        ),
    )

    assert result == {"preferred_resolutions": ["1080p"]}
    preferences = captured["preferences"]
    assert preferences == SubscriptionQualityPreferences(
        preferred_resolutions=["1080p"],
        preferred_hdr=["Dolby Vision"],
        preferred_codec=["AV1"],
        exclude_labels=["TC"],
        preferred_audio=["ja"],
        preferred_subtitles=["cht"],
        min_size_gb=2.0,
        max_size_gb=40.0,
    )


def test_resolve_subscription_resolutions_with_runtime_adapter_reads_runtime_preferences() -> None:
    sub = SimpleNamespace(title="测试订阅")

    result = (
        preferences_runtime_module.resolve_subscription_resolutions_with_runtime_adapter(
            sub,
            dependencies=_dependencies(
                get_resource_preferred_resolutions=lambda: ["2160p", "1080p"],
            ),
        )
    )

    assert result == ["2160p", "1080p"]


def test_default_runtime_preferences_dependencies_bind_existing_helpers() -> None:
    dependencies = build_default_runtime_preferences_dependencies()

    assert dependencies.run_resolve_source_order is resolve_source_order
    assert dependencies.build_quality_filter is build_subscription_quality_filter
    assert dependencies.get_resource_priority.__self__ is runtime_settings_service
    assert dependencies.get_resource_priority.__name__ == (
        "get_subscription_resource_priority"
    )
    assert dependencies.get_tg_api_id.__self__ is runtime_settings_service
    assert dependencies.get_resource_preferred_resolutions.__self__ is (
        runtime_settings_service
    )


def test_runtime_preferences_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/runtime_preferences_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
