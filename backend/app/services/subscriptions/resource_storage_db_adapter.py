from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.models.models import DownloadRecord
from app.services.subscriptions.resource_storage import (
    ResourceStorageDependencies,
)


RunStoreNewResources = Callable[
    ..., Awaitable[dict[str, Any]]
]


@dataclass(frozen=True, slots=True)
class ResourceStorageDbAdapterDependencies:
    offline_transfer_enabled: Callable[[], bool]
    record_status_matched: Any
    run_store_new_resources: RunStoreNewResources


async def load_existing_resource_urls(db: Any, subscription_id: int) -> set[str]:
    with db.no_autoflush:
        existing_result = await db.execute(
            select(DownloadRecord.resource_url).where(
                DownloadRecord.subscription_id == subscription_id
            )
        )
    return {str(row[0]) for row in existing_result.all() if row and row[0]}


def add_download_record(
    db: Any,
    subscription_id: int,
    resource_name: str,
    resource_url: str,
    resource_type: str,
    status: Any,
) -> DownloadRecord:
    record = DownloadRecord(
        subscription_id=subscription_id,
        resource_name=resource_name,
        resource_url=resource_url,
        resource_type=resource_type,
        status=status,
    )
    db.add(record)
    return record


async def store_new_resources_with_db_adapter(
    db: Any,
    subscription_id: int,
    resources: list[dict[str, Any]],
    *,
    dependencies: ResourceStorageDbAdapterDependencies,
) -> dict[str, Any]:
    async def load_urls(current_subscription_id: int) -> set[str]:
        return await load_existing_resource_urls(db, current_subscription_id)

    def add_record(
        current_subscription_id: int,
        resource_name: str,
        resource_url: str,
        resource_type: str,
        status: Any,
    ) -> DownloadRecord:
        return add_download_record(
            db,
            current_subscription_id,
            resource_name,
            resource_url,
            resource_type,
            status,
        )

    return await dependencies.run_store_new_resources(
        subscription_id,
        resources,
        dependencies=ResourceStorageDependencies(
            load_existing_resource_urls=load_urls,
            add_record=add_record,
            offline_transfer_enabled=dependencies.offline_transfer_enabled,
            record_status_matched=dependencies.record_status_matched,
        ),
    )
