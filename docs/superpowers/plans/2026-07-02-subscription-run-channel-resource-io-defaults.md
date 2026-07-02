# 订阅 Run Channel 资源 IO 默认依赖装配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 run channel 默认依赖 builder 自己装配资源抓取和资源入库 runtime helper，并清理服务层对应 callback 传递。

**Architecture:** `run_channel_runtime_adapter` 增加一个资源抓取默认 helper，并把 `fetch_resources`、`store_new_resources` builder 参数改为可选。`SubscriptionService.run_channel_check()` 不再传这两个 callback，服务层删除只剩 run channel 使用的 `_store_new_resources()`，但保留仍被手动抓取和 explore 路径引用的 `_fetch_resources()`。

**Tech Stack:** Python 3.11+, pytest, existing subscription runtime adapters, `scripts/verify-backend.sh`, Docker Compose verification.

---

### Task 1: Run Channel Runtime Adapter Red Tests

**Files:**

- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`

- [ ] **Step 1: Import module and storage helper**

Add imports near the existing run channel imports:

```python
from app.services.subscriptions import (
    run_channel_runtime_adapter as run_channel_runtime_module,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
```

- [ ] **Step 2: Update service wrapper boundary expectations**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency`, remove these two entries from the bound method assertion map:

```python
"fetch_resources": "_fetch_resources",
"store_new_resources": "_store_new_resources",
```

Then add this assertion after the loop:

```python
assert "fetch_resources" not in builder_kwargs
assert "store_new_resources" not in builder_kwargs
```

- [ ] **Step 3: Add default resource IO builder red test**

Add this test before `test_run_channel_runtime_adapter_module_boundary`:

```python
def test_default_runtime_dependencies_bind_resource_io_defaults_without_service_callbacks() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    def build_hdhive_unlock_context() -> dict[str, Any]:
        return {}

    def resolve_source_order(_channel: str) -> list[str]:
        return ["hdhive"]

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        resolve_source_order=resolve_source_order,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.fetch_resources is (
        run_channel_runtime_module.fetch_resources_with_default_runtime_dependencies
    )
    assert dependencies.store_new_resources is store_new_resources_with_runtime_adapter
```

- [ ] **Step 4: Add default fetch helper red test**

Add this test after the default resource IO builder test:

```python
@pytest.mark.asyncio
async def test_default_resource_fetch_helper_builds_resource_resolver_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = SimpleNamespace(id=1, title="示例订阅")
    dependencies_marker = object()
    marker = ([{"name": "资源"}], [{"trace": "ok"}], {"summary": "ok"})
    calls: list[dict[str, Any]] = []

    def fake_builder() -> object:
        calls.append({"builder": True})
        return dependencies_marker

    async def fake_fetch_subscription_resources_with_runtime_adapter(
        **kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        calls.append({"fetch": kwargs})
        return marker

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_resource_resolver_runtime_dependencies",
        fake_builder,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "fetch_subscription_resources_with_runtime_adapter",
        fake_fetch_subscription_resources_with_runtime_adapter,
    )

    result = await run_channel_runtime_module.fetch_resources_with_default_runtime_dependencies(
        "all",
        sub,
        {"enabled": True},
        source_order=["hdhive"],
        exclude_urls={"https://115.com/s/old"},
    )

    assert result is marker
    assert calls == [
        {"builder": True},
        {
            "fetch": {
                "channel": "all",
                "sub": sub,
                "dependencies": dependencies_marker,
                "hdhive_unlock_context": {"enabled": True},
                "source_order": ["hdhive"],
                "exclude_urls": {"https://115.com/s/old"},
            }
        },
    ]
```

- [ ] **Step 5: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_resource_io_defaults_without_service_callbacks -q
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_default_resource_fetch_helper_builds_resource_resolver_runtime_dependencies -q
```

Expected:

- First command fails with `TypeError` because `fetch_resources` and `store_new_resources` are still required builder parameters.
- Second command fails with `AttributeError` because `fetch_resources_with_default_runtime_dependencies` does not exist.

### Task 2: Service Boundary Red Test

**Files:**

- Create: `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`

- [ ] **Step 1: Write failing boundary test**

Create `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_run_channel_drops_resource_io_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")
    run_channel_start = source.index("    async def run_channel_check")
    run_channel_end = source.index("    async def _create_step_log", run_channel_start)
    run_channel_source = source[run_channel_start:run_channel_end]

    assert "fetch_resources=self._fetch_resources" not in run_channel_source
    assert "store_new_resources=self._store_new_resources" not in run_channel_source
    assert "async def _store_new_resources" not in source


def test_fetch_resources_wrapper_stays_for_existing_callers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" in source
```

- [ ] **Step 2: Run boundary red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_run_channel_resource_io_boundary.py -q
```

Expected: FAIL because `run_channel_check()` still passes both resource IO callbacks and `_store_new_resources()` still exists.

### Task 3: Implement Runtime Defaults

**Files:**

- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import runtime helpers**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
```

- [ ] **Step 2: Add default fetch helper**

Add after `RunChannelRuntimeDependencies`:

```python
async def fetch_resources_with_default_runtime_dependencies(
    channel: str,
    sub: Any,
    hdhive_unlock_context: dict[str, Any] | None = None,
    *,
    source_order: list[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await fetch_subscription_resources_with_runtime_adapter(
        channel=channel,
        sub=sub,
        dependencies=build_default_resource_resolver_runtime_dependencies(),
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )
```

- [ ] **Step 3: Make resource IO builder args optional**

Change the builder signature entries:

```python
fetch_resources: FetchResources | None = None,
store_new_resources: StoreNewResources | None = None,
```

Change the returned dependencies:

```python
fetch_resources=(
    fetch_resources
    if fetch_resources is not None
    else fetch_resources_with_default_runtime_dependencies
),
store_new_resources=(
    store_new_resources
    if store_new_resources is not None
    else store_new_resources_with_runtime_adapter
),
```

- [ ] **Step 4: Simplify service builder call and delete wrapper**

In `backend/app/services/subscription_service.py`, remove these arguments from `build_default_run_channel_runtime_dependencies()`:

```python
fetch_resources=self._fetch_resources,
store_new_resources=self._store_new_resources,
```

Delete the `_store_new_resources()` method:

```python
async def _store_new_resources(
    self,
    db: AsyncSession,
    subscription_id: int,
    resources: list[dict[str, Any]],
) -> dict[str, Any]:
    return await store_new_resources_with_runtime_adapter(
        db,
        subscription_id,
        resources,
    )
```

Remove this import:

```python
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
```

### Task 4: Verify and Commit

**Files:**

- Modified files from Tasks 1-3

- [ ] **Step 1: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_storage_runtime_adapter.py tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_fetch_resources_waterfall.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Run static checks**

Run:

```bash
git diff --check
rg -n "fetch_resources=self\\._fetch_resources|store_new_resources=self\\._store_new_resources|async def _store_new_resources|store_new_resources_with_runtime_adapter" backend/app/services/subscription_service.py
```

Expected:

- `git diff --check` exits 0.
- `rg` exits 1 with no matches for the removed service-level resource IO wiring/imports.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_run_channel_resource_io_boundary.py
git commit -m "refactor: 下沉订阅 run channel 资源 IO 默认依赖装配"
```

- [ ] **Step 4: Run full completion gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_storage_runtime_adapter.py tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_fetch_resources_waterfall.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
```

Then confirm:

```bash
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- Docker status is `running healthy`.
- `git status --short` only shows the two allowed untracked files.
