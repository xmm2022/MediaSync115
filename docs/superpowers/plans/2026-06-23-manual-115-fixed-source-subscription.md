# Manual 115 Fixed Source Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional manual 115 share-link fixed source mode that repeatedly scans user-provided links for new/missing TV episodes without changing the existing automatic search subscription mode.

**Architecture:** Store manual fixed sources in dedicated tables, expose source CRUD/scan APIs under subscriptions, and run fixed-source scans as an extra step in the existing subscription scheduler. Keep the fixed-source scan logic in a focused service so the large `subscription_service.py` only orchestrates it.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, SQLite startup schema helpers, existing `Pan115Service`, existing `tv_missing_service`, Vue 3, Element Plus, Node built-in test runner for frontend policy tests, pytest for backend tests.

---

## File Map

- Create `backend/app/services/subscription_source_service.py`
  - Owns manual source creation, listing, status updates, fixed-link scan, and file-state persistence.
- Modify `backend/app/models/models.py`
  - Adds `SubscriptionSource` and `SubscriptionSourceFile` ORM models and relationships.
- Modify `backend/app/core/database.py`
  - Adds startup DDL/index guards for new source tables if `create_all` is not enough on existing databases.
- Modify `backend/app/api/subscriptions.py`
  - Adds source request/response models and source CRUD/scan endpoints.
  - Enriches list/get subscription payloads with source summaries.
- Modify `backend/app/services/subscription_service.py`
  - Calls the fixed-source scanner after existing search/auto-transfer logic.
  - Fixes the existing `counts` variable bug in TV missing logging.
- Modify `frontend/src/api/index.js`
  - Adds `subscriptionApi` source methods.
- Modify `frontend/src/views/TvDetail.vue`
  - Extends manual 115 import dialog with mode selection and source creation.
- Modify `frontend/src/views/Subscriptions.vue`
  - Displays fixed source link/status/actions on TV subscription cards/settings.
- Keep current HDHive behavior unchanged.
- Keep current automatic search behavior unchanged.

---

### Task 0: Stabilize Existing 115 Credential 401 Fix

**Files:**
- Create: `frontend/src/api/authErrorPolicy.js`
- Create: `frontend/tests/api/authErrorPolicy.test.js`
- Modify: `frontend/src/api/index.js`

- [ ] **Step 1: Write the failing frontend policy test**

Create `frontend/tests/api/authErrorPolicy.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldRedirectToLoginForUnauthorized } from '../../src/api/authErrorPolicy.js'

test('pan115 credential 401 does not trigger app login redirect', () => {
  const error = {
    response: {
      status: 401,
      data: {
        detail: '115网盘Cookie无效或未配置，请在设置中更新Cookie',
      },
    },
    config: {
      url: '/pan115/share/extract-files',
    },
  }

  assert.equal(shouldRedirectToLoginForUnauthorized(error), false)
})

test('app session 401 still triggers login redirect', () => {
  const error = {
    response: {
      status: 401,
      data: {
        detail: '请先登录',
      },
    },
    config: {
      url: '/settings/app-info',
    },
  }

  assert.equal(shouldRedirectToLoginForUnauthorized(error), true)
})

test('object detail credential 401 keeps existing no-redirect behavior', () => {
  const error = {
    response: {
      status: 401,
      data: {
        detail: {
          code: 'cookie_invalid',
          message: 'Cookie invalid',
        },
      },
    },
    config: {
      url: '/quark/share/save-to-folder',
    },
  }

  assert.equal(shouldRedirectToLoginForUnauthorized(error), false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd frontend
node --test tests/api/authErrorPolicy.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/api/authErrorPolicy.js`.

- [ ] **Step 3: Implement the minimal auth error policy helper**

Create `frontend/src/api/authErrorPolicy.js`:

```js
const RESOURCE_CREDENTIAL_401_PATH_PREFIXES = [
  '/pan115/',
]

const normalizeRequestPath = (rawUrl) => {
  const value = String(rawUrl || '').trim()
  if (!value) return ''

  try {
    const parsed = new URL(value, 'http://localhost')
    const path = parsed.pathname || ''
    return path.startsWith('/api/') ? path.slice(4) : path
  } catch {
    const path = value.split('?')[0].split('#')[0]
    if (path.startsWith('/api/')) return path.slice(4)
    return path.startsWith('/') ? path : `/${path}`
  }
}

const isAuthEndpoint = (path) => (
  path === '/auth/login'
  || path === '/auth/logout'
  || path === '/auth/session'
)

const isResourceCredentialEndpoint = (path) => (
  RESOURCE_CREDENTIAL_401_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
)

export const shouldRedirectToLoginForUnauthorized = (error) => {
  if (Number(error?.response?.status || 0) !== 401) return false

  const path = normalizeRequestPath(error?.config?.url)
  if (isAuthEndpoint(path)) return false

  const rawDetail = error?.response?.data?.detail
  if (rawDetail && typeof rawDetail === 'object') return false

  if (isResourceCredentialEndpoint(path)) return false

  return true
}
```

- [ ] **Step 4: Wire the helper into the axios response interceptor**

Modify the top of `frontend/src/api/index.js`:

```js
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { BEIJING_TIMEZONE } from '@/utils/timezone'
import { shouldRedirectToLoginForUnauthorized } from '@/api/authErrorPolicy'
```

Replace the existing unauthorized redirect condition with:

```js
if (shouldRedirectToLoginForUnauthorized(error)) {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    import('@/router').then(({ default: router, resetAuthSessionCache }) => {
      resetAuthSessionCache()
      router.replace('/login')
    }).catch(() => {
      window.location.href = '/login'
    })
  }
  return Promise.reject(error)
}
```

Remove these local variables from the interceptor:

```js
const isAuthLoginRequest = requestUrl.includes('/auth/login')
const isAuthLogoutRequest = requestUrl.includes('/auth/logout')
const isUnauthorized = error.response?.status === 401
const isResourceCredentialError = Boolean(rawDetail && typeof rawDetail === 'object')
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd frontend
node --test tests/api/authErrorPolicy.test.js
node --check src/api/authErrorPolicy.js
node --check src/api/index.js
```

Expected: all 3 tests pass and both syntax checks exit 0.

Commit:

```bash
git add frontend/src/api/index.js frontend/src/api/authErrorPolicy.js frontend/tests/api/authErrorPolicy.test.js
git commit -m "fix: keep pan115 credential errors on current page"
```

---

### Task 1: Add Subscription Source Models and Startup Schema

**Files:**
- Modify: `backend/app/models/models.py`
- Modify: `backend/app/core/database.py`
- Test: `backend/tests/test_subscription_source_models.py`

- [ ] **Step 1: Write the failing model/schema test**

Create `backend/tests/test_subscription_source_models.py`:

```python
import pytest
from sqlalchemy import inspect


@pytest.mark.asyncio
async def test_subscription_source_tables_are_registered():
    from app.core.database import Base, engine, ensure_tables_exist
    from app.models.models import SubscriptionSource, SubscriptionSourceFile

    assert SubscriptionSource.__tablename__ == "subscription_sources"
    assert SubscriptionSourceFile.__tablename__ == "subscription_source_files"
    assert "subscription_sources" in Base.metadata.tables
    assert "subscription_source_files" in Base.metadata.tables

    await ensure_tables_exist("subscription_sources", "subscription_source_files")

    async with engine.begin() as conn:
        tables = await conn.run_sync(
            lambda sync_conn: set(inspect(sync_conn).get_table_names())
        )

    assert "subscription_sources" in tables
    assert "subscription_source_files" in tables
```

- [ ] **Step 2: Run the model/schema test to verify it fails**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_models.py -q
```

Expected: FAIL with import error or missing model/table assertion.

- [ ] **Step 3: Add ORM models and relationships**

Modify imports in `backend/app/models/models.py`:

```python
from sqlalchemy.orm import Mapped, mapped_column, relationship
```

Extend `Subscription`:

```python
    sources: Mapped[list["SubscriptionSource"]] = relationship(
        "SubscriptionSource",
        back_populates="subscription",
        cascade="all, delete-orphan",
    )
```

Add after `DownloadRecord`:

```python
class SubscriptionSource(Base):
    __tablename__ = "subscription_sources"
    __table_args__ = (
        Index("ix_subscription_sources_subscription_id", "subscription_id"),
        Index("ix_subscription_sources_enabled", "enabled"),
        UniqueConstraint(
            "subscription_id",
            "source_type",
            "share_url",
            name="uq_subscription_source_share_url",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subscription_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subscriptions.id"), nullable=False, index=True
    )
    source_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="manual_pan115_share"
    )
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    share_url: Mapped[str] = mapped_column(Text, nullable=False)
    receive_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_scanned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_scan_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="never"
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_found_episode: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_transferred_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=beijing_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=beijing_now, onupdate=beijing_now
    )

    subscription: Mapped["Subscription"] = relationship(
        "Subscription", back_populates="sources"
    )
    files: Mapped[list["SubscriptionSourceFile"]] = relationship(
        "SubscriptionSourceFile",
        back_populates="source",
        cascade="all, delete-orphan",
    )


class SubscriptionSourceFile(Base):
    __tablename__ = "subscription_source_files"
    __table_args__ = (
        Index("ix_subscription_source_files_source_id", "source_id"),
        Index("ix_subscription_source_files_episode", "source_id", "season_number", "episode_number"),
        UniqueConstraint("source_id", "fingerprint", name="uq_subscription_source_file_fingerprint"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subscription_sources.id"), nullable=False, index=True
    )
    share_file_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    season_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(700), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="seen")
    download_record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("download_records.id"), nullable=True, index=True
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=beijing_now)
    transferred_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    source: Mapped["SubscriptionSource"] = relationship(
        "SubscriptionSource", back_populates="files"
    )
```

- [ ] **Step 4: Add startup schema guards**

Modify `backend/app/core/database.py`:

```python
SUBSCRIPTION_SOURCE_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS ix_subscription_sources_subscription_id "
    "ON subscription_sources (subscription_id)",
    "CREATE INDEX IF NOT EXISTS ix_subscription_sources_enabled "
    "ON subscription_sources (enabled)",
    "CREATE INDEX IF NOT EXISTS ix_subscription_source_files_source_id "
    "ON subscription_source_files (source_id)",
    "CREATE INDEX IF NOT EXISTS ix_subscription_source_files_episode "
    "ON subscription_source_files (source_id, season_number, episode_number)",
)
```

Update `ensure_performance_indexes()`:

```python
async def ensure_performance_indexes() -> None:
    async with engine.begin() as conn:
        for ddl in PERFORMANCE_INDEX_SQL:
            await conn.execute(text(ddl))
        existing_tables = await conn.run_sync(
            lambda sync_conn: set(inspect(sync_conn).get_table_names())
        )
        if {"subscription_sources", "subscription_source_files"}.issubset(existing_tables):
            for ddl in SUBSCRIPTION_SOURCE_INDEX_SQL:
                await conn.execute(text(ddl))
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_models.py -q
python3 -m py_compile app/models/models.py app/core/database.py
```

Expected: test passes and py_compile exits 0.

Commit:

```bash
git add backend/app/models/models.py backend/app/core/database.py backend/tests/test_subscription_source_models.py
git commit -m "feat: add subscription source tables"
```

---

### Task 2: Implement Source CRUD Service

**Files:**
- Create: `backend/app/services/subscription_source_service.py`
- Test: `backend/tests/test_subscription_source_service.py`

- [ ] **Step 1: Write failing service tests**

Create `backend/tests/test_subscription_source_service.py`:

```python
import pytest

from app.models.models import MediaType, Subscription


@pytest.mark.asyncio
async def test_create_manual_source_requires_tv_subscription(tmp_path):
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        movie = Subscription(
            tmdb_id=1001,
            title="Movie",
            media_type=MediaType.MOVIE,
            auto_download=True,
        )
        db.add(movie)
        await db.commit()
        await db.refresh(movie)

        with pytest.raises(ValueError, match="仅支持电视剧订阅"):
            await subscription_source_service.create_manual_pan115_source(
                db,
                subscription_id=movie.id,
                share_url="https://115.com/s/abc123?password=abcd",
                receive_code="",
                display_name="Manual",
            )


@pytest.mark.asyncio
async def test_create_manual_source_stores_receive_code_from_link():
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        sub = Subscription(
            tmdb_id=2002,
            title="Show",
            media_type=MediaType.TV,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)

        source = await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=sub.id,
            share_url="https://115.com/s/abc123?password=abcd",
            receive_code="",
            display_name="Manual",
        )
        await db.commit()

        assert source.source_type == "manual_pan115_share"
        assert source.share_url == "https://115.com/s/abc123?password=abcd"
        assert source.receive_code == "abcd"
        assert source.enabled is True
        assert source.last_scan_status == "never"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_service.py -q
```

Expected: FAIL because `subscription_source_service` does not exist.

- [ ] **Step 3: Implement CRUD service skeleton**

Create `backend/app/services/subscription_source_service.py`:

```python
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import MediaType, Subscription, SubscriptionSource
from app.services.pan115_service import Pan115Service


MANUAL_PAN115_SOURCE = "manual_pan115_share"


def _sanitize_receive_code(value: str | None) -> str:
    text = "".join(ch for ch in str(value or "").strip() if ch.isalnum())
    return text[:4] if len(text) >= 4 else ""


def _extract_receive_code_from_url(value: str) -> str:
    import re
    from urllib.parse import parse_qs, urlparse

    text = str(value or "").strip()
    try:
        parsed = urlparse(text)
        query = parse_qs(parsed.query)
        for key in ("password", "pwd", "receive_code"):
            raw = (query.get(key) or [""])[0]
            code = _sanitize_receive_code(raw)
            if code:
                return code
    except Exception:
        pass

    match = re.search(r"(?:提取码|提取碼|密码|密碼|password|pwd)\s*[:：=]?\s*([A-Za-z0-9]{4})", text, re.I)
    return _sanitize_receive_code(match.group(1)) if match else ""


class SubscriptionSourceService:
    async def create_manual_pan115_source(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        share_url: str,
        receive_code: str = "",
        display_name: str = "",
    ) -> SubscriptionSource:
        normalized_url = str(share_url or "").strip()
        if not normalized_url:
            raise ValueError("分享链接不能为空")

        pan_service = Pan115Service("")
        share_code = pan_service._extract_share_code(normalized_url)
        if not share_code:
            raise ValueError("无效的 115 分享链接")

        result = await db.execute(
            select(Subscription).where(Subscription.id == int(subscription_id))
        )
        subscription = result.scalar_one_or_none()
        if subscription is None:
            raise ValueError("订阅不存在")
        if subscription.media_type != MediaType.TV:
            raise ValueError("固定来源仅支持电视剧订阅")

        final_receive_code = _sanitize_receive_code(receive_code) or _extract_receive_code_from_url(normalized_url)
        source = SubscriptionSource(
            subscription_id=subscription.id,
            source_type=MANUAL_PAN115_SOURCE,
            display_name=str(display_name or "").strip() or subscription.title,
            share_url=normalized_url,
            receive_code=final_receive_code or None,
            enabled=True,
            last_scan_status="never",
            last_transferred_count=0,
        )
        db.add(source)
        await db.flush()
        return source

    async def list_sources(self, db: AsyncSession, subscription_id: int) -> list[SubscriptionSource]:
        result = await db.execute(
            select(SubscriptionSource)
            .where(SubscriptionSource.subscription_id == int(subscription_id))
            .order_by(SubscriptionSource.created_at.desc())
        )
        return list(result.scalars().all())

    async def update_source_enabled(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        source_id: int,
        enabled: bool,
    ) -> SubscriptionSource:
        source = await self.get_source(db, subscription_id=subscription_id, source_id=source_id)
        source.enabled = bool(enabled)
        source.updated_at = beijing_now()
        await db.flush()
        return source

    async def delete_source(self, db: AsyncSession, *, subscription_id: int, source_id: int) -> None:
        source = await self.get_source(db, subscription_id=subscription_id, source_id=source_id)
        await db.delete(source)
        await db.flush()

    async def get_source(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        source_id: int,
    ) -> SubscriptionSource:
        result = await db.execute(
            select(SubscriptionSource).where(
                SubscriptionSource.id == int(source_id),
                SubscriptionSource.subscription_id == int(subscription_id),
            )
        )
        source = result.scalar_one_or_none()
        if source is None:
            raise ValueError("固定来源不存在")
        return source


subscription_source_service = SubscriptionSourceService()
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_service.py -q
python3 -m py_compile app/services/subscription_source_service.py
```

Expected: tests pass and py_compile exits 0.

Commit:

```bash
git add backend/app/services/subscription_source_service.py backend/tests/test_subscription_source_service.py
git commit -m "feat: add subscription source service"
```

---

### Task 3: Implement Fixed Source Scan Logic

**Files:**
- Modify: `backend/app/services/subscription_source_service.py`
- Modify: `backend/app/services/subscription_service.py`
- Test: `backend/tests/test_subscription_source_scan.py`

- [ ] **Step 1: Write failing scan selection tests**

Create `backend/tests/test_subscription_source_scan.py`:

```python
from app.services.subscription_source_service import (
    build_source_file_fingerprint,
    select_missing_episode_files,
)


def test_build_source_file_fingerprint_prefers_file_id():
    item = {"fid": "987", "name": "Show.S01E02.mkv", "size": 123}
    assert build_source_file_fingerprint(item) == "fid:987"


def test_build_source_file_fingerprint_falls_back_to_name_and_size():
    item = {"name": "Show.S01E02.mkv", "size": 123}
    assert build_source_file_fingerprint(item) == "name:Show.S01E02.mkv|size:123"


def test_select_missing_episode_files_picks_only_missing_pairs():
    files = [
        {"fid": "1", "name": "Show.S01E01.1080p.mkv", "size": 1000},
        {"fid": "2", "name": "Show.S01E02.1080p.mkv", "size": 2000},
        {"fid": "3", "name": "sample.txt", "size": 10},
    ]

    selected, parsed_count, unparsed_count = select_missing_episode_files(
        files,
        missing_episodes={(1, 2)},
        quality_filter={},
    )

    assert [item["fid"] for item in selected] == ["2"]
    assert parsed_count == 2
    assert unparsed_count == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_scan.py -q
```

Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Add pure scan helpers**

Add to `backend/app/services/subscription_source_service.py`:

```python
from app.utils.name_parser import name_parser


VIDEO_EXTENSIONS = (".mp4", ".mkv", ".avi", ".rmvb", ".flv", ".ts", ".m2ts", ".mov", ".wmv", ".m4v", ".webm")


def is_video_filename(filename: str) -> bool:
    return str(filename or "").strip().lower().endswith(VIDEO_EXTENSIONS)


def build_source_file_fingerprint(item: dict[str, Any]) -> str:
    fid = str(item.get("fid") or item.get("file_id") or "").strip()
    if fid:
        return f"fid:{fid}"
    name = str(item.get("name") or "").strip()
    size = item.get("size") or item.get("file_size") or 0
    return f"name:{name}|size:{int(size or 0)}"


def select_missing_episode_files(
    files: list[dict[str, Any]],
    *,
    missing_episodes: set[tuple[int, int]],
    quality_filter: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], int, int]:
    matched_candidates: dict[tuple[int, int], list[dict[str, Any]]] = {}
    parsed_count = 0
    unparsed_video_count = 0
    for item in files:
        if not isinstance(item, dict):
            continue
        filename = str(item.get("name") or "").strip()
        fid = str(item.get("fid") or item.get("file_id") or "").strip()
        if not filename or not fid:
            continue
        if not is_video_filename(filename):
            continue
        parsed = name_parser.parse_episode(filename)
        if parsed:
            parsed_count += 1
            pair = (int(parsed[0]), int(parsed[1]))
            if pair in missing_episodes:
                matched_candidates.setdefault(pair, []).append(item)
            continue
        unparsed_video_count += 1

    selected: list[dict[str, Any]] = []
    pan_service = Pan115Service("")
    for items in matched_candidates.values():
        if len(items) > 1:
            selected.append(pan_service.pick_best_video_file(items, quality_filter or {}) or items[0])
        else:
            selected.extend(items)
    return selected, parsed_count, unparsed_video_count
```

- [ ] **Step 4: Add scan method**

Add to `SubscriptionSourceService`:

```python
    async def scan_manual_pan115_source(
        self,
        db: AsyncSession,
        *,
        source: SubscriptionSource,
        subscription: Any,
        pan_service: Pan115Service,
        parent_folder_id: str,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if source.source_type != MANUAL_PAN115_SOURCE:
            raise ValueError("不支持的固定来源类型")
        if not source.enabled:
            return {"status": "skipped", "transferred_count": 0, "selected_count": 0}

        now = beijing_now()
        try:
            share_code = pan_service._extract_share_code(source.share_url)
            if not share_code:
                raise ValueError("无效的 115 分享链接")

            all_files = await pan_service.get_share_all_files_recursive(
                share_code,
                source.receive_code or "",
            )
            selected_items, parsed_count, unparsed_video_count = select_missing_episode_files(
                all_files,
                missing_episodes=missing_episodes,
                quality_filter=quality_filter or {},
            )
            selected_file_ids = list(dict.fromkeys(
                str(item.get("fid") or item.get("file_id"))
                for item in selected_items
                if item.get("fid") or item.get("file_id")
            ))

            for item in all_files:
                await self._upsert_source_file_state(db, source=source, item=item, status="seen")

            transferred_count = 0
            if selected_file_ids:
                await pan_service.save_share_files_directly(
                    share_url=source.share_url,
                    file_ids=selected_file_ids,
                    parent_id=parent_folder_id,
                    receive_code=source.receive_code or "",
                )
                transferred_count = len(selected_file_ids)
                for item in selected_items:
                    await self._upsert_source_file_state(db, source=source, item=item, status="transferred")

            latest_pair = ""
            parsed_pairs = []
            for item in all_files:
                parsed = name_parser.parse_episode(str(item.get("name") or ""))
                if parsed:
                    parsed_pairs.append((int(parsed[0]), int(parsed[1])))
            if parsed_pairs:
                season, episode = sorted(parsed_pairs)[-1]
                latest_pair = f"S{season:02d}E{episode:02d}"

            source.last_scanned_at = now
            source.last_scan_status = "success"
            source.last_error = None
            source.last_found_episode = latest_pair or None
            source.last_transferred_count = transferred_count
            source.updated_at = now
            await db.flush()
            return {
                "status": "success",
                "total_files": len(all_files),
                "parsed_count": parsed_count,
                "unparsed_video_count": unparsed_video_count,
                "selected_count": len(selected_file_ids),
                "transferred_count": transferred_count,
                "last_found_episode": latest_pair,
            }
        except Exception as exc:
            source.last_scanned_at = now
            source.last_scan_status = "failed"
            source.last_error = str(exc)
            source.last_transferred_count = 0
            source.updated_at = now
            await db.flush()
            raise
```

Also add `_upsert_source_file_state`:

```python
    async def _upsert_source_file_state(
        self,
        db: AsyncSession,
        *,
        source: SubscriptionSource,
        item: dict[str, Any],
        status: str,
    ) -> None:
        from app.models.models import SubscriptionSourceFile

        filename = str(item.get("name") or "").strip()
        if not filename:
            return
        fingerprint = build_source_file_fingerprint(item)
        parsed = name_parser.parse_episode(filename)
        season_number = int(parsed[0]) if parsed else None
        episode_number = int(parsed[1]) if parsed else None
        result = await db.execute(
            select(SubscriptionSourceFile).where(
                SubscriptionSourceFile.source_id == source.id,
                SubscriptionSourceFile.fingerprint == fingerprint,
            )
        )
        row = result.scalar_one_or_none()
        now = beijing_now()
        if row is None:
            row = SubscriptionSourceFile(
                source_id=source.id,
                share_file_id=str(item.get("fid") or item.get("file_id") or "").strip() or None,
                file_name=filename,
                file_size=int(item.get("size") or item.get("file_size") or 0) or None,
                season_number=season_number,
                episode_number=episode_number,
                fingerprint=fingerprint,
                status=status,
                last_seen_at=now,
                transferred_at=now if status == "transferred" else None,
            )
            db.add(row)
            return
        row.file_name = filename
        row.file_size = int(item.get("size") or item.get("file_size") or 0) or None
        row.season_number = season_number
        row.episode_number = episode_number
        row.status = status
        row.last_seen_at = now
        if status == "transferred":
            row.transferred_at = now
```

- [ ] **Step 5: Fix existing `counts` logging bug**

In `backend/app/services/subscription_service.py`, before the step log at the `tv_missing_fetch_done` branch, add:

```python
counts = tv_missing_result.get("counts") if isinstance(tv_missing_result.get("counts"), dict) else {}
```

The log line must use this local `counts`:

```python
message=f"缺集检查完成：共 {int(counts.get('aired') or 0)} 集，已有 {int(counts.get('existing') or 0)} 集，缺失 {len(missing_episodes)} 集",
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_scan.py -q
python3 -m py_compile app/services/subscription_source_service.py app/services/subscription_service.py
```

Expected: tests pass and py_compile exits 0.

Commit:

```bash
git add backend/app/services/subscription_source_service.py backend/app/services/subscription_service.py backend/tests/test_subscription_source_scan.py
git commit -m "feat: scan manual 115 subscription sources"
```

---

### Task 4: Integrate Fixed Sources Into Subscription Runs

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Test: `backend/tests/test_subscription_source_run_integration.py`

- [ ] **Step 1: Write failing orchestration test**

Create `backend/tests/test_subscription_source_run_integration.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_run_scans_manual_sources_only_when_auto_download_enabled(monkeypatch):
    from app.services.subscription_service import SubscriptionService, SubscriptionSnapshot
    from app.models.models import MediaType

    service = SubscriptionService()
    sub = SubscriptionSnapshot(
        id=1,
        tmdb_id=100,
        douban_id=None,
        title="Show",
        media_type=MediaType.TV,
        year="2026",
        auto_download=False,
        tv_scope="all",
        tv_season_number=None,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_follow_mode="new",
        tv_include_specials=False,
        has_successful_transfer=False,
    )

    called = False

    async def fake_scan(*args, **kwargs):
        nonlocal called
        called = True
        return {"saved": 1, "failed": 0}

    monkeypatch.setattr(service, "_scan_fixed_sources_for_subscription", fake_scan)

    assert service._should_scan_fixed_sources(sub, force_auto_download=False) is False
    assert service._should_scan_fixed_sources(sub, force_auto_download=True) is True
    assert called is False
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_run_integration.py -q
```

Expected: FAIL because `_should_scan_fixed_sources` does not exist.

- [ ] **Step 3: Add orchestration helpers**

Add imports to `backend/app/services/subscription_service.py`:

```python
from app.models.models import SubscriptionSource
from app.services.subscription_source_service import subscription_source_service
```

Add helper methods to `SubscriptionService`:

```python
    def _should_scan_fixed_sources(
        self,
        sub: "SubscriptionSnapshot",
        *,
        force_auto_download: bool = False,
    ) -> bool:
        return sub.media_type == MediaType.TV and sub.tmdb_id is not None and (
            bool(sub.auto_download) or bool(force_auto_download)
        )

    async def _scan_fixed_sources_for_subscription(
        self,
        db: AsyncSession,
        *,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
        tv_missing_snapshot: dict[str, Any] | None = None,
        force_auto_download: bool = False,
    ) -> dict[str, Any]:
        if not self._should_scan_fixed_sources(
            sub,
            force_auto_download=force_auto_download,
        ):
            return {"saved": 0, "failed": 0, "checked": 0}

        result = await db.execute(
            select(SubscriptionSource).where(
                SubscriptionSource.subscription_id == sub.id,
                SubscriptionSource.enabled == True,  # noqa: E712
            )
        )
        sources = list(result.scalars().all())
        if not sources:
            return {"saved": 0, "failed": 0, "checked": 0}

        pan_service = Pan115Service(runtime_settings_service.get_pan115_cookie())
        default_folder_id = runtime_settings_service.get_pan115_default_folder().get(
            "folder_id", "0"
        )
        parent_folder_id = str(default_folder_id or "0")
        quality_filter = self._resolve_subscription_quality_filter(sub)

        tv_missing_result = tv_missing_snapshot
        if tv_missing_result is None:
            tv_missing_result = await tv_missing_service.get_tv_missing_status(
                sub.tmdb_id,
                include_specials=bool(sub.tv_include_specials),
                season_number=sub.tv_season_number if sub.tv_scope in {"season", "episode_range"} else None,
                episode_start=sub.tv_episode_start if sub.tv_scope == "episode_range" else None,
                episode_end=sub.tv_episode_end if sub.tv_scope == "episode_range" else None,
                aired_only=sub.tv_follow_mode == "new",
            )
        if str(tv_missing_result.get("status") or "") != "ok":
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_missing_status_unavailable",
                status="warning",
                message=f"固定来源跳过：缺集状态不可用（{tv_missing_result.get('message') or '未知错误'}）",
            )
            return {"saved": 0, "failed": 0, "checked": len(sources)}

        missing_episodes = {
            (int(pair[0]), int(pair[1]))
            for pair in (tv_missing_result.get("missing_episodes") or [])
            if isinstance(pair, (list, tuple)) and len(pair) == 2
        }

        saved = 0
        failed = 0
        for source in sources:
            await self._create_step_log(
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
                scan_result = await subscription_source_service.scan_manual_pan115_source(
                    db,
                    source=source,
                    subscription=sub,
                    pan_service=pan_service,
                    parent_folder_id=parent_folder_id,
                    missing_episodes=missing_episodes,
                    quality_filter=quality_filter,
                )
                saved += int(scan_result.get("transferred_count") or 0)
                await self._create_step_log(
                    db,
                    run_id=run_id,
                    channel=channel,
                    subscription_id=sub.id,
                    subscription_title=sub.title,
                    step="fixed_source_scan_done",
                    status="success",
                    message=f"固定来源扫描完成，转存 {int(scan_result.get('transferred_count') or 0)} 个文件",
                    payload={"source_id": source.id, **scan_result},
                )
            except Exception as exc:
                failed += 1
                await self._create_step_log(
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

- [ ] **Step 4: Call fixed source scan from `run_channel_check`**

In `run_channel_check`, after the existing auto-transfer block has run for a subscription and before final `subscription_done`, add:

```python
fixed_source_stats = {"saved": 0, "failed": 0, "checked": 0}
if self._should_scan_fixed_sources(sub, force_auto_download=force_auto_download):
    fixed_source_stats = await self._scan_fixed_sources_for_subscription(
        inner_db,
        run_id=run_id,
        channel=normalized_channel,
        sub=sub,
        tv_missing_snapshot=tv_missing_snapshot,
        force_auto_download=force_auto_download,
    )
    async with result_lock:
        result["auto_saved_count"] += int(fixed_source_stats.get("saved") or 0)
        result["auto_failed_count"] += int(fixed_source_stats.get("failed") or 0)
```

Keep the existing automatic search fetch/store/transfer logic before this block unchanged.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_run_integration.py -q
python3 -m py_compile app/services/subscription_service.py
```

Expected: tests pass and py_compile exits 0.

Commit:

```bash
git add backend/app/services/subscription_service.py backend/tests/test_subscription_source_run_integration.py
git commit -m "feat: run manual fixed sources during subscriptions"
```

---

### Task 5: Add Source API Endpoints

**Files:**
- Modify: `backend/app/api/subscriptions.py`
- Test: `backend/tests/test_subscription_source_api.py`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_subscription_source_api.py`:

```python
import pytest

from app.models.models import MediaType, Subscription


@pytest.mark.asyncio
async def test_create_and_list_subscription_source(async_client):
    from app.core.database import async_session_maker, ensure_tables_exist

    await ensure_tables_exist()
    async with async_session_maker() as db:
        sub = Subscription(
            tmdb_id=3003,
            title="Show API",
            media_type=MediaType.TV,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        sub_id = sub.id

    create_response = await async_client.post(
        f"/subscriptions/{sub_id}/sources",
        json={
            "share_url": "https://115.com/s/abc123?password=abcd",
            "receive_code": "",
            "display_name": "Manual API",
        },
    )
    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["source_type"] == "manual_pan115_share"
    assert payload["receive_code"] == "abcd"

    list_response = await async_client.get(f"/subscriptions/{sub_id}/sources")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["display_name"] == "Manual API"
```

- [ ] **Step 2: Run API test to verify it fails**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_api.py -q
```

Expected: FAIL with 404 for `/subscriptions/{id}/sources`.

- [ ] **Step 3: Add Pydantic schemas and serializer**

Add to `backend/app/api/subscriptions.py`:

```python
class SubscriptionSourceCreate(BaseModel):
    share_url: str
    receive_code: Optional[str] = None
    display_name: Optional[str] = None


class SubscriptionSourceUpdate(BaseModel):
    enabled: Optional[bool] = None
    display_name: Optional[str] = None


def serialize_subscription_source(source) -> dict[str, Any]:
    return {
        "id": source.id,
        "subscription_id": source.subscription_id,
        "source_type": source.source_type,
        "display_name": source.display_name,
        "share_url": source.share_url,
        "receive_code": source.receive_code,
        "enabled": bool(source.enabled),
        "last_scanned_at": source.last_scanned_at.isoformat() if source.last_scanned_at else None,
        "last_scan_status": source.last_scan_status,
        "last_error": source.last_error,
        "last_found_episode": source.last_found_episode,
        "last_transferred_count": int(source.last_transferred_count or 0),
        "created_at": source.created_at.isoformat() if source.created_at else None,
        "updated_at": source.updated_at.isoformat() if source.updated_at else None,
    }
```

- [ ] **Step 4: Add CRUD endpoints**

Add imports:

```python
from app.services.subscription_source_service import subscription_source_service
```

Add routes before `@router.get("/{subscription_id}")`:

```python
@router.get("/{subscription_id}/sources")
async def list_subscription_sources(subscription_id: int, db: AsyncSession = Depends(get_db)):
    sources = await subscription_source_service.list_sources(db, subscription_id)
    return {"items": [serialize_subscription_source(source) for source in sources]}


@router.post("/{subscription_id}/sources")
async def create_subscription_source(
    subscription_id: int,
    payload: SubscriptionSourceCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        source = await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=subscription_id,
            share_url=payload.share_url,
            receive_code=payload.receive_code or "",
            display_name=payload.display_name or "",
        )
        await db.commit()
        await db.refresh(source)
        return serialize_subscription_source(source)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{subscription_id}/sources/{source_id}")
async def update_subscription_source(
    subscription_id: int,
    source_id: int,
    payload: SubscriptionSourceUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        source = await subscription_source_service.get_source(
            db,
            subscription_id=subscription_id,
            source_id=source_id,
        )
        if payload.enabled is not None:
            source.enabled = bool(payload.enabled)
        if payload.display_name is not None:
            source.display_name = str(payload.display_name or "").strip() or source.display_name
        await db.commit()
        await db.refresh(source)
        return serialize_subscription_source(source)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{subscription_id}/sources/{source_id}")
async def delete_subscription_source(
    subscription_id: int,
    source_id: int,
    db: AsyncSession = Depends(get_db),
):
    try:
        await subscription_source_service.delete_source(
            db,
            subscription_id=subscription_id,
            source_id=source_id,
        )
        await db.commit()
        return {"success": True}
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
```

- [ ] **Step 5: Add manual scan endpoint**

Add:

```python
@router.post("/{subscription_id}/sources/{source_id}/scan")
async def scan_subscription_source(
    subscription_id: int,
    source_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Subscription).where(Subscription.id == subscription_id))
    sub = result.scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    source = await subscription_source_service.get_source(
        db,
        subscription_id=subscription_id,
        source_id=source_id,
    )
    from app.services.subscription_service import SubscriptionSnapshot, subscription_service

    snapshot = SubscriptionSnapshot(
        id=sub.id,
        tmdb_id=sub.tmdb_id,
        douban_id=sub.douban_id,
        title=sub.title,
        media_type=sub.media_type,
        year=sub.year,
        auto_download=True,
        tv_scope=sub.tv_scope,
        tv_season_number=sub.tv_season_number,
        tv_episode_start=sub.tv_episode_start,
        tv_episode_end=sub.tv_episode_end,
        tv_follow_mode=sub.tv_follow_mode,
        tv_include_specials=bool(sub.tv_include_specials),
        has_successful_transfer=False,
    )
    stats = await subscription_service._scan_fixed_sources_for_subscription(
        db,
        run_id="manual-source-scan",
        channel="manual",
        sub=snapshot,
        force_auto_download=True,
    )
    await db.commit()
    await db.refresh(source)
    return {"success": True, "source": serialize_subscription_source(source), "stats": stats}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_api.py -q
python3 -m py_compile app/api/subscriptions.py
```

Expected: tests pass and py_compile exits 0.

Commit:

```bash
git add backend/app/api/subscriptions.py backend/tests/test_subscription_source_api.py
git commit -m "feat: add subscription source api"
```

---

### Task 6: Enrich Subscription List Responses With Source Summary

**Files:**
- Modify: `backend/app/api/subscriptions.py`
- Test: `backend/tests/test_subscription_source_list_summary.py`

- [ ] **Step 1: Write failing summary test**

Create `backend/tests/test_subscription_source_list_summary.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_subscription_list_includes_source_summary(async_client):
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.models.models import MediaType, Subscription
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        sub = Subscription(
            tmdb_id=4004,
            title="Show Summary",
            media_type=MediaType.TV,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=sub.id,
            share_url="https://115.com/s/summary?password=abcd",
            receive_code="",
            display_name="Summary Source",
        )
        await db.commit()

    response = await async_client.get("/subscriptions", params={"media_type": "tv"})
    assert response.status_code == 200
    data = response.json()
    item = next(row for row in data["items"] if row["tmdb_id"] == 4004)
    assert item["source_summary"]["total"] == 1
    assert item["source_summary"]["enabled"] == 1
    assert item["sources"][0]["display_name"] == "Summary Source"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_list_summary.py -q
```

Expected: FAIL because list items do not include `sources`.

- [ ] **Step 3: Add source enrichment helper**

Add to `backend/app/api/subscriptions.py`:

```python
async def enrich_subscriptions_with_sources(
    db: AsyncSession,
    subscriptions: list[Subscription],
) -> list[dict[str, Any]]:
    ids = [int(sub.id) for sub in subscriptions]
    sources_by_subscription: dict[int, list[dict[str, Any]]] = {sub_id: [] for sub_id in ids}
    if ids:
        from app.models.models import SubscriptionSource

        result = await db.execute(
            select(SubscriptionSource)
            .where(SubscriptionSource.subscription_id.in_(ids))
            .order_by(SubscriptionSource.created_at.desc())
        )
        for source in result.scalars().all():
            sources_by_subscription.setdefault(int(source.subscription_id), []).append(
                serialize_subscription_source(source)
            )

    output: list[dict[str, Any]] = []
    for sub in subscriptions:
        row = {
            "id": sub.id,
            "douban_id": sub.douban_id,
            "tmdb_id": sub.tmdb_id,
            "imdb_id": sub.imdb_id,
            "title": sub.title,
            "media_type": sub.media_type,
            "poster_path": sub.poster_path,
            "overview": sub.overview,
            "year": sub.year,
            "rating": sub.rating,
            "tv_scope": sub.tv_scope,
            "tv_season_number": sub.tv_season_number,
            "tv_episode_start": sub.tv_episode_start,
            "tv_episode_end": sub.tv_episode_end,
            "tv_follow_mode": sub.tv_follow_mode,
            "tv_include_specials": sub.tv_include_specials,
            "is_active": sub.is_active,
            "auto_download": sub.auto_download,
            "created_at": sub.created_at,
            "updated_at": sub.updated_at,
        }
        sources = sources_by_subscription.get(int(sub.id), [])
        row["sources"] = sources
        row["source_summary"] = {
            "total": len(sources),
            "enabled": sum(1 for source in sources if source.get("enabled")),
        }
        output.append(row)
    return output
```

- [ ] **Step 4: Use helper in list/get responses**

In `list_subscriptions`, replace:

```python
payload["items"] = subscriptions
return payload
```

with:

```python
payload["items"] = await enrich_subscriptions_with_sources(db, list(subscriptions))
return payload
```

In `get_subscription`, replace:

```python
return subscription
```

with:

```python
items = await enrich_subscriptions_with_sources(db, [subscription])
return items[0]
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd backend
python3 -m pytest tests/test_subscription_source_list_summary.py -q
python3 -m py_compile app/api/subscriptions.py
```

Expected: test passes and py_compile exits 0.

Commit:

```bash
git add backend/app/api/subscriptions.py backend/tests/test_subscription_source_list_summary.py
git commit -m "feat: show subscription source summaries"
```

---

### Task 7: Add Frontend API Methods

**Files:**
- Modify: `frontend/src/api/index.js`
- Test: `frontend/tests/api/subscriptionSourcesApi.test.js`

- [ ] **Step 1: Write lightweight API surface test**

Create `frontend/tests/api/subscriptionSourcesApi.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('subscriptionApi exposes fixed source methods', () => {
  const source = readFileSync(new URL('../../src/api/index.js', import.meta.url), 'utf8')
  assert.match(source, /listSources:\s*\(id\)/)
  assert.match(source, /createSource:\s*\(id,\s*data\)/)
  assert.match(source, /updateSource:\s*\(id,\s*sourceId,\s*data\)/)
  assert.match(source, /deleteSource:\s*\(id,\s*sourceId\)/)
  assert.match(source, /scanSource:\s*\(id,\s*sourceId\)/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
node --test tests/api/subscriptionSourcesApi.test.js
```

Expected: FAIL because methods do not exist.

- [ ] **Step 3: Add API methods**

In `frontend/src/api/index.js`, extend `subscriptionApi` after `toggle`:

```js
  listSources: (id) => api.get(`/subscriptions/${id}/sources`),
  createSource: (id, data) => api.post(`/subscriptions/${id}/sources`, data),
  updateSource: (id, sourceId, data) => api.patch(`/subscriptions/${id}/sources/${sourceId}`, data),
  deleteSource: (id, sourceId) => api.delete(`/subscriptions/${id}/sources/${sourceId}`),
  scanSource: (id, sourceId) => api.post(`/subscriptions/${id}/sources/${sourceId}/scan`, null, { timeout: 300000 }),
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd frontend
node --test tests/api/subscriptionSourcesApi.test.js
node --check src/api/index.js
```

Expected: test passes and syntax check exits 0.

Commit:

```bash
git add frontend/src/api/index.js frontend/tests/api/subscriptionSourcesApi.test.js
git commit -m "feat: add subscription source frontend api"
```

---

### Task 8: Extend TV Detail Manual 115 Import Dialog

**Files:**
- Modify: `frontend/src/views/TvDetail.vue`
- Test: `frontend/tests/api/tvDetailManualSource.test.js`

- [ ] **Step 1: Write source mode static test**

Create `frontend/tests/api/tvDetailManualSource.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('tv detail manual 115 dialog supports fixed source mode', () => {
  const source = readFileSync(new URL('../../src/views/TvDetail.vue', import.meta.url), 'utf8')
  assert.match(source, /manualPanForm\.value\s*=\s*\{[\s\S]*mode:\s*'transfer'/)
  assert.match(source, /<el-radio-button label="transfer">立即转存<\/el-radio-button>/)
  assert.match(source, /<el-radio-button label="source">固定追新<\/el-radio-button>/)
  assert.match(source, /<el-radio-button label="transfer_and_source">转存并追新<\/el-radio-button>/)
  assert.match(source, /ensureTvSubscriptionForManualSource/)
  assert.match(source, /subscriptionApi\.createSource/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
node --test tests/api/tvDetailManualSource.test.js
```

Expected: FAIL because UI mode and helper are missing.

- [ ] **Step 3: Add mode field to dialog state**

In `TvDetail.vue`, update `manualPanForm` initial state:

```js
const manualPanForm = ref({
  shareLink: '',
  folderName: '',
  receiveCode: '',
  mode: 'transfer'
})
```

Update `openManualPanDialog()`:

```js
const openManualPanDialog = () => {
  manualPanForm.value = {
    shareLink: '',
    folderName: buildDefaultTvFolderName(),
    receiveCode: '',
    mode: 'transfer'
  }
  manualPanDialogVisible.value = true
}
```

- [ ] **Step 4: Add mode controls to the dialog**

In the manual 115 dialog form, after the receive code form item, add:

```vue
<el-form-item label="操作">
  <el-radio-group v-model="manualPanForm.mode">
    <el-radio-button label="transfer">立即转存</el-radio-button>
    <el-radio-button label="source">固定追新</el-radio-button>
    <el-radio-button label="transfer_and_source">转存并追新</el-radio-button>
  </el-radio-group>
</el-form-item>
```

Change the submit button text:

```vue
{{ manualPanForm.mode === 'source' ? '保存来源' : '开始处理' }}
```

- [ ] **Step 5: Add subscription helper and create source call**

Add below `checkSubscribed()`:

```js
const ensureTvSubscriptionForManualSource = async () => {
  if (subscriptionId.value) return subscriptionId.value
  await checkSubscribed()
  if (subscriptionId.value) return subscriptionId.value
  const { data } = await subscriptionApi.create({
    tmdb_id: tv.value.id,
    title: tv.value.name,
    media_type: 'tv',
    poster_path: tv.value.poster_path,
    overview: tv.value.overview,
    year: tv.value.first_air_date?.split('-')[0],
    rating: tv.value.vote_average
  })
  isSubscribed.value = true
  subscriptionId.value = Number(data?.id || 0) || null
  return subscriptionId.value
}

const createManualPanSource = async ({ shareLink, receiveCode, folderName }) => {
  const targetSubscriptionId = await ensureTvSubscriptionForManualSource()
  if (!targetSubscriptionId) throw new Error('订阅创建失败，无法保存固定来源')
  await subscriptionApi.createSource(targetSubscriptionId, {
    share_url: shareLink,
    receive_code: receiveCode,
    display_name: folderName || buildDefaultTvFolderName()
  })
}
```

- [ ] **Step 6: Branch submit logic by mode**

In `submitManualPanShare`, after computing `shareLink`, `receiveCode`, and `folderName`, add:

```js
const mode = String(manualPanForm.value.mode || 'transfer')
if (mode === 'source' || mode === 'transfer_and_source') {
  await createManualPanSource({ shareLink, receiveCode, folderName })
}
if (mode === 'source') {
  ElMessage.success('已保存为固定追新来源')
  manualPanDialogVisible.value = false
  return
}
```

Keep the existing `pan115Api.saveShareToFolder(...)` path for `transfer` and `transfer_and_source`. After successful transfer in `transfer_and_source`, show:

```js
ElMessage.success(data?.message || (mode === 'transfer_and_source' ? '转存成功，已保存固定追新来源' : '转存成功'))
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
cd frontend
node --test tests/api/tvDetailManualSource.test.js
node --check src/views/TvDetail.vue
```

Expected: test passes. `node --check` may not parse `.vue`; if it fails due Vue SFC syntax, run only the Node test and rely on final Vite build.

Commit:

```bash
git add frontend/src/views/TvDetail.vue frontend/tests/api/tvDetailManualSource.test.js
git commit -m "feat: add manual 115 fixed source import"
```

---

### Task 9: Display and Manage Sources on Subscription Page

**Files:**
- Modify: `frontend/src/views/Subscriptions.vue`
- Test: `frontend/tests/api/subscriptionSourcesView.test.js`

- [ ] **Step 1: Write static view test**

Create `frontend/tests/api/subscriptionSourcesView.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('subscriptions view renders fixed source controls', () => {
  const source = readFileSync(new URL('../../src/views/Subscriptions.vue', import.meta.url), 'utf8')
  assert.match(source, /固定来源/)
  assert.match(source, /formatSourceLink/)
  assert.match(source, /handleScanSource/)
  assert.match(source, /handleToggleSource/)
  assert.match(source, /handleDeleteSource/)
  assert.match(source, /subscriptionApi\.scanSource/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
node --test tests/api/subscriptionSourcesView.test.js
```

Expected: FAIL because source controls are absent.

- [ ] **Step 3: Add source display block inside TV cards**

Inside each subscription card info block after `.tv-scope`, add:

```vue
<div v-if="sub.media_type === 'tv' && Array.isArray(sub.sources) && sub.sources.length" class="fixed-sources" @click.stop>
  <div class="fixed-source-title">固定来源</div>
  <div v-for="source in sub.sources" :key="source.id" class="fixed-source-row">
    <div class="fixed-source-main">
      <span class="fixed-source-name">{{ source.display_name || '手动 115 分享' }}</span>
      <el-tag size="small" :type="source.enabled ? 'success' : 'info'">
        {{ source.enabled ? '启用' : '停用' }}
      </el-tag>
    </div>
    <div class="fixed-source-link">{{ formatSourceLink(source.share_url) }}</div>
    <div class="fixed-source-meta">
      <span>{{ formatSourceScanStatus(source) }}</span>
      <span v-if="source.last_found_episode">最新 {{ source.last_found_episode }}</span>
      <span v-if="source.last_error" class="source-error">{{ source.last_error }}</span>
    </div>
    <div class="fixed-source-actions">
      <el-button size="small" text :loading="source.scanning" @click="handleScanSource(sub, source)">立即扫描</el-button>
      <el-button size="small" text @click="handleToggleSource(sub, source)">
        {{ source.enabled ? '停用' : '启用' }}
      </el-button>
      <el-button size="small" text type="danger" @click="handleDeleteSource(sub, source)">删除</el-button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Add source formatting and action methods**

Add to `<script setup>`:

```js
const formatSourceLink = (link) => {
  const value = String(link || '').trim()
  if (!value) return '-'
  if (value.length <= 36) return value
  return `${value.slice(0, 24)}...${value.slice(-8)}`
}

const formatSourceScanStatus = (source) => {
  const status = String(source?.last_scan_status || 'never')
  if (status === 'never') return '未扫描'
  if (status === 'success') {
    const count = Number(source?.last_transferred_count || 0)
    return count > 0 ? `上次转存 ${count} 个文件` : '上次无新增'
  }
  if (status === 'failed') return '扫描失败'
  if (status === 'warning') return '扫描异常'
  return status
}

const replaceSubscriptionSource = (subscriptionId, nextSource) => {
  const target = subscriptions.value.find((sub) => Number(sub.id) === Number(subscriptionId))
  if (!target) return
  const sources = Array.isArray(target.sources) ? [...target.sources] : []
  const index = sources.findIndex((source) => Number(source.id) === Number(nextSource.id))
  if (index >= 0) sources[index] = nextSource
  else sources.unshift(nextSource)
  target.sources = sources
  target.source_summary = {
    total: sources.length,
    enabled: sources.filter((source) => source.enabled).length
  }
}

const handleScanSource = async (sub, source) => {
  if (source.scanning) return
  source.scanning = true
  try {
    const { data } = await subscriptionApi.scanSource(sub.id, source.id)
    if (data?.source) replaceSubscriptionSource(sub.id, data.source)
    ElMessage.success('固定来源扫描完成')
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || error.message || '固定来源扫描失败')
  } finally {
    source.scanning = false
  }
}

const handleToggleSource = async (sub, source) => {
  try {
    const { data } = await subscriptionApi.updateSource(sub.id, source.id, {
      enabled: !source.enabled
    })
    replaceSubscriptionSource(sub.id, data)
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || error.message || '固定来源更新失败')
  }
}

const handleDeleteSource = async (sub, source) => {
  try {
    await ElMessageBox.confirm('确定删除这个固定来源吗？', '删除固定来源', {
      type: 'warning',
    })
    await subscriptionApi.deleteSource(sub.id, source.id)
    const target = subscriptions.value.find((item) => Number(item.id) === Number(sub.id))
    if (target) {
      target.sources = (target.sources || []).filter((item) => Number(item.id) !== Number(source.id))
      target.source_summary = {
        total: target.sources.length,
        enabled: target.sources.filter((item) => item.enabled).length
      }
    }
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error.response?.data?.detail || error.message || '固定来源删除失败')
  }
}
```

- [ ] **Step 5: Add CSS**

Add to the style block:

```scss
.fixed-sources {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.fixed-source-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.fixed-source-row + .fixed-source-row {
  margin-top: 8px;
}

.fixed-source-main,
.fixed-source-meta,
.fixed-source-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fixed-source-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.fixed-source-link,
.fixed-source-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

.source-error {
  color: var(--el-color-danger);
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd frontend
node --test tests/api/subscriptionSourcesView.test.js
```

Expected: test passes.

Commit:

```bash
git add frontend/src/views/Subscriptions.vue frontend/tests/api/subscriptionSourcesView.test.js
git commit -m "feat: manage fixed sources on subscriptions page"
```

---

### Task 10: End-to-End Verification

**Files:**
- No new files unless a previous verification exposes a bug.

- [ ] **Step 1: Run backend targeted tests**

Run:

```bash
cd backend
python3 -m pytest \
  tests/test_subscription_source_models.py \
  tests/test_subscription_source_service.py \
  tests/test_subscription_source_scan.py \
  tests/test_subscription_source_run_integration.py \
  tests/test_subscription_source_api.py \
  tests/test_subscription_source_list_summary.py \
  -q
```

Expected: all targeted backend tests pass.

- [ ] **Step 2: Run backend syntax checks**

Run:

```bash
cd backend
python3 -m py_compile \
  app/models/models.py \
  app/core/database.py \
  app/services/subscription_source_service.py \
  app/services/subscription_service.py \
  app/api/subscriptions.py
```

Expected: exits 0.

- [ ] **Step 3: Run frontend targeted tests**

Run:

```bash
cd frontend
node --test \
  tests/api/authErrorPolicy.test.js \
  tests/api/subscriptionSourcesApi.test.js \
  tests/api/tvDetailManualSource.test.js \
  tests/api/subscriptionSourcesView.test.js
```

Expected: all targeted frontend tests pass.

- [ ] **Step 4: Run frontend build when dependencies are available**

If `frontend/node_modules` exists, run:

```bash
cd frontend
npm run build
```

Expected: Vite build exits 0.

If dependencies are not installed, record this as a verification gap and do not claim build success.

- [ ] **Step 5: Rebuild and restart local app**

Run:

```bash
docker compose -f compose.local.yaml up -d --build mediasync115-local
```

Expected: container starts healthy.

Check:

```bash
docker ps --filter name=mediasync115-local --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Expected: `mediasync115-local` is `healthy` and still exposes `15173`, `19008`, and `18099`.

- [ ] **Step 6: Manual browser verification**

Use the app at:

```text
http://127.0.0.1:15173
```

Verify:

1. Open a TV detail page.
2. Click `导入 115 分享`.
3. Confirm default mode is `立即转存`.
4. Select `固定追新`, paste a 115 share link, and save.
5. Go to `我的订阅`.
6. Confirm the subscription card shows the fixed source link/status.
7. Click `立即扫描`.
8. Confirm the page stays on the current route if 115 Cookie is invalid and shows a 115 credential error instead of jumping to home/login.

- [ ] **Step 7: Commit final verification adjustments**

If verification required fixes, commit them:

```bash
git status --short
git add <changed-files>
git commit -m "fix: stabilize manual fixed source verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage:
  - Manual-only 115 fixed source: Tasks 1-9.
  - Existing search mode preserved: Tasks 4 and 8 explicitly add behavior without changing source fetch order.
  - Subscription page source visibility: Task 9.
  - HDHive OpenAPI and HDHive automatic fixed source excluded: no task adds either.
  - 115 credential 401 stays on page: Task 0.
- Placeholder scan: no unfinished markers or unspecified test tasks are intentionally left in this plan.
- Type consistency:
  - Source type is consistently `manual_pan115_share`.
  - API method names are consistently `listSources`, `createSource`, `updateSource`, `deleteSource`, `scanSource`.
  - Backend service singleton is consistently `subscription_source_service`.
