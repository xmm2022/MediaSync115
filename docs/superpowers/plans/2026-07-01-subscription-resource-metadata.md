# Subscription Resource Metadata Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription resource metadata helpers from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/resource_metadata.py` with pure functions for resource type/name extraction, search keyword construction, HDHive row normalization, share-code parsing, video filename detection, and transfer-error classification. `SubscriptionService` imports these helpers directly and removes local static helper implementations and pass-through wrappers.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Resource Metadata Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_metadata.py`

- [ ] **Step 1: Write failing tests**

Add tests that import:

```python
from app.services.subscriptions.resource_metadata import (
    build_hdhive_keyword,
    build_pansou_keyword,
    build_tg_keyword,
    determine_resource_type,
    extract_resource_name,
    is_already_received_error,
    is_likely_115_share_identifier,
    is_retryable_transfer_error,
    is_video_filename,
    normalize_hdhive_subscription_items,
    split_share_link_and_receive_code,
)
```

Required assertions:

```python
assert determine_resource_type("magnet:?xt=urn:btih:ABC") == "magnet"
assert determine_resource_type("ed2k://|file|a.mkv|1|hash|/") == "ed2k"
assert determine_resource_type("https://115.com/s/demo") == "pan115"

assert extract_resource_name({"resource_name": "资源 A"}) == "资源 A"
assert extract_resource_name({"title": "标题 B"}) == "标题 B"
assert extract_resource_name({}) == "未命名资源"

assert build_pansou_keyword("剧集", 2026) == "剧集 2026"
assert build_pansou_keyword("剧集", None) == "剧集"
assert build_hdhive_keyword(" 剧集 ", None) == "剧集"
assert build_tg_keyword("剧集", 2026) == "剧集 2026"
```

Add HDHive normalization assertions:

```python
items = normalize_hdhive_subscription_items([
    {"share_link": "https://115.com/s/a", "resource_name": "资源 A"},
    "bad",
])
assert items == [
    {
        "share_link": "https://115.com/s/a",
        "resource_name": "资源 A",
        "pan115_share_link": "https://115.com/s/a",
        "name": "资源 A",
    }
]
```

Add receive-code parsing assertions:

```python
assert split_share_link_and_receive_code("abc123-defg") == ("abc123", "defg")
assert split_share_link_and_receive_code("https://115.com/s/abc?password=Q1w2") == (
    "https://115.com/s/abc?password=Q1w2",
    "Q1w2",
)
assert split_share_link_and_receive_code("链接：https://115.com/s/abc 提取码：z9Y8") == (
    "链接：https://115.com/s/abc 提取码：z9Y8",
    "z9Y8",
)
assert split_share_link_and_receive_code("") == ("", "")
```

Add classifier assertions:

```python
assert is_video_filename("Movie.MKV")
assert not is_video_filename("poster.jpg")

assert is_likely_115_share_identifier("abc123-defg")
assert is_likely_115_share_identifier("https://115cdn.com/s/abc")
assert not is_likely_115_share_identifier("https://example.com/s/abc")

assert is_retryable_transfer_error("share_api_method_not_allowed")
assert is_retryable_transfer_error("code=404")
assert is_retryable_transfer_error("请求太频繁")
assert not is_retryable_transfer_error("invalid receive code")

assert is_already_received_error("4200045")
assert is_already_received_error("already received")
assert not is_already_received_error("timeout")
```

Add a dependency-boundary test that reads `backend/app/services/subscriptions/resource_metadata.py` and asserts it does not import `subscription_service`, `runtime_settings_service`, service clients, `AsyncSession`, `app.models`, or `app.api`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_metadata.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_metadata'`.

### Task 2: Extract Resource Metadata Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_metadata.py`
- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/tests/test_hdhive_unlock_policy.py`

- [ ] **Step 1: Implement helper module**

Implement:

```python
from __future__ import annotations

import re
from typing import Any


VIDEO_EXTENSIONS = (
    ".mp4",
    ".mkv",
    ".avi",
    ".ts",
    ".rmvb",
    ".flv",
    ".mov",
    ".wmv",
    ".m4v",
)


def determine_resource_type(url: str) -> str: ...
def extract_resource_name(item: dict[str, Any]) -> str: ...
def build_pansou_keyword(title: str, year: Any) -> str: ...
def build_hdhive_keyword(title: str, year: Any) -> str: ...
def build_tg_keyword(title: str, year: Any) -> str: ...
def normalize_hdhive_subscription_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]: ...
def split_share_link_and_receive_code(raw_link: str) -> tuple[str, str]: ...
def is_video_filename(filename: str) -> bool: ...
def is_likely_115_share_identifier(raw_link: str) -> bool: ...
def is_retryable_transfer_error(error_text: str) -> bool: ...
def is_already_received_error(error_text: str) -> bool: ...
```

Preserve the existing string matching and fallback behavior exactly.

- [ ] **Step 2: Delegate service logic**

Import the helper functions in `backend/app/services/subscription_service.py`. Replace private-helper call sites with direct functions:

```python
keyword = build_pansou_keyword(sub.title, sub.year)
resources = normalize_hdhive_subscription_items(resources)
keyword = build_hdhive_keyword(sub.title, sub.year)
keyword = build_tg_keyword(sub.title, sub.year)
extract_resource_url=extract_resource_url
normalize_share_url=normalize_share_url
resource_type = determine_resource_type(resource_url)
resource_name=extract_resource_name(item)
is_likely_115_share_identifier(...)
is_retryable_transfer_error(...)
share_link, receive_code = split_share_link_and_receive_code(...)
is_video_file=is_video_filename
is_already_received_error(...)
```

Remove old static methods for the extracted helpers. Remove unused pass-through wrappers for existing `resource_candidates.py` and `offline_transfer.py` functions. Remove now-unused imports.

- [ ] **Step 3: Update private-helper test usage**

In `backend/tests/test_hdhive_unlock_policy.py`, import:

```python
from app.services.subscriptions.resource_candidates import extract_resource_url
```

Replace:

```python
service._extract_resource_url(result[0])
service._extract_resource_url(result[1])
```

with:

```python
extract_resource_url(result[0])
extract_resource_url(result[1])
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_metadata.py tests/test_hdhive_unlock_policy.py tests/test_subscription_resource_candidates.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_failure.py tests/test_subscriptions.py tests/test_health.py
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
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/resource_metadata.py backend/tests/test_subscription_resource_metadata.py backend/tests/test_hdhive_unlock_policy.py
git commit -m "refactor: 抽离订阅资源元数据助手"
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
