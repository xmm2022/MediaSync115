# Subscription Resource Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure subscription resource candidate helpers from `SubscriptionService` into a focused service module.

**Architecture:** Add `backend/app/services/subscriptions/resource_candidates.py` with deterministic helper functions and keep `SubscriptionService` private methods as compatibility wrappers. Tests cover both direct module behavior and the old wrapper surface.

**Tech Stack:** Python 3.13 test environment, FastAPI backend, pytest, existing `scripts/verify-backend.sh` and Docker Compose deployment.

---

### Task 1: Direct Resource Candidate Module Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_candidates.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

from app.models.models import MediaType
from app.services.subscriptions.resource_candidates import (
    extract_offline_url,
    extract_resource_url,
    filter_resources_excluding_urls,
    merge_auto_save_stats,
    resource_candidate_url,
    should_continue_link_fallback,
)


def test_extract_resource_url_normalizes_115cdn_and_strips_fragment() -> None:
    assert (
        extract_resource_url({"share_link": "https://115cdn.com/s/abc123#frag"})
        == "https://115.com/s/abc123"
    )


def test_resource_candidate_url_falls_back_to_offline_url() -> None:
    item = {"magnet": "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12"}

    assert extract_offline_url(item).startswith("magnet:")
    assert resource_candidate_url(item).startswith("magnet:")


def test_filter_resources_excluding_urls_uses_candidate_url() -> None:
    resources = [
        {"share_link": "https://115.com/s/old"},
        {"magnet": "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12"},
    ]

    filtered = filter_resources_excluding_urls(resources, {"https://115.com/s/old"})

    assert filtered == [resources[1]]


def test_merge_auto_save_stats_carries_cleanup_and_remaining_missing() -> None:
    target = {
        "saved": 0,
        "failed": 1,
        "errors": [{"error": "old"}],
        "subscription_completed": False,
        "cleanup_step": "",
        "cleanup_message": "",
        "cleanup_payload": {},
        "remaining_missing_count": None,
    }

    merge_auto_save_stats(
        target,
        {
            "saved": 2,
            "failed": 0,
            "errors": [{"error": "new"}],
            "subscription_completed": True,
            "cleanup_step": "cleanup",
            "cleanup_message": "done",
            "cleanup_payload": {"deleted": True},
            "remaining_missing_count": 0,
        },
    )

    assert target["saved"] == 2
    assert target["failed"] == 1
    assert target["errors"] == [{"error": "old"}, {"error": "new"}]
    assert target["subscription_completed"] is True
    assert target["cleanup_step"] == "cleanup"
    assert target["remaining_missing_count"] == 0


def test_should_continue_link_fallback_keeps_tv_missing_rounds() -> None:
    assert should_continue_link_fallback(
        MediaType.TV,
        {"saved": 1, "subscription_completed": False, "remaining_missing_count": 2},
        attempted_count=1,
    )
    assert not should_continue_link_fallback(
        MediaType.TV,
        {"saved": 1, "subscription_completed": False, "remaining_missing_count": 0},
        attempted_count=1,
    )
```

- [ ] **Step 2: Run tests to verify RED**

Run: `scripts/verify-backend.sh -- tests/test_subscription_resource_candidates.py`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions'`.

### Task 2: Extract Candidate Helpers

**Files:**
- Create: `backend/app/services/subscriptions/__init__.py`
- Create: `backend/app/services/subscriptions/resource_candidates.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement module functions**

Move the existing helper behavior into functions named in Task 1.

- [ ] **Step 2: Keep service wrappers**

Update `SubscriptionService._normalize_share_url`, `_extract_resource_url`, `_extract_offline_url`, `_resource_candidate_url`, `_filter_resources_excluding_urls`, `_merge_auto_save_stats`, and `_should_continue_link_fallback` to delegate to the new module.

- [ ] **Step 3: Run targeted tests**

Run: `scripts/verify-backend.sh -- tests/test_subscription_resource_candidates.py tests/test_subscription_link_fallback.py`

Expected: all selected tests pass.

### Task 3: Boundary Test And Verification

**Files:**
- Modify: `backend/tests/test_subscription_resource_candidates.py`

- [ ] **Step 1: Add dependency boundary test**

Assert `backend/app/services/subscriptions/resource_candidates.py` does not import `subscription_service` or `app.api`.

- [ ] **Step 2: Run backend checks**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_candidates.py tests/test_subscription_link_fallback.py tests/test_fetch_resources_waterfall.py
scripts/verify-backend.sh --quick
scripts/verify.sh --quick
git diff --check
```

Expected: all commands exit 0.

### Task 4: Commit And Deploy

**Files:**
- Commit only the design, plan, new module, updated service, and tests.

- [ ] **Step 1: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-07-01-subscription-resource-candidates-design.md docs/superpowers/plans/2026-07-01-subscription-resource-candidates.md backend/app/services/subscriptions/__init__.py backend/app/services/subscriptions/resource_candidates.py backend/app/services/subscription_service.py backend/tests/test_subscription_resource_candidates.py
git commit -m "refactor: 抽离订阅资源候选辅助逻辑"
```

- [ ] **Step 2: Rebuild and health check**

Run:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
```

Expected: health endpoint returns `{"status":"healthy"}` and Docker health is `healthy`.
