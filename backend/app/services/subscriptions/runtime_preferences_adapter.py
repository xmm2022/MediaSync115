from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
from app.services.subscriptions.source_attempts import (
    resolve_source_order,
)


RunResolveSourceOrder = Callable[..., list[str]]
BuildQualityFilter = Callable[[SubscriptionQualityPreferences], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class RuntimePreferencesDependencies:
    get_resource_priority: Callable[[], list[str]]
    get_tg_api_id: Callable[[], str]
    get_tg_api_hash: Callable[[], str]
    get_tg_session: Callable[[], str]
    get_tg_channel_usernames: Callable[[], list[str]]
    get_resource_preferred_resolutions: Callable[[], list[str]]
    get_resource_preferred_hdr: Callable[[], list[str]]
    get_resource_preferred_codec: Callable[[], list[str]]
    get_resource_exclude_tags: Callable[[], list[str]]
    get_resource_preferred_audio: Callable[[], list[str]]
    get_resource_preferred_subtitles: Callable[[], list[str]]
    get_resource_min_size_gb: Callable[[], float | None]
    get_resource_max_size_gb: Callable[[], float | None]
    run_resolve_source_order: RunResolveSourceOrder
    build_quality_filter: BuildQualityFilter


def build_default_runtime_preferences_dependencies() -> RuntimePreferencesDependencies:
    return RuntimePreferencesDependencies(
        get_resource_priority=(
            runtime_settings_service.get_subscription_resource_priority
        ),
        get_tg_api_id=runtime_settings_service.get_tg_api_id,
        get_tg_api_hash=runtime_settings_service.get_tg_api_hash,
        get_tg_session=runtime_settings_service.get_tg_session,
        get_tg_channel_usernames=runtime_settings_service.get_tg_channel_usernames,
        get_resource_preferred_resolutions=(
            runtime_settings_service.get_resource_preferred_resolutions
        ),
        get_resource_preferred_hdr=runtime_settings_service.get_resource_preferred_hdr,
        get_resource_preferred_codec=(
            runtime_settings_service.get_resource_preferred_codec
        ),
        get_resource_exclude_tags=runtime_settings_service.get_resource_exclude_tags,
        get_resource_preferred_audio=(
            runtime_settings_service.get_resource_preferred_audio
        ),
        get_resource_preferred_subtitles=(
            runtime_settings_service.get_resource_preferred_subtitles
        ),
        get_resource_min_size_gb=runtime_settings_service.get_resource_min_size_gb,
        get_resource_max_size_gb=runtime_settings_service.get_resource_max_size_gb,
        run_resolve_source_order=resolve_source_order,
        build_quality_filter=build_subscription_quality_filter,
    )


def resolve_source_order_with_runtime_adapter(
    channel: str,
    *,
    dependencies: RuntimePreferencesDependencies | None = None,
) -> list[str]:
    _ = channel
    current_dependencies = (
        dependencies or build_default_runtime_preferences_dependencies()
    )
    tg_ready = bool(
        str(current_dependencies.get_tg_api_id() or "").strip()
        and str(current_dependencies.get_tg_api_hash() or "").strip()
        and str(current_dependencies.get_tg_session() or "").strip()
        and current_dependencies.get_tg_channel_usernames()
    )
    return current_dependencies.run_resolve_source_order(
        current_dependencies.get_resource_priority(),
        tg_ready=tg_ready,
    )


def resolve_subscription_resolutions_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: RuntimePreferencesDependencies | None = None,
) -> list[str]:
    _ = sub
    current_dependencies = (
        dependencies or build_default_runtime_preferences_dependencies()
    )
    return current_dependencies.get_resource_preferred_resolutions()


def resolve_subscription_quality_filter_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: RuntimePreferencesDependencies | None = None,
) -> dict[str, Any]:
    _ = sub
    current_dependencies = (
        dependencies or build_default_runtime_preferences_dependencies()
    )
    return current_dependencies.build_quality_filter(
        SubscriptionQualityPreferences(
            preferred_resolutions=(
                current_dependencies.get_resource_preferred_resolutions()
            ),
            preferred_hdr=current_dependencies.get_resource_preferred_hdr(),
            preferred_codec=current_dependencies.get_resource_preferred_codec(),
            exclude_labels=current_dependencies.get_resource_exclude_tags(),
            preferred_audio=current_dependencies.get_resource_preferred_audio(),
            preferred_subtitles=(
                current_dependencies.get_resource_preferred_subtitles()
            ),
            min_size_gb=current_dependencies.get_resource_min_size_gb(),
            max_size_gb=current_dependencies.get_resource_max_size_gb(),
        )
    )
