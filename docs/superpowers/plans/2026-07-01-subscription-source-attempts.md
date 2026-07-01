# Subscription Source Attempts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract source-attempt summary and source-order pure decisions from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/source_attempts.py` and keep `SubscriptionService` methods as wrappers. The new module receives plain data and does not import runtime settings, API modules, database code, or provider services.

**Tech Stack:** Python 3.13 test environment, pytest, existing `scripts/verify-backend.sh`, existing Docker Compose deployment.

---

### Task 1: Source Attempts Module Tests

**Files:**
- Create: `backend/tests/test_subscription_source_attempts.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
    resolve_source_order,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_source_attempt_summary_reports_success_chain() -> None:
    summary = build_source_attempt_summary(
        [
            {"source": "pansou", "status": "empty", "count": 0},
            {"source": "hdhive", "status": "success", "count": 2},
            {"source": "offline", "status": "success", "count": 1},
        ],
        ["pansou", "hdhive", "tg"],
    )

    assert summary == "尝试来源 [Pansou(无资源) → HDHive(2条) → 离线磁力(1条)]，最终命中 HDHive, 离线磁力"


def test_build_source_attempt_summary_reports_failure_and_empty() -> None:
    summary = build_source_attempt_summary(
        [
            {"source": "tg", "status": "failed", "count": 0, "error": "boom"},
            {"source": "pansou", "status": "empty", "count": 0},
        ],
        ["tg", "pansou"],
    )

    assert summary == "尝试来源 [TG(失败) → Pansou(无资源)]，均未命中可用资源"


def test_resolve_source_order_filters_unsupported_and_unready_tg() -> None:
    assert resolve_source_order(["seedhub", "tg", "pansou", "hdhive"], tg_ready=False) == [
        "pansou",
        "hdhive",
    ]
    assert resolve_source_order(["seedhub", "tg", "pansou"], tg_ready=True) == [
        "tg",
        "pansou",
    ]


def test_source_attempts_module_does_not_import_runtime_service_or_api_layers() -> None:
    source = (ROOT / "backend/app/services/subscriptions/source_attempts.py").read_text(
        encoding="utf-8"
    )

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run tests to verify RED**

Run: `scripts/verify-backend.sh -- tests/test_subscription_source_attempts.py`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.source_attempts'`.

### Task 2: Extract Source Attempt Helpers

**Files:**
- Create: `backend/app/services/subscriptions/source_attempts.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement pure helper functions**

Implement `build_source_attempt_summary()` and `resolve_source_order()` with the behavior captured in the tests.

- [ ] **Step 2: Delegate from `SubscriptionService`**

Import the two helpers and update `_build_source_attempt_summary()` and `_resolve_source_order()` to call them. Keep runtime settings reads inside `_resolve_source_order()`.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_source_attempts.py tests/test_fetch_resources_waterfall.py
```

Expected: all selected tests pass.

### Task 3: Full Verification And Commit

**Files:**
- Commit only the design, plan, new module, updated service, and tests.

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
git add docs/superpowers/specs/2026-07-01-subscription-source-attempts-design.md docs/superpowers/plans/2026-07-01-subscription-source-attempts.md backend/app/services/subscriptions/source_attempts.py backend/app/services/subscription_service.py backend/tests/test_subscription_source_attempts.py
git commit -m "refactor: 抽离订阅来源尝试辅助逻辑"
```

### Task 4: Rebuild And Health Check

- [ ] **Step 1: Rebuild**

Run: `docker compose up -d --build`

- [ ] **Step 2: Verify health**

Run:

```bash
curl -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
```

Expected: health endpoint returns `{"status":"healthy"}` and Docker health is `healthy`.
