from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.media_postprocess_service import media_postprocess_service
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    PostprocessStatusRuntimeDependencies,
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
    build_default_postprocess_status_runtime_dependencies,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> PostprocessStatusRuntimeDependencies:
    async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
        return {"triggered": False, "trigger": trigger}

    async def run_apply_precise_transfer_postprocess_status(
        record: Any,
        *,
        dependencies: PostprocessStatusDependencies,
    ) -> dict[str, Any]:
        _ = (record, dependencies)
        return {"triggered": False}

    values: dict[str, Any] = {
        "trigger_archive_after_transfer": trigger_archive_after_transfer,
        "archiving_status": "ARCHIVING",
        "completed_status": "COMPLETED",
        "now": lambda: datetime(2026, 1, 1, 12, 0, 0),
        "run_apply_precise_transfer_postprocess_status": (
            run_apply_precise_transfer_postprocess_status
        ),
    }
    values.update(overrides)
    return PostprocessStatusRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_record() -> None:
    now = datetime(2026, 1, 2, 12, 0, 0)
    record = SimpleNamespace(id=7)
    runner_calls: list[dict[str, Any]] = []
    trigger_calls: list[str] = []

    async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
        trigger_calls.append(trigger)
        return {"triggered": True, "trigger": trigger}

    async def run_apply_precise_transfer_postprocess_status(
        target: Any,
        *,
        dependencies: PostprocessStatusDependencies,
    ) -> dict[str, Any]:
        runner_calls.append(
            {
                "record": target,
                "dependencies": dependencies,
            }
        )
        archive_result = await dependencies.trigger_archive_after_transfer(
            trigger="subscription_transfer"
        )
        assert dependencies.archiving_status == "ARCHIVING"
        assert dependencies.completed_status == "COMPLETED"
        assert dependencies.now() == now
        return archive_result

    result = await apply_precise_transfer_postprocess_status_with_runtime_adapter(
        record,
        dependencies=_dependencies(
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            now=lambda: now,
            run_apply_precise_transfer_postprocess_status=(
                run_apply_precise_transfer_postprocess_status
            ),
        ),
    )

    assert result == {"triggered": True, "trigger": "subscription_transfer"}
    assert trigger_calls == ["subscription_transfer"]
    assert len(runner_calls) == 1
    assert runner_calls[0]["record"] is record
    assert isinstance(
        runner_calls[0]["dependencies"],
        PostprocessStatusDependencies,
    )


def test_default_runtime_dependencies_bind_existing_helpers_and_statuses() -> None:
    dependencies = build_default_postprocess_status_runtime_dependencies()

    assert (
        dependencies.trigger_archive_after_transfer.__self__
        is media_postprocess_service
    )
    assert (
        dependencies.trigger_archive_after_transfer.__func__
        is type(media_postprocess_service).trigger_archive_after_transfer
    )
    assert dependencies.archiving_status == MediaStatus.ARCHIVING
    assert dependencies.completed_status == MediaStatus.COMPLETED
    assert callable(dependencies.now)
    assert (
        dependencies.run_apply_precise_transfer_postprocess_status
        is apply_precise_transfer_postprocess_status
    )


def test_postprocess_status_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/postprocess_status_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
