#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

QUICK=0
NO_DOCKER=0
PYTEST_ARGS=()

usage() {
  cat <<'EOF'
Usage: scripts/verify-backend.sh [--quick] [--no-docker] [-- pytest-args...]

Options:
  --quick       Run syntax compilation only; does not require pytest or PostgreSQL.
  --no-docker   Require TEST_DATABASE_URL instead of allowing pytest to start a temporary PostgreSQL container.
  --            Pass remaining arguments to pytest.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --quick)
      QUICK=1
      shift
      ;;
    --no-docker)
      NO_DOCKER=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      PYTEST_ARGS=("$@")
      break
      ;;
    *)
      PYTEST_ARGS+=("$1")
      shift
      ;;
  esac
done

PYTHON_BIN="${PYTHON:-}"
if [ -z "$PYTHON_BIN" ]; then
  if [ -x "$ROOT/backend/.venv/bin/python" ]; then
    PYTHON_BIN="$ROOT/backend/.venv/bin/python"
  else
    PYTHON_BIN="python3"
  fi
fi

if [ "$QUICK" -eq 1 ]; then
  "$PYTHON_BIN" -m compileall -q app main.py
  exit 0
fi

if ! "$PYTHON_BIN" -c "import pytest" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
pytest is not installed for this Python environment.

Install backend development dependencies first:
  cd backend
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt -r requirements-dev.txt

For CI, provide an isolated PostgreSQL TEST_DATABASE_URL.
EOF
  exit 2
fi

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  if [[ "$TEST_DATABASE_URL" != postgresql+asyncpg://* ]]; then
    echo "TEST_DATABASE_URL must use postgresql+asyncpg://" >&2
    exit 2
  fi
  db_without_query="${TEST_DATABASE_URL%%\?*}"
  db_name="${db_without_query##*/}"
  if [[ "$db_name" != *test* && "${ALLOW_NON_TEST_DATABASE_URL:-}" != "1" ]]; then
    cat >&2 <<EOF
Refusing to run tests against database '$db_name'.
Use a dedicated test database name containing 'test', or set ALLOW_NON_TEST_DATABASE_URL=1 intentionally.
EOF
    exit 2
  fi
elif [ "$NO_DOCKER" -eq 1 ]; then
  echo "--no-docker requires TEST_DATABASE_URL to be set." >&2
  exit 2
else
  unset DATABASE_URL
fi

"$PYTHON_BIN" -m pytest "${PYTEST_ARGS[@]}"
