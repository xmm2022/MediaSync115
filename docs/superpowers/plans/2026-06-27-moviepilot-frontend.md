# MoviePilot Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the MediaSync115 frontend controls needed to configure MoviePilot and create PT subscriptions through the backend MoviePilot provider.

**Architecture:** Keep MoviePilot-specific HTTP calls in a dedicated frontend API module. Settings owns MoviePilot connection/runtime fields, while SubscriptionTab owns provider selection and PT subscription filters.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, lucide-react, existing axios API client.

---

### Task 1: Frontend API Contract

**Files:**
- Create: `frontend/src/api/moviepilot.ts`
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/api/types.ts`

- [ ] Add MoviePilot config, health, search, and subscription payload/response types.
- [ ] Add `moviepilotApi` wrapper for `/api/moviepilot/config`, `/health`, `/search`, `/subscriptions`, `/subscriptions/sync`, and `/subscriptions/{id}/search`.
- [ ] Export the new API module from `frontend/src/api/index.ts`.
- [ ] Run `cd frontend && npm run lint` and expect TypeScript to fail before implementation if imports are referenced by UI first, then pass after the API module exists.

### Task 2: Settings UI

**Files:**
- Modify: `frontend/src/components/SettingsTab.tsx`

- [ ] Add state fields for `moviepilot_enabled`, `moviepilot_base_url`, `moviepilot_username`, `moviepilot_password`, and `moviepilot_save_path`.
- [ ] Load the runtime values into those fields, using password placeholder semantics from `moviepilot_password_configured`.
- [ ] Include MoviePilot fields in the existing save payload, only sending `moviepilot_password` when the password field is non-empty.
- [ ] Add a compact MoviePilot connection section with enable toggle, URL, username, password, save path, save button, and health check button.
- [ ] Run `cd frontend && npm run lint` and expect TypeScript to pass.

### Task 3: PT Subscription Entry

**Files:**
- Modify: `frontend/src/components/SubscriptionTab.tsx`

- [ ] Add a provider selector for local MediaSync115 subscription versus MoviePilot PT subscription.
- [ ] Add MoviePilot-only optional fields: quality, resolution, include keywords, exclude keywords, and save path.
- [ ] When provider is `moviepilot`, call `moviepilotApi.createSubscription`; otherwise keep the existing `subscriptionApi.create` path.
- [ ] Reset MoviePilot-specific fields after successful creation.
- [ ] Show provider metadata in the list when backend returns `provider`, `external_system`, or `external_subscription_id`.
- [ ] Run `cd frontend && npm run lint` and expect TypeScript to pass.

### Task 4: Verification, Commit, Deploy

**Files:**
- No new source files beyond the frontend changes above.

- [ ] Run `cd frontend && npm run build`.
- [ ] Run targeted backend MoviePilot tests from `backend/`.
- [ ] Run the broad backend pytest subset after removing `backend/data/test.db*`.
- [ ] Commit with a Chinese commit message.
- [ ] Rebuild and redeploy Docker with `docker compose up -d --build`.
- [ ] Check service health through the local health endpoint.
