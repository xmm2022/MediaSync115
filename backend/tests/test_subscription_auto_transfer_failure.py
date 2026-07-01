from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.subscriptions.auto_transfer_failure import handle_transfer_failure


ROOT = Path(__file__).resolve().parents[2]


def _subscription() -> SimpleNamespace:
    return SimpleNamespace(
        id=91,
        title="测试订阅",
    )


def _record() -> SimpleNamespace:
    return SimpleNamespace(
        id=101,
        resource_name="资源 E",
        status="transferring",
        error_message=None,
    )


async def _handle(error_text: str) -> tuple[
    Any,
    SimpleNamespace,
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    record = _record()
    step_logs: list[dict[str, Any]] = []
    operation_logs: list[dict[str, Any]] = []

    async def create_step_log(**kwargs: Any) -> None:
        step_logs.append(kwargs)

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    result = await handle_transfer_failure(
        sub=_subscription(),
        record=record,
        source="hdhive",
        exc=RuntimeError(error_text),
        failed_status="failed",
        create_step_log=create_step_log,
        log_operation=log_operation,
        trace_id="run-failure",
    )
    return result, record, step_logs, operation_logs


def test_handle_transfer_failure_marks_record_and_returns_error_entry() -> None:
    error_text = "保存失败"
    result, record, step_logs, operation_logs = asyncio.run(_handle(error_text))

    assert record.status == "failed"
    assert record.error_message == error_text
    assert result.failed_increment == 1
    assert result.error_entry == {
        "source": "hdhive",
        "subscription_id": 91,
        "title": "测试订阅",
        "resource": "资源 E",
        "error": error_text,
    }
    assert step_logs[0]["step"] == "auto_transfer_try_next_link"
    assert step_logs[0]["status"] == "info"
    assert step_logs[0]["message"] == f"链接转存失败，将尝试下一条资源：{error_text}"
    assert step_logs[0]["payload"] == {
        "source": "hdhive",
        "record_id": 101,
        "error": error_text,
    }
    assert step_logs[1]["step"] == "auto_transfer_item_failed"
    assert step_logs[1]["status"] == "failed"
    assert step_logs[1]["message"] == f"转存失败：资源 E（{error_text}）"
    assert step_logs[1]["payload"] == {
        "source": "hdhive",
        "record_id": 101,
        "error": error_text,
    }
    assert operation_logs[0]["action"] == "subscription.record.transfer_fail"
    assert operation_logs[0]["status"] == "failed"
    assert operation_logs[0]["trace_id"] == "run-failure"
    assert operation_logs[0]["extra"] == {
        "subscription_id": 91,
        "record_id": 101,
        "source": "hdhive",
        "error": error_text,
    }


def test_handle_transfer_failure_truncates_messages_and_payloads() -> None:
    error_text = "错误" * 600
    result, record, step_logs, operation_logs = asyncio.run(_handle(error_text))

    assert record.error_message == error_text[:1000]
    assert result.error_entry["error"] == error_text
    assert step_logs[0]["message"] == f"链接转存失败，将尝试下一条资源：{error_text[:120]}"
    assert step_logs[0]["payload"]["error"] == error_text[:300]
    assert step_logs[1]["message"] == f"转存失败：资源 E（{error_text[:100]}）"
    assert step_logs[1]["payload"]["error"] == error_text[:500]
    assert operation_logs[0]["message"] == (
        f"[测试订阅] [hdhive] 转存失败：资源 E（{error_text[:200]}）"
    )
    assert operation_logs[0]["extra"]["error"] == error_text[:300]


def test_auto_transfer_failure_module_does_not_import_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_failure.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "operation_log_service" not in source
    assert "media_postprocess_service" not in source
    assert "kafka_producer" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
