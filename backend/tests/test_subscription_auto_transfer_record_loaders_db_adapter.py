from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    AutoTransferRecordLoaderDbDependencies,
    build_default_auto_transfer_record_loader_db_dependencies,
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
    load_subscription_resource_urls_with_db_adapter,
)
from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url,
    select_retryable_records,
)


ROOT = Path(__file__).resolve().parents[2]


class _NoAutoflush:
    def __init__(self, db: _FakeDb) -> None:
        self._db = db

    def __enter__(self) -> None:
        self._db.no_autoflush_entered += 1

    def __exit__(self, *_args: Any) -> None:
        self._db.no_autoflush_exited += 1


class _Scalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _ExecuteResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _Scalars:
        return _Scalars(self._rows)

    def all(self) -> list[Any]:
        return self._rows


class _FakeDb:
    def __init__(self, queued_rows: list[list[Any]] | None = None) -> None:
        self.no_autoflush = _NoAutoflush(self)
        self.no_autoflush_entered = 0
        self.no_autoflush_exited = 0
        self.queued_rows = list(queued_rows or [])
        self.executed: list[Any] = []

    async def execute(self, statement: Any) -> _ExecuteResult:
        self.executed.append(statement)
        rows = self.queued_rows.pop(0) if self.queued_rows else []
        return _ExecuteResult(rows)


def _dependencies(**overrides: Any) -> AutoTransferRecordLoaderDbDependencies:
    def select_retryable_records(
        failed_rows: list[Any],
        pending_rows: list[Any],
    ) -> list[Any]:
        return [*failed_rows, *pending_rows]

    def dedupe_records_by_resource_url(rows: list[Any]) -> list[Any]:
        return list(rows)

    values = {
        "select_retryable_records": select_retryable_records,
        "dedupe_records_by_resource_url": dedupe_records_by_resource_url,
    }
    values.update(overrides)
    return AutoTransferRecordLoaderDbDependencies(**values)


@pytest.mark.asyncio
async def test_retryable_loader_queries_failed_and_pending_records_with_limits() -> None:
    failed_rows = [SimpleNamespace(id=1, resource_url="failed")]
    pending_rows = [SimpleNamespace(id=2, resource_url="pending")]
    db = _FakeDb([failed_rows, pending_rows])
    selector_calls: list[tuple[list[Any], list[Any]]] = []

    def select_records(
        failed: list[Any],
        pending: list[Any],
    ) -> list[Any]:
        selector_calls.append((failed, pending))
        return ["selected"]

    result = await load_retryable_records_with_db_adapter(
        db,
        101,
        dependencies=_dependencies(select_retryable_records=select_records),
    )

    assert result == ["selected"]
    assert selector_calls == [(failed_rows, pending_rows)]
    assert db.no_autoflush_entered == 1
    assert db.no_autoflush_exited == 1
    assert len(db.executed) == 2
    failed_params = db.executed[0].compile().params
    pending_params = db.executed[1].compile().params
    assert failed_params == {
        "subscription_id_1": 101,
        "status_1": MediaStatus.FAILED,
        "param_1": 8,
    }
    assert pending_params == {
        "subscription_id_1": 101,
        "status_1": [MediaStatus.PENDING, MediaStatus.MATCHED],
        "param_1": 5,
    }


@pytest.mark.asyncio
async def test_force_retry_loader_cleans_duplicate_urls_and_dedupes_rows() -> None:
    rows = [
        SimpleNamespace(id=3, resource_url="https://115.com/s/a"),
        SimpleNamespace(id=4, resource_url="https://115.com/s/a"),
    ]
    db = _FakeDb([rows])
    dedupe_calls: list[list[Any]] = []

    def dedupe(rows_arg: list[Any]) -> list[Any]:
        dedupe_calls.append(rows_arg)
        return [rows_arg[0]]

    result = await load_force_retry_records_with_db_adapter(
        db,
        202,
        [" https://115.com/s/a ", "", None, "https://115.com/s/b"],
        dependencies=_dependencies(dedupe_records_by_resource_url=dedupe),
    )

    assert result == [rows[0]]
    assert dedupe_calls == [rows]
    assert db.no_autoflush_entered == 1
    assert db.no_autoflush_exited == 1
    assert len(db.executed) == 1
    params = db.executed[0].compile().params
    assert params == {
        "subscription_id_1": 202,
        "resource_url_1": ["https://115.com/s/a", "https://115.com/s/b"],
        "status_1": [
            MediaStatus.FAILED,
            MediaStatus.PENDING,
            MediaStatus.MATCHED,
        ],
    }


@pytest.mark.asyncio
async def test_force_retry_loader_skips_database_when_duplicate_urls_are_empty() -> None:
    db = _FakeDb()

    def dedupe(_rows: list[Any]) -> list[Any]:
        raise AssertionError("dedupe should not run without URLs")

    result = await load_force_retry_records_with_db_adapter(
        db,
        303,
        ["", None, "   "],
        dependencies=_dependencies(dedupe_records_by_resource_url=dedupe),
    )

    assert result == []
    assert db.no_autoflush_entered == 0
    assert db.no_autoflush_exited == 0
    assert db.executed == []


@pytest.mark.asyncio
async def test_subscription_resource_url_loader_strips_non_empty_urls() -> None:
    db = _FakeDb(
        [
            [
                (" https://115.com/s/a ",),
                ("",),
                (None,),
                ("https://115.com/s/b",),
            ]
        ]
    )

    result = await load_subscription_resource_urls_with_db_adapter(db, 404)

    assert result == {"https://115.com/s/a", "https://115.com/s/b"}
    assert db.no_autoflush_entered == 1
    assert db.no_autoflush_exited == 1
    assert len(db.executed) == 1
    assert db.executed[0].compile().params == {"subscription_id_1": 404}


def test_default_dependencies_bind_record_selection_helpers() -> None:
    dependencies = build_default_auto_transfer_record_loader_db_dependencies()

    assert dependencies.select_retryable_records is select_retryable_records
    assert dependencies.dedupe_records_by_resource_url is (
        dedupe_records_by_resource_url
    )


def test_auto_transfer_record_loader_db_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "app.api" not in source
