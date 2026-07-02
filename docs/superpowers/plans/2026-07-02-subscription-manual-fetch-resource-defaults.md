# 订阅手动资源抓取默认依赖装配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手动资源抓取 runtime adapter 自己装配默认资源解析 helper，并清理 `SubscriptionService.fetch_resources_for_media()` 的私有 `_fetch_resources` callback 传递。

**Architecture:** `manual_resource_fetch_runtime_adapter` 新增默认资源抓取 helper，并把 `fetch_resources` builder 参数改为可选。`SubscriptionService.fetch_resources_for_media()` 继续作为 public 方法转调 runtime adapter，但不再传服务私有 wrapper；`_fetch_resources()` 暂时保留给 explore 队列和兼容测试。

**Tech Stack:** Python 3.11+, pytest, existing subscription runtime adapters, `scripts/verify-backend.sh`, Docker Compose verification.

---

### Task 1: Manual Fetch Runtime Adapter Red Tests

**Files:**

- Modify: `backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py`

- [ ] **Step 1: Import module and resource resolver helper**

Add imports near the existing manual fetch imports:

```python
from app.services.subscriptions import (
    manual_resource_fetch_runtime_adapter as manual_fetch_runtime_module,
)
```

- [ ] **Step 2: Update default builder test**

Replace `test_default_dependencies_bind_snapshot_media_types_and_fetch_callback` with:

```python
def test_default_dependencies_bind_snapshot_media_types_and_fetch_callback() -> None:
    async def fetch_resources(
        _channel: str,
        _sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return [], [], {}

    dependencies = build_default_manual_resource_fetch_runtime_dependencies(
        fetch_resources=fetch_resources,
    )

    assert dependencies.snapshot_class is SubscriptionSnapshot
    assert dependencies.tv_media_type is MediaType.TV
    assert dependencies.movie_media_type is MediaType.MOVIE
    assert dependencies.fetch_resources is fetch_resources


def test_default_dependencies_bind_runtime_fetch_helper_without_service_callback() -> None:
    dependencies = build_default_manual_resource_fetch_runtime_dependencies()

    assert dependencies.snapshot_class is SubscriptionSnapshot
    assert dependencies.tv_media_type is MediaType.TV
    assert dependencies.movie_media_type is MediaType.MOVIE
    assert dependencies.fetch_resources is (
        manual_fetch_runtime_module.fetch_resources_with_default_runtime_dependencies
    )
```

- [ ] **Step 3: Add falsy injection red test**

Add this test after the default helper test:

```python
def test_default_dependencies_preserve_falsy_fetch_resource_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> Any:
            return [], [], {}

    fetch_resources = FalsyAsyncCallable()

    dependencies = build_default_manual_resource_fetch_runtime_dependencies(
        fetch_resources=fetch_resources,
    )

    assert dependencies.fetch_resources is fetch_resources
```

- [ ] **Step 4: Add default fetch helper red test**

Add this test after the falsy injection test:

```python
@pytest.mark.asyncio
async def test_default_fetch_helper_builds_resource_resolver_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = SubscriptionSnapshot(
        id=0,
        tmdb_id=1001,
        douban_id="db1",
        title="剧名",
        media_type=MediaType.TV,
        year="2026",
        auto_download=False,
        tv_scope="all",
        tv_season_number=2,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_follow_mode="missing",
        tv_include_specials=False,
        has_successful_transfer=False,
    )
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
        manual_fetch_runtime_module,
        "build_default_resource_resolver_runtime_dependencies",
        fake_builder,
    )
    monkeypatch.setattr(
        manual_fetch_runtime_module,
        "fetch_subscription_resources_with_runtime_adapter",
        fake_fetch_subscription_resources_with_runtime_adapter,
    )

    result = await manual_fetch_runtime_module.fetch_resources_with_default_runtime_dependencies(
        "all",
        sub,
    )

    assert result is marker
    assert calls == [
        {"builder": True},
        {
            "fetch": {
                "channel": "all",
                "sub": sub,
                "dependencies": dependencies_marker,
                "hdhive_unlock_context": None,
                "source_order": None,
                "exclude_urls": None,
            }
        },
    ]
```

- [ ] **Step 5: Update service wrapper test**

In `test_subscription_service_wrapper_passes_public_arguments_and_fetch_callback`, replace:

```python
fetch_callback = builder_kwargs["fetch_resources"]
assert fetch_callback.__self__ is service
assert fetch_callback.__func__ is service._fetch_resources.__func__
```

with:

```python
assert builder_kwargs == {}
```

- [ ] **Step 6: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py::test_default_dependencies_bind_runtime_fetch_helper_without_service_callback -q
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py::test_default_fetch_helper_builds_resource_resolver_runtime_dependencies -q
```

Expected:

- First command fails with `TypeError` because `fetch_resources` is still required.
- Second command fails with `AttributeError` because `fetch_resources_with_default_runtime_dependencies` does not exist.

### Task 2: Service Boundary Red Test

**Files:**

- Create: `backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py`

- [ ] **Step 1: Write failing boundary test**

Create `backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py`:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_manual_fetch_drops_fetch_resource_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")
    start = source.index("    async def fetch_resources_for_media")
    end = source.index("\\n\\n\\nsubscription_service =", start)
    public_fetch_source = source[start:end]

    assert "fetch_resources=self._fetch_resources" not in public_fetch_source


def test_fetch_resources_wrapper_stays_for_existing_callers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" in source
```

- [ ] **Step 2: Run boundary red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_manual_fetch_runtime_boundary.py -q
```

Expected: FAIL because `fetch_resources_for_media()` still passes `fetch_resources=self._fetch_resources`.

### Task 3: Implement Manual Fetch Defaults

**Files:**

- Modify: `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import resource resolver runtime helpers**

In `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`, add:

```python
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
```

- [ ] **Step 2: Add default fetch helper**

Add before `build_default_manual_resource_fetch_runtime_dependencies()`:

```python
async def fetch_resources_with_default_runtime_dependencies(
    channel: str,
    sub: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await fetch_subscription_resources_with_runtime_adapter(
        channel=channel,
        sub=sub,
        dependencies=build_default_resource_resolver_runtime_dependencies(),
        hdhive_unlock_context=None,
        source_order=None,
        exclude_urls=None,
    )
```

- [ ] **Step 3: Make fetch callback optional**

Change:

```python
def build_default_manual_resource_fetch_runtime_dependencies(
    *,
    fetch_resources: FetchResources,
) -> ManualResourceFetchRuntimeDependencies:
```

to:

```python
def build_default_manual_resource_fetch_runtime_dependencies(
    *,
    fetch_resources: FetchResources | None = None,
) -> ManualResourceFetchRuntimeDependencies:
```

Change the returned dependency:

```python
fetch_resources=(
    fetch_resources
    if fetch_resources is not None
    else fetch_resources_with_default_runtime_dependencies
),
```

- [ ] **Step 4: Simplify service public method**

In `backend/app/services/subscription_service.py`, change:

```python
dependencies=build_default_manual_resource_fetch_runtime_dependencies(
    fetch_resources=self._fetch_resources,
),
```

to:

```python
dependencies=build_default_manual_resource_fetch_runtime_dependencies(),
```

### Task 4: Verify and Commit

**Files:**

- Modified files from Tasks 1-3

- [ ] **Step 1: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_subscription_service_manual_fetch_runtime_boundary.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_run_channel_runtime_adapter.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Run static checks**

Run:

```bash
git diff --check
sed -n '385,410p' backend/app/services/subscription_service.py | rg "fetch_resources=self\\._fetch_resources"
rg -n "async def _fetch_resources" backend/app/services/subscription_service.py
```

Expected:

- `git diff --check` exits 0.
- The `sed | rg` command exits 1 with no matches.
- `_fetch_resources` search exits 0 with one match because the wrapper remains for existing callers.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py
git commit -m "refactor: 下沉订阅手动资源抓取默认依赖装配"
```

- [ ] **Step 4: Run full completion gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_subscription_service_manual_fetch_runtime_boundary.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_run_channel_runtime_adapter.py -q
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
