import pytest

from app.models.models import DownloadRecord, MediaStatus
from app.services.subscriptions import (
    postprocess_status_runtime_adapter as postprocess_runtime_adapter_module,
)
from app.services.subscription_service import subscription_service


def _download_record() -> DownloadRecord:
    return DownloadRecord(
        subscription_id=1,
        resource_name="Show.S01E01.mkv",
        resource_url="https://115.com/s/precise-transfer",
        resource_type="pan115",
        status=MediaStatus.MATCHED,
    )


@pytest.mark.asyncio
async def test_precise_transfer_marks_completed_when_archive_not_triggered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_trigger_archive_after_transfer(trigger: str = "transfer"):
        assert trigger == "subscription_transfer"
        return {"triggered": False, "reason": "archive_disabled"}

    monkeypatch.setattr(
        postprocess_runtime_adapter_module.media_postprocess_service,
        "trigger_archive_after_transfer",
        fake_trigger_archive_after_transfer,
    )

    record = _download_record()
    result = await subscription_service._apply_precise_transfer_postprocess_status(record)

    assert result == {"triggered": False, "reason": "archive_disabled"}
    assert record.status == MediaStatus.COMPLETED
    assert record.completed_at is not None
    assert record.error_message is None


@pytest.mark.asyncio
async def test_precise_transfer_keeps_archiving_when_archive_triggered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_trigger_archive_after_transfer(trigger: str = "transfer"):
        assert trigger == "subscription_transfer"
        return {"triggered": True, "result": {"task_id": "archive-1"}}

    monkeypatch.setattr(
        postprocess_runtime_adapter_module.media_postprocess_service,
        "trigger_archive_after_transfer",
        fake_trigger_archive_after_transfer,
    )

    record = _download_record()
    result = await subscription_service._apply_precise_transfer_postprocess_status(record)

    assert result == {"triggered": True, "result": {"task_id": "archive-1"}}
    assert record.status == MediaStatus.ARCHIVING
    assert record.completed_at is None
    assert record.error_message is None
