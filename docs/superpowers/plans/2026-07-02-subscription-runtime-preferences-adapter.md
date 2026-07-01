# 订阅 Runtime Preferences Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move subscription source order and quality filter runtime settings wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.runtime_preferences_adapter` with an injectable dependency dataclass, default runtime bindings, and two wrapper functions. Keep `source_attempts.py` and `quality_filter.py` pure; keep `SubscriptionService` method signatures as compatibility entry points.

**Tech Stack:** Python 3.13, pytest, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/runtime_preferences_adapter.py`
  - Runtime settings dependency dataclass.
  - Default dependency builder.
  - Source order and quality filter runtime wrapper functions.
- Create: `backend/tests/test_subscription_runtime_preferences_adapter.py`
  - Red/green tests for source order readiness, quality preferences, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_resolve_source_order()` and `_resolve_subscription_quality_filter()` to the runtime adapter.
  - Remove direct imports of `resolve_source_order`, `SubscriptionQualityPreferences`, and `build_subscription_quality_filter`.

## Task 1: Write Runtime Preferences Tests

**Files:**
- Create: `backend/tests/test_subscription_runtime_preferences_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_runtime_preferences_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    RuntimePreferencesDependencies,
    build_default_runtime_preferences_dependencies,
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.source_attempts import resolve_source_order


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> RuntimePreferencesDependencies:
    def run_resolve_source_order(
        priority: list[str],
        *,
        tg_ready: bool,
    ) -> list[str]:
        return [source for source in priority if source != "tg" or tg_ready]

    def build_quality_filter(
        preferences: SubscriptionQualityPreferences,
    ) -> dict[str, Any]:
        return build_subscription_quality_filter(preferences)

    values: dict[str, Any] = {
        "get_resource_priority": lambda: ["tg", "pansou", "hdhive"],
        "get_tg_api_id": lambda: "123",
        "get_tg_api_hash": lambda: "hash",
        "get_tg_session": lambda: "session",
        "get_tg_channel_usernames": lambda: ["channel"],
        "get_resource_preferred_resolutions": lambda: ["2160p"],
        "get_resource_preferred_hdr": lambda: ["HDR10"],
        "get_resource_preferred_codec": lambda: ["H265"],
        "get_resource_exclude_tags": lambda: ["CAM"],
        "get_resource_preferred_audio": lambda: ["zh"],
        "get_resource_preferred_subtitles": lambda: ["chs"],
        "get_resource_min_size_gb": lambda: 1.5,
        "get_resource_max_size_gb": lambda: 60.0,
        "run_resolve_source_order": run_resolve_source_order,
        "build_quality_filter": build_quality_filter,
    }
    values.update(overrides)
    return RuntimePreferencesDependencies(**values)


def test_runtime_adapter_resolves_source_order_with_injected_tg_readiness() -> None:
    calls: list[tuple[list[str], bool]] = []

    def run_resolve_source_order(
        priority: list[str],
        *,
        tg_ready: bool,
    ) -> list[str]:
        calls.append((priority, tg_ready))
        return ["tg", "pansou"] if tg_ready else ["pansou"]

    result = resolve_source_order_with_runtime_adapter(
        "all",
        dependencies=_dependencies(
            get_resource_priority=lambda: ["tg", "pansou"],
            get_tg_api_id=lambda: " 123 ",
            get_tg_api_hash=lambda: " hash ",
            get_tg_session=lambda: " session ",
            get_tg_channel_usernames=lambda: ["channel"],
            run_resolve_source_order=run_resolve_source_order,
        ),
    )

    assert result == ["tg", "pansou"]
    assert calls == [(["tg", "pansou"], True)]


def test_runtime_adapter_marks_tg_unready_when_required_settings_are_blank() -> None:
    calls: list[tuple[list[str], bool]] = []

    def run_resolve_source_order(
        priority: list[str],
        *,
        tg_ready: bool,
    ) -> list[str]:
        calls.append((priority, tg_ready))
        return ["tg"] if tg_ready else ["pansou"]

    result = resolve_source_order_with_runtime_adapter(
        "all",
        dependencies=_dependencies(
            get_resource_priority=lambda: ["tg", "pansou"],
            get_tg_api_id=lambda: "123",
            get_tg_api_hash=lambda: " ",
            get_tg_session=lambda: "session",
            get_tg_channel_usernames=lambda: ["channel"],
            run_resolve_source_order=run_resolve_source_order,
        ),
    )

    assert result == ["pansou"]
    assert calls == [(["tg", "pansou"], False)]


def test_runtime_adapter_builds_quality_filter_from_injected_preferences() -> None:
    captured: dict[str, Any] = {}

    def build_quality_filter(
        preferences: SubscriptionQualityPreferences,
    ) -> dict[str, Any]:
        captured["preferences"] = preferences
        return {"preferred_resolutions": preferences.preferred_resolutions}

    result = resolve_subscription_quality_filter_with_runtime_adapter(
        SimpleNamespace(title="测试"),
        dependencies=_dependencies(
            get_resource_preferred_resolutions=lambda: ["1080p"],
            get_resource_preferred_hdr=lambda: ["Dolby Vision"],
            get_resource_preferred_codec=lambda: ["AV1"],
            get_resource_exclude_tags=lambda: ["TC"],
            get_resource_preferred_audio=lambda: ["ja"],
            get_resource_preferred_subtitles=lambda: ["cht"],
            get_resource_min_size_gb=lambda: 2.0,
            get_resource_max_size_gb=lambda: 40.0,
            build_quality_filter=build_quality_filter,
        ),
    )

    assert result == {"preferred_resolutions": ["1080p"]}
    preferences = captured["preferences"]
    assert preferences == SubscriptionQualityPreferences(
        preferred_resolutions=["1080p"],
        preferred_hdr=["Dolby Vision"],
        preferred_codec=["AV1"],
        exclude_labels=["TC"],
        preferred_audio=["ja"],
        preferred_subtitles=["cht"],
        min_size_gb=2.0,
        max_size_gb=40.0,
    )


def test_default_runtime_preferences_dependencies_bind_existing_helpers() -> None:
    dependencies = build_default_runtime_preferences_dependencies()

    assert dependencies.run_resolve_source_order is resolve_source_order
    assert dependencies.build_quality_filter is build_subscription_quality_filter
    assert dependencies.get_resource_priority.__self__ is runtime_settings_service
    assert dependencies.get_resource_priority.__name__ == (
        "get_subscription_resource_priority"
    )
    assert dependencies.get_tg_api_id.__self__ is runtime_settings_service
    assert dependencies.get_resource_preferred_resolutions.__self__ is (
        runtime_settings_service
    )


def test_runtime_preferences_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/runtime_preferences_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.runtime_preferences_adapter'`.

## Task 2: Implement Runtime Preferences Adapter

**Files:**
- Create: `backend/app/services/subscriptions/runtime_preferences_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/runtime_preferences_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
from app.services.subscriptions.source_attempts import (
    resolve_source_order,
)


RunResolveSourceOrder = Callable[..., list[str]]
BuildQualityFilter = Callable[[SubscriptionQualityPreferences], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class RuntimePreferencesDependencies:
    get_resource_priority: Callable[[], list[str]]
    get_tg_api_id: Callable[[], str]
    get_tg_api_hash: Callable[[], str]
    get_tg_session: Callable[[], str]
    get_tg_channel_usernames: Callable[[], list[str]]
    get_resource_preferred_resolutions: Callable[[], list[str]]
    get_resource_preferred_hdr: Callable[[], list[str]]
    get_resource_preferred_codec: Callable[[], list[str]]
    get_resource_exclude_tags: Callable[[], list[str]]
    get_resource_preferred_audio: Callable[[], list[str]]
    get_resource_preferred_subtitles: Callable[[], list[str]]
    get_resource_min_size_gb: Callable[[], float | None]
    get_resource_max_size_gb: Callable[[], float | None]
    run_resolve_source_order: RunResolveSourceOrder
    build_quality_filter: BuildQualityFilter


def build_default_runtime_preferences_dependencies() -> RuntimePreferencesDependencies:
    return RuntimePreferencesDependencies(
        get_resource_priority=runtime_settings_service.get_subscription_resource_priority,
        get_tg_api_id=runtime_settings_service.get_tg_api_id,
        get_tg_api_hash=runtime_settings_service.get_tg_api_hash,
        get_tg_session=runtime_settings_service.get_tg_session,
        get_tg_channel_usernames=runtime_settings_service.get_tg_channel_usernames,
        get_resource_preferred_resolutions=(
            runtime_settings_service.get_resource_preferred_resolutions
        ),
        get_resource_preferred_hdr=runtime_settings_service.get_resource_preferred_hdr,
        get_resource_preferred_codec=runtime_settings_service.get_resource_preferred_codec,
        get_resource_exclude_tags=runtime_settings_service.get_resource_exclude_tags,
        get_resource_preferred_audio=runtime_settings_service.get_resource_preferred_audio,
        get_resource_preferred_subtitles=(
            runtime_settings_service.get_resource_preferred_subtitles
        ),
        get_resource_min_size_gb=runtime_settings_service.get_resource_min_size_gb,
        get_resource_max_size_gb=runtime_settings_service.get_resource_max_size_gb,
        run_resolve_source_order=resolve_source_order,
        build_quality_filter=build_subscription_quality_filter,
    )


def resolve_source_order_with_runtime_adapter(
    channel: str,
    *,
    dependencies: RuntimePreferencesDependencies | None = None,
) -> list[str]:
    _ = channel
    current_dependencies = (
        dependencies or build_default_runtime_preferences_dependencies()
    )
    tg_ready = bool(
        str(current_dependencies.get_tg_api_id() or "").strip()
        and str(current_dependencies.get_tg_api_hash() or "").strip()
        and str(current_dependencies.get_tg_session() or "").strip()
        and current_dependencies.get_tg_channel_usernames()
    )
    return current_dependencies.run_resolve_source_order(
        current_dependencies.get_resource_priority(),
        tg_ready=tg_ready,
    )


def resolve_subscription_quality_filter_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: RuntimePreferencesDependencies | None = None,
) -> dict[str, Any]:
    _ = sub
    current_dependencies = (
        dependencies or build_default_runtime_preferences_dependencies()
    )
    return current_dependencies.build_quality_filter(
        SubscriptionQualityPreferences(
            preferred_resolutions=(
                current_dependencies.get_resource_preferred_resolutions()
            ),
            preferred_hdr=current_dependencies.get_resource_preferred_hdr(),
            preferred_codec=current_dependencies.get_resource_preferred_codec(),
            exclude_labels=current_dependencies.get_resource_exclude_tags(),
            preferred_audio=current_dependencies.get_resource_preferred_audio(),
            preferred_subtitles=(
                current_dependencies.get_resource_preferred_subtitles()
            ),
            min_size_gb=current_dependencies.get_resource_min_size_gb(),
            max_size_gb=current_dependencies.get_resource_max_size_gb(),
        )
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py
```

Expected: PASS.

## Task 3: Wire SubscriptionService to Runtime Preferences Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace imports**

In `backend/app/services/subscription_service.py`, remove:

```python
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
    resolve_source_order,
)
```

Add:

```python
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
)
```

- [ ] **Step 2: Simplify service wrappers**

Change the two service methods to:

```python
    def _resolve_source_order(self, channel: str) -> list[str]:
        return resolve_source_order_with_runtime_adapter(channel)

    def _resolve_subscription_quality_filter(
        self, sub: "SubscriptionSnapshot"
    ) -> dict[str, Any]:
        return resolve_subscription_quality_filter_with_runtime_adapter(sub)
```

- [ ] **Step 3: Run targeted regression**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py tests/test_subscription_source_attempts.py tests/test_subscription_quality_filter.py tests/test_resource_tags_quality.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_run_start_flow.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/runtime_preferences_adapter.py backend/tests/test_subscription_runtime_preferences_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅 runtime preferences adapter"
```

## Task 4: Full Verification

**Files:**
- No edits.

- [ ] **Step 1: Backend full verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: all backend tests pass.

- [ ] **Step 2: Frontend production build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build exits 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Project quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: command exits 0.

- [ ] **Step 4: Docker build and health check**

Run:

```bash
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: container is healthy and `/healthz` returns `{"status":"healthy"}`.

- [ ] **Step 5: Final workspace check**

Run:

```bash
git status --short
wc -l backend/app/services/subscription_service.py
git log --oneline -10
```

Expected: `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: plan covers source order settings, TG readiness, quality preferences, service wiring, targeted checks, full verification, Docker health, and workspace check.
- 占位扫描：没有未决步骤；代码片段和命令都是明确的。
- Type consistency: `RuntimePreferencesDependencies`, `resolve_source_order_with_runtime_adapter()`, and `resolve_subscription_quality_filter_with_runtime_adapter()` names match tests, implementation, and service wiring.
