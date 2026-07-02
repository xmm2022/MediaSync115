from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.models.models import DownloadRecord, MediaStatus
from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url as dedupe_records_by_resource_url_core,
    select_retryable_records as select_retryable_records_core,
)


@dataclass(frozen=True, slots=True)
class AutoTransferRecordLoaderDbDependencies:
    select_retryable_records: Callable[[Iterable[Any], Iterable[Any]], list[Any]]
    dedupe_records_by_resource_url: Callable[[Iterable[Any]], list[Any]]


def build_default_auto_transfer_record_loader_db_dependencies() -> (
    AutoTransferRecordLoaderDbDependencies
):
    return AutoTransferRecordLoaderDbDependencies(
        select_retryable_records=select_retryable_records_core,
        dedupe_records_by_resource_url=dedupe_records_by_resource_url_core,
    )


async def load_retryable_records_with_db_adapter(
    db: Any,
    subscription_id: int,
    *,
    dependencies: AutoTransferRecordLoaderDbDependencies | None = None,
) -> list[Any]:
    current_dependencies = (
        dependencies or build_default_auto_transfer_record_loader_db_dependencies()
    )
    with db.no_autoflush:
        failed_result = await db.execute(
            select(DownloadRecord)
            .where(
                DownloadRecord.subscription_id == subscription_id,
                DownloadRecord.status == MediaStatus.FAILED,
            )
            .order_by(DownloadRecord.created_at.desc())
            .limit(8)
        )
        pending_result = await db.execute(
            select(DownloadRecord)
            .where(
                DownloadRecord.subscription_id == subscription_id,
                DownloadRecord.status.in_(
                    (MediaStatus.PENDING, MediaStatus.MATCHED)
                ),
            )
            .order_by(DownloadRecord.created_at.desc())
            .limit(5)
        )

    failed_rows = list(failed_result.scalars().all())
    pending_rows = list(pending_result.scalars().all())

    return current_dependencies.select_retryable_records(
        failed_rows,
        pending_rows,
    )


async def load_force_retry_records_with_db_adapter(
    db: Any,
    subscription_id: int,
    duplicate_urls: list[str],
    *,
    dependencies: AutoTransferRecordLoaderDbDependencies | None = None,
) -> list[Any]:
    current_dependencies = (
        dependencies or build_default_auto_transfer_record_loader_db_dependencies()
    )
    url_values = [
        str(item or "").strip()
        for item in duplicate_urls
        if str(item or "").strip()
    ]
    if not url_values:
        return []

    with db.no_autoflush:
        rows_result = await db.execute(
            select(DownloadRecord)
            .where(
                DownloadRecord.subscription_id == subscription_id,
                DownloadRecord.resource_url.in_(url_values),
                DownloadRecord.status.in_(
                    (MediaStatus.FAILED, MediaStatus.PENDING, MediaStatus.MATCHED)
                ),
            )
            .order_by(DownloadRecord.created_at.desc())
        )

    return current_dependencies.dedupe_records_by_resource_url(
        rows_result.scalars().all()
    )


async def load_subscription_resource_urls_with_db_adapter(
    db: Any,
    subscription_id: int,
) -> set[str]:
    with db.no_autoflush:
        result = await db.execute(
            select(DownloadRecord.resource_url).where(
                DownloadRecord.subscription_id == subscription_id
            )
        )
    return {str(row[0]).strip() for row in result.all() if row and row[0]}
