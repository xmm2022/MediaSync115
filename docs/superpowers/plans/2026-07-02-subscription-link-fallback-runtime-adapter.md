# 订阅链接回退 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增订阅链接回退 runtime adapter，将 `_auto_save_records_with_link_fallback()` 的默认依赖装配从 `SubscriptionService` 下沉到 `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`。

**Architecture:** `link_fallback_flow.py` 继续保存纯业务流程，`link_fallback_adapter.py` 继续保存 adapter 层依赖转换，新 runtime adapter 负责绑定真实运行时 helper。`SubscriptionService` 保留同名 wrapper 作为 run channel 注入入口，但不再直接 import link fallback flow/adapter 或手动构造 `LinkFallbackAdapterDependencies`。

**Tech Stack:** Python 3.11+, pytest, existing subscription runtime adapters, `scripts/verify-backend.sh`, Docker Compose verification.

---

### Task 1: Runtime Adapter Tests

**Files:**

- Create: `backend/tests/test_subscription_link_fallback_runtime_adapter.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_subscription_link_fallback_runtime_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions import (
    link_fallback_runtime_adapter as runtime_module,
)
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_subscription_resource_urls_with_db_adapter,
)
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.link_fallback_flow import (
    LinkFallbackDependencies,
    auto_save_records_with_link_fallback,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_runtime_adapter_builds_adapter_dependencies_and_forwards_arguments() -> None:
    sub = SimpleNamespace(id=101, title="测试订阅")
    records = [SimpleNamespace(id=201)]
    tv_missing_snapshot = {"missing": True}
    hdhive_unlock_context = {"enabled": True}
    source_order = ["pansou"]
    events: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
    adapter_calls: list[dict[str, Any]] = []

    async def create_step_log(*args: Any, **kwargs: Any) -> None:
        events.append(("create_step_log", args, kwargs))

    async def auto_save_resources(*args: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("auto_save_resources", args, kwargs))
        return {"saved": 1, "failed": 0}

    async def load_subscription_resource_urls(db: Any, subscription_id: int) -> set[str]:
        events.append(("load_subscription_resource_urls", (db, subscription_id), {}))
        return {"https://115.com/s/old"}

    async def fetch_resources(*args: Any, **kwargs: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        events.append(("fetch_resources", args, kwargs))
        return ([{"url": "https://115.com/s/new"}], [], {"summary": "ok"})

    async def store_new_resources(db: Any, subscription_id: int, resources: list[dict[str, Any]]) -> dict[str, Any]:
        events.append(("store_new_resources", (db, subscription_id, resources), {}))
        return {"created_records": [SimpleNamespace(id=301)]}

    async def run_link_fallback(db: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("run_link_fallback", (db,), kwargs))
        return {"saved": 2, "failed": 0}

    async def run_adapter(**kwargs: Any) -> dict[str, Any]:
        adapter_calls.append(kwargs)

        assert kwargs["db"] == "runtime-db"
        assert kwargs["run_id"] == "run-1"
        assert kwargs["channel"] == "all"
        assert kwargs["sub"] is sub
        assert kwargs["records"] is records
        assert kwargs["transfer_source"] == "new"
        assert kwargs["tv_missing_snapshot"] is tv_missing_snapshot
        assert kwargs["hdhive_unlock_context"] is hdhive_unlock_context
        assert kwargs["source_order"] is source_order
        assert kwargs["enable_link_refetch"] is False
        assert kwargs["max_rounds"] == 4

        adapter_dependencies = kwargs["dependencies"]
        assert isinstance(adapter_dependencies, LinkFallbackAdapterDependencies)
        await adapter_dependencies.create_step_log("core-db", step="x")
        assert await adapter_dependencies.auto_save_resources(
            "core-db",
            "run-core",
            "all",
            sub,
            records,
            source="new_fallback",
        ) == {"saved": 1, "failed": 0}
        assert await adapter_dependencies.load_subscription_resource_urls(
            "core-db",
            101,
        ) == {"https://115.com/s/old"}
        assert await adapter_dependencies.fetch_resources(
            "all",
            sub,
            hdhive_unlock_context,
            source_order=source_order,
        ) == ([{"url": "https://115.com/s/new"}], [], {"summary": "ok"})
        assert await adapter_dependencies.store_new_resources(
            "core-db",
            101,
            [{"url": "https://115.com/s/new"}],
        ) == {"created_records": [SimpleNamespace(id=301)]}
        assert await adapter_dependencies.run_link_fallback("flow-db") == {
            "saved": 2,
            "failed": 0,
        }

        return {"saved": 3, "failed": 0}

    result = await runtime_module.auto_save_records_with_link_fallback_with_runtime_adapter(
        db="runtime-db",
        run_id="run-1",
        channel="all",
        sub=sub,
        records=records,
        transfer_source="new",
        dependencies=runtime_module.LinkFallbackRuntimeDependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
            load_subscription_resource_urls=load_subscription_resource_urls,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
            run_adapter=run_adapter,
            run_link_fallback=run_link_fallback,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=False,
        max_rounds=4,
    )

    assert result == {"saved": 3, "failed": 0}
    assert len(adapter_calls) == 1
    assert [event[0] for event in events] == [
        "create_step_log",
        "auto_save_resources",
        "load_subscription_resource_urls",
        "fetch_resources",
        "store_new_resources",
        "run_link_fallback",
    ]


def test_default_runtime_dependencies_bind_existing_helpers_and_runners() -> None:
    dependencies = runtime_module.build_default_link_fallback_runtime_dependencies()

    assert dependencies.create_step_log is runtime_module.create_subscription_step_log
    assert dependencies.auto_save_resources is (
        runtime_module.auto_save_resources_with_default_runtime_dependencies
    )
    assert dependencies.load_subscription_resource_urls is (
        load_subscription_resource_urls_with_db_adapter
    )
    assert dependencies.fetch_resources is (
        runtime_module.fetch_resources_with_default_runtime_dependencies
    )
    assert dependencies.store_new_resources is store_new_resources_with_runtime_adapter
    assert dependencies.run_adapter is auto_save_records_with_link_fallback_with_adapter
    assert dependencies.run_link_fallback is auto_save_records_with_link_fallback


@pytest.mark.asyncio
async def test_default_auto_save_helper_builds_auto_save_runtime_dependencies(monkeypatch: Any) -> None:
    calls: list[dict[str, Any]] = []
    dependencies_marker = object()

    def build_dependencies(**kwargs: Any) -> object:
        calls.append({"builder": kwargs})
        return dependencies_marker

    async def run_auto_save(**kwargs: Any) -> dict[str, Any]:
        calls.append({"runner": kwargs})
        return {"saved": 1}

    monkeypatch.setattr(
        runtime_module,
        "build_default_auto_save_resources_runtime_dependencies",
        build_dependencies,
    )
    monkeypatch.setattr(
        runtime_module,
        "auto_save_resources_with_runtime_adapter",
        run_auto_save,
    )

    result = await runtime_module.auto_save_resources_with_default_runtime_dependencies(
        "db",
        "run-1",
        "all",
        SimpleNamespace(id=1),
        [],
        source="new",
        tv_missing_snapshot={"missing": True},
    )

    assert result == {"saved": 1}
    assert calls[0]["builder"]["resolve_quality_filter"] is (
        runtime_module.resolve_subscription_quality_filter_with_runtime_adapter
    )
    assert calls[0]["builder"]["create_step_log"] is runtime_module.create_subscription_step_log
    assert calls[0]["builder"]["apply_precise_postprocess_status"] is (
        runtime_module.apply_precise_transfer_postprocess_status_with_runtime_adapter
    )
    assert calls[0]["builder"]["notify_transfer_success"] is (
        runtime_module.notify_transfer_success_with_runtime_adapter
    )
    assert calls[1]["runner"]["dependencies"] is dependencies_marker


@pytest.mark.asyncio
async def test_default_fetch_helper_builds_resource_resolver_runtime_dependencies(monkeypatch: Any) -> None:
    calls: list[dict[str, Any]] = []
    dependencies_marker = object()

    def build_dependencies() -> object:
        calls.append({"builder": {}})
        return dependencies_marker

    async def run_fetch(**kwargs: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        calls.append({"runner": kwargs})
        return [], [], {"summary": "ok"}

    monkeypatch.setattr(
        runtime_module,
        "build_default_resource_resolver_runtime_dependencies",
        build_dependencies,
    )
    monkeypatch.setattr(
        runtime_module,
        "fetch_subscription_resources_with_runtime_adapter",
        run_fetch,
    )

    result = await runtime_module.fetch_resources_with_default_runtime_dependencies(
        "all",
        SimpleNamespace(id=1),
        {"unlock": True},
        source_order=["pansou"],
        exclude_urls={"https://115.com/s/old"},
    )

    assert result == ([], [], {"summary": "ok"})
    assert calls[1]["runner"]["dependencies"] is dependencies_marker
    assert calls[1]["runner"]["channel"] == "all"
    assert calls[1]["runner"]["hdhive_unlock_context"] == {"unlock": True}
    assert calls[1]["runner"]["source_order"] == ["pansou"]
    assert calls[1]["runner"]["exclude_urls"] == {"https://115.com/s/old"}


def test_link_fallback_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/link_fallback_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run runtime adapter red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py -q
```

Expected: FAIL during import because `link_fallback_runtime_adapter.py` does not exist.

### Task 2: Service Boundary Test

**Files:**

- Create: `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py`

- [ ] **Step 1: Write failing service boundary test**

Create `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py`:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_link_fallback_adapter_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "LinkFallbackAdapterDependencies",
        "auto_save_records_with_link_fallback_flow",
        "auto_save_records_with_link_fallback_with_adapter",
        "MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS",
    ):
        assert name not in source


def test_subscription_service_uses_link_fallback_runtime_adapter() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _auto_save_records_with_link_fallback" in source
    assert "auto_save_records_with_link_fallback_with_runtime_adapter" in source
    assert "build_default_link_fallback_runtime_dependencies()" in source
```

- [ ] **Step 2: Run boundary red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_link_fallback_runtime_boundary.py -q
```

Expected: FAIL because `subscription_service.py` still imports the link fallback flow/adapter and manually constructs dependencies.

### Task 3: Runtime Adapter Implementation

**Files:**

- Create: `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`

- [ ] **Step 1: Implement runtime adapter**

Create `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    build_default_auto_save_resources_runtime_dependencies,
    auto_save_resources_with_runtime_adapter,
)
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_subscription_resource_urls_with_db_adapter,
)
from app.services.subscriptions.execution_logs import (
    create_step_log as create_subscription_step_log,
)
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.link_fallback_flow import (
    auto_save_records_with_link_fallback,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)


DEFAULT_MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS = 6
RunLinkFallbackAdapter = Callable[..., Awaitable[dict[str, Any]]]
RunLinkFallback = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class LinkFallbackRuntimeDependencies:
    create_step_log: Callable[..., Awaitable[None]]
    auto_save_resources: Callable[..., Awaitable[dict[str, Any]]]
    load_subscription_resource_urls: Callable[[Any, int], Awaitable[set[str]]]
    fetch_resources: Callable[
        ...,
        Awaitable[
            tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
        ],
    ]
    store_new_resources: Callable[
        [Any, int, list[dict[str, Any]]],
        Awaitable[dict[str, Any]],
    ]
    run_adapter: RunLinkFallbackAdapter
    run_link_fallback: RunLinkFallback


async def auto_save_resources_with_default_runtime_dependencies(
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    *,
    source: str,
    tv_missing_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await auto_save_resources_with_runtime_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        source=source,
        dependencies=build_default_auto_save_resources_runtime_dependencies(
            resolve_quality_filter=resolve_subscription_quality_filter_with_runtime_adapter,
            create_step_log=create_subscription_step_log,
            apply_precise_postprocess_status=(
                apply_precise_transfer_postprocess_status_with_runtime_adapter
            ),
            notify_transfer_success=notify_transfer_success_with_runtime_adapter,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
    )


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


def build_default_link_fallback_runtime_dependencies() -> LinkFallbackRuntimeDependencies:
    return LinkFallbackRuntimeDependencies(
        create_step_log=create_subscription_step_log,
        auto_save_resources=auto_save_resources_with_default_runtime_dependencies,
        load_subscription_resource_urls=load_subscription_resource_urls_with_db_adapter,
        fetch_resources=fetch_resources_with_default_runtime_dependencies,
        store_new_resources=store_new_resources_with_runtime_adapter,
        run_adapter=auto_save_records_with_link_fallback_with_adapter,
        run_link_fallback=auto_save_records_with_link_fallback,
    )


async def auto_save_records_with_link_fallback_with_runtime_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    transfer_source: str,
    dependencies: LinkFallbackRuntimeDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    enable_link_refetch: bool = True,
    max_rounds: int = DEFAULT_MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS,
) -> dict[str, Any]:
    return await dependencies.run_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        transfer_source=transfer_source,
        dependencies=LinkFallbackAdapterDependencies(
            create_step_log=dependencies.create_step_log,
            auto_save_resources=dependencies.auto_save_resources,
            load_subscription_resource_urls=(
                dependencies.load_subscription_resource_urls
            ),
            fetch_resources=dependencies.fetch_resources,
            store_new_resources=dependencies.store_new_resources,
            run_link_fallback=dependencies.run_link_fallback,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=enable_link_refetch,
        max_rounds=max_rounds,
    )
```

- [ ] **Step 2: Run runtime adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py -q
```

Expected: PASS.

### Task 4: SubscriptionService Wiring

**Files:**

- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace service-level dependency assembly**

Modify imports in `backend/app/services/subscription_service.py`:

Remove:

```python
from app.services.subscriptions.link_fallback_flow import (
    auto_save_records_with_link_fallback as auto_save_records_with_link_fallback_flow,
)
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
```

Add:

```python
from app.services.subscriptions.link_fallback_runtime_adapter import (
    auto_save_records_with_link_fallback_with_runtime_adapter,
    build_default_link_fallback_runtime_dependencies,
)
```

Remove:

```python
MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS = 6
```

Change `_auto_save_records_with_link_fallback()` body to:

```python
return await auto_save_records_with_link_fallback_with_runtime_adapter(
    db=db,
    run_id=run_id,
    channel=channel,
    sub=sub,
    records=records,
    transfer_source=transfer_source,
    dependencies=build_default_link_fallback_runtime_dependencies(),
    tv_missing_snapshot=tv_missing_snapshot,
    hdhive_unlock_context=hdhive_unlock_context,
    source_order=source_order,
    enable_link_refetch=enable_link_refetch,
)
```

- [ ] **Step 2: Run boundary test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_link_fallback_runtime_boundary.py -q
```

Expected: PASS.

### Task 5: Targeted Verification and Commit

**Files:**

- Created and modified files from Tasks 1-4.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py -q
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run:

```bash
git diff --check
rg -n "LinkFallbackAdapterDependencies|auto_save_records_with_link_fallback_flow|auto_save_records_with_link_fallback_with_adapter|MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected:

- `git diff --check` exits 0.
- `rg` exits 1 with no matches in `subscription_service.py`.
- Line count decreases from 476.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/link_fallback_runtime_adapter.py \
  backend/app/services/subscription_service.py \
  backend/tests/test_subscription_link_fallback_runtime_adapter.py \
  backend/tests/test_subscription_service_link_fallback_runtime_boundary.py
git commit -m "refactor: 下沉订阅链接回退 runtime 依赖装配"
```

### Task 6: Completion Verification

**Files:**

- No file edits.

- [ ] **Step 1: Run related targeted backend tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py -q
```

Expected: PASS.

- [ ] **Step 2: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: PASS.

- [ ] **Step 5: Build and start Docker service**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: command exits 0.

- [ ] **Step 6: Verify Docker health and health endpoint**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected:

- Docker health becomes `healthy`.
- `/healthz` returns `{"status":"healthy"}`.

- [ ] **Step 7: Final workspace check**

Run:

```bash
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

Line count is lower than 476.
