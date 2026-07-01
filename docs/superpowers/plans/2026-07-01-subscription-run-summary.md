# Subscription Run Summary Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure subscription-run summary helpers from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/run_summary.py` with pure functions for channel normalization, run status resolution, and final message construction. Keep `SubscriptionService.run_channel_check()` responsible for orchestration, logging, persistence, and enum values.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Run Summary Tests

**Files:**
- Create: `backend/tests/test_subscription_run_summary.py`

- [ ] **Step 1: Write failing tests**

Add tests that import:

```python
from app.services.subscriptions.run_summary import (
    build_run_message,
    normalize_subscription_channel,
    resolve_run_status,
)
```

Required assertions:

```python
assert normalize_subscription_channel(" HDHive ") == "hdhive"
assert normalize_subscription_channel("ALL") == "all"

with pytest.raises(ValueError, match="unsupported channel"):
    normalize_subscription_channel("bad")

assert resolve_run_status(
    0, 3, 0,
    success_status="success",
    failed_status="failed",
    partial_status="partial",
) == "success"

assert resolve_run_status(
    3, 3, 0,
    success_status="success",
    failed_status="failed",
    partial_status="partial",
) == "failed"

assert resolve_run_status(
    1, 3, 0,
    success_status="success",
    failed_status="failed",
    partial_status="partial",
) == "partial"

assert resolve_run_status(
    0, 3, 1,
    success_status="success",
    failed_status="failed",
    partial_status="partial",
) == "partial"
```

Add message tests:

```python
assert build_run_message({
    "checked_count": 2,
    "new_resource_count": 0,
    "auto_saved_count": 0,
    "auto_failed_count": 0,
    "cleanup_deleted_count": 0,
    "failed_count": 0,
}) == "共 2 个订阅，未发现新资源"

assert build_run_message({
    "checked_count": 4,
    "new_resource_count": 3,
    "auto_saved_count": 2,
    "auto_failed_count": 1,
    "cleanup_deleted_count": 1,
    "failed_count": 1,
}) == "共 4 个订阅，发现 3 个新资源，转存成功 2 个，转存失败 1 个，自动完成 1 个订阅，处理出错 1 个"
```

Add a dependency-boundary test that reads `backend/app/services/subscriptions/run_summary.py` and asserts it does not import `subscription_service`, `runtime_settings_service`, service clients, `AsyncSession`, `app.models`, or `app.api`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_summary.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_summary'`.

### Task 2: Extract Run Summary Module

**Files:**
- Create: `backend/app/services/subscriptions/run_summary.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement:

```python
SUPPORTED_SUBSCRIPTION_CHANNELS = frozenset({"pansou", "hdhive", "tg", "priority", "all"})

def normalize_subscription_channel(channel: str) -> str: ...

def resolve_run_status(
    failed_count: int,
    checked_count: int,
    auto_failed_count: int,
    *,
    success_status: Any,
    failed_status: Any,
    partial_status: Any,
) -> Any: ...

def build_run_message(result: dict[str, Any]) -> str: ...
```

Preserve the existing status and message behavior exactly.

- [ ] **Step 2: Delegate service logic**

Import the helper functions in `backend/app/services/subscription_service.py`. Replace:

```python
normalized_channel = self._normalize_channel(channel)
status = self._resolve_status(...)
message = self._build_message(result)
```

with direct helper calls:

```python
normalized_channel = normalize_subscription_channel(channel)
status = resolve_run_status(
    result["failed_count"],
    result["checked_count"],
    result["auto_failed_count"],
    success_status=ExecutionStatus.SUCCESS,
    failed_status=ExecutionStatus.FAILED,
    partial_status=ExecutionStatus.PARTIAL,
)
message = build_run_message(result)
```

Remove the old static methods `_normalize_channel()`, `_resolve_status()`, and `_build_message()`.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_summary.py tests/test_subscriptions.py tests/test_health.py
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
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/run_summary.py backend/tests/test_subscription_run_summary.py
git commit -m "refactor: 抽离订阅运行汇总助手"
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
