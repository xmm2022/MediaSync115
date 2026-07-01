# Subscription Fixed Source Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription fixed-source scan flow from `subscription_service.py` into a focused, dependency-injected module without changing runtime behavior.

**Architecture:** Add `app.services.subscriptions.fixed_source_scan` with a pure scan predicate, a dependency dataclass, and the async scan flow. Keep `SubscriptionService` as the integration adapter that loads enabled manual 115 sources and wires existing global services into the extracted function.

**Tech Stack:** Python 3.12, pytest, SQLAlchemy async session shape, existing MediaSync115 service modules.

---

### Task 1: Extract Fixed Source Scan Flow

**Files:**
- Create: `backend/app/services/subscriptions/fixed_source_scan.py`
- Create: `backend/tests/test_fixed_source_scan.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_fixed_source_scan.py`:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription,
    should_scan_fixed_sources,
)


ROOT = Path(__file__).resolve().parents[2]


def _subscription(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "id": 101,
        "tmdb_id": 9001,
        "title": "Fixed Source Show",
        "media_type": MediaType.TV,
        "auto_download": True,
        "tv_scope": "episode_range",
        "tv_season_number": 1,
        "tv_episode_start": 2,
        "tv_episode_end": 5,
        "tv_follow_mode": "new",
        "tv_include_specials": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _source(source_id: int, name: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=source_id,
        display_name=name,
        share_url=f"https://115.com/s/{name}",
    )


def test_should_scan_fixed_sources_requires_supported_media_tmdb_and_auto_download() -> None:
    assert should_scan_fixed_sources(_subscription()) is True
    assert should_scan_fixed_sources(_subscription(auto_download=False)) is False
    assert (
        should_scan_fixed_sources(
            _subscription(auto_download=False),
            force_auto_download=True,
        )
        is True
    )
    assert should_scan_fixed_sources(_subscription(tmdb_id=None)) is False
    assert (
        should_scan_fixed_sources(_subscription(media_type=MediaType.COLLECTION))
        is False
    )


@pytest.mark.asyncio
async def test_scan_fixed_sources_skips_before_loading_sources_when_policy_is_false() -> None:
    calls: list[str] = []

    async def list_sources(_db: Any, _subscription_id: int) -> list[Any]:
        calls.append("list_sources")
        return [_source(1, "unused")]

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: object(),
        get_parent_folder_id=lambda: "0",
        resolve_quality_filter=lambda _sub: {},
        get_tv_missing_status=_unexpected_tv_missing,
        scan_manual_source=_unexpected_scan,
        create_step_log=_unexpected_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-1",
        channel="all",
        sub=_subscription(auto_download=False),
        dependencies=dependencies,
    )

    assert result == {"saved": 0, "failed": 0, "checked": 0}
    assert calls == []


@pytest.mark.asyncio
async def test_scan_fixed_sources_logs_warning_when_tv_missing_status_is_unavailable() -> None:
    logs: list[dict[str, Any]] = []

    async def list_sources(_db: Any, subscription_id: int) -> list[Any]:
        assert subscription_id == 101
        return [_source(10, "source-a"), _source(11, "source-b")]

    async def get_tv_missing_status(tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
        assert tmdb_id == 9001
        assert kwargs == {
            "include_specials": False,
            "season_number": 1,
            "episode_start": 2,
            "episode_end": 5,
            "aired_only": True,
        }
        return {"status": "error", "message": "Emby unavailable"}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: object(),
        get_parent_folder_id=lambda: "target-folder",
        resolve_quality_filter=lambda _sub: {"preferred_resolutions": ["1080p"]},
        get_tv_missing_status=get_tv_missing_status,
        scan_manual_source=_unexpected_scan,
        create_step_log=create_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-1",
        channel="priority",
        sub=_subscription(),
        dependencies=dependencies,
    )

    assert result == {"saved": 0, "failed": 0, "checked": 2}
    assert logs == [
        {
            "run_id": "run-1",
            "channel": "priority",
            "subscription_id": 101,
            "subscription_title": "Fixed Source Show",
            "step": "fixed_source_missing_status_unavailable",
            "status": "warning",
            "message": "固定来源跳过：缺集状态不可用（Emby unavailable）",
        }
    ]


@pytest.mark.asyncio
async def test_scan_fixed_sources_accumulates_success_and_failure_per_source() -> None:
    logs: list[dict[str, Any]] = []
    scan_calls: list[tuple[int, set[tuple[int, int]], dict[str, Any]]] = []
    pan_service = object()

    async def list_sources(_db: Any, _subscription_id: int) -> list[Any]:
        return [_source(20, "ok-source"), _source(21, "bad-source")]

    async def scan_manual_source(
        _db: Any,
        *,
        source: Any,
        subscription: Any,
        pan_service: Any,
        parent_folder_id: str,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any],
    ) -> dict[str, Any]:
        assert subscription.id == 101
        assert pan_service is not None
        assert parent_folder_id == "target-folder"
        scan_calls.append((source.id, set(missing_episodes), dict(quality_filter)))
        if source.id == 21:
            raise RuntimeError("share expired")
        return {"status": "success", "transferred_count": 3, "selected_count": 4}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    dependencies = FixedSourceScanDependencies(
        list_enabled_manual_sources=list_sources,
        create_pan_service=lambda: pan_service,
        get_parent_folder_id=lambda: "target-folder",
        resolve_quality_filter=lambda _sub: {"preferred_resolutions": ["2160p"]},
        get_tv_missing_status=_unexpected_tv_missing,
        scan_manual_source=scan_manual_source,
        create_step_log=create_step_log,
    )

    result = await scan_fixed_sources_for_subscription(
        object(),
        run_id="run-2",
        channel="all",
        sub=_subscription(),
        tv_missing_snapshot={
            "status": "ok",
            "missing_episodes": [[1, 2], ["1", "3"], ["bad"], [2, "x"]],
        },
        dependencies=dependencies,
    )

    assert result == {"saved": 3, "failed": 1, "checked": 2}
    assert scan_calls == [
        (20, {(1, 2), (1, 3)}, {"preferred_resolutions": ["2160p"]}),
        (21, {(1, 2), (1, 3)}, {"preferred_resolutions": ["2160p"]}),
    ]
    assert [entry["step"] for entry in logs] == [
        "fixed_source_scan_start",
        "fixed_source_scan_done",
        "fixed_source_scan_start",
        "fixed_source_scan_failed",
    ]
    assert logs[1]["payload"] == {
        "source_id": 20,
        "status": "success",
        "transferred_count": 3,
        "selected_count": 4,
    }
    assert logs[3]["message"] == "固定来源扫描失败：share expired"


def test_fixed_source_scan_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/fixed_source_scan.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "Pan115Service" not in source
    assert "subscription_source_service" not in source
    assert "AsyncSession" not in source
    assert "app.api" not in source


async def _unexpected_tv_missing(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise AssertionError("tv missing status should not be requested")


async def _unexpected_scan(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise AssertionError("fixed source scan should not run")


async def _unexpected_step_log(*_args: Any, **_kwargs: Any) -> None:
    raise AssertionError("step log should not be written")
```

- [ ] **Step 2: Run the red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_fixed_source_scan.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.fixed_source_scan'`.

- [ ] **Step 3: Create the extracted module**

Create `backend/app/services/subscriptions/fixed_source_scan.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


CreateStepLog = Callable[..., Awaitable[None]]
ListEnabledManualSources = Callable[[Any, int], Awaitable[list[Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
ScanManualSource = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class FixedSourceScanDependencies:
    list_enabled_manual_sources: ListEnabledManualSources
    create_pan_service: Callable[[], Any]
    get_parent_folder_id: Callable[[], str]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: GetTvMissingStatus
    scan_manual_source: ScanManualSource
    create_step_log: CreateStepLog


def _media_type_value(sub: Any) -> Any:
    media_type = getattr(sub, "media_type", None)
    return getattr(media_type, "value", media_type)


def should_scan_fixed_sources(
    sub: Any,
    *,
    force_auto_download: bool = False,
) -> bool:
    return (
        _media_type_value(sub) in {"movie", "tv"}
        and getattr(sub, "tmdb_id", None) is not None
        and (
            bool(getattr(sub, "auto_download", False))
            or bool(force_auto_download)
        )
    )


def _tv_missing_status_kwargs(sub: Any) -> dict[str, Any]:
    tv_scope = getattr(sub, "tv_scope", "")
    return {
        "include_specials": bool(getattr(sub, "tv_include_specials", False)),
        "season_number": getattr(sub, "tv_season_number", None)
        if tv_scope in {"season", "episode_range"}
        else None,
        "episode_start": getattr(sub, "tv_episode_start", None)
        if tv_scope == "episode_range"
        else None,
        "episode_end": getattr(sub, "tv_episode_end", None)
        if tv_scope == "episode_range"
        else None,
        "aired_only": getattr(sub, "tv_follow_mode", "") == "new",
    }


def _parse_missing_episode_pairs(value: Any) -> set[tuple[int, int]]:
    pairs: set[tuple[int, int]] = set()
    for pair in value or []:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        try:
            pairs.add((int(pair[0]), int(pair[1])))
        except (TypeError, ValueError):
            continue
    return pairs


def _zero_stats() -> dict[str, int]:
    return {"saved": 0, "failed": 0, "checked": 0}


async def scan_fixed_sources_for_subscription(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: FixedSourceScanDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    force_auto_download: bool = False,
) -> dict[str, Any]:
    if not should_scan_fixed_sources(
        sub,
        force_auto_download=force_auto_download,
    ):
        return _zero_stats()

    sources = await dependencies.list_enabled_manual_sources(db, int(sub.id))
    if not sources:
        return _zero_stats()

    pan_service = dependencies.create_pan_service()
    parent_folder_id = dependencies.get_parent_folder_id()
    quality_filter = dependencies.resolve_quality_filter(sub)

    missing_episodes: set[tuple[int, int]] = set()
    if _media_type_value(sub) == "tv":
        tv_missing_result = tv_missing_snapshot
        if tv_missing_result is None:
            tv_missing_result = await dependencies.get_tv_missing_status(
                getattr(sub, "tmdb_id", None),
                **_tv_missing_status_kwargs(sub),
            )
        if str(tv_missing_result.get("status") or "") != "ok":
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_missing_status_unavailable",
                status="warning",
                message=(
                    "固定来源跳过：缺集状态不可用"
                    f"（{tv_missing_result.get('message') or '未知错误'}）"
                ),
            )
            return {"saved": 0, "failed": 0, "checked": len(sources)}

        missing_episodes = _parse_missing_episode_pairs(
            tv_missing_result.get("missing_episodes")
        )

    saved = 0
    failed = 0
    for source in sources:
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="fixed_source_scan_start",
            status="info",
            message=f"开始扫描固定来源：{source.display_name or source.share_url}",
            payload={"source_id": source.id},
        )
        try:
            scan_result = await dependencies.scan_manual_source(
                db,
                source=source,
                subscription=sub,
                pan_service=pan_service,
                parent_folder_id=parent_folder_id,
                missing_episodes=missing_episodes,
                quality_filter=quality_filter,
            )
            transferred_count = int(scan_result.get("transferred_count") or 0)
            saved += transferred_count
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_scan_done",
                status="success",
                message=f"固定来源扫描完成，转存 {transferred_count} 个文件",
                payload={"source_id": source.id, **scan_result},
            )
        except Exception as exc:
            failed += 1
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_scan_failed",
                status="warning",
                message=f"固定来源扫描失败：{exc}",
                payload={"source_id": source.id},
            )
    return {"saved": saved, "failed": failed, "checked": len(sources)}
```

- [ ] **Step 4: Wire `SubscriptionService` to the extracted module**

Modify imports in `backend/app/services/subscription_service.py`:

```python
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription as scan_fixed_sources_flow,
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
```

Replace `_should_scan_fixed_sources()` with:

```python
    def _should_scan_fixed_sources(
        self,
        sub: "SubscriptionSnapshot",
        *,
        force_auto_download: bool = False,
    ) -> bool:
        return should_scan_fixed_sources_policy(
            sub,
            force_auto_download=force_auto_download,
        )
```

Replace the body of `_scan_fixed_sources_for_subscription()` with:

```python
        async def list_enabled_manual_sources(
            current_db: AsyncSession,
            subscription_id: int,
        ) -> list[SubscriptionSource]:
            result = await current_db.execute(
                select(SubscriptionSource).where(
                    SubscriptionSource.subscription_id == subscription_id,
                    SubscriptionSource.enabled.is_(True),
                    SubscriptionSource.source_type == MANUAL_PAN115_SOURCE,
                )
            )
            return list(result.scalars().all())

        def create_pan_service() -> Pan115Service:
            return Pan115Service(runtime_settings_service.get_pan115_cookie())

        def get_parent_folder_id() -> str:
            default_folder = runtime_settings_service.get_pan115_default_folder() or {}
            return str(default_folder.get("folder_id") or "0")

        async def get_tv_missing_status(
            tmdb_id: int,
            **kwargs: Any,
        ) -> dict[str, Any]:
            return await tv_missing_service.get_tv_missing_status(tmdb_id, **kwargs)

        async def scan_manual_source(
            current_db: AsyncSession,
            **kwargs: Any,
        ) -> dict[str, Any]:
            return await subscription_source_service.scan_manual_pan115_source(
                current_db,
                **kwargs,
            )

        async def create_step_log(
            current_db: AsyncSession,
            **kwargs: Any,
        ) -> None:
            await self._create_step_log(current_db, **kwargs)

        dependencies = FixedSourceScanDependencies(
            list_enabled_manual_sources=list_enabled_manual_sources,
            create_pan_service=create_pan_service,
            get_parent_folder_id=get_parent_folder_id,
            resolve_quality_filter=self._resolve_subscription_quality_filter,
            get_tv_missing_status=get_tv_missing_status,
            scan_manual_source=scan_manual_source,
            create_step_log=create_step_log,
        )
        return await scan_fixed_sources_flow(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            tv_missing_snapshot=tv_missing_snapshot,
            force_auto_download=force_auto_download,
            dependencies=dependencies,
        )
```

- [ ] **Step 5: Run focused green tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_fixed_source_scan.py
```

Expected: all tests in `test_fixed_source_scan.py` pass.

- [ ] **Step 6: Run fixed-source and subscription regression tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_fixed_source_scan.py tests/test_subscription_source_run_integration.py tests/test_subscription_source_scan.py tests/test_fetch_resources_waterfall.py tests/test_subscription_snapshot.py tests/test_health.py
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit the refactor**

Run:

```bash
git diff --check
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/fixed_source_scan.py backend/tests/test_fixed_source_scan.py
git diff --cached --check
git commit -m "refactor: 抽离订阅固定来源扫描"
```

Expected: commit succeeds and unrelated untracked files remain untracked.

- [ ] **Step 8: Run final verification and local deployment checks**

Run:

```bash
scripts/verify-backend.sh --quick
scripts/verify-backend.sh
scripts/verify-frontend.sh --build
scripts/verify.sh --quick
docker compose up -d --build
curl --retry 30 --retry-all-errors --retry-delay 2 -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
git status --short
wc -l backend/app/services/subscription_service.py backend/app/services/subscriptions/fixed_source_scan.py backend/tests/test_fixed_source_scan.py
```

Expected:

- Backend quick and full suites pass.
- Frontend build verification passes.
- Compose quick verification passes.
- `/healthz` returns `{"status":"healthy"}`.
- Docker health is `healthy`.
- `subscription_service.py` line count decreases.
