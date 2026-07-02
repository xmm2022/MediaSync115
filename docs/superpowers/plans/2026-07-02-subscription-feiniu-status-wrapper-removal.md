# Subscription Feiniu Status Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Feiniu movie status default wiring into cleanup runtime adapters and delete `SubscriptionService` Feiniu status wrappers.

**Architecture:** `build_default_pre_scan_cleanup_runtime_dependencies()` and `build_default_completed_cleanup_runtime_dependencies()` keep explicit `check_feiniu_movie_status` injection, but the parameter becomes optional. When omitted, each builder defaults to `check_feiniu_movie_status_with_runtime_adapter()`, letting `SubscriptionService` drop its movie and TV Feiniu private wrappers.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Import Feiniu movie status runtime adapter in pre-scan tests**

In `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`, add:

```python
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
)
```

- [ ] **Step 2: Update pre-scan default dependency test**

In `test_default_runtime_dependencies_bind_existing_services_and_runner()`, remove:

```python
    async def check_feiniu_movie_status(_tmdb_id: int) -> dict[str, Any]:
        return {"checked": False}
```

Change the builder call from:

```python
    dependencies = build_default_pre_scan_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )
```

to:

```python
    dependencies = build_default_pre_scan_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
    )
```

Change:

```python
    assert dependencies.check_feiniu_movie_status is check_feiniu_movie_status
```

to:

```python
    assert (
        dependencies.check_feiniu_movie_status
        is check_feiniu_movie_status_with_runtime_adapter
    )
```

- [ ] **Step 3: Add pre-scan falsy injection test**

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, _tmdb_id: int) -> dict[str, Any]:
            return {"checked": True}

    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    check_feiniu_movie_status = FalsyAsyncCallable()

    dependencies = build_default_pre_scan_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )

    assert dependencies.check_feiniu_movie_status is check_feiniu_movie_status
```

- [ ] **Step 4: Import Feiniu movie status runtime adapter in completed-cleanup tests**

In `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`, add:

```python
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
)
```

- [ ] **Step 5: Update completed-cleanup default dependency test**

In `test_default_runtime_dependencies_bind_existing_services_sleep_and_runners()`, remove:

```python
    async def check_feiniu_movie_status(_tmdb_id: int) -> dict[str, Any]:
        return {"checked": False}
```

Change the builder call from:

```python
    dependencies = build_default_completed_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )
```

to:

```python
    dependencies = build_default_completed_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
    )
```

Change:

```python
    assert dependencies.check_feiniu_movie_status is check_feiniu_movie_status
```

to:

```python
    assert (
        dependencies.check_feiniu_movie_status
        is check_feiniu_movie_status_with_runtime_adapter
    )
```

- [ ] **Step 6: Add completed-cleanup falsy injection test**

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, _tmdb_id: int) -> dict[str, Any]:
            return {"checked": True}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    check_feiniu_movie_status = FalsyAsyncCallable()

    dependencies = build_default_completed_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )

    assert dependencies.check_feiniu_movie_status is check_feiniu_movie_status
```

- [ ] **Step 7: Add service dead-wrapper boundary test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add:

```python
def test_subscription_service_drops_feiniu_status_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_check_feiniu_movie_status",
        "_check_feiniu_tv_missing_status",
        "check_feiniu_movie_status_with_runtime_adapter",
        "check_feiniu_tv_missing_status_with_runtime_adapter",
    ):
        assert name not in source
```

- [ ] **Step 8: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_services_and_runner tests/test_subscription_pre_scan_cleanup_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_services_sleep_and_runners tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because both default builders still require `check_feiniu_movie_status`, and `SubscriptionService` still contains Feiniu status wrappers/imports.

### Task 2: Move Feiniu Movie Status Defaults Into Runtime Adapters

**Files:**
- Modify: `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`
- Modify: `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add Feiniu movie status default import to pre-scan runtime adapter**

In `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`, add:

```python
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
)
```

- [ ] **Step 2: Make pre-scan Feiniu callback optional**

Change:

```python
    check_feiniu_movie_status: CheckFeiniuMovieStatus,
```

to:

```python
    check_feiniu_movie_status: CheckFeiniuMovieStatus | None = None,
```

Then change dataclass construction to:

```python
        check_feiniu_movie_status=(
            check_feiniu_movie_status
            if check_feiniu_movie_status is not None
            else check_feiniu_movie_status_with_runtime_adapter
        ),
```

- [ ] **Step 3: Add Feiniu movie status default import to completed cleanup runtime adapter**

In `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`, add:

```python
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
)
```

- [ ] **Step 4: Make completed-cleanup Feiniu callback optional**

Change:

```python
    check_feiniu_movie_status: CheckFeiniuMovieStatus,
```

to:

```python
    check_feiniu_movie_status: CheckFeiniuMovieStatus | None = None,
```

Then change dataclass construction to:

```python
        check_feiniu_movie_status=(
            check_feiniu_movie_status
            if check_feiniu_movie_status is not None
            else check_feiniu_movie_status_with_runtime_adapter
        ),
```

- [ ] **Step 5: Remove service Feiniu wrappers and injected kwargs**

In `backend/app/services/subscription_service.py`, remove this import block:

```python
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
    check_feiniu_tv_missing_status_with_runtime_adapter,
)
```

Remove this kwarg from `_evaluate_pre_scan_cleanup()`:

```python
                check_feiniu_movie_status=self._check_feiniu_movie_status,
```

Remove this kwarg from both completed cleanup default builder calls:

```python
                check_feiniu_movie_status=self._check_feiniu_movie_status,
```

Delete `_check_feiniu_movie_status()` and `_check_feiniu_tv_missing_status()`.

- [ ] **Step 6: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_completed_cleanup.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`
- Commit: `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`
- Commit: `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_check_feiniu_movie_status|_check_feiniu_tv_missing_status|check_feiniu_movie_status_with_runtime_adapter|check_feiniu_tv_missing_status_with_runtime_adapter" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1. `wc -l` decreases from 214.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py backend/tests/test_subscription_completed_cleanup_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅 Feiniu status wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_completed_cleanup.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
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
