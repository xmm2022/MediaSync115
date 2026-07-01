# 订阅转存通知 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move subscription transfer-success notification runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.transfer_notification_runtime_adapter` to bind TG Bot notification, logger warning, and the existing core `transfer_notifications.notify_transfer_success()` helper. Keep `transfer_notifications.py` pure and keep `SubscriptionService._notify_transfer_success()` as a compatibility wrapper.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/transfer_notification_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Lazy TG Bot notification sender.
  - Default dependency builder.
  - Runtime wrapper for `notify_transfer_success()`.
- Create: `backend/tests/test_subscription_transfer_notification_runtime_adapter.py`
  - Red/green tests for wrapper forwarding, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_notify_transfer_success()` to the runtime adapter.
  - Remove direct imports of `TransferNotificationDependencies` and `notify_transfer_success_flow`.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_transfer_notification_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_transfer_notification_runtime_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.transfer_notification_runtime_adapter import (
    TransferNotificationRuntimeDependencies,
    build_default_transfer_notification_runtime_dependencies,
    notify_transfer_success_with_runtime_adapter,
    send_tg_bot_notification,
)
from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> TransferNotificationRuntimeDependencies:
    async def notify(message: str, *, poster_path: str | None = None) -> None:
        _ = (message, poster_path)

    def log_warning(message: str, **kwargs: Any) -> None:
        _ = (message, kwargs)

    async def run_notify_transfer_success(
        *args: Any,
        **kwargs: Any,
    ) -> None:
        _ = (args, kwargs)

    values: dict[str, Any] = {
        "notify": notify,
        "log_warning": log_warning,
        "run_notify_transfer_success": run_notify_transfer_success,
    }
    values.update(overrides)
    return TransferNotificationRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_arguments() -> None:
    events: list[tuple[str, Any]] = []
    runner_calls: list[dict[str, Any]] = []

    async def notify(message: str, *, poster_path: str | None = None) -> None:
        events.append(("notify", message, poster_path))

    def log_warning(message: str, **kwargs: Any) -> None:
        events.append(("warning", message, kwargs))

    async def run_notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        *,
        poster_path: str | None = None,
        dependencies: TransferNotificationDependencies,
    ) -> None:
        runner_calls.append(
            {
                "sub_title": sub_title,
                "resource_name": resource_name,
                "source": source,
                "method": method,
                "poster_path": poster_path,
                "dependencies": dependencies,
            }
        )
        await dependencies.notify("message", poster_path=poster_path)
        dependencies.log_warning("warn", exc_info=True)

    await notify_transfer_success_with_runtime_adapter(
        "订阅 A",
        "资源 B",
        "hdhive",
        "分享转存",
        poster_path="/poster.jpg",
        dependencies=_dependencies(
            notify=notify,
            log_warning=log_warning,
            run_notify_transfer_success=run_notify_transfer_success,
        ),
    )

    assert len(runner_calls) == 1
    assert runner_calls[0]["sub_title"] == "订阅 A"
    assert runner_calls[0]["resource_name"] == "资源 B"
    assert runner_calls[0]["source"] == "hdhive"
    assert runner_calls[0]["method"] == "分享转存"
    assert runner_calls[0]["poster_path"] == "/poster.jpg"
    assert isinstance(
        runner_calls[0]["dependencies"],
        TransferNotificationDependencies,
    )
    assert events == [
        ("notify", "message", "/poster.jpg"),
        ("warning", "warn", {"exc_info": True}),
    ]


def test_default_runtime_dependencies_bind_existing_sender_and_runner() -> None:
    dependencies = build_default_transfer_notification_runtime_dependencies()

    assert dependencies.notify is send_tg_bot_notification
    assert dependencies.run_notify_transfer_success is notify_transfer_success
    assert callable(dependencies.log_warning)


def test_transfer_notification_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/transfer_notification_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notification_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.transfer_notification_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/transfer_notification_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/transfer_notification_runtime_adapter.py`:

```python
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success,
)


logger = logging.getLogger(__name__)

Notify = Callable[..., Awaitable[None]]
LogWarning = Callable[..., None]
RunNotifyTransferSuccess = Callable[..., Awaitable[None]]


@dataclass(frozen=True, slots=True)
class TransferNotificationRuntimeDependencies:
    notify: Notify
    log_warning: LogWarning
    run_notify_transfer_success: RunNotifyTransferSuccess


async def send_tg_bot_notification(
    message: str,
    *,
    poster_path: str | None = None,
) -> None:
    from app.services.tg_bot.notifications import tg_bot_notify

    await tg_bot_notify(message, poster_path=poster_path)


def build_default_transfer_notification_runtime_dependencies() -> (
    TransferNotificationRuntimeDependencies
):
    return TransferNotificationRuntimeDependencies(
        notify=send_tg_bot_notification,
        log_warning=logger.warning,
        run_notify_transfer_success=notify_transfer_success,
    )


async def notify_transfer_success_with_runtime_adapter(
    sub_title: str,
    resource_name: str,
    source: str,
    method: str,
    *,
    poster_path: str | None = None,
    dependencies: TransferNotificationRuntimeDependencies | None = None,
) -> None:
    current_dependencies = (
        dependencies or build_default_transfer_notification_runtime_dependencies()
    )
    await current_dependencies.run_notify_transfer_success(
        sub_title,
        resource_name,
        source,
        method,
        poster_path=poster_path,
        dependencies=TransferNotificationDependencies(
            notify=current_dependencies.notify,
            log_warning=current_dependencies.log_warning,
        ),
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notification_runtime_adapter.py
```

Expected: PASS.

## Task 3: Wire SubscriptionService to Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace imports**

Remove:

```python
from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success as notify_transfer_success_flow,
)
```

Add:

```python
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)
```

- [ ] **Step 2: Simplify service wrapper**

Change `_notify_transfer_success()` to:

```python
    @staticmethod
    async def _notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None = None,
    ) -> None:
        await notify_transfer_success_with_runtime_adapter(
            sub_title,
            resource_name,
            source,
            method,
            poster_path=poster_path,
        )
```

- [ ] **Step 3: Run targeted regression**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notification_runtime_adapter.py tests/test_subscription_transfer_notifications.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/transfer_notification_runtime_adapter.py backend/tests/test_subscription_transfer_notification_runtime_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅转存通知 runtime adapter"
```

## Task 4: Full Verification

**Files:**
- No edits.

- [ ] **Step 1: Backend full verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: all backend tests pass.

- [ ] **Step 2: Frontend production build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build exits 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Project quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: command exits 0.

- [ ] **Step 4: Docker build and health check**

Run:

```bash
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: container is healthy and `/healthz` returns `{"status":"healthy"}`.

- [ ] **Step 5: Final workspace check**

Run:

```bash
git status --short
wc -l backend/app/services/subscription_service.py
git log --oneline -10
```

Expected: `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: plan covers runtime notification dependencies, lazy TG sender, service wiring, targeted checks, full verification, Docker health, and workspace check.
- 占位扫描：没有未决步骤；代码片段和命令都是明确的。
- Type consistency: `TransferNotificationRuntimeDependencies`, `send_tg_bot_notification()`, and `notify_transfer_success_with_runtime_adapter()` names match tests, implementation, and service wiring.
