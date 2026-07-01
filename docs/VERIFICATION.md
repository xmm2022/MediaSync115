# Verification Guide

Use these checks before and after stabilization or refactor work.

## Quick Checks

```bash
git status --short
scripts/verify.sh --quick
```

Run the full local gate:

```bash
scripts/verify.sh --full
```

## Backend

Backend tests require development dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

Run all backend tests:

```bash
scripts/verify-backend.sh
```

Run selected tests:

```bash
scripts/verify-backend.sh -- tests/test_health.py tests/test_settings.py
```

`backend/tests/conftest.py` uses `TEST_DATABASE_URL` when provided. If it is not set, pytest attempts to start a temporary `postgres:16-alpine` container. CI should prefer an explicit isolated test database:

```bash
TEST_DATABASE_URL=postgresql+asyncpg://mediasync:mediasync@127.0.0.1:5432/mediasync115_test \
  scripts/verify-backend.sh
```

Do not point `TEST_DATABASE_URL` at a production database.

`scripts/verify-backend.sh` refuses `TEST_DATABASE_URL` values that do not use `postgresql+asyncpg://`. It also refuses database names that do not contain `test` unless `ALLOW_NON_TEST_DATABASE_URL=1` is set intentionally.

For a syntax-only check:

```bash
scripts/verify-backend.sh --quick
```

## Frontend

```bash
scripts/verify-frontend.sh
scripts/verify-frontend.sh --build
```

This runs:

- `npm test` by default
- `npm run build` when `--build` is provided

The production build may print Vite chunk-size warnings. A warning is not a failure unless the command exits non-zero.

## Compose

```bash
scripts/verify-compose.sh --all
```

This validates the supported compose files with `docker compose config --quiet`.

Supported modes:

```bash
scripts/verify-compose.sh --local
scripts/verify-compose.sh --dev
scripts/verify-compose.sh --nas
```

## Runtime Smoke

After rebuilding and deploying:

```bash
curl -fsS http://127.0.0.1:5173/healthz
curl -fsS http://127.0.0.1:9008/healthz
```

For authenticated API paths, verify in the Web UI or with a logged-in session. Anonymous `/api/*` requests may correctly return `401`.

## Data Boundary

The Docker build context must not include runtime data, local databases, STRM output, or logs. `.dockerignore` should exclude:

- `data/`
- `strm/`
- `logs`
- `*.db`
- `*.sqlite3`

Verify this boundary with:

```bash
scripts/verify-dockerignore.sh
```
