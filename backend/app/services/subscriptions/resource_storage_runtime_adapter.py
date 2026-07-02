from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.models.models import MediaStatus
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.resource_storage import (
    store_new_resources as store_new_resources_flow,
)
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)


RunStoreNewResources = Callable[..., Awaitable[dict[str, Any]]]
RunStoreNewResourcesWithDbAdapter = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class ResourceStorageRuntimeDependencies:
    offline_transfer_enabled: Callable[[], bool]
    record_status_matched: Any
    run_store_new_resources: RunStoreNewResources
    run_store_new_resources_with_db_adapter: RunStoreNewResourcesWithDbAdapter


def build_default_resource_storage_runtime_dependencies() -> (
    ResourceStorageRuntimeDependencies
):
    return ResourceStorageRuntimeDependencies(
        offline_transfer_enabled=(
            runtime_settings_service.get_subscription_offline_transfer_enabled
        ),
        record_status_matched=MediaStatus.MATCHED,
        run_store_new_resources=store_new_resources_flow,
        run_store_new_resources_with_db_adapter=store_new_resources_with_db_adapter,
    )


async def store_new_resources_with_runtime_adapter(
    db: Any,
    subscription_id: int,
    resources: list[dict[str, Any]],
    *,
    dependencies: ResourceStorageRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_resource_storage_runtime_dependencies()
    )
    return await current_dependencies.run_store_new_resources_with_db_adapter(
        db,
        subscription_id,
        resources,
        dependencies=ResourceStorageDbAdapterDependencies(
            offline_transfer_enabled=(
                current_dependencies.offline_transfer_enabled
            ),
            record_status_matched=current_dependencies.record_status_matched,
            run_store_new_resources=current_dependencies.run_store_new_resources,
        ),
    )
