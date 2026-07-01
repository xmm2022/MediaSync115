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
    delete_stmt = delete(SubscriptionExecutionLog)
    if keep_ids:
        delete_stmt = delete_stmt.where(
            SubscriptionExecutionLog.id.notin_(keep_ids)
        )
    await db.execute(delete_stmt)
