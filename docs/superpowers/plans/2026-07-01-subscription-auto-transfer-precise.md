# Subscription Auto Transfer Precise Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the TV missing-episode precise-transfer success branch from `_auto_save_resources()`.

**Architecture:** Add `backend/app/services/subscriptions/auto_transfer_precise.py` with a callback-based single-record precise-transfer helper. Keep `SubscriptionService._auto_save_resources()` responsible for runtime dependencies, branch selection, database-backed step logs, and the outer error handling path.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Precise Submission Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_precise.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `submit_precise_transfer_record()` from `app.services.subscriptions.auto_transfer_precise`. Use `types.SimpleNamespace` for subscription and record-like objects, fake async callbacks for Pan115 operations, archive post-processing, notifications, logging, upcoming lookup, cleanup policy evaluation, and a selector callback returning simple selection objects.

Required success assertions:

```python
assert record.file_id == "parent-folder"
assert result.saved_increment == 1
assert result.should_stop is True
assert result.should_continue is False
assert result.subscription_completed is True
assert result.cleanup_step == "subscription_cleanup_tv_completed_after_transfer"
assert missing_episodes == set()
assert step_logs[0]["step"] == "tv_record_files_parsed"
assert step_logs[1]["step"] == "tv_transfer_selected_done"
assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
assert events[0]["transfer_type"] == "precise"
```

Add a skip test where the selector returns no selected ids:

```python
assert record.status == "matched"
assert record.completed_at is None
assert record.error_message is None
assert result.saved_increment == 0
assert result.should_continue is True
assert save_calls == []
assert events == []
```

Add an invalid-share-code test expecting:

```python
with pytest.raises(ValueError, match="无效的分享链接，无法提取分享码"):
    asyncio.run(_submit(extracted_share_code=""))
```

Add an event best-effort test that makes the event callback raise and still verifies the helper returns success. Add a dependency-boundary test that rejects direct imports of service/runtime/database/API/model layers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_precise.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_precise'`.

### Task 2: Extract Precise Submission Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_precise.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement `PreciseTransferSubmissionResult` with:

```python
@dataclass(frozen=True)
class PreciseTransferSubmissionResult:
    saved_increment: int
    should_continue: bool
    should_stop: bool
    subscription_completed: bool
    cleanup_step: str
    cleanup_message: str
    cleanup_payload: dict[str, Any]
```

Implement `submit_precise_transfer_record()` with injected callbacks for:

```python
extract_share_code
get_share_all_files_recursive
select_missing_episode_files
save_share_files_directly
apply_postprocess_status
notify_transfer_success
log_operation
create_step_log
emit_transfer_success
normalize_follow_mode
has_upcoming_episodes
evaluate_cleanup
is_video_file
```

Preserve the existing inline branch behavior, including exact step names, operation action names, event payload shape, cleanup metadata keys, and best-effort event emission.

- [ ] **Step 2: Delegate service logic**

Import `submit_precise_transfer_record()` in `backend/app/services/subscription_service.py`. Replace only the `if tv_missing_enabled and is_tv_subscription:` success branch with a call to the helper. Pass:

```python
sub=sub
record=record
source=source
share_link=share_link
receive_code=receive_code
parent_folder_id=parent_folder_id
quality_filter=quality_filter
missing_episodes=missing_episodes
matched_status=MediaStatus.MATCHED
extract_share_code=pan_service._extract_share_code
get_share_all_files_recursive=pan_service.get_share_all_files_recursive
select_missing_episode_files=select_tv_missing_episode_files
save_share_files_directly=pan_service.save_share_files_directly
apply_postprocess_status=self._apply_precise_transfer_postprocess_status
notify_transfer_success=self._notify_transfer_success
log_operation=operation_log_service.log_background_event
create_step_log=create_auto_transfer_step_log
emit_transfer_success=emit_transfer_success
normalize_follow_mode=normalize_tv_follow_mode
has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope
evaluate_cleanup=evaluate_tv_cleanup
is_video_file=self._is_video_filename
trace_id=run_id
```

Then merge returned saved count and cleanup metadata. `continue` when `should_continue` is true and `break` when `should_stop` is true.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_offline.py tests/test_subscription_auto_transfer_context.py tests/test_subscription_tv_episode_selection.py tests/test_subscription_link_fallback.py
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
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/auto_transfer_precise.py backend/tests/test_subscription_auto_transfer_precise.py
git commit -m "refactor: 抽离订阅自动转存精准提交"
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
