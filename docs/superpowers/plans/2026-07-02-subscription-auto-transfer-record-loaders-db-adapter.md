# 订阅自动转存记录加载 DB Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move auto-transfer retry and link-fallback record loading queries out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.auto_transfer_record_loaders_db_adapter` to own `DownloadRecord` query shapes for retryable records, force-retry duplicate records, and subscription resource URLs. Keep retry filtering and URL dedupe rules in `record_selection.py` and inject them into the DB adapter.

**Tech Stack:** Python 3.13, pytest, SQLAlchemy select builder, async database session fakes, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py`
  - Dependency dataclass for core selector/deduper callbacks.
  - Default dependency builder binding `record_selection.py`.
  - DB loader for retryable failed and pending/matched records.
  - DB loader for force-retry duplicate URLs.
  - DB loader for subscription resource URL set used by link fallback.
- Create: `backend/tests/test_subscription_auto_transfer_record_loaders_db_adapter.py`
  - Red/green tests for query shape, no-autoflush usage, short-circuit behavior, URL stripping, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_load_retryable_records()`, `_load_force_retry_records()`, and `_load_subscription_resource_urls()` to the DB adapter.
  - Remove direct imports of SQLAlchemy `select`, `select_retryable_records`, and `dedupe_records_by_resource_url`.

## Task 1: Write DB Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_record_loaders_db_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_auto_transfer_record_loaders_db_adapter.py`:

```python
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
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_record_loaders_db_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_record_loaders_db_adapter'`.

## Task 2: Implement DB Adapter

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py`:

```python
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
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_record_loaders_db_adapter.py
```

Expected: PASS.

## Task 3: Wire SubscriptionService Wrappers

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Update imports**

Remove:

```python
from sqlalchemy import select
from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url,
    select_retryable_records,
)
```

Add:

```python
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
    load_subscription_resource_urls_with_db_adapter,
)
```

- [ ] **Step 2: Replace wrapper bodies**

Replace `_load_retryable_records()` with:

```python
    async def _load_retryable_records(
        self, db: AsyncSession, subscription_id: int
    ) -> list[DownloadRecord]:
        return await load_retryable_records_with_db_adapter(db, subscription_id)
```

Replace `_load_force_retry_records()` with:

```python
    async def _load_force_retry_records(
        self,
        db: AsyncSession,
        subscription_id: int,
        duplicate_urls: list[str],
    ) -> list[DownloadRecord]:
        return await load_force_retry_records_with_db_adapter(
            db,
            subscription_id,
            duplicate_urls,
        )
```

Replace `_load_subscription_resource_urls()` with:

```python
    async def _load_subscription_resource_urls(
        self, db: AsyncSession, subscription_id: int
    ) -> set[str]:
        return await load_subscription_resource_urls_with_db_adapter(
            db,
            subscription_id,
        )
```

- [ ] **Step 3: Run targeted regression tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_record_loaders_db_adapter.py tests/test_subscription_record_selection.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_item_processing_run_flow.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_auto_transfer_record_loaders_db_adapter.py
git commit -m "refactor: 抽离订阅自动转存记录加载 DB adapter"
```

Expected: commit succeeds and leaves only the two allowed untracked files.

## Task 4: Completion Verification

**Files:**
- No edits.

- [ ] **Step 1: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: all backend tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build exits 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: exits 0.

- [ ] **Step 4: Rebuild and start container**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: image builds and `mediasync115` starts.

- [ ] **Step 5: Wait for Docker health**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
```

Expected: prints `health=healthy` and exits 0.

- [ ] **Step 6: Verify HTTP health and workspace state**

Run:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- compose status shows `mediasync115` healthy.
- Docker inspect prints `healthy`.
- `git status --short` only lists:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

- `subscription_service.py` line count decreases from 795.

## Self-Review

- Spec coverage: plan covers retry loader, force loader, link-fallback URL loader, service wrapper wiring, targeted tests, and every completion verification command.
- Placeholder scan: no deferred work remains in this plan.
- Type consistency: `AutoTransferRecordLoaderDbDependencies` and all three `*_with_db_adapter()` function names match across test, implementation, and service wiring.
