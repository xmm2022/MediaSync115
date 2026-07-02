# 订阅飞牛状态 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Feiniu movie/TV status runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.feiniu_status_runtime_adapter` to own the existing Feiniu status query flow with explicit injected runtime dependencies. Keep `SubscriptionService._check_feiniu_movie_status()` and `_check_feiniu_tv_missing_status()` as compatibility wrappers used by pre-scan and completed-cleanup flows.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/feiniu_status_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder for runtime settings, Feiniu services, TMDB service, and logger.
  - Movie and TV status runtime wrappers that preserve current return shapes and exception fallback.
- Create: `backend/tests/test_subscription_feiniu_status_runtime_adapter.py`
  - Red/green tests for URL gating, indexed/live priority, TV missing calculation, exception fallback, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_check_feiniu_movie_status()` and `_check_feiniu_tv_missing_status()` to the runtime adapter.
  - Remove direct imports of `feiniu_service` and `feiniu_sync_index_service`.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_feiniu_status_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_feiniu_status_runtime_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.feiniu_service import feiniu_service
from app.services.feiniu_sync_index_service import feiniu_sync_index_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.tmdb_service import tmdb_service
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    FeiniuStatusRuntimeDependencies,
    build_default_feiniu_status_runtime_dependencies,
    check_feiniu_movie_status_with_runtime_adapter,
    check_feiniu_tv_missing_status_with_runtime_adapter,
    logger as feiniu_status_logger,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeLogger:
    def __init__(self) -> None:
        self.exceptions: list[tuple[str, tuple[Any, ...]]] = []

    def exception(self, message: str, *args: Any) -> None:
        self.exceptions.append((message, args))


def _dependencies(**overrides: Any) -> FeiniuStatusRuntimeDependencies:
    async def unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("unexpected async dependency call")

    values: dict[str, Any] = {
        "get_feiniu_url": lambda: "http://feiniu.test",
        "get_indexed_movie_status": unexpected_async,
        "get_live_movie_status": unexpected_async,
        "get_indexed_tv_existing_episodes": unexpected_async,
        "get_live_tv_episode_status": unexpected_async,
        "get_tv_detail": unexpected_async,
        "logger": FakeLogger(),
    }
    values.update(overrides)
    return FeiniuStatusRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_movie_status_skips_downstream_when_feiniu_url_is_blank() -> None:
    result = await check_feiniu_movie_status_with_runtime_adapter(
        101,
        dependencies=_dependencies(get_feiniu_url=lambda: "   "),
    )

    assert result == {"checked": False}


@pytest.mark.asyncio
async def test_tv_missing_status_skips_downstream_when_feiniu_url_is_blank() -> None:
    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        202,
        dependencies=_dependencies(get_feiniu_url=lambda: ""),
    )

    assert result == {"checked": False}


@pytest.mark.asyncio
async def test_movie_status_uses_indexed_result_and_preserves_item_ids() -> None:
    async def get_indexed_movie_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 303
        return {"status": "ok", "exists": True, "item_ids": ["fn-1"]}

    result = await check_feiniu_movie_status_with_runtime_adapter(
        303,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
        ),
    )

    assert result == {
        "checked": True,
        "exists": True,
        "item_ids": ["fn-1"],
    }


@pytest.mark.asyncio
async def test_movie_status_treats_indexed_miss_as_authoritative() -> None:
    live_calls = 0

    async def get_indexed_movie_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 404
        return {"status": "ok", "exists": False}

    async def get_live_movie_status(_tmdb_id: int) -> dict[str, Any]:
        nonlocal live_calls
        live_calls += 1
        return {"status": "ok", "exists": True, "item_ids": ["live-1"]}

    result = await check_feiniu_movie_status_with_runtime_adapter(
        404,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
            get_live_movie_status=get_live_movie_status,
        ),
    )

    assert result == {
        "checked": True,
        "exists": False,
        "item_ids": [],
    }
    assert live_calls == 0


@pytest.mark.asyncio
async def test_movie_status_live_not_logged_in_returns_unchecked() -> None:
    async def get_indexed_movie_status(_tmdb_id: int) -> None:
        return None

    async def get_live_movie_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 505
        return {"status": "not_logged_in", "exists": False}

    result = await check_feiniu_movie_status_with_runtime_adapter(
        505,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
            get_live_movie_status=get_live_movie_status,
        ),
    )

    assert result == {"checked": False}


@pytest.mark.asyncio
async def test_tv_missing_status_uses_indexed_pairs_and_tmdb_seasons() -> None:
    async def get_indexed_tv_existing_episodes(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 606
        return {
            "status": "ok",
            "existing_episodes": [[1, 1], [1, 3], ["bad"], ["2", "1"]],
        }

    async def get_tv_detail(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 606
        return {
            "seasons": [
                {"season_number": 0, "episode_count": 10},
                {"season_number": 1, "episode_count": 3},
                {"season_number": 2, "episode_count": 1},
            ]
        }

    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        606,
        dependencies=_dependencies(
            get_indexed_tv_existing_episodes=get_indexed_tv_existing_episodes,
            get_tv_detail=get_tv_detail,
        ),
    )

    assert result == {"checked": True, "missing_count": 1}


@pytest.mark.asyncio
async def test_tv_missing_status_falls_back_to_live_when_indexed_empty() -> None:
    async def get_indexed_tv_existing_episodes(_tmdb_id: int) -> None:
        return None

    async def get_live_tv_episode_status(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 707
        return {"status": "ok", "existing_episodes": {(1, 1)}}

    async def get_tv_detail(tmdb_id: int) -> dict[str, Any]:
        assert tmdb_id == 707
        return {"seasons": [{"season_number": 1, "episode_count": 2}]}

    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        707,
        dependencies=_dependencies(
            get_indexed_tv_existing_episodes=get_indexed_tv_existing_episodes,
            get_live_tv_episode_status=get_live_tv_episode_status,
            get_tv_detail=get_tv_detail,
        ),
    )

    assert result == {"checked": True, "missing_count": 1}


@pytest.mark.asyncio
async def test_movie_status_logs_exception_and_returns_unchecked() -> None:
    fake_logger = FakeLogger()

    async def get_indexed_movie_status(_tmdb_id: int) -> dict[str, Any]:
        raise RuntimeError("index unavailable")

    result = await check_feiniu_movie_status_with_runtime_adapter(
        808,
        dependencies=_dependencies(
            get_indexed_movie_status=get_indexed_movie_status,
            logger=fake_logger,
        ),
    )

    assert result == {"checked": False}
    assert fake_logger.exceptions == [
        ("飞牛电影状态查询失败: tmdb_id=%s", (808,))
    ]


@pytest.mark.asyncio
async def test_tv_missing_status_logs_exception_and_returns_unchecked() -> None:
    fake_logger = FakeLogger()

    async def get_indexed_tv_existing_episodes(_tmdb_id: int) -> dict[str, Any]:
        raise RuntimeError("index unavailable")

    result = await check_feiniu_tv_missing_status_with_runtime_adapter(
        909,
        dependencies=_dependencies(
            get_indexed_tv_existing_episodes=get_indexed_tv_existing_episodes,
            logger=fake_logger,
        ),
    )

    assert result == {"checked": False}
    assert fake_logger.exceptions == [
        ("飞牛剧集缺集状态查询失败: tmdb_id=%s", (909,))
    ]


def test_default_runtime_dependencies_bind_existing_services() -> None:
    dependencies = build_default_feiniu_status_runtime_dependencies()

    assert dependencies.get_feiniu_url.__self__ is runtime_settings_service
    assert (
        dependencies.get_feiniu_url.__func__
        is type(runtime_settings_service).get_feiniu_url
    )
    assert dependencies.get_indexed_movie_status.__self__ is feiniu_sync_index_service
    assert (
        dependencies.get_indexed_movie_status.__func__
        is type(feiniu_sync_index_service).get_movie_status
    )
    assert dependencies.get_live_movie_status.__self__ is feiniu_service
    assert (
        dependencies.get_live_movie_status.__func__
        is type(feiniu_service).get_movie_status_by_tmdb
    )
    assert (
        dependencies.get_indexed_tv_existing_episodes.__self__
        is feiniu_sync_index_service
    )
    assert (
        dependencies.get_indexed_tv_existing_episodes.__func__
        is type(feiniu_sync_index_service).get_tv_existing_episodes
    )
    assert dependencies.get_live_tv_episode_status.__self__ is feiniu_service
    assert (
        dependencies.get_live_tv_episode_status.__func__
        is type(feiniu_service).get_tv_episode_status_by_tmdb
    )
    assert dependencies.get_tv_detail.__self__ is tmdb_service
    assert dependencies.get_tv_detail.__func__ is type(tmdb_service).get_tv_detail
    assert dependencies.logger is feiniu_status_logger


def test_feiniu_status_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/feiniu_status_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_feiniu_status_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.feiniu_status_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/feiniu_status_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/feiniu_status_runtime_adapter.py`:

```python
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.feiniu_service import feiniu_service
from app.services.feiniu_sync_index_service import feiniu_sync_index_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.tmdb_service import tmdb_service


logger = logging.getLogger(__name__)

GetFeiniuUrl = Callable[[], str]
GetIndexedMovieStatus = Callable[[int], Awaitable[dict[str, Any] | None]]
GetLiveMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetIndexedTvExistingEpisodes = Callable[[int], Awaitable[dict[str, Any] | None]]
GetLiveTvEpisodeStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetTvDetail = Callable[[int], Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class FeiniuStatusRuntimeDependencies:
    get_feiniu_url: GetFeiniuUrl
    get_indexed_movie_status: GetIndexedMovieStatus
    get_live_movie_status: GetLiveMovieStatus
    get_indexed_tv_existing_episodes: GetIndexedTvExistingEpisodes
    get_live_tv_episode_status: GetLiveTvEpisodeStatus
    get_tv_detail: GetTvDetail
    logger: Any


def build_default_feiniu_status_runtime_dependencies() -> (
    FeiniuStatusRuntimeDependencies
):
    return FeiniuStatusRuntimeDependencies(
        get_feiniu_url=runtime_settings_service.get_feiniu_url,
        get_indexed_movie_status=feiniu_sync_index_service.get_movie_status,
        get_live_movie_status=feiniu_service.get_movie_status_by_tmdb,
        get_indexed_tv_existing_episodes=(
            feiniu_sync_index_service.get_tv_existing_episodes
        ),
        get_live_tv_episode_status=(
            feiniu_service.get_tv_episode_status_by_tmdb
        ),
        get_tv_detail=tmdb_service.get_tv_detail,
        logger=logger,
    )


async def check_feiniu_movie_status_with_runtime_adapter(
    tmdb_id: int,
    *,
    dependencies: FeiniuStatusRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_feiniu_status_runtime_dependencies()
    )
    if not current_dependencies.get_feiniu_url().strip():
        return {"checked": False}
    try:
        indexed_result = await current_dependencies.get_indexed_movie_status(
            tmdb_id
        )
        if indexed_result is not None:
            if str(indexed_result.get("status") or "") == "ok" and bool(
                indexed_result.get("exists")
            ):
                return {
                    "checked": True,
                    "exists": True,
                    "item_ids": indexed_result.get("item_ids") or [],
                }
            return {
                "checked": True,
                "exists": False,
                "item_ids": [],
            }
        live_result = await current_dependencies.get_live_movie_status(tmdb_id)
        if str(live_result.get("status") or "") == "ok" and bool(
            live_result.get("exists")
        ):
            return {
                "checked": True,
                "exists": True,
                "item_ids": live_result.get("item_ids") or [],
            }
        if str(live_result.get("status") or "") == "not_logged_in":
            return {"checked": False}
        return {
            "checked": str(live_result.get("status") or "") == "ok",
            "exists": False,
            "item_ids": [],
        }
    except Exception:
        current_dependencies.logger.exception(
            "飞牛电影状态查询失败: tmdb_id=%s",
            tmdb_id,
        )
        return {"checked": False}


async def check_feiniu_tv_missing_status_with_runtime_adapter(
    tmdb_id: int,
    *,
    dependencies: FeiniuStatusRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_feiniu_status_runtime_dependencies()
    )
    if not current_dependencies.get_feiniu_url().strip():
        return {"checked": False}
    try:
        indexed_result = (
            await current_dependencies.get_indexed_tv_existing_episodes(tmdb_id)
        )
        feiniu_result = (
            indexed_result
            if indexed_result is not None
            else await current_dependencies.get_live_tv_episode_status(tmdb_id)
        )
        status_text = str(feiniu_result.get("status") or "")
        if status_text not in ("ok",):
            return {"checked": False}

        feiniu_existing = feiniu_result.get("existing_episodes") or set()
        feiniu_existing_pairs = {
            (int(p[0]), int(p[1]))
            for p in feiniu_existing
            if isinstance(p, (list, tuple)) and len(p) == 2
        } if isinstance(feiniu_existing, (list, set)) else feiniu_existing

        tmdb_detail = await current_dependencies.get_tv_detail(tmdb_id)
        seasons = (
            tmdb_detail.get("seasons")
            if isinstance(tmdb_detail, dict)
            else []
        )
        if not isinstance(seasons, list):
            seasons = []
        tmdb_pairs: set[tuple[int, int]] = set()
        for season in seasons:
            if not isinstance(season, dict):
                continue
            sn = season.get("season_number")
            ec = season.get("episode_count")
            if sn is None or ec is None:
                continue
            sn = int(sn)
            ec = int(ec)
            if sn == 0:
                continue
            for ep in range(1, ec + 1):
                tmdb_pairs.add((sn, ep))

        if not tmdb_pairs:
            return {"checked": False}

        missing = tmdb_pairs - feiniu_existing_pairs
        return {"checked": True, "missing_count": len(missing)}
    except Exception:
        current_dependencies.logger.exception(
            "飞牛剧集缺集状态查询失败: tmdb_id=%s",
            tmdb_id,
        )
        return {"checked": False}
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_feiniu_status_runtime_adapter.py
```

Expected: PASS.

## Task 3: Connect SubscriptionService Wrappers

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add imports and replace method bodies**

In `backend/app/services/subscription_service.py`, add:

```python
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
    check_feiniu_tv_missing_status_with_runtime_adapter,
)
```

Remove:

```python
from app.services.feiniu_service import feiniu_service
from app.services.feiniu_sync_index_service import feiniu_sync_index_service
```

Replace `_check_feiniu_movie_status()` with:

```python
    async def _check_feiniu_movie_status(
        self, tmdb_id: int
    ) -> dict[str, Any]:
        """检查电影在飞牛中是否已存在，返回 {"checked": bool, "exists": bool, "item_ids": list}"""
        return await check_feiniu_movie_status_with_runtime_adapter(tmdb_id)
```

Replace `_check_feiniu_tv_missing_status()` with:

```python
    async def _check_feiniu_tv_missing_status(
        self, tmdb_id: int
    ) -> dict[str, Any]:
        """检查剧集在飞牛中的缺集状态，返回 {"checked": bool, "missing_count": int}"""
        return await check_feiniu_tv_missing_status_with_runtime_adapter(tmdb_id)
```

- [ ] **Step 2: Run related targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_feiniu_status_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_completed_cleanup.py
```

Expected: PASS.

- [ ] **Step 3: Inspect direct Feiniu imports**

Run:

```bash
rg -n "feiniu_service|feiniu_sync_index_service|tmdb_service as _tmdb" backend/app/services/subscription_service.py backend/app/services/subscriptions/feiniu_status_runtime_adapter.py
```

Expected: Feiniu service imports appear only in `feiniu_status_runtime_adapter.py`; `subscription_service.py` only references the new wrapper names.

## Task 4: Commit and Verify

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Create: `backend/app/services/subscriptions/feiniu_status_runtime_adapter.py`
- Create: `backend/tests/test_subscription_feiniu_status_runtime_adapter.py`

- [ ] **Step 1: Check status**

Run:

```bash
git status --short
```

Expected: implementation files plus the two allowed pre-existing untracked files.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/feiniu_status_runtime_adapter.py backend/tests/test_subscription_feiniu_status_runtime_adapter.py
git commit -m "refactor: 抽离订阅飞牛状态 runtime adapter"
```

Expected: commit succeeds.

- [ ] **Step 3: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: PASS.

- [ ] **Step 6: Rebuild and start Docker service**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: command exits 0 and starts `mediasync115`.

- [ ] **Step 7: Wait for Docker health**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
```

Expected: exits 0 after printing `health=healthy`.

- [ ] **Step 8: Final state checks**

Run:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
git log --oneline -12
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- compose status shows `mediasync115` up and healthy.
- Docker inspect prints `healthy`.
- `git status --short` only shows:
  - `?? backend/scripts/export_hdhive_189_links.py`
  - `?? docs/next-session-prompt.md`
- `subscription_service.py` line count is lower than before this block.

## Self-Review

- Spec coverage: plan covers adapter creation, service wrapper connection, related regression tests, full verification, Docker health check, and final status constraints.
- Placeholder scan: no unresolved placeholder wording is present.
- Type consistency: test dependency names match `FeiniuStatusRuntimeDependencies`; implementation and service wrapper names match the planned imports.
