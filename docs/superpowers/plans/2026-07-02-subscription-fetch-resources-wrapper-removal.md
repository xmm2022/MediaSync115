# 订阅资源抓取 Wrapper 删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `SubscriptionService._fetch_resources()`，并把剩余调用面迁到 subscriptions runtime/candidate helper。

**Architecture:** Explore 队列直接使用 resource resolver runtime adapter、runtime preferences adapter 和 resource candidate helper。Waterfall 测试直接覆盖 resource resolver runtime adapter。服务层删除资源抓取薄 wrapper 和对应 imports。

**Tech Stack:** Python 3.11+, pytest, existing subscription runtime adapters, `scripts/verify-backend.sh`, Docker Compose verification.

---

### Task 1: Boundary Red Tests

**Files:**

- Create: `backend/tests/test_explore_action_queue_resource_boundary.py`
- Modify: `backend/tests/test_subscription_service_resource_resolver_boundary.py`
- Modify: `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`
- Modify: `backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py`

- [ ] **Step 1: Add explore queue boundary test**

Create `backend/tests/test_explore_action_queue_resource_boundary.py`:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXPLORE_QUEUE = ROOT / "backend/app/services/explore_action_queue_service.py"


def test_explore_save_uses_subscription_resource_helpers_not_service_private_methods() -> None:
    source = EXPLORE_QUEUE.read_text(encoding="utf-8")

    for name in (
        "subscription_service._fetch_resources",
        "subscription_service._extract_resource_url",
        "subscription_service._extract_offline_url",
    ):
        assert name not in source

    for name in (
        "fetch_subscription_resources_with_runtime_adapter",
        "build_default_resource_resolver_runtime_dependencies",
        "resolve_source_order_with_runtime_adapter",
        "extract_resource_url",
        "extract_offline_url",
    ):
        assert name in source
```

- [ ] **Step 2: Update service boundary tests to expect wrapper removal**

In `backend/tests/test_subscription_service_resource_resolver_boundary.py`, change the second test to:

```python
def test_subscription_service_drops_fetch_resources_wrapper_and_keeps_hdhive_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" not in source
    assert "build_default_resource_resolver_runtime_dependencies" not in source
    assert "fetch_subscription_resources_with_runtime_adapter" not in source
    assert "_build_hdhive_unlock_context" in source
    assert "_prepare_hdhive_locked_resources" in source
```

In `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`, replace `test_fetch_resources_wrapper_stays_for_existing_callers` with:

```python
def test_fetch_resources_wrapper_is_removed_after_runtime_defaults_take_over() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" not in source
```

In `backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py`, replace `test_fetch_resources_wrapper_stays_for_existing_callers` with:

```python
def test_fetch_resources_wrapper_is_removed_after_manual_defaults_take_over() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" not in source
```

- [ ] **Step 3: Run boundary red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_explore_action_queue_resource_boundary.py -q
scripts/verify-backend.sh -- tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_service_manual_fetch_runtime_boundary.py -q
```

Expected:

- Explore boundary test fails because explore still calls service private helper names.
- Service boundary tests fail because `_fetch_resources()` still exists.

### Task 2: Migrate Waterfall Tests

**Files:**

- Modify: `backend/tests/test_fetch_resources_waterfall.py`

- [ ] **Step 1: Update imports**

Change:

```python
from app.services.subscription_service import SubscriptionService, SubscriptionSnapshot
```

to:

```python
from app.services.subscriptions.snapshot import SubscriptionSnapshot
```

- [ ] **Step 2: Replace service wrapper calls**

In `test_fetch_resources_stops_after_first_source_hit`, remove:

```python
service = SubscriptionService()
```

Replace:

```python
resources, _traces, meta = asyncio.run(
    service._fetch_resources(
        channel="all",
        sub=sub,
        source_order=["pansou", "hdhive", "tg"],
    )
)
```

with:

```python
resources, _traces, meta = asyncio.run(
    resolver_runtime_module.fetch_subscription_resources_with_runtime_adapter(
        channel="all",
        sub=sub,
        dependencies=(
            resolver_runtime_module.build_default_resource_resolver_runtime_dependencies()
        ),
        source_order=["pansou", "hdhive", "tg"],
    )
)
```

In `test_fetch_resources_falls_back_when_first_source_exhausted`, remove:

```python
service = SubscriptionService()
```

Replace:

```python
resources, _traces, meta = asyncio.run(
    service._fetch_resources(
        channel="all",
        sub=sub,
        source_order=["pansou", "hdhive"],
        exclude_urls={"https://115.com/s/used"},
    )
)
```

with:

```python
resources, _traces, meta = asyncio.run(
    resolver_runtime_module.fetch_subscription_resources_with_runtime_adapter(
        channel="all",
        sub=sub,
        dependencies=(
            resolver_runtime_module.build_default_resource_resolver_runtime_dependencies()
        ),
        source_order=["pansou", "hdhive"],
        exclude_urls={"https://115.com/s/used"},
    )
)
```

### Task 3: Migrate Explore Queue

**Files:**

- Modify: `backend/app/services/explore_action_queue_service.py`

- [ ] **Step 1: Add imports**

Add near the existing service imports:

```python
from app.services.subscriptions.resource_candidates import (
    extract_offline_url,
    extract_resource_url,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot
```

- [ ] **Step 2: Remove service import from `_execute_save()`**

Replace:

```python
from app.services.subscription_service import (
    SubscriptionSnapshot,
    subscription_service,
)
```

with no import.

- [ ] **Step 3: Replace source order and resource fetch**

Change:

```python
source_order = subscription_service._resolve_source_order("all")
```

to:

```python
source_order = resolve_source_order_with_runtime_adapter("all")
```

Change the per-source fetch call to:

```python
primary_resources, _traces, meta = await fetch_subscription_resources_with_runtime_adapter(
    channel="all",
    sub=snapshot,
    dependencies=build_default_resource_resolver_runtime_dependencies(),
    source_order=[source],
)
```

- [ ] **Step 4: Replace URL helper calls**

Change:

```python
share_link = subscription_service._extract_resource_url(resource)
```

to:

```python
share_link = extract_resource_url(resource)
```

Change:

```python
offline_url = subscription_service._extract_offline_url(resource)
```

to:

```python
offline_url = extract_offline_url(resource)
```

### Task 4: Delete Service Wrapper

**Files:**

- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Remove resource resolver imports**

Delete:

```python
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
```

- [ ] **Step 2: Delete `_fetch_resources()`**

Delete the whole method:

```python
async def _fetch_resources(...):
    ...
```

### Task 5: Verify and Commit

**Files:**

- Modified files from Tasks 1-4

- [ ] **Step 1: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_explore_action_queue_resource_boundary.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_service_manual_fetch_runtime_boundary.py tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_resource_resolver_runtime_adapter.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Run static checks**

Run:

```bash
git diff --check
rg -n "_fetch_resources|_extract_resource_url|_extract_offline_url|fetch_subscription_resources_with_runtime_adapter|build_default_resource_resolver_runtime_dependencies" backend/app/services/subscription_service.py backend/app/services/explore_action_queue_service.py
```

Expected:

- `git diff --check` exits 0.
- `subscription_service.py` has no `_fetch_resources`, `fetch_subscription_resources_with_runtime_adapter`, or `build_default_resource_resolver_runtime_dependencies`.
- `explore_action_queue_service.py` has no service private helper calls and does contain runtime/candidate helper imports.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/explore_action_queue_service.py backend/app/services/subscription_service.py backend/tests/test_explore_action_queue_resource_boundary.py backend/tests/test_fetch_resources_waterfall.py backend/tests/test_subscription_service_resource_resolver_boundary.py backend/tests/test_subscription_service_run_channel_resource_io_boundary.py backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py
git commit -m "refactor: 删除订阅资源抓取 wrapper"
```

- [ ] **Step 4: Run full completion gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_explore_action_queue_resource_boundary.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_service_manual_fetch_runtime_boundary.py tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_resource_resolver_runtime_adapter.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
```

Then confirm:

```bash
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- Docker status is `running healthy`.
- `git status --short` only shows the two allowed untracked files.
