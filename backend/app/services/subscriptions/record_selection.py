from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.services.subscriptions.resource_metadata import (
    is_likely_115_share_identifier,
    is_retryable_transfer_error,
)


def _record_attr(record: Any, name: str) -> Any:
    return getattr(record, name, None)


def _record_url(record: Any) -> str:
    return str(_record_attr(record, "resource_url") or "").strip()


def is_offline_resource_type(resource_type: Any) -> bool:
    return str(resource_type or "") in ("magnet", "ed2k")


def is_retryable_failed_record(record: Any) -> bool:
    is_offline = is_offline_resource_type(_record_attr(record, "resource_type"))
    if not is_offline and not is_likely_115_share_identifier(_record_url(record)):
        return False
    return is_retryable_transfer_error(_record_attr(record, "error_message") or "")


def is_retryable_pending_record(record: Any) -> bool:
    is_offline = is_offline_resource_type(_record_attr(record, "resource_type"))
    if is_offline:
        return True
    return is_likely_115_share_identifier(_record_url(record))


def select_retryable_records(
    failed_rows: Iterable[Any], pending_rows: Iterable[Any]
) -> list[Any]:
    retryable: list[Any] = []
    for row in failed_rows:
        if is_retryable_failed_record(row):
            retryable.append(row)
    for row in pending_rows:
        if is_retryable_pending_record(row):
            retryable.append(row)
    return retryable


def merge_records(primary: Iterable[Any], secondary: Iterable[Any]) -> list[Any]:
    merged: list[Any] = []
    seen_keys: set[str] = set()
    for record in list(primary or []) + list(secondary or []):
        if not record:
            continue
        record_id = _record_attr(record, "id")
        key = (
            f"id:{record_id}"
            if record_id is not None
            else f"url:{_record_url(record)}"
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        merged.append(record)
    return merged


def exclude_new_records(
    retry_records: Iterable[Any], new_records: Iterable[Any]
) -> list[Any]:
    new_keys = {_record_url(item) for item in new_records if item}
    new_keys.discard("")
    if not new_keys:
        return list(retry_records)
    return [item for item in retry_records if _record_url(item) not in new_keys]


def dedupe_records_by_resource_url(records: Iterable[Any]) -> list[Any]:
    selected: list[Any] = []
    seen_urls: set[str] = set()
    for row in records:
        key = _record_url(row)
        if not key or key in seen_urls:
            continue
        seen_urls.add(key)
        selected.append(row)
    return selected
