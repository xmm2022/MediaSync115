from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url,
    exclude_new_records,
    is_offline_resource_type,
    is_retryable_failed_record,
    is_retryable_pending_record,
    merge_records,
    select_retryable_records,
)


ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Record:
    id: int | None
    resource_url: str
    resource_type: str = "pan115"
    error_message: str = ""


def test_retryable_record_classification_keeps_existing_rules() -> None:
    assert is_offline_resource_type("magnet")
    assert is_offline_resource_type("ed2k")
    assert not is_offline_resource_type("pan115")

    retryable_115 = Record(1, "https://115.com/s/a", error_message="code=404")
    retryable_offline = Record(2, "magnet:?xt=urn:btih:ABC", "magnet", "timeout")
    bad_error = Record(3, "https://115.com/s/b", error_message="invalid code")
    bad_link = Record(4, "https://example.com/s/c", error_message="code=404")

    assert is_retryable_failed_record(retryable_115)
    assert is_retryable_failed_record(retryable_offline)
    assert not is_retryable_failed_record(bad_error)
    assert not is_retryable_failed_record(bad_link)

    assert is_retryable_pending_record(Record(5, "abc123-abcd"))
    assert is_retryable_pending_record(
        Record(6, "ed2k://|file|a.mkv|1|hash|/", "ed2k")
    )
    assert not is_retryable_pending_record(Record(7, "https://example.com/s/c"))

    assert select_retryable_records(
        [retryable_115, bad_error],
        [Record(8, "abc123-abcd"), Record(9, "https://example.com/s/c")],
    ) == [retryable_115, Record(8, "abc123-abcd")]


def test_merge_records_deduplicates_by_id_then_url() -> None:
    first = Record(1, "https://115.com/s/a")
    same_id = Record(1, "https://115.com/s/a-new")
    no_id = Record(None, "https://115.com/s/b")
    same_url = Record(None, "https://115.com/s/b")

    assert merge_records(
        [first, no_id], [same_id, same_url, Record(3, "https://115.com/s/c")]
    ) == [
        first,
        no_id,
        Record(3, "https://115.com/s/c"),
    ]


def test_exclude_new_records_uses_resource_url() -> None:
    first = Record(1, "https://115.com/s/a")
    no_id = Record(None, "https://115.com/s/b")
    third = Record(3, "https://115.com/s/c")

    assert exclude_new_records(
        [first, no_id, third],
        [Record(20, "https://115.com/s/b")],
    ) == [first, third]


def test_dedupe_records_by_resource_url_keeps_first_non_empty_url() -> None:
    assert dedupe_records_by_resource_url(
        [
            Record(1, "https://115.com/s/a"),
            Record(2, ""),
            Record(3, "https://115.com/s/a"),
            Record(4, "https://115.com/s/b"),
        ]
    ) == [Record(1, "https://115.com/s/a"), Record(4, "https://115.com/s/b")]


def test_record_selection_module_does_not_import_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/record_selection.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
