# Subscription Record Selection Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription download-record selection helpers from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/record_selection.py` with pure helper functions for retry filtering, record-list merging, new-record exclusion, and force-retry URL de-duplication. `SubscriptionService` keeps SQLAlchemy queries and delegates row-list decisions to the helper module; existing resource-candidate pass-through wrappers are removed in favor of direct imports.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Record Selection Tests

**Files:**
- Create: `backend/tests/test_subscription_record_selection.py`

- [ ] **Step 1: Write failing tests**

Add tests with a local record-like dataclass:

```python
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
```

Required assertions:

```python
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
assert is_retryable_pending_record(Record(6, "ed2k://|file|a.mkv|1|hash|/", "ed2k"))
assert not is_retryable_pending_record(Record(7, "https://example.com/s/c"))

assert select_retryable_records(
    [retryable_115, bad_error],
    [Record(8, "abc123-abcd"), Record(9, "https://example.com/s/c")],
) == [retryable_115, Record(8, "abc123-abcd")]
```

Add merge and exclusion assertions:

```python
first = Record(1, "https://115.com/s/a")
same_id = Record(1, "https://115.com/s/a-new")
no_id = Record(None, "https://115.com/s/b")
same_url = Record(None, "https://115.com/s/b")

assert merge_records([first, no_id], [same_id, same_url, Record(3, "https://115.com/s/c")]) == [
    first,
    no_id,
    Record(3, "https://115.com/s/c"),
]

assert exclude_new_records(
    [first, no_id, Record(3, "https://115.com/s/c")],
    [Record(20, "https://115.com/s/b")],
) == [first, Record(3, "https://115.com/s/c")]

assert dedupe_records_by_resource_url(
    [
        Record(1, "https://115.com/s/a"),
        Record(2, ""),
        Record(3, "https://115.com/s/a"),
        Record(4, "https://115.com/s/b"),
    ]
) == [Record(1, "https://115.com/s/a"), Record(4, "https://115.com/s/b")]
```

Add a dependency-boundary test that reads `backend/app/services/subscriptions/record_selection.py` and asserts it does not import `subscription_service`, `runtime_settings_service`, service clients, `AsyncSession`, `app.models`, or `app.api`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_record_selection.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.record_selection'`.

### Task 2: Extract Record Selection Module

**Files:**
- Create: `backend/app/services/subscriptions/record_selection.py`
- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/tests/test_subscription_link_fallback.py`

- [ ] **Step 1: Implement helper module**

Implement:

```python
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


def is_offline_resource_type(resource_type: Any) -> bool: ...
def is_retryable_failed_record(record: Any) -> bool: ...
def is_retryable_pending_record(record: Any) -> bool: ...
def select_retryable_records(failed_rows: Iterable[Any], pending_rows: Iterable[Any]) -> list[Any]: ...
def merge_records(primary: Iterable[Any], secondary: Iterable[Any]) -> list[Any]: ...
def exclude_new_records(retry_records: Iterable[Any], new_records: Iterable[Any]) -> list[Any]: ...
def dedupe_records_by_resource_url(records: Iterable[Any]) -> list[Any]: ...
```

Preserve the existing retry selection, merge, and de-duplication behavior exactly.

- [ ] **Step 2: Delegate service logic**

Import the helper functions in `backend/app/services/subscription_service.py`:

```python
from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url,
    exclude_new_records,
    merge_records,
    select_retryable_records,
)
```

Replace:

```python
retry_records = self._merge_records(retry_records, duplicate_retry_records)
retry_records = self._exclude_new_records(retry_records, created_records)
...
return retryable
...
selected: list[DownloadRecord] = []
...
return selected
...
self._merge_auto_save_stats(merged, last_stats)
...
if not self._should_continue_link_fallback(...)
...
resources = self._filter_resources_excluding_urls(resources, exclude_urls)
```

with:

```python
retry_records = merge_records(retry_records, duplicate_retry_records)
retry_records = exclude_new_records(retry_records, created_records)
...
return select_retryable_records(failed_rows, pending_rows)
...
return dedupe_records_by_resource_url(rows_result.scalars().all())
...
merge_auto_save_stats(merged, last_stats)
...
if not should_continue_link_fallback(sub.media_type, last_stats, attempted_count=last_attempted_count)
...
resources = filter_resources_excluding_urls(resources, exclude_urls)
```

Remove old static methods `_exclude_new_records()`, `_merge_records()`, `_resource_candidate_url()`, `_filter_resources_excluding_urls()`, `_merge_auto_save_stats()`, and `_should_continue_link_fallback()`.

- [ ] **Step 3: Update wrapper-dependent tests**

In `backend/tests/test_subscription_link_fallback.py`, import direct helpers:

```python
from app.services.subscriptions.resource_candidates import (
    filter_resources_excluding_urls,
    merge_auto_save_stats,
    should_continue_link_fallback,
)
```

Replace private method assertions with direct helper calls using `snapshot.media_type`:

```python
assert should_continue_link_fallback(
    _movie_snapshot().media_type,
    {"saved": 0, "failed": 1, "subscription_completed": False},
    attempted_count=1,
)
```

Replace `SubscriptionService._filter_resources_excluding_urls(...)` and `SubscriptionService._merge_auto_save_stats(...)` with direct helper calls.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_record_selection.py tests/test_subscription_link_fallback.py tests/test_subscription_resource_candidates.py tests/test_subscription_resource_metadata.py tests/test_subscriptions.py tests/test_health.py
```

Expected: all selected tests pass.

### Task 3: Verification, Commit, Deploy

- [ ] **Step 1: Verify**

Run:

```bash
scripts/verify-backend.sh --quick
scripts/verify-backend.sh
scripts/verify-frontend.sh --build
scripts/verify.sh --quick
git diff --check
```

Expected: all commands exit 0. The existing Vite chunk-size warning may remain.

- [ ] **Step 2: Commit**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/record_selection.py backend/tests/test_subscription_record_selection.py backend/tests/test_subscription_link_fallback.py
git commit -m "refactor: 抽离订阅重试记录选择"
```

- [ ] **Step 3: Rebuild and health check**

Run:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
```

Expected: health endpoint returns `{"status":"healthy"}` and Docker health is `healthy`.
