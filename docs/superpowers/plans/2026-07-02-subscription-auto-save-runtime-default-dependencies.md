# 订阅自动转存 Runtime 默认依赖装配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `auto_save_resources_runtime_adapter` 自己装配默认 runtime callback，并清理 `SubscriptionService._auto_save_resources()` 的手动依赖传递。

**Architecture:** 扩展现有 runtime adapter builder，使四个服务 callback 参数可选并默认绑定现有 runtime helper。`SubscriptionService` 保留 `_auto_save_resources()` 入口，但只调用无参默认 builder；自动转存专用的 postprocess/notify 私有 wrapper 删除。

**Tech Stack:** Python 3.11+, pytest, existing subscription runtime adapters, `scripts/verify-backend.sh`, Docker Compose verification.

---

### Task 1: Auto-Save Runtime Builder Red Tests

**Files:**

- Modify: `backend/tests/test_subscription_auto_save_resources_runtime_adapter.py`

- [ ] **Step 1: Add imports for default helper assertions**

Add imports near the existing runtime adapter imports:

```python
from app.services.subscriptions.execution_logs import (
    create_step_log as create_subscription_step_log,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)
```

- [ ] **Step 2: Add no-arg default builder red test**

Add this test before `test_emit_transfer_success_event_respects_kafka_enabled`:

```python
def test_default_runtime_dependencies_bind_runtime_helpers_without_service_callbacks() -> None:
    dependencies = build_default_auto_save_resources_runtime_dependencies()

    assert dependencies.resolve_quality_filter is (
        resolve_subscription_quality_filter_with_runtime_adapter
    )
    assert dependencies.create_step_log is create_subscription_step_log
    assert dependencies.apply_precise_postprocess_status is (
        apply_precise_transfer_postprocess_status_with_runtime_adapter
    )
    assert dependencies.notify_transfer_success is (
        notify_transfer_success_with_runtime_adapter
    )
    assert dependencies.run_adapter is auto_save_resources_with_adapter
    assert dependencies.run_batch is auto_save_resources_batch
```

- [ ] **Step 3: Add falsy injection red test**

Add this test after the no-arg default builder test:

```python
def test_default_runtime_dependencies_preserve_falsy_explicit_injections() -> None:
    class FalsyCallable:
        def __bool__(self) -> bool:
            return False

        def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {}

    resolve_quality_filter = FalsyCallable()

    dependencies = build_default_auto_save_resources_runtime_dependencies(
        resolve_quality_filter=resolve_quality_filter,
    )

    assert dependencies.resolve_quality_filter is resolve_quality_filter
```

- [ ] **Step 4: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py::test_default_runtime_dependencies_bind_runtime_helpers_without_service_callbacks -q
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_explicit_injections -q
```

Expected:

- First command fails with `TypeError` because the default builder still requires explicit callbacks.
- Second command fails with `TypeError` for missing required callbacks.

### Task 2: Service Boundary Red Test

**Files:**

- Create: `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`

- [ ] **Step 1: Write failing boundary test**

Create `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


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


def test_subscription_service_uses_auto_save_runtime_default_dependencies() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _auto_save_resources" in source
    assert "auto_save_resources_with_runtime_adapter" in source
    assert "build_default_auto_save_resources_runtime_dependencies()" in source
```

- [ ] **Step 2: Run boundary red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py -q
```

Expected: FAIL because service still contains callback assembly and wrapper methods.

### Task 3: Implement Runtime Defaults

**Files:**

- Modify: `backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py`
- Modify: `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`

- [ ] **Step 1: Add default helper imports**

In `backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py`, add:

```python
from app.services.subscriptions.execution_logs import (
    create_step_log as create_subscription_step_log,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)
```

- [ ] **Step 2: Make builder callbacks optional**

Change the builder signature and callback assignments:

```python
def build_default_auto_save_resources_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]] | None = None,
    create_step_log: Callable[..., Awaitable[None]] | None = None,
    apply_precise_postprocess_status: (
        Callable[[Any], Awaitable[dict[str, Any]]] | None
    ) = None,
    notify_transfer_success: Callable[..., Awaitable[None]] | None = None,
) -> AutoSaveResourcesRuntimeDependencies:
    return AutoSaveResourcesRuntimeDependencies(
        get_pan115_cookie=runtime_settings_service.get_pan115_cookie,
        create_pan_service=Pan115Service,
        get_pan115_default_folder=runtime_settings_service.get_pan115_default_folder,
        get_pan115_offline_folder=runtime_settings_service.get_pan115_offline_folder,
        resolve_quality_filter=(
            resolve_quality_filter
            if resolve_quality_filter is not None
            else resolve_subscription_quality_filter_with_runtime_adapter
        ),
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        create_step_log=(
            create_step_log
            if create_step_log is not None
            else create_subscription_step_log
        ),
        emit_transfer_success_event=emit_transfer_success_event,
        select_tv_missing_episode_files=select_tv_missing_episode_files,
        apply_precise_postprocess_status=(
            apply_precise_postprocess_status
            if apply_precise_postprocess_status is not None
            else apply_precise_transfer_postprocess_status_with_runtime_adapter
        ),
        notify_transfer_success=(
            notify_transfer_success
            if notify_transfer_success is not None
            else notify_transfer_success_with_runtime_adapter
        ),
        trigger_archive_after_transfer=(
            media_postprocess_service.trigger_archive_after_transfer
        ),
        log_operation=operation_log_service.log_background_event,
        now=beijing_now,
        is_video_file=is_video_filename,
        statuses=AutoTransferBatchStatuses(
            transferring=MediaStatus.TRANSFERRING,
            downloading=MediaStatus.DOWNLOADING,
            offline_submitted=MediaStatus.OFFLINE_SUBMITTED,
            matched=MediaStatus.MATCHED,
            completed=MediaStatus.COMPLETED,
            failed=MediaStatus.FAILED,
        ),
        run_adapter=auto_save_resources_with_adapter,
        run_batch=auto_save_resources_batch,
    )
```

- [ ] **Step 3: Simplify link fallback default helper**

In `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`, change:

```python
dependencies=build_default_auto_save_resources_runtime_dependencies(
    resolve_quality_filter=resolve_subscription_quality_filter_with_runtime_adapter,
    create_step_log=create_subscription_step_log,
    apply_precise_postprocess_status=(
        apply_precise_transfer_postprocess_status_with_runtime_adapter
    ),
    notify_transfer_success=notify_transfer_success_with_runtime_adapter,
),
```

to:

```python
dependencies=build_default_auto_save_resources_runtime_dependencies(),
```

Remove now-unused imports from `link_fallback_runtime_adapter.py`:

```python
from app.services.subscriptions.execution_logs import (
    create_step_log as create_subscription_step_log,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)
```

- [ ] **Step 4: Run runtime builder tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py::test_default_runtime_dependencies_bind_runtime_helpers_without_service_callbacks tests/test_subscription_auto_save_resources_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_explicit_injections -q
```

Expected: PASS.

### Task 4: Service Wiring and Precise Transfer Test Update

**Files:**

- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/tests/test_subscription_precise_transfer_status.py`
- Modify: `backend/tests/test_subscription_link_fallback_runtime_adapter.py`

- [ ] **Step 1: Simplify service auto-save wrapper**

In `backend/app/services/subscription_service.py`, remove imports:

```python
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)
```

Change `_auto_save_resources()` dependencies argument to:

```python
dependencies=build_default_auto_save_resources_runtime_dependencies(),
```

Delete methods:

```python
async def _apply_precise_transfer_postprocess_status(...)
@staticmethod
async def _notify_transfer_success(...)
```

- [ ] **Step 2: Update precise transfer tests to runtime adapter**

In `backend/tests/test_subscription_precise_transfer_status.py`, replace:

```python
from app.services.subscription_service import subscription_service
```

with:

```python
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
```

Replace both calls:

```python
result = await subscription_service._apply_precise_transfer_postprocess_status(record)
```

with:

```python
result = await apply_precise_transfer_postprocess_status_with_runtime_adapter(record)
```

- [ ] **Step 3: Update link fallback runtime test expectation**

In `backend/tests/test_subscription_link_fallback_runtime_adapter.py`, change the default auto-save helper test builder assertions from checking individual callback kwargs to expecting no kwargs:

```python
assert calls[0]["builder"] == {}
assert calls[1]["runner"]["dependencies"] is dependencies_marker
```

- [ ] **Step 4: Run service boundary and related tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_link_fallback_runtime_adapter.py -q
```

Expected: PASS.

### Task 5: Targeted Verification and Commit

**Files:**

- Modified and created files from Tasks 1-4.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py -q
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run:

```bash
git diff --check
rg -n "_apply_precise_transfer_postprocess_status|_notify_transfer_success|apply_precise_transfer_postprocess_status_with_runtime_adapter|notify_transfer_success_with_runtime_adapter|apply_precise_postprocess_status=|notify_transfer_success=self\\._notify_transfer_success" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected:

- `git diff --check` exits 0.
- `rg` exits 1 with no matches in `subscription_service.py`.
- Line count decreases from 463.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py \
  backend/app/services/subscriptions/link_fallback_runtime_adapter.py \
  backend/app/services/subscription_service.py \
  backend/tests/test_subscription_auto_save_resources_runtime_adapter.py \
  backend/tests/test_subscription_service_auto_save_runtime_boundary.py \
  backend/tests/test_subscription_precise_transfer_status.py \
  backend/tests/test_subscription_link_fallback_runtime_adapter.py
git commit -m "refactor: 下沉订阅自动转存 runtime 默认依赖装配"
```

### Task 6: Completion Verification

**Files:**

- No file edits.

- [ ] **Step 1: Run related targeted backend tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py -q
```

Expected: PASS.

- [ ] **Step 2: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: PASS.

- [ ] **Step 5: Build and start Docker service**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: command exits 0.

- [ ] **Step 6: Verify Docker health and health endpoint**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected:

- Docker health becomes `healthy`.
- `/healthz` returns `{"status":"healthy"}`.

- [ ] **Step 7: Final workspace check**

Run:

```bash
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

Line count is lower than 463.
