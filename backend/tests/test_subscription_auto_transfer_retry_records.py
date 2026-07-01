from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.auto_transfer_retry_records import (
    AutoTransferRetryRecordDependencies,
    select_auto_transfer_retry_records,
)


ROOT = Path(__file__).resolve().parents[2]


def _record(record_id: int | None, url: str) -> SimpleNamespace:
    return SimpleNamespace(id=record_id, resource_url=url)


def _dependencies(**overrides: Any) -> AutoTransferRetryRecordDependencies:
    async def load_retryable_records(_db: Any, _subscription_id: int) -> list[Any]:
        return []

    async def load_force_retry_records(
        _db: Any, _subscription_id: int, _duplicate_urls: list[str]
    ) -> list[Any]:
        return []

    values: dict[str, Any] = {
        "load_retryable_records": load_retryable_records,
        "load_force_retry_records": load_force_retry_records,
    }
    values.update(overrides)
    return AutoTransferRetryRecordDependencies(**values)


@pytest.mark.asyncio
async def test_select_auto_transfer_retry_records_loads_auto_records_and_excludes_new_urls() -> None:
    retry_records = [
        _record(1, "https://115.com/s/a"),
        _record(2, "https://115.com/s/new"),
    ]
    load_calls: list[tuple[Any, int]] = []

    async def load_retryable_records(db: Any, subscription_id: int) -> list[Any]:
        load_calls.append((db, subscription_id))
        return retry_records

    result = await select_auto_transfer_retry_records(
        db="db",
        subscription_id=101,
        auto_download=True,
        force_auto_download=False,
        duplicate_urls=[],
        created_records=[_record(20, "https://115.com/s/new")],
        dependencies=_dependencies(load_retryable_records=load_retryable_records),
    )

    assert result == [_record(1, "https://115.com/s/a")]
    assert load_calls == [("db", 101)]


@pytest.mark.asyncio
async def test_select_auto_transfer_retry_records_loads_force_duplicates_without_auto_download() -> None:
    force_records = [_record(3, "https://115.com/s/duplicate")]
    force_calls: list[tuple[Any, int, list[str]]] = []

    async def load_force_retry_records(
        db: Any, subscription_id: int, duplicate_urls: list[str]
    ) -> list[Any]:
        force_calls.append((db, subscription_id, duplicate_urls))
        return force_records

    result = await select_auto_transfer_retry_records(
        db="db",
        subscription_id=202,
        auto_download=False,
        force_auto_download=True,
        duplicate_urls=["https://115.com/s/duplicate"],
        created_records=[],
        dependencies=_dependencies(load_force_retry_records=load_force_retry_records),
    )

    assert result == force_records
    assert force_calls == [("db", 202, ["https://115.com/s/duplicate"])]


@pytest.mark.asyncio
async def test_select_auto_transfer_retry_records_merges_auto_and_force_records() -> None:
    first = _record(1, "https://115.com/s/a")
    no_id = _record(None, "https://115.com/s/b")

    async def load_retryable_records(_db: Any, _subscription_id: int) -> list[Any]:
        return [first, no_id]

    async def load_force_retry_records(
        _db: Any, _subscription_id: int, _duplicate_urls: list[str]
    ) -> list[Any]:
        return [
            _record(1, "https://115.com/s/a-new"),
            _record(None, "https://115.com/s/b"),
            _record(4, "https://115.com/s/c"),
        ]

    result = await select_auto_transfer_retry_records(
        db=object(),
        subscription_id=303,
        auto_download=True,
        force_auto_download=True,
        duplicate_urls=["https://115.com/s/a", "https://115.com/s/b"],
        created_records=[],
        dependencies=_dependencies(
            load_retryable_records=load_retryable_records,
            load_force_retry_records=load_force_retry_records,
        ),
    )

    assert result == [first, no_id, _record(4, "https://115.com/s/c")]


@pytest.mark.asyncio
async def test_select_auto_transfer_retry_records_skips_force_loader_without_duplicate_urls() -> None:
    async def load_force_retry_records(
        _db: Any, _subscription_id: int, _duplicate_urls: list[str]
    ) -> list[Any]:
        raise AssertionError("force loader should not be called")

    result = await select_auto_transfer_retry_records(
        db=object(),
        subscription_id=404,
        auto_download=False,
        force_auto_download=True,
        duplicate_urls=[],
        created_records=[],
        dependencies=_dependencies(load_force_retry_records=load_force_retry_records),
    )

    assert result == []


def test_auto_transfer_retry_records_module_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_retry_records.py"
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
