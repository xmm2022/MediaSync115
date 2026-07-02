# Subscription Auto Save Resources Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-unused `SubscriptionService._auto_save_resources()` wrapper and keep auto-save behavior inside the existing runtime adapter layer.

**Architecture:** No new production abstraction is needed. `link_fallback_runtime_adapter` already owns the default `auto_save_resources_with_default_runtime_dependencies()` helper, so this change removes stale service-level callback assembly and updates static boundary tests to enforce the final ownership boundary.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Static Boundary Tests

**Files:**
- Modify: `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Remove helper that extracts the old wrapper body**

Delete this helper from `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`:

```python
def _auto_save_resources_source(source: str) -> str:
    start = source.index("    async def _auto_save_resources")
    end = source.index("    async def _create_execution_log", start)
    return source[start:end]
```

- [ ] **Step 2: Update auto-save boundary test**

Change `test_subscription_service_drops_auto_save_runtime_callback_assembly()` to read the whole service source and assert the final boundary:

```python
def test_subscription_service_drops_auto_save_runtime_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_apply_precise_transfer_postprocess_status",
        "_notify_transfer_success",
        "apply_precise_transfer_postprocess_status_with_runtime_adapter",
        "notify_transfer_success_with_runtime_adapter",
        "resolve_quality_filter=self._resolve_subscription_quality_filter",
        "apply_precise_postprocess_status=",
        "notify_transfer_success=self._notify_transfer_success",
    ):
        assert name not in source
```

Replace `test_subscription_service_uses_auto_save_runtime_default_dependencies()` with:

```python
def test_subscription_service_drops_auto_save_resources_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "async def _auto_save_resources",
        "auto_save_resources_with_runtime_adapter",
        "build_default_auto_save_resources_runtime_dependencies",
        "DownloadRecord",
    ):
        assert name not in source
```

- [ ] **Step 3: Add dead wrapper cleanup test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add:

```python
def test_subscription_service_drops_auto_save_resources_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_auto_save_resources",
        "auto_save_resources_with_runtime_adapter",
        "build_default_auto_save_resources_runtime_dependencies",
        "DownloadRecord",
    ):
        assert name not in source
```

- [ ] **Step 4: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because `subscription_service.py` still contains `_auto_save_resources()`, auto-save runtime adapter imports, and `DownloadRecord`.

### Task 2: Delete Service Wrapper And Imports

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Remove auto-save runtime imports**

Delete this import block:

```python
from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
)
```

If `DownloadRecord` is only used by `_auto_save_resources()`, change:

```python
from app.models.models import (
    DownloadRecord,
    ExecutionStatus,
)
```

to:

```python
from app.models.models import ExecutionStatus
```

- [ ] **Step 2: Delete `_auto_save_resources()`**

Delete the entire method:

```python
    async def _auto_save_resources(
        self,
        db: AsyncSession,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
        records: list[DownloadRecord],
        source: str,
        tv_missing_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await auto_save_resources_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=records,
            source=source,
            dependencies=build_default_auto_save_resources_runtime_dependencies(),
            tv_missing_snapshot=tv_missing_snapshot,
        )
```

- [ ] **Step 3: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_link_fallback_flow.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_auto_save_resources|auto_save_resources_with_runtime_adapter|build_default_auto_save_resources_runtime_dependencies|DownloadRecord" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 because the service no longer contains the wrapper/imports. `wc -l` decreases from 293.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/tests/test_subscription_service_auto_save_runtime_boundary.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅自动转存 wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_link_fallback_flow.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected final status is the two allowed untracked files only.
