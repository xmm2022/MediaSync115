from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.record_selection import (
    exclude_new_records,
    merge_records,
)


@dataclass(frozen=True, slots=True)
class AutoTransferRetryRecordDependencies:
    load_retryable_records: Callable[[Any, int], Awaitable[list[Any]]]
    load_force_retry_records: Callable[[Any, int, list[str]], Awaitable[list[Any]]]


async def select_auto_transfer_retry_records(
    *,
    db: Any,
    subscription_id: int,
    auto_download: bool,
    force_auto_download: bool,
    duplicate_urls: Iterable[str],
    created_records: Iterable[Any],
    dependencies: AutoTransferRetryRecordDependencies,
) -> list[Any]:
    retry_records: list[Any] = []

    if auto_download:
        retry_records = await dependencies.load_retryable_records(db, subscription_id)

    duplicate_url_values = list(duplicate_urls or [])
    if force_auto_download and duplicate_url_values:
        duplicate_retry_records = await dependencies.load_force_retry_records(
            db,
            subscription_id,
            duplicate_url_values,
        )
        retry_records = merge_records(retry_records, duplicate_retry_records)

    return exclude_new_records(retry_records, created_records)
