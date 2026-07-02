# 订阅 Run Channel Runtime Adapter Implementation Plan

## Goal

把 `SubscriptionService.run_channel_check()` 中 start/dispatch/item-processing/finalize 的 runtime wiring 抽到 `backend/app/services/subscriptions/run_channel_runtime_adapter.py`。

Public behavior remains unchanged:

- `SubscriptionService.run_channel_check()` signature stays the same.
- Channel normalization, start -> dispatch -> finalize ordering, result mutation, progress callback, per-item inner sessions, result lock, statuses, TV media type, and concurrency remain compatible.
- Existing lower flow modules are not modified.

## Current Shape

`SubscriptionService.run_channel_check()` currently:

1. Calls `normalize_subscription_channel(channel)`.
2. Calls `start_subscription_run(...)` with `SubscriptionRunStartDependencies(...)`.
3. Creates `asyncio.Lock()`.
4. Defines `_process_subscription(sub)` that calls `process_subscription_item(...)` with `SubscriptionItemProcessingDependencies(...)`.
5. Calls `dispatch_subscription_checks(...)` with `_SUBSCRIPTION_SCAN_CONCURRENCY`.
6. Calls `finalize_subscription_run(...)` with `RunFinalizeDependencies(...)`.
7. Returns the mutated `result`.

This wiring can move as one adapter without changing lower behavior.

## Target Files

Create:

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- `backend/tests/test_subscription_run_channel_runtime_adapter.py`

Modify:

- `backend/app/services/subscription_service.py`

## Step 1: Red Test

Create `backend/tests/test_subscription_run_channel_runtime_adapter.py`.

Imports:

```python
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.database import async_session_maker
from app.core.timezone_utils import beijing_now
from app.models.models import ExecutionStatus, MediaType
from app.services.operation_log_service import operation_log_service
from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)
from app.services.subscriptions.run_channel_runtime_adapter import (
    RunChannelRuntimeDependencies,
    build_default_run_channel_runtime_dependencies,
    run_channel_check_with_runtime_adapter,
)
from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
from app.services.subscriptions.run_loader import load_active_subscription_snapshots
from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)
```

Test cases:

1. `test_runtime_adapter_wires_start_dispatch_process_and_finalize`
   - Build fake callbacks for all runtime dependencies.
   - Fake `run_start` asserts it receives normalized channel, force flag, progress callback, and `SubscriptionRunStartDependencies`.
   - Fake `run_start` calls selected start dependencies (`now`, `make_run_id`, `build_hdhive_unlock_context`, `resolve_source_order`, `load_active_subscriptions`) to prove the lower dependency object is populated from runtime callbacks.
   - Fake `dispatch_checks` asserts it receives `SubscriptionRunDispatchDependencies` and requested concurrency, then invokes `dependencies.process_subscription(sub)`.
   - Fake `process_item` asserts it receives:
     - run id from start result
     - normalized channel
     - force flag
     - hdhive context and source order from start result
     - same mutable result dict
     - result lock from `make_result_lock`
     - same progress callback
     - TV media type from runtime dependencies
     - `SubscriptionItemProcessingDependencies` containing the supplied service callbacks
   - Fake `finalize_run` asserts it receives:
     - normalized channel
     - run id, result, started_at, hdhive context from start result
     - success/failed/partial statuses from runtime dependencies
     - `RunFinalizeDependencies` containing log and persistence callbacks
   - Assert returned value is the same result dict and event order is `start -> dispatch -> process -> finalize`.

2. `test_default_runtime_dependencies_bind_existing_services_and_runners`
   - Call `build_default_run_channel_runtime_dependencies(...)` with marker service callbacks.
   - Assert default binding:
     - `log_background_event` is bound to `operation_log_service`.
     - `load_active_subscriptions is load_active_subscription_snapshots`.
     - `session_factory is async_session_maker`.
     - `now is beijing_now`.
     - `make_run_id()` returns a 32-character hex string.
     - `make_result_lock is asyncio.Lock`.
     - statuses are `ExecutionStatus.SUCCESS/FAILED/PARTIAL`.
     - `tv_media_type is MediaType.TV`.
     - runners are existing lower flow functions.
     - supplied service callbacks are preserved by identity.

3. `test_run_channel_runtime_adapter_module_boundary`
   - Read `run_channel_runtime_adapter.py`.
   - Assert it does not import `subscription_service`, `app.api`, or `AsyncSession`.

Expected red command:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py -q
```

Expected failure:

```text
ModuleNotFoundError: No module named 'app.services.subscriptions.run_channel_runtime_adapter'
```

## Step 2: Implement Adapter

Create `backend/app/services/subscriptions/run_channel_runtime_adapter.py`.

Structure:

```python
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

from app.core.database import async_session_maker
from app.core.timezone_utils import beijing_now
from app.models.models import ExecutionStatus, MediaType
from app.services.operation_log_service import operation_log_service
from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)
from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
from app.services.subscriptions.run_loader import load_active_subscription_snapshots
from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)
from app.services.subscriptions.run_summary import normalize_subscription_channel
```

Define type aliases for callbacks where useful:

- `LogBackgroundEvent`
- `CreateExecutionLog`
- `CreateStepLog`
- `PruneStepLogs`
- `LoadActiveSubscriptions`
- `BuildHdhiveUnlockContext`
- `ResolveSourceOrder`
- `SessionFactory`
- `EvaluatePreScanCleanup`
- `FetchResources`
- `StoreNewResources`
- `LoadRetryableRecords`
- `LoadForceRetryRecords`
- `AutoSaveRecordsWithLinkFallback`
- `ShouldScanFixedSources`
- `ScanFixedSourcesForSubscription`
- `DeleteSubscriptionWithRecords`
- `Now`
- `MakeRunId`
- `MakeResultLock`
- lower runner aliases

Dataclass:

```python
@dataclass(frozen=True, slots=True)
class RunChannelRuntimeDependencies:
    log_background_event: LogBackgroundEvent
    create_execution_log: CreateExecutionLog
    create_step_log: CreateStepLog
    prune_step_logs: PruneStepLogs
    load_active_subscriptions: LoadActiveSubscriptions
    build_hdhive_unlock_context: BuildHdhiveUnlockContext
    resolve_source_order: ResolveSourceOrder
    session_factory: SessionFactory
    evaluate_pre_scan_cleanup: EvaluatePreScanCleanup
    fetch_resources: FetchResources
    store_new_resources: StoreNewResources
    load_retryable_records: LoadRetryableRecords
    load_force_retry_records: LoadForceRetryRecords
    auto_save_records_with_link_fallback: AutoSaveRecordsWithLinkFallback
    should_scan_fixed_sources: ShouldScanFixedSources
    scan_fixed_sources_for_subscription: ScanFixedSourcesForSubscription
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    now: Now
    make_run_id: MakeRunId
    make_result_lock: MakeResultLock
    success_status: Any
    failed_status: Any
    partial_status: Any
    tv_media_type: Any
    run_start: RunStart
    dispatch_checks: DispatchChecks
    process_item: ProcessItem
    finalize_run: FinalizeRun
```

Default builder:

```python
def build_default_run_channel_runtime_dependencies(
    *,
    create_execution_log: CreateExecutionLog,
    create_step_log: CreateStepLog,
    prune_step_logs: PruneStepLogs,
    build_hdhive_unlock_context: BuildHdhiveUnlockContext,
    resolve_source_order: ResolveSourceOrder,
    evaluate_pre_scan_cleanup: EvaluatePreScanCleanup,
    fetch_resources: FetchResources,
    store_new_resources: StoreNewResources,
    load_retryable_records: LoadRetryableRecords,
    load_force_retry_records: LoadForceRetryRecords,
    auto_save_records_with_link_fallback: AutoSaveRecordsWithLinkFallback,
    should_scan_fixed_sources: ShouldScanFixedSources,
    scan_fixed_sources_for_subscription: ScanFixedSourcesForSubscription,
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
) -> RunChannelRuntimeDependencies:
    return RunChannelRuntimeDependencies(
        log_background_event=operation_log_service.log_background_event,
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        load_active_subscriptions=load_active_subscription_snapshots,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        resolve_source_order=resolve_source_order,
        session_factory=async_session_maker,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        fetch_resources=fetch_resources,
        store_new_resources=store_new_resources,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=auto_save_records_with_link_fallback,
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
        now=beijing_now,
        make_run_id=lambda: uuid4().hex,
        make_result_lock=asyncio.Lock,
        success_status=ExecutionStatus.SUCCESS,
        failed_status=ExecutionStatus.FAILED,
        partial_status=ExecutionStatus.PARTIAL,
        tv_media_type=MediaType.TV,
        run_start=start_subscription_run,
        dispatch_checks=dispatch_subscription_checks,
        process_item=process_subscription_item,
        finalize_run=finalize_subscription_run,
    )
```

Adapter wrapper:

```python
async def run_channel_check_with_runtime_adapter(
    *,
    db: Any,
    channel: str,
    force_auto_download: bool,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None,
    concurrency: int,
    dependencies: RunChannelRuntimeDependencies,
) -> dict[str, Any]:
    normalized_channel = normalize_subscription_channel(channel)
    run_start = await dependencies.run_start(
        db=db,
        channel=normalized_channel,
        force_auto_download=force_auto_download,
        progress_callback=progress_callback,
        dependencies=SubscriptionRunStartDependencies(...),
    )

    result_lock = dependencies.make_result_lock()

    async def process_subscription(sub: Any) -> None:
        await dependencies.process_item(
            sub=sub,
            run_id=run_start.run_id,
            channel=normalized_channel,
            force_auto_download=force_auto_download,
            hdhive_unlock_context=run_start.hdhive_unlock_context,
            source_order=run_start.source_order,
            result=run_start.result,
            result_lock=result_lock,
            progress_callback=progress_callback,
            tv_media_type=dependencies.tv_media_type,
            dependencies=SubscriptionItemProcessingDependencies(...),
        )

    await dependencies.dispatch_checks(
        subscriptions=run_start.subscriptions,
        concurrency=concurrency,
        dependencies=SubscriptionRunDispatchDependencies(
            process_subscription=process_subscription,
        ),
    )

    await dependencies.finalize_run(
        db=db,
        channel=normalized_channel,
        run_id=run_start.run_id,
        result=run_start.result,
        started_at=run_start.started_at,
        hdhive_unlock_context=run_start.hdhive_unlock_context,
        success_status=dependencies.success_status,
        failed_status=dependencies.failed_status,
        partial_status=dependencies.partial_status,
        dependencies=RunFinalizeDependencies(...),
    )
    return run_start.result
```

## Step 3: Wire SubscriptionService

Modify imports in `backend/app/services/subscription_service.py`:

Add:

```python
from app.services.subscriptions.run_channel_runtime_adapter import (
    build_default_run_channel_runtime_dependencies,
    run_channel_check_with_runtime_adapter,
)
```

Remove direct imports no longer needed by `SubscriptionService`:

- `uuid4`
- `beijing_now`
- top-level `MediaType`
- `async_session_maker`
- `SubscriptionItemProcessingDependencies`
- `process_subscription_item`
- `RunFinalizeDependencies`
- `finalize_subscription_run`
- `SubscriptionRunStartDependencies`
- `start_subscription_run`
- `SubscriptionRunDispatchDependencies`
- `dispatch_subscription_checks`

Keep:

- `asyncio` if still used elsewhere.
- `ExecutionStatus` because `_create_execution_log()` type annotation still uses it.
- `_SUBSCRIPTION_SCAN_CONCURRENCY`.

Replace `run_channel_check()` body with:

```python
return await run_channel_check_with_runtime_adapter(
    db=db,
    channel=channel,
    force_auto_download=force_auto_download,
    progress_callback=progress_callback,
    concurrency=_SUBSCRIPTION_SCAN_CONCURRENCY,
    dependencies=build_default_run_channel_runtime_dependencies(
        create_execution_log=self._create_execution_log,
        create_step_log=self._create_step_log,
        prune_step_logs=self._prune_step_logs,
        build_hdhive_unlock_context=self._build_hdhive_unlock_context,
        resolve_source_order=self._resolve_source_order,
        evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup,
        fetch_resources=self._fetch_resources,
        store_new_resources=self._store_new_resources,
        load_retryable_records=self._load_retryable_records,
        load_force_retry_records=self._load_force_retry_records,
        auto_save_records_with_link_fallback=(
            self._auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=self._should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=(
            self._scan_fixed_sources_for_subscription
        ),
        delete_subscription_with_records=(
            self._delete_subscription_with_records
        ),
    ),
)
```

## Step 4: Green Tests

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py -q
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_run_start_flow.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_run_finalize_flow.py -q
```

If failures occur, use the failure trace to identify whether the mismatch is:

- adapter calling order,
- missing callback identity,
- wrong normalized channel,
- wrong status/media constant,
- or import cleanup in `SubscriptionService`.

Do not change lower flow behavior to satisfy adapter tests.

## Step 5: Pre-Commit Checks

Run:

```bash
git diff --check
rg -n "start_subscription_run|dispatch_subscription_checks|finalize_subscription_run|process_subscription_item|SubscriptionRunStartDependencies|SubscriptionRunDispatchDependencies|RunFinalizeDependencies|SubscriptionItemProcessingDependencies|beijing_now|uuid4|async_session_maker" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected scan behavior:

- No direct start/dispatch/finalize/item-processing imports or calls remain in `subscription_service.py`.
- `ExecutionStatus` may remain.
- `asyncio` should remain only if still needed by other methods; remove it if no longer referenced.

Commit:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py
git commit -m "refactor: 抽离订阅 run channel runtime adapter"
```

## Step 6: Completion Verification

After implementation commit, run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_run_start_flow.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_run_finalize_flow.py -q
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

- Related targeted tests pass.
- Backend full test suite passes.
- Frontend build passes; Vite chunk-size warning is acceptable.
- Quick verify passes.
- Container starts and becomes healthy.
- `/healthz` returns `{"status":"healthy"}`.
- `git status --short` only shows:
  - `?? backend/scripts/export_hdhive_189_links.py`
  - `?? docs/next-session-prompt.md`

## Risk Notes

- The highest regression risk is accidentally changing the object identity of `result`, `result_lock`, progress callback, hdhive context, or source order. Tests should assert identity where possible.
- Do not hide `_SUBSCRIPTION_SCAN_CONCURRENCY` inside the adapter in this step; service should pass it explicitly.
- Do not move lower flow logic into the adapter. The adapter should only construct dependency dataclasses and call existing runners.
