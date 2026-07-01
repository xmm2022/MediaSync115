# Project Stabilization Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the verification and architecture baseline required before core module extraction.

**Architecture:** Phase 1 deliberately avoids product behavior changes. It documents target module boundaries, adds executable verification entry points, protects Docker build context from runtime data, and prepares the next phase: extracting backend resource search out of API routes.

**Tech Stack:** Bash, Docker Compose, pytest, Vite, TypeScript, FastAPI, PostgreSQL.

---

## File Structure

- Create `docs/ARCHITECTURE.md`: project-level domain boundaries and refactor priorities.
- Create `docs/VERIFICATION.md`: canonical verification commands and test database policy.
- Create `scripts/verify-backend.sh`: backend pytest wrapper.
- Create `scripts/verify-frontend.sh`: frontend test/build wrapper.
- Create `scripts/verify-compose.sh`: compose config validation wrapper.
- Create `scripts/verify-dockerignore.sh`: Docker build-context boundary check.
- Create `scripts/verify.sh`: first-stage verification orchestrator.
- Modify `.dockerignore`: exclude root runtime data and local databases from Docker build context.
- Modify `backend/tests/test_documentation_contracts.py`: assert verification docs/scripts and Docker ignore rules remain present.

## Task 1: Document Boundaries

**Files:**
- Create: `docs/ARCHITECTURE.md`

- [x] **Step 1: Write the architecture roadmap**

Record current domains, key layer inversion, target backend/frontend boundaries, P0/P1/P2 order, and guardrails.

- [x] **Step 2: Review for scope**

Confirm the document does not prescribe new product features and only describes stabilization/refactor boundaries.

## Task 2: Add Verification Guide

**Files:**
- Create: `docs/VERIFICATION.md`

- [x] **Step 1: Write verification commands**

Document quick checks, backend pytest behavior, frontend checks, compose validation, runtime smoke, and Docker data boundary.

- [x] **Step 2: Make `TEST_DATABASE_URL` safety explicit**

State that CI should provide an isolated PostgreSQL database and must not point tests at production.

## Task 3: Add Verification Scripts

**Files:**
- Create: `scripts/verify-backend.sh`
- Create: `scripts/verify-frontend.sh`
- Create: `scripts/verify-compose.sh`
- Create: `scripts/verify-dockerignore.sh`
- Create: `scripts/verify.sh`

- [x] **Step 1: Add backend wrapper**

Create a Bash script that selects `backend/.venv/bin/python` when available, supports `--quick`, validates `TEST_DATABASE_URL`, and runs pytest from `backend/`.

- [x] **Step 2: Add frontend wrapper**

Create a Bash script that runs `npm test` by default and `npm run build` when `--build` is provided.

- [x] **Step 3: Add compose wrapper**

Create a Bash script that runs `docker compose config --quiet` for supported compose combinations and supports `--all`, `--local`, `--dev`, and `--nas`.

- [x] **Step 4: Add dockerignore and orchestration wrappers**

Create `scripts/verify-dockerignore.sh` and `scripts/verify.sh`.

- [x] **Step 5: Mark scripts executable**

Run:

```bash
chmod +x scripts/verify.sh scripts/verify-backend.sh scripts/verify-frontend.sh scripts/verify-compose.sh scripts/verify-dockerignore.sh
```

## Task 4: Protect Docker Build Context

**Files:**
- Modify: `.dockerignore`
- Modify: `backend/tests/test_documentation_contracts.py`

- [x] **Step 1: Write the contract test**

Add a test that asserts `.dockerignore` contains `data`, `strm`, `logs`, `*.db`, and `*.sqlite3`.

- [x] **Step 2: Update `.dockerignore`**

Add those entries near the other runtime/build output ignore rules.

## Task 5: Verify

**Files:**
- No code files.

- [x] **Step 1: Run frontend verification**

Run:

```bash
scripts/verify-frontend.sh
```

Expected: command exits 0. Vite chunk-size warnings are acceptable.

- [x] **Step 2: Run compose verification**

Run:

```bash
scripts/verify-compose.sh --all
```

Expected: command exits 0 for each supported compose combination.

- [x] **Step 3: Run backend documentation contract when pytest is available**

Run:

```bash
scripts/verify-backend.sh -- tests/test_documentation_contracts.py
```

Expected when dependencies are installed: command exits 0.

If pytest is not installed, the script should fail with an explicit message instead of a confusing import traceback.
