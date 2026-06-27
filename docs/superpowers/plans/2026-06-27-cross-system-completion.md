# Cross-System Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the practical MediaSync115-side integration across MoviePilot, Twilight, and Symedia boundaries.

**Architecture:** MediaSync115 mirrors MoviePilot execution state and exposes lightweight external-service controls. MoviePilot remains the PT/downloader provider, Twilight remains the Emby/Jellyfin account authority, and Symedia remains directory-driven.

**Tech Stack:** FastAPI, SQLAlchemy async, APScheduler dynamic jobs, React 19, TypeScript, Vite, pytest.

---

### Task 1: MoviePilot Download And Transfer Sync

**Files:**
- Modify: `backend/app/services/moviepilot_provider_service.py`
- Modify: `backend/app/api/moviepilot.py`
- Test: `backend/tests/test_moviepilot_provider_service.py`
- Test: `backend/tests/test_moviepilot_api.py`

- [x] Write failing tests for active MoviePilot downloads creating/updating `DownloadRecord`.
- [x] Write failing tests for MoviePilot transfer history marking records completed or failed.
- [x] Add provider helpers to normalize MoviePilot downloader and transfer-history payloads.
- [x] Add `sync_execution_state(db)` that runs subscription, active download, and transfer-history sync in one call.
- [x] Add API route support so `POST /api/moviepilot/subscriptions/sync` returns counts for subscriptions, downloads, and transfer history.
- [x] Run MoviePilot backend tests.

### Task 2: Scheduler Job

**Files:**
- Modify: `backend/app/services/job_registry.py`
- Test: `backend/tests/test_moviepilot_provider_service.py`

- [x] Register a `moviepilot.sync` job key.
- [x] Implement the job by opening a DB session and calling `moviepilot_provider_service.sync_execution_state`.
- [x] Test that the job registry exposes and runs the job with a fake provider path where practical.
- [x] Verify `/api/scheduler/job-keys` includes `moviepilot.sync` through existing route behavior.

### Task 3: Frontend MoviePilot State Controls

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/moviepilot.ts`
- Modify: `frontend/src/api/moviepilot.contract.test.ts`
- Modify: `frontend/src/components/SubscriptionTab.tsx`

- [x] Add typed sync summary fields for downloads and transfer history.
- [x] Update the MP sync button log message to show all returned counts.
- [x] Ensure subscription detail downloads display synced `offline_status`, `offline_info_hash`, and errors already returned by existing download records.
- [x] Run TypeScript check and production build.

### Task 4: Twilight Lightweight Entry

**Files:**
- Modify: `backend/app/services/runtime_settings_service.py`
- Modify: `backend/app/api/settings.py`
- Create: `backend/app/services/twilight_client.py`
- Create: `backend/app/api/twilight.py`
- Modify: `backend/main.py`
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/twilight.ts`
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/components/SettingsTab.tsx`
- Test: `backend/tests/test_twilight_runtime_settings.py`
- Test: `backend/tests/test_twilight_api.py`

- [x] Store Twilight enabled, base URL, API key, and web URL settings with secret masking.
- [x] Add a Twilight client for `/api/v1/system/health` and `/api/v1/apikey/status` when an API key is configured.
- [x] Add `/api/twilight/config` and `/api/twilight/health` routes.
- [x] Add Settings UI fields and health check/link buttons.
- [x] Run backend Twilight tests and frontend build.

### Task 5: Final Verification And Deployment

**Files:**
- No additional source files.

- [x] Run targeted MoviePilot and Twilight tests.
- [x] Run `rm -f backend/data/test.db*` equivalent from `backend/`, then the broad pytest subset.
- [x] Run frontend production build through the Node Docker container.
- [x] Commit with a Chinese commit message.
- [x] Rebuild and redeploy Docker with `docker compose up -d --build`.
- [x] Check `http://127.0.0.1:5173/healthz` and Docker health.
