# Subscription Quality Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription quality-filter configuration assembly from `subscription_service.py` into a dependency-injected helper module.

**Architecture:** Add `app.services.subscriptions.quality_filter` with a dataclass representing already-read runtime preferences and a pure builder function. Keep `SubscriptionService` responsible for reading `runtime_settings_service`, then delegate dict assembly to the helper.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper modules.

---

### Task 1: Add Quality Filter Tests

**Files:**
- Create: `backend/tests/test_subscription_quality_filter.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
```

Test cases:

- `test_build_subscription_quality_filter_merges_hdr_and_codec_preferences()`
- `test_build_subscription_quality_filter_converts_empty_lists_to_none()`
- `test_build_subscription_quality_filter_preserves_language_subtitle_and_size_values()`
- `test_quality_filter_module_stays_dependency_injected()`

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_quality_filter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.quality_filter'`.

### Task 2: Implement Quality Filter Helper

**Files:**
- Create: `backend/app/services/subscriptions/quality_filter.py`

- [ ] **Step 1: Add dataclass**

Create the helper shell:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SubscriptionQualityPreferences:
    preferred_resolutions: list[str]
    preferred_hdr: list[str]
    preferred_codec: list[str]
    exclude_labels: list[str]
    preferred_audio: list[str]
    preferred_subtitles: list[str]
    min_size_gb: float | None
    max_size_gb: float | None
```

- [ ] **Step 2: Implement `build_subscription_quality_filter()`**

Add the extracted rule:

```python
def build_subscription_quality_filter(
    preferences: SubscriptionQualityPreferences,
) -> dict[str, Any]:
    preferred_formats = (
        preferences.preferred_hdr or []
    ) + (preferences.preferred_codec or [])
    return {
        "preferred_resolutions": preferences.preferred_resolutions or None,
        "preferred_formats": preferred_formats or None,
        "exclude_labels": preferences.exclude_labels or None,
        "preferred_languages": preferences.preferred_audio or None,
        "preferred_subtitles": preferences.preferred_subtitles or None,
        "min_size_gb": preferences.min_size_gb,
        "max_size_gb": preferences.max_size_gb,
    }
```

- [ ] **Step 3: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_quality_filter.py
```

Expected: PASS.

### Task 3: Replace Service Quality Filter with Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper**

```python
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
```

- [ ] **Step 2: Replace `_resolve_subscription_quality_filter()` body**

Preserve the existing method signature and runtime getter calls:

```python
def _resolve_subscription_quality_filter(self, sub: "SubscriptionSnapshot") -> dict[str, Any]:
    _ = sub
    return build_subscription_quality_filter(
        SubscriptionQualityPreferences(
            preferred_resolutions=(
                runtime_settings_service.get_resource_preferred_resolutions()
            ),
            preferred_hdr=runtime_settings_service.get_resource_preferred_hdr(),
            preferred_codec=runtime_settings_service.get_resource_preferred_codec(),
            exclude_labels=runtime_settings_service.get_resource_exclude_tags(),
            preferred_audio=runtime_settings_service.get_resource_preferred_audio(),
            preferred_subtitles=(
                runtime_settings_service.get_resource_preferred_subtitles()
            ),
            min_size_gb=runtime_settings_service.get_resource_min_size_gb(),
            max_size_gb=runtime_settings_service.get_resource_max_size_gb(),
        )
    )
```

- [ ] **Step 3: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_quality_filter.py tests/test_resource_tags_quality.py tests/test_fetch_resources_waterfall.py tests/test_fixed_source_scan.py tests/test_subscription_auto_transfer_batch.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

```bash
git add backend/app/services/subscriptions/quality_filter.py backend/app/services/subscription_service.py backend/tests/test_subscription_quality_filter.py
git commit -m "refactor: 抽离订阅质量过滤"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_quality_filter.py tests/test_resource_tags_quality.py tests/test_fetch_resources_waterfall.py tests/test_fixed_source_scan.py tests/test_subscription_auto_transfer_batch.py
```

Expected: exit 0.

- [ ] **Step 2: Run backend full verification**

```bash
scripts/verify-backend.sh
```

Expected: exit 0.

- [ ] **Step 3: Run frontend build**

```bash
npm --prefix frontend run build
```

Expected: exit 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run quick verification**

```bash
scripts/verify.sh --quick
```

Expected: exit 0.

- [ ] **Step 5: Build and start Docker service**

```bash
docker compose up -d --build mediasync115
```

Expected: exit 0.

- [ ] **Step 6: Check health**

```bash
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true)
  echo "health=$status"
  if [ "$status" = healthy ]; then exit 0; fi
  sleep 2
done
exit 1
```

Then verify the HTTP endpoint and compose state:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and the service health is `healthy`.

- [ ] **Step 7: Confirm worktree state**

```bash
git status --short
```

Expected: only these existing untracked files remain:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: the plan covers HDR/codec merge order, empty list normalization, language/subtitle/size passthrough, dependency boundary, service adapter wiring, targeted regressions, full verification, Docker health, and final worktree state.
- 占位符扫描：没有未完成实现步骤。
- Type consistency: `SubscriptionQualityPreferences` and `build_subscription_quality_filter()` names match tests, helper, and service imports.
