# Subscription Snapshot Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the subscription snapshot dataclass from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/snapshot.py` containing the slotted `SubscriptionSnapshot` dataclass. `SubscriptionService` imports the class from the new module and keeps it in its module namespace so existing imports remain compatible.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Snapshot Tests

**Files:**
- Create: `backend/tests/test_subscription_snapshot.py`

- [ ] **Step 1: Write failing tests**

Add tests that import:

```python
from pathlib import Path

import pytest

from app.models.models import MediaType
from app.services import subscription_service as subscription_service_module
from app.services.subscriptions.snapshot import SubscriptionSnapshot
```

Add a helper:

```python
ROOT = Path(__file__).resolve().parents[2]


def _snapshot() -> SubscriptionSnapshot:
    return SubscriptionSnapshot(
        id=1,
        tmdb_id=123,
        douban_id="db123",
        title="Example",
        media_type=MediaType.TV,
        year="2026",
        auto_download=True,
        tv_scope="all",
        tv_season_number=1,
        tv_episode_start=1,
        tv_episode_end=12,
        tv_follow_mode="missing",
        tv_include_specials=False,
        has_successful_transfer=True,
    )
```

Required assertions:

```python
snapshot = _snapshot()
assert snapshot.id == 1
assert snapshot.tmdb_id == 123
assert snapshot.douban_id == "db123"
assert snapshot.title == "Example"
assert snapshot.media_type == MediaType.TV
assert snapshot.year == "2026"
assert snapshot.auto_download is True
assert snapshot.tv_scope == "all"
assert snapshot.tv_season_number == 1
assert snapshot.tv_episode_start == 1
assert snapshot.tv_episode_end == 12
assert snapshot.tv_follow_mode == "missing"
assert snapshot.tv_include_specials is False
assert snapshot.has_successful_transfer is True

with pytest.raises(AttributeError):
    snapshot.extra = "not allowed"

assert subscription_service_module.SubscriptionSnapshot is SubscriptionSnapshot
```

Add a dependency-boundary test that reads `backend/app/services/subscriptions/snapshot.py` and asserts it does not import `subscription_service`, `runtime_settings_service`, service clients, `AsyncSession`, or `app.api`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_snapshot.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.snapshot'`.

### Task 2: Extract Snapshot Module

**Files:**
- Create: `backend/app/services/subscriptions/snapshot.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement snapshot module**

Implement:

```python
from __future__ import annotations

from dataclasses import dataclass

from app.models.models import MediaType


@dataclass(slots=True)
class SubscriptionSnapshot:
    id: int
    tmdb_id: int | None
    douban_id: str | None
    title: str
    media_type: MediaType
    year: str | None
    auto_download: bool
    tv_scope: str
    tv_season_number: int | None
    tv_episode_start: int | None
    tv_episode_end: int | None
    tv_follow_mode: str
    tv_include_specials: bool
    has_successful_transfer: bool
```

- [ ] **Step 2: Rewire service import**

In `backend/app/services/subscription_service.py`:

```python
from app.services.subscriptions.snapshot import SubscriptionSnapshot
```

Remove:

```python
from dataclasses import dataclass
```

Remove the local `@dataclass(slots=True) class SubscriptionSnapshot` block from the bottom of the file.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_snapshot.py tests/test_fetch_resources_waterfall.py tests/test_subscription_link_fallback.py tests/test_subscriptions.py tests/test_health.py
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
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/snapshot.py backend/tests/test_subscription_snapshot.py
git commit -m "refactor: 抽离订阅快照模型"
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
