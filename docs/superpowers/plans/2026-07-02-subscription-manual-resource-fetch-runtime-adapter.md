# 订阅手动资源抓取 Runtime Adapter Implementation Plan

## Goal

把 `SubscriptionService.fetch_resources_for_media()` 中的临时 `SubscriptionSnapshot` 构造和 `channel="all"` 调用封装到 `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`。

主服务 public method 保留原签名，只传入 public 参数和自身 `_fetch_resources` callback。

## Target Files

Create:

- `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`
- `backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py`

Modify:

- `backend/app/services/subscription_service.py`

## Step 1: Red Test

Create `backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py`.

Imports:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.models.models import MediaType
from app.services import subscription_service as subscription_service_module
from app.services.subscription_service import SubscriptionService
from app.services.subscriptions.manual_resource_fetch_runtime_adapter import (
    ManualResourceFetchRuntimeDependencies,
    build_default_manual_resource_fetch_runtime_dependencies,
    fetch_resources_for_media_with_runtime_adapter,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot
```

Test cases:

1. `test_adapter_builds_tv_snapshot_and_calls_fetch_resources`
   - Inject fake `fetch_resources(channel, sub)` that records arguments and returns marker tuple.
   - Call adapter with `media_type="tv"`, `tmdb_id=1001`, `douban_id="db1"`, `title="剧名"`, `year="2026"`, `season_number=2`.
   - Assert return value is marker tuple.
   - Assert `channel == "all"`.
   - Assert `sub` is `SubscriptionSnapshot` with:
     - `id == 0`
     - `tmdb_id == 1001`
     - `douban_id == "db1"`
     - `title == "剧名"`
     - `media_type is MediaType.TV`
     - `year == "2026"`
     - `auto_download is False`
     - `tv_scope == "all"`
     - `tv_season_number == 2`
     - `tv_episode_start is None`
     - `tv_episode_end is None`
     - `tv_follow_mode == "missing"`
     - `tv_include_specials is False`
     - `has_successful_transfer is False`

2. `test_adapter_maps_non_tv_media_type_to_movie_and_normalizes_blank_title`
   - Call adapter with `media_type="movie"` and `title=""`.
   - Assert `media_type is MediaType.MOVIE`.
   - Assert title remains empty string.
   - Call adapter with `media_type="unknown"` and `title=None` using `# type: ignore[arg-type]`.
   - Assert non-TV still maps to Movie and title becomes empty string.

3. `test_default_dependencies_bind_snapshot_media_types_and_fetch_callback`
   - `build_default_manual_resource_fetch_runtime_dependencies(fetch_resources=...)`.
   - Assert `snapshot_class is SubscriptionSnapshot`.
   - Assert TV/Movie media constants.
   - Assert callback identity.

4. `test_subscription_service_wrapper_passes_public_arguments_and_fetch_callback`
   - Monkeypatch `subscription_service_module.build_default_manual_resource_fetch_runtime_dependencies` to capture `fetch_resources`.
   - Monkeypatch `subscription_service_module.fetch_resources_for_media_with_runtime_adapter` to capture all arguments and return marker.
   - Call `SubscriptionService().fetch_resources_for_media(...)`.
   - Assert wrapper passes public args unchanged and dependencies marker.
   - Assert builder received `service._fetch_resources` as a bound method.

5. `test_manual_resource_fetch_runtime_adapter_module_boundary`
   - Read module source.
   - Assert no `subscription_service`, `app.api`, or `AsyncSession`.

Expected red command:

```bash
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py -q
```

Expected failure:

```text
ModuleNotFoundError: No module named 'app.services.subscriptions.manual_resource_fetch_runtime_adapter'
```

## Step 2: Implement Adapter

Create `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.models.models import MediaType
from app.services.subscriptions.snapshot import SubscriptionSnapshot


FetchResources = Callable[
    [str, Any],
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]


@dataclass(frozen=True, slots=True)
class ManualResourceFetchRuntimeDependencies:
    snapshot_class: type[SubscriptionSnapshot]
    tv_media_type: Any
    movie_media_type: Any
    fetch_resources: FetchResources


def build_default_manual_resource_fetch_runtime_dependencies(
    *,
    fetch_resources: FetchResources,
) -> ManualResourceFetchRuntimeDependencies:
    return ManualResourceFetchRuntimeDependencies(
        snapshot_class=SubscriptionSnapshot,
        tv_media_type=MediaType.TV,
        movie_media_type=MediaType.MOVIE,
        fetch_resources=fetch_resources,
    )


async def fetch_resources_for_media_with_runtime_adapter(
    *,
    media_type: str,
    tmdb_id: int | None = None,
    douban_id: str | None = None,
    title: str = "",
    year: str | None = None,
    season_number: int | None = None,
    dependencies: ManualResourceFetchRuntimeDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    resolved_media_type = (
        dependencies.tv_media_type
        if media_type == "tv"
        else dependencies.movie_media_type
    )
    snapshot = dependencies.snapshot_class(
        id=0,
        tmdb_id=tmdb_id,
        douban_id=douban_id,
        title=title or "",
        media_type=resolved_media_type,
        year=year,
        auto_download=False,
        tv_scope="all",
        tv_season_number=season_number,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_follow_mode="missing",
        tv_include_specials=False,
        has_successful_transfer=False,
    )
    return await dependencies.fetch_resources("all", snapshot)
```

## Step 3: Wire SubscriptionService

Modify imports:

```python
from app.services.subscriptions.manual_resource_fetch_runtime_adapter import (
    build_default_manual_resource_fetch_runtime_dependencies,
    fetch_resources_for_media_with_runtime_adapter,
)
```

Replace `fetch_resources_for_media()` body:

```python
return await fetch_resources_for_media_with_runtime_adapter(
    media_type=media_type,
    tmdb_id=tmdb_id,
    douban_id=douban_id,
    title=title,
    year=year,
    season_number=season_number,
    dependencies=build_default_manual_resource_fetch_runtime_dependencies(
        fetch_resources=self._fetch_resources,
    ),
)
```

Remove local import:

```python
from app.models.models import MediaType
```

## Step 4: Green Tests

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py -q
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_fetch_resources_waterfall.py -q
```

If tests fail, inspect whether the mismatch is:

- wrong snapshot default field,
- wrong media type mapping,
- wrong callback identity,
- wrong channel value,
- or wrapper argument drift.

Do not change resource resolver/fetcher behavior for this block.

## Step 5: Pre-Commit Checks

Run:

```bash
git diff --check
rg -n "fetch_resources_for_media_with_runtime_adapter|build_default_manual_resource_fetch_runtime_dependencies|from app.models.models import MediaType" backend/app/services/subscription_service.py backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py
wc -l backend/app/services/subscription_service.py
```

Expected:

- `subscription_service.py` imports the new adapter wrapper/builder.
- `subscription_service.py` no longer has a local `MediaType` import inside `fetch_resources_for_media()`.
- New adapter imports `MediaType` and `SubscriptionSnapshot`.

Commit:

```bash
git add backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py
git commit -m "refactor: 抽离订阅手动资源抓取 runtime adapter"
```

## Step 6: Completion Verification

After implementation commit, run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_fetch_resources_waterfall.py -q
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

- Targeted tests pass.
- Backend full test suite passes.
- Frontend build passes; Vite chunk-size warning is acceptable.
- Quick verify passes.
- Container starts and becomes healthy.
- `/healthz` returns `{"status":"healthy"}`.
- `git status --short` only shows:
  - `?? backend/scripts/export_hdhive_189_links.py`
  - `?? docs/next-session-prompt.md`

## Risk Notes

- The main compatibility risk is snapshot field drift, especially `tv_scope`, `tv_follow_mode`, `season_number`, and non-TV fallback to Movie.
- Keep `channel="all"` in the adapter because the manual search API currently depends on all sources being eligible.
- Do not normalize arbitrary media type strings beyond current behavior; only exact `"tv"` maps to TV.
