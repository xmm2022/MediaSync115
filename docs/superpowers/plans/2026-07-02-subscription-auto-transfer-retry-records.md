# Subscription Auto Transfer Retry Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract auto-transfer retry record selection from `SubscriptionService.run_channel_check()` into a small dependency-injected helper.

**Architecture:** Add `app.services.subscriptions.auto_transfer_retry_records` for async record loading orchestration plus existing `record_selection` merge/exclude rules. Keep `run_channel_check()` responsible for `should_auto_download`, new/retry transfer execution, logs, result counters, cleanup, transactions, and errors.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Retry Record Selection Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_retry_records.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `select_auto_transfer_retry_records(...)` loads ordinary retryable records only when `auto_download=True`.
- It removes records whose `resource_url` is present in `created_records`.
- It loads force retry records when `force_auto_download=True` and `duplicate_urls` is non-empty, even if `auto_download=False`.
- When both loaders run, it preserves existing `merge_records()` order and de-duplicates by id/url.
- It skips the force loader when `duplicate_urls` is empty.
- Module boundary stays free of runtime settings, DB sessions, models, external service clients, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_retry_records.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_retry_records'`.

### Task 2: Implement Helper Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_retry_records.py`

- [ ] **Step 1: Define dependencies dataclass**

Implement `AutoTransferRetryRecordDependencies` with:

- `load_retryable_records(db, subscription_id)`
- `load_force_retry_records(db, subscription_id, duplicate_urls)`

- [ ] **Step 2: Implement selector**

Implement `select_auto_transfer_retry_records(...)`:

- initialize retry records as an empty list
- load ordinary retry records only when `auto_download` is true
- load force retry records only when `force_auto_download` is true and `duplicate_urls` is non-empty
- combine with `merge_records()`
- return `exclude_new_records(retry_records, created_records)`

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper**

Import:

- `AutoTransferRetryRecordDependencies`
- `select_auto_transfer_retry_records`

Remove direct imports of `merge_records` and `exclude_new_records` if unused after wiring.

- [ ] **Step 2: Replace inline retry selection**

Inside `if should_auto_download:`, replace only the retry record loading/merge/exclude block with the helper call. Inject existing service methods:

- `self._load_retryable_records`
- `self._load_force_retry_records`

Do not move new transfer execution, retry transfer execution, logs, result counters, cleanup, transaction handling, or error handling.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_record_selection.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm the service change only delegates retry selection and removes now-unused imports.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/auto_transfer_retry_records.py backend/tests/test_subscription_auto_transfer_retry_records.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅自动转存重试记录选择"
```

### Task 5: Full Completion Standard

- [ ] **Step 1: Backend full verification**

```bash
scripts/verify-backend.sh
```

- [ ] **Step 2: Frontend build**

```bash
npm --prefix frontend run build
```

- [ ] **Step 3: Quick repository verification**

```bash
scripts/verify.sh --quick
```

- [ ] **Step 4: Docker rebuild and health**

```bash
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected final status: only the two known untracked files remain:

- `backend/scripts/export_hdhive_189_links.py`
- `docs/next-session-prompt.md`
