# Subscription Execution Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription step/execution log persistence helpers from `subscription_service.py` into a focused DB helper module while preserving existing private service wrapper signatures.

**Architecture:** Add `app.services.subscriptions.execution_logs` for database-backed log creation and retention. Keep `SubscriptionService._create_step_log()`, `_prune_step_logs()`, and `_create_execution_log()` as compatibility wrappers that delegate to the extracted functions.

**Tech Stack:** Python 3.12/3.13 test env, pytest, SQLAlchemy async sessions, existing MediaSync115 models and verification scripts.

---

### Task 1: Extract Subscription Execution Log Helpers

**Files:**
- Create: `backend/app/services/subscriptions/execution_logs.py`
- Create: `backend/tests/test_subscription_execution_logs.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_subscription_execution_logs.py`:

```python
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


async def _reset_logs() -> None:
    await ensure_tables_exist("subscription_step_logs", "subscription_execution_logs")
    async with async_session_maker() as db:
        await db.execute(delete(SubscriptionStepLog))
        await db.execute(delete(SubscriptionExecutionLog))
        await db.commit()


@pytest.mark.asyncio
async def test_create_step_log_truncates_message_and_serializes_payload() -> None:
    await _reset_logs()
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
    await _reset_logs()

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
    await _reset_logs()

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
async def test_create_execution_log_serializes_details_and_prunes_old_rows() -> None:
    await _reset_logs()
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
```

- [ ] **Step 2: Run the red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_execution_logs.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.execution_logs'`.

- [ ] **Step 3: Create the extracted module**

Create `backend/app/services/subscriptions/execution_logs.py`:

```python
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    ExecutionStatus,
    SubscriptionExecutionLog,
    SubscriptionStepLog,
)


async def create_step_log(
    db: AsyncSession,
    *,
    run_id: str,
    channel: str,
    step: str,
    status: str,
    message: str,
    subscription_id: int | None = None,
    subscription_title: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    row = SubscriptionStepLog(
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        step=step,
        status=status,
        message=message[:500],
        payload=json.dumps(payload, ensure_ascii=False) if payload else None,
    )
    db.add(row)


async def prune_step_logs(
    db: AsyncSession,
    *,
    keep_limit: int = 1000,
) -> None:
    keep_ids_subquery = (
        select(SubscriptionStepLog.id)
        .order_by(SubscriptionStepLog.created_at.desc(), SubscriptionStepLog.id.desc())
        .limit(keep_limit)
        .subquery()
    )
    await db.execute(
        delete(SubscriptionStepLog).where(
            ~SubscriptionStepLog.id.in_(select(keep_ids_subquery.c.id))
        )
    )


async def create_execution_log(
    db: AsyncSession,
    *,
    channel: str,
    status: ExecutionStatus,
    message: str,
    checked_count: int,
    new_resource_count: int,
    failed_count: int,
    details: list[dict[str, Any]],
    started_at: datetime,
    finished_at: datetime,
    keep_limit: int = 5,
) -> None:
    log = SubscriptionExecutionLog(
        channel=channel,
        status=status,
        message=message,
        checked_count=checked_count,
        new_resource_count=new_resource_count,
        failed_count=failed_count,
        details=json.dumps(details, ensure_ascii=False) if details else None,
        started_at=started_at,
        finished_at=finished_at,
    )
    db.add(log)
    await db.flush()

    keep_ids_result = await db.execute(
        select(SubscriptionExecutionLog.id)
        .order_by(
            SubscriptionExecutionLog.started_at.desc(),
            SubscriptionExecutionLog.id.desc(),
        )
        .limit(keep_limit)
    )
    keep_ids = [row[0] for row in keep_ids_result.all() if row and row[0]]
    if keep_ids:
        await db.execute(
            delete(SubscriptionExecutionLog).where(
                SubscriptionExecutionLog.id.notin_(keep_ids)
            )
        )
```

- [ ] **Step 4: Wire `SubscriptionService` wrappers to the extracted module**

Modify imports in `backend/app/services/subscription_service.py`:

```python
from app.services.subscriptions.execution_logs import (
    create_execution_log as create_subscription_execution_log,
    create_step_log as create_subscription_step_log,
    prune_step_logs as prune_subscription_step_logs,
)
```

Replace `_create_step_log()` body with:

```python
        await create_subscription_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            step=step,
            status=status,
            message=message,
            payload=payload,
        )
```

Replace `_prune_step_logs()` body with:

```python
        await prune_subscription_step_logs(db)
```

Replace `_create_execution_log()` body with:

```python
        await create_subscription_execution_log(
            db,
            channel=channel,
            status=status,
            message=message,
            checked_count=checked_count,
            new_resource_count=new_resource_count,
            failed_count=failed_count,
            details=details,
            started_at=started_at,
            finished_at=finished_at,
        )
```

- [ ] **Step 5: Run focused green tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_execution_logs.py
```

Expected: all tests in `test_subscription_execution_logs.py` pass.

- [ ] **Step 6: Run logging and subscription regressions**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_execution_logs.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py tests/test_health.py
```

Expected: selected tests pass.

- [ ] **Step 7: Commit the refactor**

Run:

```bash
git diff --check
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/execution_logs.py backend/tests/test_subscription_execution_logs.py
git diff --cached --check
git commit -m "refactor: 抽离订阅执行日志助手"
```

Expected: commit succeeds and unrelated untracked files remain untracked.

- [ ] **Step 8: Run final verification and local deployment checks**

Run:

```bash
scripts/verify-backend.sh --quick
scripts/verify-backend.sh
scripts/verify-frontend.sh --build
scripts/verify.sh --quick
docker compose up -d --build
curl --retry 30 --retry-all-errors --retry-delay 2 -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
git status --short
wc -l backend/app/services/subscription_service.py backend/app/services/subscriptions/execution_logs.py backend/tests/test_subscription_execution_logs.py
```

Expected:

- Backend quick and full suites pass.
- Frontend build verification passes.
- Compose quick verification passes.
- `/healthz` returns `{"status":"healthy"}`.
- Docker health is `healthy`.
- `subscription_service.py` line count decreases.
