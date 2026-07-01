from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_candidates import (
    extract_offline_url,
    extract_resource_url,
)
from app.services.subscriptions.resource_metadata import (
    determine_resource_type,
    extract_resource_name,
)


LoadExistingResourceUrls = Callable[[int], Awaitable[set[str]]]
AddRecord = Callable[[int, str, str, str, Any], Any]
OfflineTransferEnabled = Callable[[], bool]


@dataclass(frozen=True)
class ResourceStorageDependencies:
    load_existing_resource_urls: LoadExistingResourceUrls
    add_record: AddRecord
    offline_transfer_enabled: OfflineTransferEnabled
    record_status_matched: Any


async def store_new_resources(
    subscription_id: int,
    resources: list[dict[str, Any]],
    *,
    dependencies: ResourceStorageDependencies,
) -> dict[str, Any]:
    if not resources:
        return {
            "created_records": [],
            "checked_count": 0,
            "duplicate_count": 0,
            "duplicate_urls": [],
            "invalid_count": 0,
        }

    existing_urls = set(await dependencies.load_existing_resource_urls(subscription_id))
    offline_enabled = dependencies.offline_transfer_enabled()
    created_records: list[Any] = []
    duplicate_urls: set[str] = set()
    duplicate_count = 0
    invalid_count = 0

    for item in resources:
        resource_url = extract_resource_url(item)
        resource_type = "pan115"
        if not resource_url and offline_enabled:
            resource_url = extract_offline_url(item)
            if resource_url:
                resource_type = determine_resource_type(resource_url)
        if not resource_url:
            invalid_count += 1
            continue
        if resource_url in existing_urls:
            duplicate_count += 1
            duplicate_urls.add(resource_url)
            continue

        record = dependencies.add_record(
            subscription_id,
            extract_resource_name(item),
            resource_url,
            resource_type,
            dependencies.record_status_matched,
        )
        existing_urls.add(resource_url)
        created_records.append(record)

    return {
        "created_records": created_records,
        "checked_count": len(resources),
        "duplicate_count": duplicate_count,
        "duplicate_urls": list(duplicate_urls),
        "invalid_count": invalid_count,
    }
