# 订阅服务未调用 Wrapper 清理 Implementation Plan

## Goal

删除 `SubscriptionService` 中无 repo 调用的私有兼容 wrapper：

- `_build_source_attempt_summary()`
- `_allow_unlock_by_threshold()`
- `_safe_int()`
- `_should_stop_unlocking_on_message()`

同时移除对应 helper imports。保留仍被使用的 `_build_hdhive_unlock_context()` 和 `_prepare_hdhive_locked_resources()`。

## Target Files

Create:

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

Modify:

- `backend/app/services/subscription_service.py`

## Step 1: Red Test

Create `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`.

Test body:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_unreferenced_private_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_build_source_attempt_summary",
        "_allow_unlock_by_threshold",
        "_safe_int",
        "_should_stop_unlocking_on_message",
        "build_source_attempt_summary",
        "allow_unlock_by_threshold",
        "safe_int",
        "should_stop_unlocking_on_message",
    ):
        assert name not in source


def test_subscription_service_keeps_used_hdhive_runtime_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "_build_hdhive_unlock_context" in source
    assert "_prepare_hdhive_locked_resources" in source
    assert "build_hdhive_unlock_context_with_runtime_adapter" in source
    assert "prepare_hdhive_locked_resources_with_runtime_adapter" in source
```

Expected red command:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected failure:

- Static assertion fails because the wrapper/import names still exist in `subscription_service.py`.

## Step 2: Remove Dead Wrappers

Modify `backend/app/services/subscription_service.py`:

Remove import:

```python
from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
)
```

Change HDHive unlock import from:

```python
from app.services.subscriptions.hdhive_unlock import (
    allow_unlock_by_threshold,
    safe_int,
    should_stop_unlocking_on_message,
)
```

to no import, unless some non-target name still needs it.

Delete methods:

```python
def _build_source_attempt_summary(...)
@staticmethod
def _allow_unlock_by_threshold(...)
@staticmethod
def _safe_int(...)
@staticmethod
def _should_stop_unlocking_on_message(...)
```

Do not delete:

```python
def _build_hdhive_unlock_context(...)
async def _prepare_hdhive_locked_resources(...)
```

## Step 3: Green Tests

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py -q
scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_source_attempts.py tests/test_hdhive_unlock_policy.py -q
```

If failures occur, check whether:

- a target wrapper/import still exists,
- a non-target wrapper was removed by mistake,
- or helper tests reveal accidental helper changes.

Do not modify helper modules for this block.

## Step 4: Pre-Commit Checks

Run:

```bash
git diff --check
rg -n "_build_source_attempt_summary|_allow_unlock_by_threshold|_safe_int\\(|_should_stop_unlocking_on_message|build_source_attempt_summary|allow_unlock_by_threshold|safe_int|should_stop_unlocking_on_message" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected:

- `rg` returns no matches for target wrapper/helper names in `subscription_service.py`.
- Line count decreases.

Commit:

```bash
git add backend/app/services/subscription_service.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 清理订阅服务未调用 wrapper"
```

## Step 5: Completion Verification

After implementation commit, run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_source_attempts.py tests/test_hdhive_unlock_policy.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected:

- Targeted tests pass.
- Backend full test suite passes.
- Frontend build passes; Vite chunk-size warning is acceptable.
- Quick verify passes.
- Container starts and becomes healthy.
- `/healthz` returns `{"status":"healthy"}`.
- `git status --short` only shows:
  - `?? backend/scripts/export_hdhive_189_links.py`
  - `?? docs/next-session-prompt.md`

## Risk Notes

- The methods are private and repo-local reference search found no callers, but this is still a deletion; rely on backend full tests and Docker smoke after commit.
- Keep the static test narrow so it does not block future legitimate helper usage outside `SubscriptionService`.
