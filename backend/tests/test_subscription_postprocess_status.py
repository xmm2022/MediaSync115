from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status,
)


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_apply_postprocess_status_marks_archiving_when_archive_is_triggered() -> None:
    archive_calls: list[str] = []

    async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
        archive_calls.append(trigger)
        return {"triggered": True, "job_id": "archive-1"}

    record = SimpleNamespace(
        status="MATCHED",
        completed_at=datetime(2026, 1, 1, 12, 0, 0),
        error_message="old error",
    )

    archive_result = await apply_precise_transfer_postprocess_status(
        record,
        dependencies=PostprocessStatusDependencies(
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            archiving_status="ARCHIVING",
            completed_status="COMPLETED",
            now=lambda: datetime(2026, 1, 2, 12, 0, 0),
        ),
    )

    assert archive_calls == ["subscription_transfer"]
    assert archive_result == {"triggered": True, "job_id": "archive-1"}
    assert record.status == "ARCHIVING"
    assert record.completed_at is None
    assert record.error_message is None


@pytest.mark.asyncio
async def test_apply_postprocess_status_marks_completed_when_archive_is_not_triggered() -> None:
    now = datetime(2026, 1, 3, 12, 0, 0)

    async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
        assert trigger == "subscription_transfer"
        return {"triggered": False}

    record = SimpleNamespace(
        status="TRANSFERRING",
        completed_at=None,
        error_message="old error",
    )

    archive_result = await apply_precise_transfer_postprocess_status(
        record,
        dependencies=PostprocessStatusDependencies(
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            archiving_status="ARCHIVING",
            completed_status="COMPLETED",
            now=lambda: now,
        ),
    )

    assert archive_result == {"triggered": False}
    assert record.status == "COMPLETED"
    assert record.completed_at == now
    assert record.error_message is None


def test_postprocess_status_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/postprocess_status.py"
    ).read_text(encoding="utf-8")

    forbidden_tokens = [
        "subscription_service",
        "media_postprocess_service",
        "runtime_settings_service",
        "AsyncSession",
        "app.models",
        "app.api",
    ]
    for token in forbidden_tokens:
        assert token not in source
