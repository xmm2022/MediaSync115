from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_storage import (
    ResourceStorageDependencies,
    store_new_resources,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(
    *,
    existing_urls: set[str] | None = None,
    offline_enabled: bool = False,
) -> tuple[ResourceStorageDependencies, list[Any], list[int]]:
    records: list[Any] = []
    load_calls: list[int] = []

    async def load_existing_resource_urls(subscription_id: int) -> set[str]:
        load_calls.append(subscription_id)
        return set(existing_urls or set())

    def add_record(
        subscription_id: int,
        resource_name: str,
        resource_url: str,
        resource_type: str,
        status: Any,
    ) -> Any:
        record = SimpleNamespace(
            subscription_id=subscription_id,
            resource_name=resource_name,
            resource_url=resource_url,
            resource_type=resource_type,
            status=status,
        )
        records.append(record)
        return record

    return (
        ResourceStorageDependencies(
            load_existing_resource_urls=load_existing_resource_urls,
            add_record=add_record,
            offline_transfer_enabled=lambda: offline_enabled,
            record_status_matched="MATCHED",
        ),
        records,
        load_calls,
    )


@pytest.mark.asyncio
async def test_store_new_resources_returns_default_stats_without_loading_empty_input() -> None:
    dependencies, records, load_calls = _dependencies()

    stats = await store_new_resources(
        100,
        [],
        dependencies=dependencies,
    )

    assert stats == {
        "created_records": [],
        "checked_count": 0,
        "duplicate_count": 0,
        "duplicate_urls": [],
        "invalid_count": 0,
    }
    assert records == []
    assert load_calls == []


@pytest.mark.asyncio
async def test_store_new_resources_creates_pan115_records_and_tracks_checked_count() -> None:
    dependencies, records, load_calls = _dependencies()

    stats = await store_new_resources(
        101,
        [
            {
                "title": "新资源",
                "share_link": "https://115.com/s/new",
            }
        ],
        dependencies=dependencies,
    )

    assert stats["checked_count"] == 1
    assert stats["duplicate_count"] == 0
    assert stats["duplicate_urls"] == []
    assert stats["invalid_count"] == 0
    assert stats["created_records"] == records
    assert load_calls == [101]
    assert len(records) == 1
    assert records[0].subscription_id == 101
    assert records[0].resource_name == "新资源"
    assert records[0].resource_url == "https://115.com/s/new"
    assert records[0].resource_type == "pan115"
    assert records[0].status == "MATCHED"


@pytest.mark.asyncio
async def test_store_new_resources_counts_existing_url_duplicates() -> None:
    dependencies, records, load_calls = _dependencies(
        existing_urls={"https://115.com/s/existing"}
    )

    stats = await store_new_resources(
        102,
        [
            {
                "name": "旧资源",
                "share_link": "https://115.com/s/existing",
            }
        ],
        dependencies=dependencies,
    )

    assert records == []
    assert load_calls == [102]
    assert stats["checked_count"] == 1
    assert stats["duplicate_count"] == 1
    assert set(stats["duplicate_urls"]) == {"https://115.com/s/existing"}
    assert stats["invalid_count"] == 0


@pytest.mark.asyncio
async def test_store_new_resources_counts_same_batch_duplicates() -> None:
    dependencies, records, _load_calls = _dependencies()

    stats = await store_new_resources(
        103,
        [
            {"resource_name": "第一条", "share_url": "https://115.com/s/repeat"},
            {"resource_name": "第二条", "share_url": "https://115.com/s/repeat"},
        ],
        dependencies=dependencies,
    )

    assert len(records) == 1
    assert records[0].resource_name == "第一条"
    assert stats["created_records"] == records
    assert stats["checked_count"] == 2
    assert stats["duplicate_count"] == 1
    assert set(stats["duplicate_urls"]) == {"https://115.com/s/repeat"}
    assert stats["invalid_count"] == 0


@pytest.mark.asyncio
async def test_store_new_resources_rejects_offline_url_when_offline_disabled() -> None:
    dependencies, records, _load_calls = _dependencies(offline_enabled=False)

    stats = await store_new_resources(
        104,
        [
            {
                "title": "磁力资源",
                "magnet": "magnet:?xt=urn:btih:ABCDEF",
            }
        ],
        dependencies=dependencies,
    )

    assert records == []
    assert stats["checked_count"] == 1
    assert stats["duplicate_count"] == 0
    assert stats["duplicate_urls"] == []
    assert stats["invalid_count"] == 1


@pytest.mark.asyncio
async def test_store_new_resources_accepts_magnet_when_offline_enabled() -> None:
    dependencies, records, _load_calls = _dependencies(offline_enabled=True)

    stats = await store_new_resources(
        105,
        [
            {
                "name": "离线资源",
                "magnet_url": "magnet:?xt=urn:btih:123456",
            }
        ],
        dependencies=dependencies,
    )

    assert stats["created_records"] == records
    assert stats["checked_count"] == 1
    assert stats["duplicate_count"] == 0
    assert stats["invalid_count"] == 0
    assert len(records) == 1
    assert records[0].resource_name == "离线资源"
    assert records[0].resource_url == "magnet:?xt=urn:btih:123456"
    assert records[0].resource_type == "magnet"
    assert records[0].status == "MATCHED"


def test_resource_storage_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_storage.py"
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
