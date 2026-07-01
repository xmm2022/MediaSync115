# Subscription Offline Transfer Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure offline-transfer metadata parsing from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/offline_transfer.py` with deterministic helpers and a small dataclass. Keep `SubscriptionService` wrapper methods and update the offline submission branch to use the new metadata helper.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Offline Transfer Metadata Tests

**Files:**
- Create: `backend/tests/test_subscription_offline_transfer.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.offline_transfer import (
    build_submitted_offline_metadata,
    extract_hash_from_offline_url,
    extract_offline_info_hash,
    extract_offline_task_id,
)


ROOT = Path(__file__).resolve().parents[2]


def test_extract_hash_from_magnet_url_uppercases_btih() -> None:
    assert (
        extract_hash_from_offline_url(
            "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
        )
        == "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
    )


def test_extract_offline_metadata_reads_nested_payloads() -> None:
    payload = {
        "data": [
            {"ignored": ""},
            {"task": {"taskId": "task-123", "taskHash": "hash-456"}},
        ]
    }

    assert extract_offline_info_hash(payload) == "hash-456"
    assert extract_offline_task_id(payload) == "task-123"


def test_build_submitted_offline_metadata_falls_back_to_url_hash() -> None:
    metadata = build_submitted_offline_metadata(
        {"data": {"task_id": "task-only"}},
        "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
    )

    assert metadata.info_hash == "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
    assert metadata.task_id == "task-only"


def test_offline_transfer_module_does_not_import_runtime_or_service_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/offline_transfer.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run tests to verify RED**

Run: `scripts/verify-backend.sh -- tests/test_subscription_offline_transfer.py`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.offline_transfer'`.

### Task 2: Extract Metadata Helpers

**Files:**
- Create: `backend/app/services/subscriptions/offline_transfer.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement module helpers**

Implement `SubmittedOfflineMetadata`, `extract_hash_from_offline_url()`, `extract_first_nested_value()`, `extract_offline_info_hash()`, `extract_offline_task_id()`, and `build_submitted_offline_metadata()`.

- [ ] **Step 2: Delegate service wrappers**

Update `SubscriptionService._extract_hash_from_offline_url()`, `_extract_offline_info_hash()`, `_extract_offline_task_id()`, and `_extract_first_nested_value()` to call the module helpers.

- [ ] **Step 3: Use metadata helper in offline branch**

Replace the inline `offline_info_hash` / `offline_task_id` extraction with `build_submitted_offline_metadata()`.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_offline_transfer.py tests/test_subscription_resource_candidates.py tests/test_subscription_link_fallback.py
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
git add docs/superpowers/specs/2026-07-01-subscription-offline-transfer-metadata-design.md docs/superpowers/plans/2026-07-01-subscription-offline-transfer-metadata.md backend/app/services/subscriptions/offline_transfer.py backend/app/services/subscription_service.py backend/tests/test_subscription_offline_transfer.py
git commit -m "refactor: 抽离订阅离线转存元数据解析"
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
