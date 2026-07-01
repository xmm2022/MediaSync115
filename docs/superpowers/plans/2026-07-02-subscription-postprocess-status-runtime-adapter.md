# 订阅后处理状态 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move precise-transfer postprocess status runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.postprocess_status_runtime_adapter` to bind the archive trigger service, runtime media statuses, clock, and the existing pure `postprocess_status.apply_precise_transfer_postprocess_status()` helper. Keep `postprocess_status.py` dependency-injected and keep `SubscriptionService._apply_precise_transfer_postprocess_status()` as a compatibility wrapper.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/postprocess_status_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder for archive service, statuses, clock, and core runner.
  - Runtime wrapper that translates runtime dependencies into `PostprocessStatusDependencies`.
- Create: `backend/tests/test_subscription_postprocess_status_runtime_adapter.py`
  - Red/green tests for wrapper dependency translation, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_apply_precise_transfer_postprocess_status()` to the runtime adapter.
  - Remove direct imports of `PostprocessStatusDependencies`, `apply_postprocess_status_flow`, `media_postprocess_service`, `beijing_now`, and top-level `MediaStatus` usage when no longer needed.
- Modify: `backend/tests/test_subscription_precise_transfer_status.py`
  - Patch the archive trigger through the new runtime adapter module, because the service wrapper no longer owns `media_postprocess_service`.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_postprocess_status_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_postprocess_status_runtime_adapter.py`:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.media_postprocess_service import media_postprocess_service
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    PostprocessStatusRuntimeDependencies,
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
    build_default_postprocess_status_runtime_dependencies,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> PostprocessStatusRuntimeDependencies:
    async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
        return {"triggered": False, "trigger": trigger}

    async def run_apply_precise_transfer_postprocess_status(
        record: Any,
        *,
        dependencies: PostprocessStatusDependencies,
    ) -> dict[str, Any]:
        _ = (record, dependencies)
        return {"triggered": False}

    values: dict[str, Any] = {
        "trigger_archive_after_transfer": trigger_archive_after_transfer,
        "archiving_status": "ARCHIVING",
        "completed_status": "COMPLETED",
        "now": lambda: datetime(2026, 1, 1, 12, 0, 0),
        "run_apply_precise_transfer_postprocess_status": (
            run_apply_precise_transfer_postprocess_status
        ),
    }
    values.update(overrides)
    return PostprocessStatusRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_record() -> None:
    now = datetime(2026, 1, 2, 12, 0, 0)
    record = SimpleNamespace(id=7)
    runner_calls: list[dict[str, Any]] = []
    trigger_calls: list[str] = []

    async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
        trigger_calls.append(trigger)
        return {"triggered": True, "trigger": trigger}

    async def run_apply_precise_transfer_postprocess_status(
        target: Any,
        *,
        dependencies: PostprocessStatusDependencies,
    ) -> dict[str, Any]:
        runner_calls.append(
            {
                "record": target,
                "dependencies": dependencies,
            }
        )
        archive_result = await dependencies.trigger_archive_after_transfer(
            trigger="subscription_transfer"
        )
        assert dependencies.archiving_status == "ARCHIVING"
        assert dependencies.completed_status == "COMPLETED"
        assert dependencies.now() == now
        return archive_result

    result = await apply_precise_transfer_postprocess_status_with_runtime_adapter(
        record,
        dependencies=_dependencies(
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            now=lambda: now,
            run_apply_precise_transfer_postprocess_status=(
                run_apply_precise_transfer_postprocess_status
            ),
        ),
    )

    assert result == {"triggered": True, "trigger": "subscription_transfer"}
    assert trigger_calls == ["subscription_transfer"]
    assert len(runner_calls) == 1
    assert runner_calls[0]["record"] is record
    assert isinstance(runner_calls[0]["dependencies"], PostprocessStatusDependencies)


def test_default_runtime_dependencies_bind_existing_helpers_and_statuses() -> None:
    dependencies = build_default_postprocess_status_runtime_dependencies()

    assert (
        dependencies.trigger_archive_after_transfer
        is media_postprocess_service.trigger_archive_after_transfer
    )
    assert dependencies.archiving_status == MediaStatus.ARCHIVING
    assert dependencies.completed_status == MediaStatus.COMPLETED
    assert callable(dependencies.now)
    assert (
        dependencies.run_apply_precise_transfer_postprocess_status
        is apply_precise_transfer_postprocess_status
    )


def test_postprocess_status_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/postprocess_status_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.postprocess_status_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/postprocess_status_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/postprocess_status_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.timezone_utils import beijing_now
from app.models.models import MediaStatus
from app.services.media_postprocess_service import media_postprocess_service
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status,
)


TriggerArchiveAfterTransfer = Callable[..., Awaitable[dict[str, Any]]]
Now = Callable[[], datetime]
RunApplyPreciseTransferPostprocessStatus = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class PostprocessStatusRuntimeDependencies:
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer
    archiving_status: Any
    completed_status: Any
    now: Now
    run_apply_precise_transfer_postprocess_status: (
        RunApplyPreciseTransferPostprocessStatus
    )


def build_default_postprocess_status_runtime_dependencies() -> (
    PostprocessStatusRuntimeDependencies
):
    return PostprocessStatusRuntimeDependencies(
        trigger_archive_after_transfer=(
            media_postprocess_service.trigger_archive_after_transfer
        ),
        archiving_status=MediaStatus.ARCHIVING,
        completed_status=MediaStatus.COMPLETED,
        now=beijing_now,
        run_apply_precise_transfer_postprocess_status=(
            apply_precise_transfer_postprocess_status
        ),
    )


async def apply_precise_transfer_postprocess_status_with_runtime_adapter(
    record: Any,
    *,
    dependencies: PostprocessStatusRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_postprocess_status_runtime_dependencies()
    )
    return await current_dependencies.run_apply_precise_transfer_postprocess_status(
        record,
        dependencies=PostprocessStatusDependencies(
            trigger_archive_after_transfer=(
                current_dependencies.trigger_archive_after_transfer
            ),
            archiving_status=current_dependencies.archiving_status,
            completed_status=current_dependencies.completed_status,
            now=current_dependencies.now,
        ),
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status_runtime_adapter.py
```

Expected: PASS.

## Task 3: Wire SubscriptionService Wrapper

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/tests/test_subscription_precise_transfer_status.py`

- [ ] **Step 1: Update service imports**

In `backend/app/services/subscription_service.py`, remove:

```python
from app.core.timezone_utils import beijing_now
from app.services.media_postprocess_service import media_postprocess_service
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status as apply_postprocess_status_flow,
)
```

Add:

```python
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
```

Keep `MediaStatus` imported only if other methods still use it; otherwise remove it from the model import block.

- [ ] **Step 2: Update wrapper body**

Replace `_apply_precise_transfer_postprocess_status()` with:

```python
    async def _apply_precise_transfer_postprocess_status(
        self,
        record: DownloadRecord,
    ) -> dict[str, Any]:
        return await apply_precise_transfer_postprocess_status_with_runtime_adapter(
            record,
        )
```

- [ ] **Step 3: Update service-level regression patch point**

In `backend/tests/test_subscription_precise_transfer_status.py`, replace:

```python
from app.services import subscription_service as subscription_service_module
```

with:

```python
from app.services.subscriptions import (
    postprocess_status_runtime_adapter as postprocess_runtime_adapter_module,
)
```

Replace both monkeypatch blocks with:

```python
    monkeypatch.setattr(
        postprocess_runtime_adapter_module.media_postprocess_service,
        "trigger_archive_after_transfer",
        fake_trigger_archive_after_transfer,
    )
```

- [ ] **Step 4: Run targeted regression tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status_runtime_adapter.py tests/test_subscription_postprocess_status.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/postprocess_status_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_postprocess_status_runtime_adapter.py backend/tests/test_subscription_precise_transfer_status.py
git commit -m "refactor: 抽离订阅后处理状态 runtime adapter"
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

- `subscription_service.py` line count decreases from 856.

## Self-Review

- Spec coverage: plan covers new runtime adapter, service wrapper wiring, service regression patch point, targeted tests, and every completion verification command.
- Placeholder scan: no deferred work remains in this plan.
- Type consistency: `PostprocessStatusRuntimeDependencies`, `PostprocessStatusDependencies`, and `apply_precise_transfer_postprocess_status_with_runtime_adapter()` names match across test, implementation, and service wiring.
