from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.hdhive_service import hdhive_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.hdhive_unlock import (
    build_hdhive_unlock_context,
    prepare_hdhive_locked_resources,
)
from app.services.subscriptions.resource_candidates import (
    extract_resource_url,
    normalize_share_url,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)


BuildContext = Callable[..., dict[str, Any]]
PrepareLockedResources = Callable[..., Awaitable[list[dict[str, Any]]]]


@dataclass(frozen=True, slots=True)
class HDHiveUnlockRuntimeDependencies:
    get_auto_unlock_enabled: Callable[[], bool]
    get_max_points_per_item: Callable[[], int]
    get_budget_points_per_run: Callable[[], int]
    get_threshold_inclusive: Callable[[], bool]
    normalize_items: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    extract_resource_url: Callable[[dict[str, Any]], str]
    normalize_share_url: Callable[[str], str]
    unlock_resource: Callable[[str], Awaitable[dict[str, Any]]]
    build_context: BuildContext
    prepare_locked_resources: PrepareLockedResources


def build_default_hdhive_unlock_runtime_dependencies() -> HDHiveUnlockRuntimeDependencies:
    return HDHiveUnlockRuntimeDependencies(
        get_auto_unlock_enabled=(
            runtime_settings_service.get_subscription_hdhive_auto_unlock_enabled
        ),
        get_max_points_per_item=(
            runtime_settings_service.get_subscription_hdhive_unlock_max_points_per_item
        ),
        get_budget_points_per_run=(
            runtime_settings_service.get_subscription_hdhive_unlock_budget_points_per_run
        ),
        get_threshold_inclusive=(
            runtime_settings_service.get_subscription_hdhive_unlock_threshold_inclusive
        ),
        normalize_items=normalize_hdhive_subscription_items,
        extract_resource_url=extract_resource_url,
        normalize_share_url=normalize_share_url,
        unlock_resource=hdhive_service.unlock_resource,
        build_context=build_hdhive_unlock_context,
        prepare_locked_resources=prepare_hdhive_locked_resources,
    )


def build_hdhive_unlock_context_with_runtime_adapter(
    *,
    dependencies: HDHiveUnlockRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_hdhive_unlock_runtime_dependencies()
    )
    budget_total = current_dependencies.get_budget_points_per_run()
    return current_dependencies.build_context(
        enabled=current_dependencies.get_auto_unlock_enabled(),
        max_points_per_item=current_dependencies.get_max_points_per_item(),
        budget_total=budget_total,
        threshold_inclusive=current_dependencies.get_threshold_inclusive(),
    )


async def prepare_hdhive_locked_resources_with_runtime_adapter(
    resources: list[dict[str, Any]],
    context: dict[str, Any],
    traces: list[dict[str, Any]],
    *,
    dependencies: HDHiveUnlockRuntimeDependencies | None = None,
) -> list[dict[str, Any]]:
    current_dependencies = (
        dependencies or build_default_hdhive_unlock_runtime_dependencies()
    )
    return await current_dependencies.prepare_locked_resources(
        resources,
        context,
        traces,
        normalize_items=current_dependencies.normalize_items,
        extract_resource_url=current_dependencies.extract_resource_url,
        normalize_share_url=current_dependencies.normalize_share_url,
        unlock_resource=current_dependencies.unlock_resource,
    )
