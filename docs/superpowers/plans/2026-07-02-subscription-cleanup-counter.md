# Subscription Cleanup Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cleanup result counter mutation from `SubscriptionService._apply_cleanup_stats()` into the run counter helper module.

**Architecture:** Extend `app.services.subscriptions.run_counters` with `apply_cleanup_stats()`. The helper accepts the caller-provided TV media type sentinel so the helper module stays independent from model enums.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Cleanup Counter Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_counters.py`

- [ ] **Step 1: Extend imports**

Add `apply_cleanup_stats` to the existing import:

```python
from app.services.subscriptions.run_counters import (
    apply_auto_transfer_stats,
    apply_cleanup_stats,
    apply_fixed_source_transfer_stats,
    apply_resource_store_stats,
    apply_subscription_failure,
    increment_processed_count,
    set_checked_count,
)
```

- [ ] **Step 2: Extend the result factory**

Add cleanup fields to `_result()`:

```python
"cleanup_deleted_count": 0,
"cleanup_movie_deleted_count": 0,
"cleanup_tv_deleted_count": 0,
```

- [ ] **Step 3: Add failing tests**

Add these tests before the module-boundary test:

```python
def test_apply_cleanup_stats_counts_tv_cleanup() -> None:
    result = _result()
    tv_media_type = object()

    apply_cleanup_stats(
        result,
        tv_media_type,
        tv_media_type=tv_media_type,
    )

    assert result["cleanup_deleted_count"] == 1
    assert result["cleanup_tv_deleted_count"] == 1
    assert result["cleanup_movie_deleted_count"] == 0


def test_apply_cleanup_stats_counts_non_tv_cleanup_as_movie() -> None:
    result = _result()

    apply_cleanup_stats(
        result,
        object(),
        tv_media_type=object(),
    )

    assert result["cleanup_deleted_count"] == 1
    assert result["cleanup_tv_deleted_count"] == 0
    assert result["cleanup_movie_deleted_count"] == 1
```

- [ ] **Step 4: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py
```

Expected: FAIL during collection with `ImportError` for the missing `apply_cleanup_stats` symbol.

### Task 2: Implement Cleanup Counter Helper

**Files:**
- Modify: `backend/app/services/subscriptions/run_counters.py`

- [ ] **Step 1: Add helper function**

Append this function after `apply_subscription_failure()`:

```python
def apply_cleanup_stats(
    result: dict[str, Any],
    media_type: Any,
    *,
    tv_media_type: Any,
) -> None:
    result["cleanup_deleted_count"] = (
        int(result.get("cleanup_deleted_count") or 0) + 1
    )
    if media_type == tv_media_type:
        result["cleanup_tv_deleted_count"] = (
            int(result.get("cleanup_tv_deleted_count") or 0) + 1
        )
    else:
        result["cleanup_movie_deleted_count"] = (
            int(result.get("cleanup_movie_deleted_count") or 0) + 1
        )
```

- [ ] **Step 2: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py
```

Expected: PASS.

### Task 3: Replace Service Cleanup Counter Method

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper**

Add `apply_cleanup_stats` to the existing `run_counters` import:

```python
apply_cleanup_stats,
```

- [ ] **Step 2: Replace the three call sites**

Replace each:

```python
self._apply_cleanup_stats(result, sub.media_type)
```

with:

```python
apply_cleanup_stats(
    result,
    sub.media_type,
    tv_media_type=MediaType.TV,
)
```

- [ ] **Step 3: Delete `_apply_cleanup_stats()`**

Remove this static method from `SubscriptionService`:

```python
@staticmethod
def _apply_cleanup_stats(result: dict[str, Any], media_type: MediaType) -> None:
    result["cleanup_deleted_count"] = (
        int(result.get("cleanup_deleted_count") or 0) + 1
    )
    if media_type == MediaType.TV:
        result["cleanup_tv_deleted_count"] = (
            int(result.get("cleanup_tv_deleted_count") or 0) + 1
        )
    else:
        result["cleanup_movie_deleted_count"] = (
            int(result.get("cleanup_movie_deleted_count") or 0) + 1
        )
```

- [ ] **Step 4: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py tests/test_subscription_run_completion.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add backend/app/services/subscriptions/run_counters.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_counters.py
git commit -m "refactor: 抽离订阅清理计数器"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py tests/test_subscription_run_completion.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
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

- [ ] **Step 6: Check Docker and HTTP health**

```bash
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true)
  echo "health=$status"
  if [ "$status" = healthy ]; then exit 0; fi
  sleep 2
done
exit 1
```

Then verify:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and Docker health is `healthy`.

- [ ] **Step 7: Confirm final working tree boundary**

```bash
git status --short
```

Expected output only:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```
