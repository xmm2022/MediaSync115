# 订阅固定来源扫描 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move fixed-source scan runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.fixed_source_scan_runtime_adapter` to bind manual-source querying, Pan115 runtime construction, default folder lookup, TV missing status, manual source scanning, step logging, and the existing pure `fixed_source_scan.scan_fixed_sources_for_subscription()` helper. Keep `fixed_source_scan.py` dependency-injected and keep `SubscriptionService._scan_fixed_sources_for_subscription()` as a compatibility wrapper.

**Tech Stack:** Python 3.13, pytest, SQLAlchemy select builder, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder for ORM model, source type, select builder, runtime settings, Pan115, TV missing service, source scanner, and core runner.
  - Runtime wrapper that translates runtime dependencies into `FixedSourceScanDependencies`.
- Create: `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`
  - Red/green tests for lower dependency translation, query shape, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_scan_fixed_sources_for_subscription()` to the runtime adapter.
  - Remove direct imports of `Pan115Service`, `SubscriptionSource`, `MANUAL_PAN115_SOURCE`, and `subscription_source_service`.
  - Keep `runtime_settings_service` and `tv_missing_service` imports if other wrappers still use them.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select

from app.models.models import SubscriptionSource
from app.services.pan115_service import Pan115Service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscription_source_service import (
    MANUAL_PAN115_SOURCE,
    subscription_source_service,
)
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription,
)
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    FixedSourceScanRuntimeDependencies,
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
from app.services.tv_missing_service import tv_missing_service


ROOT = Path(__file__).resolve().parents[2]


class _Scalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _ExecuteResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _Scalars:
        return _Scalars(self._rows)


class _FakeDb:
    def __init__(self, rows: list[Any]) -> None:
        self.rows = rows
        self.statements: list[Any] = []

    async def execute(self, statement: Any) -> _ExecuteResult:
        self.statements.append(statement)
        return _ExecuteResult(self.rows)


def _dependencies(**overrides: Any) -> FixedSourceScanRuntimeDependencies:
    async def get_tv_missing_status(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"status": "ok", "missing_episodes": []}

    async def scan_manual_source(_db: Any, **kwargs: Any) -> dict[str, Any]:
        return {"status": "success", "kwargs": kwargs}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        _ = kwargs

    async def run_scan_fixed_sources_for_subscription(
        *args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return {"runner": {"args": args, "kwargs": kwargs}}

    values: dict[str, Any] = {
        "manual_source_type": "manual_pan115_test",
        "source_model": SubscriptionSource,
        "run_select": select,
        "get_pan115_cookie": lambda: "cookie-value",
        "create_pan_service": lambda cookie: {"cookie": cookie},
        "get_pan115_default_folder": lambda: {"folder_id": "parent-folder"},
        "resolve_quality_filter": lambda sub: {"title": sub.title},
        "get_tv_missing_status": get_tv_missing_status,
        "scan_manual_source": scan_manual_source,
        "create_step_log": create_step_log,
        "run_scan_fixed_sources_for_subscription": (
            run_scan_fixed_sources_for_subscription
        ),
    }
    values.update(overrides)
    return FixedSourceScanRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_arguments() -> None:
    source = SimpleNamespace(id=31)
    db = _FakeDb([source])
    sub = SimpleNamespace(id=101, title="固定来源订阅")
    tv_missing_snapshot = {"status": "ok"}
    events: list[tuple[str, Any]] = []
    runner_calls: list[dict[str, Any]] = []

    async def get_tv_missing_status(tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
        events.append(("tv_missing", tmdb_id, kwargs))
        return {"status": "ok"}

    async def scan_manual_source(current_db: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("scan", current_db, kwargs))
        return {"status": "success", "transferred_count": 1}

    async def create_step_log(current_db: Any, **kwargs: Any) -> None:
        events.append(("step", current_db, kwargs))

    async def run_scan_fixed_sources_for_subscription(
        db_arg: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        kwargs["db"] = db_arg
        runner_calls.append(kwargs)
        lower_dependencies = kwargs["dependencies"]
        assert isinstance(lower_dependencies, FixedSourceScanDependencies)

        sources = await lower_dependencies.list_enabled_manual_sources(
            kwargs["db"],
            101,
        )
        assert sources == [source]
        assert len(db.statements) == 1
        compiled = db.statements[0].compile()
        assert compiled.params == {
            "subscription_id_1": 101,
            "source_type_1": "manual_pan115_test",
        }
        assert "subscription_sources.enabled IS true" in str(compiled)

        assert lower_dependencies.create_pan_service() == {
            "cookie": "cookie-value"
        }
        assert lower_dependencies.get_parent_folder_id() == "parent-folder"
        assert lower_dependencies.resolve_quality_filter(sub) == {
            "title": "固定来源订阅"
        }
        assert await lower_dependencies.get_tv_missing_status(
            9001,
            include_specials=True,
        ) == {"status": "ok"}
        assert await lower_dependencies.scan_manual_source(
            "db-2",
            source=source,
        ) == {"status": "success", "transferred_count": 1}
        await lower_dependencies.create_step_log("db-3", step="fixed")
        return {"saved": 1, "failed": 0, "checked": 1}

    result = await scan_fixed_sources_with_runtime_adapter(
        db=db,
        run_id="run-1",
        channel="all",
        sub=sub,
        dependencies=_dependencies(
            get_tv_missing_status=get_tv_missing_status,
            scan_manual_source=scan_manual_source,
            create_step_log=create_step_log,
            run_scan_fixed_sources_for_subscription=(
                run_scan_fixed_sources_for_subscription
            ),
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        force_auto_download=True,
    )

    assert result == {"saved": 1, "failed": 0, "checked": 1}
    assert len(runner_calls) == 1
    assert runner_calls[0]["db"] is db
    assert runner_calls[0]["run_id"] == "run-1"
    assert runner_calls[0]["channel"] == "all"
    assert runner_calls[0]["sub"] is sub
    assert runner_calls[0]["tv_missing_snapshot"] is tv_missing_snapshot
    assert runner_calls[0]["force_auto_download"] is True
    assert events == [
        ("tv_missing", 9001, {"include_specials": True}),
        ("scan", "db-2", {"source": source}),
        ("step", "db-3", {"step": "fixed"}),
    ]


@pytest.mark.asyncio
async def test_runtime_adapter_parent_folder_defaults_to_zero() -> None:
    async def run_scan_fixed_sources_for_subscription(
        _db_arg: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        lower_dependencies = kwargs["dependencies"]
        assert lower_dependencies.get_parent_folder_id() == "0"
        return {"saved": 0, "failed": 0, "checked": 0}

    result = await scan_fixed_sources_with_runtime_adapter(
        db=_FakeDb([]),
        run_id="run-2",
        channel="all",
        sub=SimpleNamespace(id=102, title="无目录"),
        dependencies=_dependencies(
            get_pan115_default_folder=lambda: {},
            run_scan_fixed_sources_for_subscription=(
                run_scan_fixed_sources_for_subscription
            ),
        ),
    )

    assert result == {"saved": 0, "failed": 0, "checked": 0}


def test_default_runtime_dependencies_bind_existing_runtime_services() -> None:
    async def create_step_log(*_args: Any, **_kwargs: Any) -> None:
        return None

    dependencies = build_default_fixed_source_scan_runtime_dependencies(
        resolve_quality_filter=lambda _sub: {},
        create_step_log=create_step_log,
    )

    assert dependencies.manual_source_type == MANUAL_PAN115_SOURCE
    assert dependencies.source_model is SubscriptionSource
    assert dependencies.run_select is select
    assert dependencies.create_pan_service is Pan115Service
    assert (
        dependencies.get_pan115_cookie.__self__
        is runtime_settings_service
    )
    assert (
        dependencies.get_pan115_cookie.__func__
        is type(runtime_settings_service).get_pan115_cookie
    )
    assert (
        dependencies.get_pan115_default_folder.__self__
        is runtime_settings_service
    )
    assert (
        dependencies.get_tv_missing_status.__self__
        is tv_missing_service
    )
    assert (
        dependencies.scan_manual_source.__self__
        is subscription_source_service
    )
    assert dependencies.create_step_log is create_step_log
    assert dependencies.run_scan_fixed_sources_for_subscription is (
        scan_fixed_sources_for_subscription
    )


def test_fixed_source_scan_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.fixed_source_scan_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.models.models import SubscriptionSource
from app.services.pan115_service import Pan115Service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscription_source_service import (
    MANUAL_PAN115_SOURCE,
    subscription_source_service,
)
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription,
)
from app.services.tv_missing_service import tv_missing_service


RunScanFixedSourcesForSubscription = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class FixedSourceScanRuntimeDependencies:
    manual_source_type: str
    source_model: Any
    run_select: Callable[[Any], Any]
    get_pan115_cookie: Callable[[], str]
    create_pan_service: Callable[[str], Any]
    get_pan115_default_folder: Callable[[], dict[str, Any]]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: Callable[..., Awaitable[dict[str, Any]]]
    scan_manual_source: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    run_scan_fixed_sources_for_subscription: RunScanFixedSourcesForSubscription


def build_default_fixed_source_scan_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]],
    create_step_log: Callable[..., Awaitable[None]],
) -> FixedSourceScanRuntimeDependencies:
    return FixedSourceScanRuntimeDependencies(
        manual_source_type=MANUAL_PAN115_SOURCE,
        source_model=SubscriptionSource,
        run_select=select,
        get_pan115_cookie=runtime_settings_service.get_pan115_cookie,
        create_pan_service=Pan115Service,
        get_pan115_default_folder=(
            runtime_settings_service.get_pan115_default_folder
        ),
        resolve_quality_filter=resolve_quality_filter,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        scan_manual_source=subscription_source_service.scan_manual_pan115_source,
        create_step_log=create_step_log,
        run_scan_fixed_sources_for_subscription=(
            scan_fixed_sources_for_subscription
        ),
    )


async def scan_fixed_sources_with_runtime_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: FixedSourceScanRuntimeDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    force_auto_download: bool = False,
) -> dict[str, Any]:
    async def list_enabled_manual_sources(
        current_db: Any,
        subscription_id: int,
    ) -> list[Any]:
        model = dependencies.source_model
        result = await current_db.execute(
            dependencies.run_select(model).where(
                model.subscription_id == subscription_id,
                model.enabled.is_(True),
                model.source_type == dependencies.manual_source_type,
            )
        )
        return list(result.scalars().all())

    def create_pan_service() -> Any:
        return dependencies.create_pan_service(dependencies.get_pan115_cookie())

    def get_parent_folder_id() -> str:
        default_folder = dependencies.get_pan115_default_folder() or {}
        return str(default_folder.get("folder_id") or "0")

    async def get_tv_missing_status(
        tmdb_id: int,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return await dependencies.get_tv_missing_status(tmdb_id, **kwargs)

    async def scan_manual_source(
        current_db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return await dependencies.scan_manual_source(current_db, **kwargs)

    async def create_step_log(
        current_db: Any,
        **kwargs: Any,
    ) -> None:
        await dependencies.create_step_log(current_db, **kwargs)

    return await dependencies.run_scan_fixed_sources_for_subscription(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        tv_missing_snapshot=tv_missing_snapshot,
        force_auto_download=force_auto_download,
        dependencies=FixedSourceScanDependencies(
            list_enabled_manual_sources=list_enabled_manual_sources,
            create_pan_service=create_pan_service,
            get_parent_folder_id=get_parent_folder_id,
            resolve_quality_filter=dependencies.resolve_quality_filter,
            get_tv_missing_status=get_tv_missing_status,
            scan_manual_source=scan_manual_source,
            create_step_log=create_step_log,
        ),
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py
```

Expected: PASS.

## Task 3: Wire SubscriptionService Wrapper

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Update imports**

In `backend/app/services/subscription_service.py`, replace:

```python
from sqlalchemy import and_, delete, or_, select
```

with:

```python
from sqlalchemy import select
```

Remove `SubscriptionSource` from the `app.models.models` import block, remove `Pan115Service`, and remove:

```python
from app.services.subscription_source_service import (
    MANUAL_PAN115_SOURCE,
    subscription_source_service,
)
```

Replace the fixed-source scan import:

```python
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription as scan_fixed_sources_flow,
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
```

with:

```python
from app.services.subscriptions.fixed_source_scan import (
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
```

- [ ] **Step 2: Replace fixed-source scan wrapper body**

Replace the body of `_scan_fixed_sources_for_subscription()` with:

```python
        return await scan_fixed_sources_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_fixed_source_scan_runtime_dependencies(
                resolve_quality_filter=self._resolve_subscription_quality_filter,
                create_step_log=self._create_step_log,
            ),
            tv_missing_snapshot=tv_missing_snapshot,
            force_auto_download=force_auto_download,
        )
```

- [ ] **Step 3: Run targeted regression tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py
git commit -m "refactor: 抽离订阅固定来源扫描 runtime adapter"
```

Expected: commit succeeds and leaves only the two allowed untracked files.

## Task 4: Completion Verification

**Files:**
- No edits.

- [ ] **Step 1: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: all backend tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build exits 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: exits 0.

- [ ] **Step 4: Rebuild and start container**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: image builds and `mediasync115` starts.

- [ ] **Step 5: Wait for Docker health**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
```

Expected: prints `health=healthy` and exits 0.

- [ ] **Step 6: Verify HTTP health and workspace state**

Run:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- compose status shows `mediasync115` healthy.
- Docker inspect prints `healthy`.
- `git status --short` only lists:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

- `subscription_service.py` line count decreases from 846.

## Self-Review

- Spec coverage: plan covers runtime adapter creation, service wrapper wiring, query shape verification, default bindings, targeted tests, and every completion verification command.
- Placeholder scan: no deferred work remains in this plan.
- Type consistency: `FixedSourceScanRuntimeDependencies`, `FixedSourceScanDependencies`, and `scan_fixed_sources_with_runtime_adapter()` names match across test, implementation, and service wiring.
