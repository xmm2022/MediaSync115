# 订阅资源 Resolver 默认 Runtime 依赖装配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将订阅资源 resolver 的默认 fetcher、偏好和 HDHive unlock 依赖装配下沉到 `resource_resolver_runtime_adapter`，让 `SubscriptionService` 不再保留资源抓取和分辨率偏好转发 wrapper。

**Architecture:** `resource_resolver_runtime_adapter` 继续作为 runtime 边界，默认 builder 支持无参构造并绑定现有 runtime helper，同时保留显式依赖覆盖能力。`SubscriptionService._fetch_resources()` 保持公开行为不变，只调用 runtime adapter 和默认 builder。

**Tech Stack:** Python 3.11, pytest, FastAPI backend service modules, existing `scripts/verify-backend.sh` and Docker Compose verification.

---

### Task 1: Runtime Preferences Resolution Helper

**Files:**

- Modify: `backend/tests/test_subscription_runtime_preferences_adapter.py`
- Modify: `backend/app/services/subscriptions/runtime_preferences_adapter.py`

- [ ] **Step 1: Write the failing test**

Add this test to `backend/tests/test_subscription_runtime_preferences_adapter.py`:

```python
def test_resolve_subscription_resolutions_with_runtime_adapter_reads_runtime_preferences() -> None:
    sub = SimpleNamespace(title="测试订阅")

    result = (
        preferences_runtime_module.resolve_subscription_resolutions_with_runtime_adapter(
            sub,
            dependencies=_dependencies(
                get_resource_preferred_resolutions=lambda: ["2160p", "1080p"],
            ),
        )
    )

    assert result == ["2160p", "1080p"]
```

Also add this module import near the existing runtime preferences imports:

```python
from app.services.subscriptions import (
    runtime_preferences_adapter as preferences_runtime_module,
)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py::test_resolve_subscription_resolutions_with_runtime_adapter_reads_runtime_preferences -q
```

Expected: FAIL with `AttributeError` because `resolve_subscription_resolutions_with_runtime_adapter` does not exist yet.

- [ ] **Step 3: Implement the helper**

Add this function to `backend/app/services/subscriptions/runtime_preferences_adapter.py` after `resolve_source_order_with_runtime_adapter()`:

```python
def resolve_subscription_resolutions_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: RuntimePreferencesDependencies | None = None,
) -> list[str]:
    _ = sub
    current_dependencies = (
        dependencies or build_default_runtime_preferences_dependencies()
    )
    return current_dependencies.get_resource_preferred_resolutions()
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py::test_resolve_subscription_resolutions_with_runtime_adapter_reads_runtime_preferences -q
```

Expected: PASS.

### Task 2: Resource Resolver Default Runtime Dependencies

**Files:**

- Modify: `backend/tests/test_subscription_resource_resolver_runtime_adapter.py`
- Modify: `backend/app/services/subscriptions/resource_resolver_runtime_adapter.py`

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_subscription_resource_resolver_runtime_adapter.py`, import the runtime helper modules:

```python
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
    resolve_subscription_resolutions_with_runtime_adapter,
)
```

Add this test before the existing explicit-dependency default builder test:

```python
def test_default_runtime_dependencies_bind_resource_resolver_runtime_helpers() -> None:
    dependencies = build_default_resource_resolver_runtime_dependencies()

    assert dependencies.fetch_from_hdhive is fetch_from_hdhive_with_runtime_adapter
    assert dependencies.fetch_from_tg is fetch_from_tg_with_runtime_adapter
    assert dependencies.fetch_from_pansou is fetch_from_pansou_with_runtime_adapter
    assert dependencies.fetch_offline_magnets is fetch_offline_magnets_with_runtime_adapter
    assert dependencies.resolve_source_order is resolve_source_order_with_runtime_adapter
    assert dependencies.resolve_subscription_resolutions is (
        resolve_subscription_resolutions_with_runtime_adapter
    )
    assert dependencies.resolve_subscription_quality_filter is (
        resolve_subscription_quality_filter_with_runtime_adapter
    )
    assert dependencies.prepare_hdhive_locked_resources is (
        prepare_hdhive_locked_resources_with_runtime_adapter
    )
    assert dependencies.build_hdhive_unlock_context is (
        build_hdhive_unlock_context_with_runtime_adapter
    )
    assert dependencies.filter_resources_excluding_urls is filter_resources_excluding_urls
    assert dependencies.run_adapter is fetch_subscription_resources_with_adapter
    assert dependencies.run_resolver is resolve_subscription_resources
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py::test_default_runtime_dependencies_bind_resource_resolver_runtime_helpers -q
```

Expected: FAIL with `TypeError` because the default builder still requires explicit fetcher, preference, and unlock callbacks.

- [ ] **Step 3: Implement optional default bindings**

Modify `backend/app/services/subscriptions/resource_resolver_runtime_adapter.py`:

```python
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
    resolve_subscription_resolutions_with_runtime_adapter,
)
```

Change `build_default_resource_resolver_runtime_dependencies()` so each runtime callback argument defaults to `None` and the returned dataclass uses the module-level helper when no override is provided:

```python
def build_default_resource_resolver_runtime_dependencies(
    *,
    fetch_from_hdhive: FetchResources | None = None,
    fetch_from_tg: FetchResources | None = None,
    fetch_from_pansou: FetchResources | None = None,
    fetch_offline_magnets: FetchResources | None = None,
    resolve_source_order: Callable[[str], list[str]] | None = None,
    resolve_subscription_resolutions: Callable[[Any], list[str]] | None = None,
    resolve_subscription_quality_filter: Callable[[Any], dict[str, Any]] | None = None,
    prepare_hdhive_locked_resources: Callable[
        [list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Awaitable[list[dict[str, Any]]],
    ]
    | None = None,
    build_hdhive_unlock_context: Callable[[], dict[str, Any]] | None = None,
) -> ResourceResolverRuntimeDependencies:
    return ResourceResolverRuntimeDependencies(
        fetch_from_hdhive=fetch_from_hdhive or fetch_from_hdhive_with_runtime_adapter,
        fetch_from_tg=fetch_from_tg or fetch_from_tg_with_runtime_adapter,
        fetch_from_pansou=fetch_from_pansou or fetch_from_pansou_with_runtime_adapter,
        fetch_offline_magnets=(
            fetch_offline_magnets or fetch_offline_magnets_with_runtime_adapter
        ),
        resolve_source_order=(
            resolve_source_order or resolve_source_order_with_runtime_adapter
        ),
        resolve_subscription_resolutions=(
            resolve_subscription_resolutions
            or resolve_subscription_resolutions_with_runtime_adapter
        ),
        resolve_subscription_quality_filter=(
            resolve_subscription_quality_filter
            or resolve_subscription_quality_filter_with_runtime_adapter
        ),
        prepare_hdhive_locked_resources=(
            prepare_hdhive_locked_resources
            or prepare_hdhive_locked_resources_with_runtime_adapter
        ),
        build_hdhive_unlock_context=(
            build_hdhive_unlock_context
            or build_hdhive_unlock_context_with_runtime_adapter
        ),
        filter_resources_excluding_urls=filter_resources_excluding_urls,
        log_background_event=operation_log_service.log_background_event,
        emit_source_attempt_event=emit_source_attempt_event,
        run_adapter=fetch_subscription_resources_with_adapter,
        run_resolver=resolve_subscription_resources,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py::test_default_runtime_dependencies_bind_resource_resolver_runtime_helpers -q
```

Expected: PASS.

### Task 3: SubscriptionService Boundary Cleanup

**Files:**

- Create: `backend/tests/test_subscription_service_resource_resolver_boundary.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Write the failing boundary test**

Create `backend/tests/test_subscription_service_resource_resolver_boundary.py`:

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_resource_resolver_default_dependency_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_fetch_from_pansou",
        "_fetch_from_hdhive",
        "_fetch_from_tg",
        "_fetch_offline_magnets",
        "_resolve_subscription_resolutions",
        "fetch_from_pansou_with_runtime_adapter",
        "fetch_from_hdhive_with_runtime_adapter",
        "fetch_from_tg_with_runtime_adapter",
        "fetch_offline_magnets_with_runtime_adapter",
        "runtime_settings_service",
    ):
        assert name not in source


def test_subscription_service_keeps_fetch_resources_and_used_hdhive_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" in source
    assert "build_default_resource_resolver_runtime_dependencies()" in source
    assert "_build_hdhive_unlock_context" in source
    assert "_prepare_hdhive_locked_resources" in source
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_resource_resolver_boundary.py -q
```

Expected: FAIL because the service still contains the target wrapper methods and imports.

- [ ] **Step 3: Remove service-level default dependency wrappers**

Modify `backend/app/services/subscription_service.py`:

- Remove the import block for `app.services.subscriptions.resource_fetcher_runtime_adapter`.
- Remove `from app.services.runtime_settings_service import runtime_settings_service`.
- Change `_fetch_resources()` to:

```python
async def _fetch_resources(
    self,
    channel: str,
    sub: "SubscriptionSnapshot",
    hdhive_unlock_context: dict[str, Any] | None = None,
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

- Delete methods:

```python
async def _fetch_from_pansou(...)
async def _fetch_from_hdhive(...)
async def _fetch_from_tg(...)
async def _fetch_offline_magnets(...)
def _resolve_subscription_resolutions(...)
```

- Do not delete:

```python
def _resolve_source_order(...)
def _resolve_subscription_quality_filter(...)
def _build_hdhive_unlock_context(...)
async def _prepare_hdhive_locked_resources(...)
```

- [ ] **Step 4: Run boundary test to verify it passes**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_service_resource_resolver_boundary.py -q
```

Expected: PASS.

### Task 4: Waterfall Test Compatibility

**Files:**

- Modify: `backend/tests/test_fetch_resources_waterfall.py`

- [ ] **Step 1: Update service wrapper monkeypatches**

In `test_fetch_resources_stops_after_first_source_hit_in_service_wrapper()`, replace assignments to `service._fetch_from_*` with `monkeypatch.setattr()` on `resolver_runtime_module`:

```python
pansou_mock = AsyncMock(side_effect=fake_pansou)
hdhive_mock = AsyncMock(side_effect=fake_hdhive)
monkeypatch.setattr(
    resolver_runtime_module,
    "fetch_from_pansou_with_runtime_adapter",
    pansou_mock,
)
monkeypatch.setattr(
    resolver_runtime_module,
    "fetch_from_hdhive_with_runtime_adapter",
    hdhive_mock,
)
monkeypatch.setattr(
    resolver_runtime_module,
    "fetch_from_tg_with_runtime_adapter",
    AsyncMock(return_value=([], [])),
)
monkeypatch.setattr(
    resolver_runtime_module,
    "fetch_offline_magnets_with_runtime_adapter",
    AsyncMock(return_value=([], [])),
)
monkeypatch.setattr(
    resolver_runtime_module,
    "prepare_hdhive_locked_resources_with_runtime_adapter",
    AsyncMock(side_effect=lambda resources, *_args, **_kwargs: resources),
)
monkeypatch.setattr(
    resolver_runtime_module,
    "resolve_subscription_resolutions_with_runtime_adapter",
    lambda _sub: [],
)
monkeypatch.setattr(
    resolver_runtime_module,
    "resolve_subscription_quality_filter_with_runtime_adapter",
    lambda _sub: {},
)
monkeypatch.setattr(
    resolver_runtime_module.operation_log_service,
    "log_background_event",
    AsyncMock(),
)
```

Change the test method signature to include `monkeypatch: Any`, and assert `hdhive_mock.assert_not_called()`.

Apply the same pattern to `test_fetch_resources_falls_back_when_first_source_exhausted()`, but keep both PanSou and HDHive mocks callable and assert the existing results.

- [ ] **Step 2: Run updated waterfall tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_fetch_resources_waterfall.py -q
```

Expected: PASS.

### Task 5: Targeted Verification and Commit

**Files:**

- Modified files from Tasks 1-4.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_runtime_preferences_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_hdhive_unlock_policy.py tests/test_subscription_run_channel_runtime_adapter.py -q
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run:

```bash
git diff --check
rg -n "_fetch_from_pansou|_fetch_from_hdhive|_fetch_from_tg|_fetch_offline_magnets|_resolve_subscription_resolutions|fetch_from_pansou_with_runtime_adapter|fetch_from_hdhive_with_runtime_adapter|fetch_from_tg_with_runtime_adapter|fetch_offline_magnets_with_runtime_adapter|runtime_settings_service" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected:

- `git diff --check` exits 0.
- `rg` exits 1 with no matches in `subscription_service.py`.
- Line count decreases.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/runtime_preferences_adapter.py \
  backend/app/services/subscriptions/resource_resolver_runtime_adapter.py \
  backend/app/services/subscription_service.py \
  backend/tests/test_subscription_runtime_preferences_adapter.py \
  backend/tests/test_subscription_resource_resolver_runtime_adapter.py \
  backend/tests/test_fetch_resources_waterfall.py \
  backend/tests/test_subscription_service_resource_resolver_boundary.py
git commit -m "refactor: 下沉订阅资源 resolver 默认 runtime 依赖装配"
```

### Task 6: Completion Verification

**Files:**

- No new file edits.

- [ ] **Step 1: Run related targeted backend tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_runtime_preferences_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_hdhive_unlock_policy.py tests/test_subscription_run_channel_runtime_adapter.py -q
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

Line count is lower than 523.
