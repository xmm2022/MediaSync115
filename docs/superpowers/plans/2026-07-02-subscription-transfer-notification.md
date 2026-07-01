# Subscription Transfer Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription transfer-success TG notification handling from `subscription_service.py` into a dependency-injected helper module.

**Architecture:** Add `app.services.subscriptions.transfer_notifications` with a dependency dataclass and one async function. Keep `SubscriptionService` as the adapter that imports `tg_bot_notify` lazily and injects logger warning behavior.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper modules.

---

### Task 1: Add Transfer Notification Tests

**Files:**
- Create: `backend/tests/test_subscription_transfer_notifications.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success,
)
```

Use a small dependency factory:

```python
def _dependencies(
    *,
    send_error: Exception | None = None,
):
    sent: list[tuple[str, str | None]] = []
    warnings: list[tuple[str, dict[str, Any]]] = []

    async def notify(message: str, *, poster_path: str | None = None) -> None:
        if send_error is not None:
            raise send_error
        sent.append((message, poster_path))

    def log_warning(message: str, **kwargs: Any) -> None:
        warnings.append((message, kwargs))

    return (
        TransferNotificationDependencies(
            notify=notify,
            log_warning=log_warning,
        ),
        sent,
        warnings,
    )
```

Test cases:

- `test_notify_transfer_success_sends_escaped_html_message_with_poster()`
- `test_notify_transfer_success_swallows_sender_errors_and_logs_warning()`
- `test_transfer_notifications_module_stays_dependency_injected()`

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notifications.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.transfer_notifications'`.

### Task 2: Implement Transfer Notification Helper

**Files:**
- Create: `backend/app/services/subscriptions/transfer_notifications.py`

- [ ] **Step 1: Add dependency dataclass**

Create the helper shell:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import escape
from typing import Any


Notify = Callable[..., Awaitable[None]]
LogWarning = Callable[..., None]


@dataclass(frozen=True)
class TransferNotificationDependencies:
    notify: Notify
    log_warning: LogWarning
```

- [ ] **Step 2: Implement `notify_transfer_success()`**

Add the extracted behavior:

```python
async def notify_transfer_success(
    sub_title: str,
    resource_name: str,
    source: str,
    method: str,
    *,
    poster_path: str | None = None,
    dependencies: TransferNotificationDependencies,
) -> None:
    try:
        lines = [
            "<b>订阅 · 转存成功</b>",
            f"订阅：{escape(sub_title)}",
            f"资源：{escape(resource_name)}",
            f"来源：{escape(source)}　方式：{escape(method)}",
        ]
        await dependencies.notify("\n".join(lines), poster_path=poster_path)
    except Exception:
        dependencies.log_warning("订阅转存 TG 通知发送失败", exc_info=True)
```

- [ ] **Step 3: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notifications.py
```

Expected: PASS.

### Task 3: Replace Service Notification with Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper**

```python
from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success as notify_transfer_success_flow,
)
```

- [ ] **Step 2: Replace `_notify_transfer_success()` body**

Preserve the existing static method signature:

```python
@staticmethod
async def _notify_transfer_success(
    sub_title: str,
    resource_name: str,
    source: str,
    method: str,
    poster_path: str | None = None,
) -> None:
    async def notify(message: str, *, poster_path: str | None = None) -> None:
        from app.services.tg_bot.notifications import tg_bot_notify

        await tg_bot_notify(message, poster_path=poster_path)

    await notify_transfer_success_flow(
        sub_title,
        resource_name,
        source,
        method,
        poster_path=poster_path,
        dependencies=TransferNotificationDependencies(
            notify=notify,
            log_warning=logger.warning,
        ),
    )
```

- [ ] **Step 3: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notifications.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_already_received.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

```bash
git add backend/app/services/subscriptions/transfer_notifications.py backend/app/services/subscription_service.py backend/tests/test_subscription_transfer_notifications.py
git commit -m "refactor: 抽离订阅转存通知"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_notifications.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_already_received.py
```

Expected: exit 0.

- [ ] **Step 2: Run backend full verification**

```bash
scripts/verify-backend.sh
```

Expected: exit 0.

- [ ] **Step 3: Run frontend build**

```bash
npm --prefix frontend run build
```

Expected: exit 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run quick verification**

```bash
scripts/verify.sh --quick
```

Expected: exit 0.

- [ ] **Step 5: Build and start Docker service**

```bash
docker compose up -d --build mediasync115
```

Expected: exit 0.

- [ ] **Step 6: Check health**

```bash
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true)
  echo "health=$status"
  if [ "$status" = healthy ]; then exit 0; fi
  sleep 2
done
exit 1
```

Then verify the HTTP endpoint and compose state:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and the service health is `healthy`.

- [ ] **Step 7: Confirm worktree state**

```bash
git status --short
```

Expected: only these existing untracked files remain:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: the plan covers message construction, HTML escaping, poster passthrough, send failure logging, dependency boundary, service adapter wiring, targeted regressions, full verification, Docker health, and final worktree state.
- 占位符扫描：没有未完成实现步骤。
- Type consistency: `TransferNotificationDependencies`, `notify_transfer_success()`, and `notify_transfer_success_flow` names match tests, helper, and service imports.
