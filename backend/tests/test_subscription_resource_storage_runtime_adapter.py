from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.resource_storage import (
    store_new_resources as store_new_resources_flow,
)
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    ResourceStorageRuntimeDependencies,
    build_default_resource_storage_runtime_dependencies,
    store_new_resources_with_runtime_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> ResourceStorageRuntimeDependencies:
    async def run_store_new_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"stored": True}

    async def run_store_new_resources_with_db_adapter(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"db": True}

    values: dict[str, Any] = {
        "offline_transfer_enabled": lambda: False,
        "record_status_matched": "MATCHED",
        "run_store_new_resources": run_store_new_resources,
        "run_store_new_resources_with_db_adapter": (
            run_store_new_resources_with_db_adapter
        ),
    }
    values.update(overrides)
    return ResourceStorageRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_db_adapter_dependencies_and_forwards_arguments() -> None:
    db = object()
    resources = [{"name": "资源", "share_url": "https://115.com/s/new"}]
    core_runner_marker = object()
    captured: dict[str, Any] = {}

    async def run_store_new_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"core": core_runner_marker}

    async def run_store_new_resources_with_db_adapter(
        current_db: Any,
        subscription_id: int,
        current_resources: list[dict[str, Any]],
        *,
        dependencies: ResourceStorageDbAdapterDependencies,
    ) -> dict[str, Any]:
        captured["db"] = current_db
        captured["subscription_id"] = subscription_id
        captured["resources"] = current_resources
        captured["dependencies"] = dependencies
        return {
            "offline_enabled": dependencies.offline_transfer_enabled(),
            "matched_status": dependencies.record_status_matched,
            "core_runner": dependencies.run_store_new_resources,
        }

    result = await store_new_resources_with_runtime_adapter(
        db,
        42,
        resources,
        dependencies=_dependencies(
            offline_transfer_enabled=lambda: True,
            record_status_matched="CUSTOM_MATCHED",
            run_store_new_resources=run_store_new_resources,
            run_store_new_resources_with_db_adapter=(
                run_store_new_resources_with_db_adapter
            ),
        ),
    )

    assert result == {
        "offline_enabled": True,
        "matched_status": "CUSTOM_MATCHED",
        "core_runner": run_store_new_resources,
    }
    assert captured["db"] is db
    assert captured["subscription_id"] == 42
    assert captured["resources"] is resources
    assert isinstance(
        captured["dependencies"],
        ResourceStorageDbAdapterDependencies,
    )


def test_default_runtime_dependencies_bind_existing_helpers_and_status() -> None:
    dependencies = build_default_resource_storage_runtime_dependencies()

    assert dependencies.offline_transfer_enabled.__self__ is runtime_settings_service
    assert (
        dependencies.offline_transfer_enabled.__func__
        is type(runtime_settings_service).get_subscription_offline_transfer_enabled
    )
    assert dependencies.record_status_matched == MediaStatus.MATCHED
    assert dependencies.run_store_new_resources is store_new_resources_flow
    assert (
        dependencies.run_store_new_resources_with_db_adapter
        is store_new_resources_with_db_adapter
    )


def test_resource_storage_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_storage_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "DownloadRecord" not in source
