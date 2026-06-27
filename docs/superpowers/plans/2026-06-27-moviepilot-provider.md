# MoviePilot Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend MoviePilot provider MVP so MediaSync115 can create and sync PT subscriptions through MoviePilot.

**Architecture:** Keep MoviePilot integration isolated in a new service/client and API router. Local subscriptions gain provider metadata, while MoviePilot remains the execution backend for PT rules and downloads.

**Tech Stack:** FastAPI, SQLAlchemy async, SQLite lightweight column migration, httpx, pytest.

---

### Task 1: Runtime Settings

**Files:**
- Modify: `backend/app/services/runtime_settings_service.py`
- Modify: `backend/app/api/settings.py`
- Test: `backend/tests/test_moviepilot_runtime_settings.py`

- [ ] Add MoviePilot defaults: enabled, base URL, username, password, token, incoming save path.
- [ ] Add getters and masked `get_moviepilot_config()`.
- [ ] Extend bulk settings schema.
- [ ] Test that settings persist and secrets are not exposed by the config helper.

### Task 2: MoviePilot Client

**Files:**
- Create: `backend/app/services/moviepilot_client.py`
- Test: `backend/tests/test_moviepilot_client.py`

- [ ] Define `MoviePilotClientError`.
- [ ] Implement login to `/api/v1/login/access-token`.
- [ ] Implement request retry after 401/403.
- [ ] Implement search, create subscription, list subscriptions, manual subscription search, downloads, and transfer history methods.
- [ ] Test token refresh and payload mapping with `httpx.MockTransport`.

### Task 3: Provider Service

**Files:**
- Create: `backend/app/services/moviepilot_provider_service.py`
- Modify: `backend/app/models/models.py`
- Modify: `backend/app/core/database.py`
- Test: `backend/tests/test_moviepilot_provider_service.py`

- [ ] Add local subscription provider metadata columns.
- [ ] Map MediaSync115 subscription fields to MoviePilot `Subscribe` schema.
- [ ] Create or reuse local subscriptions and persist `external_subscription_id`.
- [ ] Sync external subscription state into local metadata.
- [ ] Test movie and TV subscription creation.

### Task 4: API Router

**Files:**
- Create: `backend/app/api/moviepilot.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_moviepilot_api.py`

- [ ] Add `/api/moviepilot/config`, `/health`, `/search`, `/subscriptions`, `/subscriptions/sync`, and `/subscriptions/{id}/search`.
- [ ] Return clear 400/502 errors for missing config and upstream failures.
- [ ] Include router in FastAPI app.
- [ ] Test route contracts with monkeypatched service methods.

### Task 5: Verification

**Files:**
- No new files.

- [ ] Run targeted pytest for MoviePilot tests.
- [ ] Run backend pytest.
- [ ] Commit with a Chinese commit message.
- [ ] Build Docker image and redeploy local container only after tests pass.
