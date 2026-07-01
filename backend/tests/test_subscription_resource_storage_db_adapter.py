from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.resource_storage import ResourceStorageDependencies
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeNoAutoflush:
    def __init__(self, db: FakeDb) -> None:
        self._db = db

    def __enter__(self) -> None:
        self._db.no_autoflush_entered += 1

    def __exit__(self, *_args: Any) -> None:
        self._db.no_autoflush_exited += 1


class FakeResult:
    def __init__(self, rows: list[tuple[Any]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[Any]]:
        return self._rows


class FakeDb:
    def __init__(self) -> None:
        self.no_autoflush = FakeNoAutoflush(self)
        self.no_autoflush_entered = 0
        self.no_autoflush_exited = 0
        self.executed: list[Any] = []
        self.added: list[Any] = []

    async def execute(self, statement: Any) -> FakeResult:
        self.executed.append(statement)
        return FakeResult(
            [
                ("https://115.com/s/existing",),
                ("",),
                (None,),
                ("  https://115.com/s/spaced  ",),
            ]
        )

    def add(self, record: Any) -> None:
        self.added.append(record)


@pytest.mark.asyncio
async def test_resource_storage_db_adapter_builds_core_dependencies() -> None:
    db = FakeDb()
    captured: dict[str, Any] = {}

    async def run_store_new_resources(
        subscription_id: int,
        resources: list[dict[str, Any]],
        *,
        dependencies: ResourceStorageDependencies,
    ) -> dict[str, Any]:
        urls = await dependencies.load_existing_resource_urls(subscription_id)
        record = dependencies.add_record(
            subscription_id,
            "资源名",
            "https://115.com/s/new",
            "pan115",
            dependencies.record_status_matched,
        )
        captured["dependencies"] = dependencies
        return {
            "subscription_id": subscription_id,
            "resources": resources,
            "urls": urls,
            "offline_enabled": dependencies.offline_transfer_enabled(),
            "record": record,
        }

    result = await store_new_resources_with_db_adapter(
        db,
        101,
        [{"name": "资源名", "share_url": "https://115.com/s/new"}],
        dependencies=ResourceStorageDbAdapterDependencies(
            offline_transfer_enabled=lambda: True,
            record_status_matched="MATCHED",
            run_store_new_resources=run_store_new_resources,
        ),
    )

    assert result["subscription_id"] == 101
    assert result["resources"] == [
        {"name": "资源名", "share_url": "https://115.com/s/new"}
    ]
    assert result["urls"] == {
        "https://115.com/s/existing",
        "  https://115.com/s/spaced  ",
    }
    assert result["offline_enabled"] is True
    assert db.no_autoflush_entered == 1
    assert db.no_autoflush_exited == 1
    assert len(db.executed) == 1
    assert db.added == [result["record"]]

    record = result["record"]
    assert record.subscription_id == 101
    assert record.resource_name == "资源名"
    assert record.resource_url == "https://115.com/s/new"
    assert record.resource_type == "pan115"
    assert record.status == "MATCHED"
    assert captured["dependencies"].record_status_matched == "MATCHED"


def test_resource_storage_db_adapter_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_storage_db_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "app.api" not in source
