# Subscription TV Episode Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract TV missing-episode file selection into a pure subscriptions helper module.

**Architecture:** Add `backend/app/services/subscriptions/tv_episode_selection.py` with a small result dataclass and selector function. Update `SubscriptionService` and `subscription_source_service` to delegate to it while preserving existing external method/function names.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend scripts, Docker Compose deployment.

---

### Task 1: TV Episode Selection Tests

**Files:**
- Create: `backend/tests/test_subscription_tv_episode_selection.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.subscriptions.tv_episode_selection import (
    select_missing_episode_files,
)


ROOT = Path(__file__).resolve().parents[2]


def test_select_missing_episode_files_picks_best_candidate_per_missing_pair() -> None:
    files = [
        {"fid": "low", "name": "Show.S01E02.720p.mkv", "size": 100},
        {"fid": "high", "name": "Show.S01E02.1080p.mkv", "size": 200},
        {"fid": "other", "name": "Show.S01E03.1080p.mkv", "size": 300},
    ]

    def pick_largest(items: list[dict[str, Any]], _quality: dict[str, Any]) -> dict[str, Any]:
        return max(items, key=lambda item: int(item.get("size") or 0))

    result = select_missing_episode_files(
        files,
        missing_episodes={(1, 2)},
        quality_filter={},
        best_picker=pick_largest,
    )

    assert [item["fid"] for item in result.selected_items] == ["high"]
    assert result.selected_file_ids == ["high"]
    assert result.matched_pairs == {(1, 2)}
    assert result.matched_missing_count == 2
    assert result.parsed_count == 3
    assert result.unparsed_video_count == 0


def test_select_missing_episode_files_respects_selected_ids_and_counts_unparsed_video() -> None:
    files = [
        {"fid": "1", "name": "Show.S01E01.mkv"},
        {"fid": "2", "name": "Unparsed.Special.mkv"},
        {"fid": "3", "name": "Show.S01E02.txt"},
    ]

    result = select_missing_episode_files(
        files,
        missing_episodes={(1, 1), (1, 2)},
        selected_file_ids={"1", "2"},
    )

    assert result.selected_file_ids == ["1"]
    assert result.matched_pairs == {(1, 1)}
    assert result.parsed_count == 1
    assert result.unparsed_video_count == 1


def test_tv_episode_selection_module_does_not_import_service_or_api_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/tv_episode_selection.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "pan115_service" not in source
    assert "runtime_settings_service" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run tests to verify RED**

Run: `scripts/verify-backend.sh -- tests/test_subscription_tv_episode_selection.py`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.tv_episode_selection'`.

### Task 2: Extract Selector And Preserve Wrappers

**Files:**
- Create: `backend/app/services/subscriptions/tv_episode_selection.py`
- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/app/services/subscription_source_service.py`

- [ ] **Step 1: Implement selector**

Implement `MissingEpisodeFileSelection`, `is_video_filename`, `item_file_id`, and `select_missing_episode_files()`.

- [ ] **Step 2: Update subscription source wrapper**

Keep `subscription_source_service.select_missing_episode_files()` returning `(selected_items, parsed_count, unparsed_video_count)` by delegating to the new selector with `Pan115Service.pick_best_video_file`.

- [ ] **Step 3: Update auto-transfer TV branch**

Replace the local file parsing block in `_auto_save_resources()` with the new selector result. Keep share listing, save calls, logs, and cleanup in place.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_tv_episode_selection.py tests/test_subscription_source_scan.py tests/test_subscription_source_service.py tests/test_subscription_link_fallback.py
```

Expected: all selected tests pass.

### Task 3: Verification, Commit, Deploy

- [ ] **Step 1: Verify**

Run:

```bash
scripts/verify-backend.sh --quick
scripts/verify-backend.sh
scripts/verify-frontend.sh --build
scripts/verify.sh --quick
git diff --check
```

Expected: all commands exit 0. The existing Vite chunk-size warning may remain.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-07-01-subscription-tv-episode-selection-design.md docs/superpowers/plans/2026-07-01-subscription-tv-episode-selection.md backend/app/services/subscriptions/tv_episode_selection.py backend/app/services/subscription_service.py backend/app/services/subscription_source_service.py backend/tests/test_subscription_tv_episode_selection.py
git commit -m "refactor: 抽离订阅缺集文件选择逻辑"
```

- [ ] **Step 3: Rebuild and health check**

Run:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
```

Expected: health endpoint returns `{"status":"healthy"}` and Docker health is `healthy`.
