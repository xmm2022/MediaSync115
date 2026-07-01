from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import delete, select

from app.core.database import async_session_maker, ensure_tables_exist
from app.core.timezone_utils import beijing_now
from app.models.models import (
    ExecutionStatus,
    SubscriptionExecutionLog,
    SubscriptionStepLog,
)
from app.services.subscriptions.execution_logs import (
    create_execution_log,
    create_step_log,
    prune_step_logs,
)


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
async def clean_subscription_logs() -> None:
    await _reset_logs()
    yield
    await _reset_logs()


async def _reset_logs() -> None:
    await ensure_tables_exist("subscription_step_logs", "subscription_execution_logs")
    async with async_session_maker() as db:
        await db.execute(delete(SubscriptionStepLog))
        await db.execute(delete(SubscriptionExecutionLog))
        await db.commit()


@pytest.mark.asyncio
async def test_create_step_log_truncates_message_and_serializes_payload() -> None:
    long_message = "长" * 520

    async with async_session_maker() as db:
        await create_step_log(
            db,
            run_id="exec-log-step",
            channel="all",
            subscription_id=12,
            subscription_title="测试订阅",
            step="sample_step",
            status="info",
            message=long_message,
            payload={"title": "中文", "count": 2},
        )
        await db.commit()

    async with async_session_maker() as db:
        row = (
            await db.execute(
                select(SubscriptionStepLog).where(
                    SubscriptionStepLog.run_id == "exec-log-step"
                )
            )
        ).scalar_one()

    assert len(row.message) == 500
    assert row.message == "长" * 500
    assert json.loads(row.payload or "{}") == {"title": "中文", "count": 2}
    assert "\\u4e2d\\u6587" not in (row.payload or "")


@pytest.mark.asyncio
async def test_create_step_log_keeps_empty_payload_as_none() -> None:
    async with async_session_maker() as db:
        await create_step_log(
            db,
            run_id="exec-log-empty-payload",
            channel="all",
            step="empty_payload",
            status="info",
            message="empty",
            payload={},
        )
        await db.commit()

    async with async_session_maker() as db:
        row = (
            await db.execute(
                select(SubscriptionStepLog).where(
                    SubscriptionStepLog.run_id == "exec-log-empty-payload"
                )
            )
        ).scalar_one()

    assert row.payload is None


@pytest.mark.asyncio
async def test_prune_step_logs_keeps_latest_rows_by_created_at_then_id() -> None:
    async with async_session_maker() as db:
        for idx in range(3):
            await create_step_log(
                db,
                run_id=f"exec-log-prune-{idx}",
                channel="all",
                step="prune",
                status="info",
                message=str(idx),
            )
            await db.flush()

        await prune_step_logs(db, keep_limit=2)
        await db.commit()

    async with async_session_maker() as db:
        rows = (
            await db.execute(
                select(SubscriptionStepLog.run_id).order_by(
                    SubscriptionStepLog.id.asc()
                )
            )
        ).scalars().all()

    assert rows == ["exec-log-prune-1", "exec-log-prune-2"]


@pytest.mark.asyncio
async def test_prune_step_logs_with_zero_limit_removes_all_rows() -> None:
    async with async_session_maker() as db:
        await create_step_log(
            db,
            run_id="exec-log-prune-zero",
            channel="all",
            step="prune",
            status="info",
            message="0",
        )
        await prune_step_logs(db, keep_limit=0)
        await db.commit()

    async with async_session_maker() as db:
        remaining = (
            await db.execute(select(SubscriptionStepLog.id))
        ).scalars().all()

    assert remaining == []


@pytest.mark.asyncio
async def test_create_execution_log_serializes_details_and_prunes_old_rows() -> None:
    started = beijing_now()

    async with async_session_maker() as db:
        for idx in range(3):
            await create_execution_log(
                db,
                channel="all",
                status=ExecutionStatus.SUCCESS,
                message=f"run {idx}",
                checked_count=idx + 1,
                new_resource_count=idx,
                failed_count=0,
                details=[{"title": f"订阅 {idx}"}],
                started_at=started + timedelta(seconds=idx),
                finished_at=started + timedelta(seconds=idx, minutes=1),
                keep_limit=2,
            )
        await db.commit()

    async with async_session_maker() as db:
        rows = (
            await db.execute(
                select(SubscriptionExecutionLog).order_by(
                    SubscriptionExecutionLog.started_at.asc(),
                    SubscriptionExecutionLog.id.asc(),
                )
            )
        ).scalars().all()

    assert [row.message for row in rows] == ["run 1", "run 2"]
    assert json.loads(rows[-1].details or "[]") == [{"title": "订阅 2"}]
    assert "\\u8ba2\\u9605" not in (rows[-1].details or "")


@pytest.mark.asyncio
async def test_create_execution_log_with_zero_limit_removes_all_rows() -> None:
    started = beijing_now()

    async with async_session_maker() as db:
        await create_execution_log(
            db,
            channel="all",
            status=ExecutionStatus.SUCCESS,
            message="run zero",
            checked_count=1,
            new_resource_count=0,
            failed_count=0,
            details=[],
            started_at=started,
            finished_at=started + timedelta(minutes=1),
            keep_limit=0,
        )
        await db.commit()

    async with async_session_maker() as db:
        remaining = (
            await db.execute(select(SubscriptionExecutionLog.id))
        ).scalars().all()

    assert remaining == []


def test_execution_logs_module_stays_within_db_logging_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/execution_logs.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "operation_log_service" not in source
    assert "app.api" not in source
