#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_BACKEND=1
RUN_FRONTEND=1
RUN_COMPOSE=1
RUN_DOCKERIGNORE=1
FRONTEND_BUILD=0
BACKEND_QUICK=0
PYTEST_ARGS=()

usage() {
  cat <<'EOF'
Usage: scripts/verify.sh [--quick|--full] [--backend] [--frontend] [--compose] [--dockerignore] [-- pytest-args...]

Default runs:
  git diff --check
  scripts/verify-dockerignore.sh
  scripts/verify-compose.sh --all
  scripts/verify-backend.sh
  scripts/verify-frontend.sh

Options:
  --quick          Use backend compile check and skip frontend production build.
  --full           Run default checks plus frontend production build.
  --backend        Run only git diff check + backend checks.
  --frontend       Run only git diff check + frontend checks.
  --compose        Run only git diff check + compose checks.
  --dockerignore   Run only git diff check + dockerignore checks.
  --               Pass remaining arguments to pytest through verify-backend.sh.
EOF
}

select_only() {
  RUN_BACKEND=0
  RUN_FRONTEND=0
  RUN_COMPOSE=0
  RUN_DOCKERIGNORE=0
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --quick)
      BACKEND_QUICK=1
      FRONTEND_BUILD=0
      shift
      ;;
    --full)
      BACKEND_QUICK=0
      FRONTEND_BUILD=1
      shift
      ;;
    --backend)
      select_only
      RUN_BACKEND=1
      shift
      ;;
    --frontend)
      select_only
      RUN_FRONTEND=1
      shift
      ;;
    --compose)
      select_only
      RUN_COMPOSE=1
      shift
      ;;
    --dockerignore)
      select_only
      RUN_DOCKERIGNORE=1
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
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "Checking: git diff --check"
git diff --check

if [ "$RUN_DOCKERIGNORE" -eq 1 ]; then
  scripts/verify-dockerignore.sh
fi

if [ "$RUN_COMPOSE" -eq 1 ]; then
  scripts/verify-compose.sh --all
fi

if [ "$RUN_BACKEND" -eq 1 ]; then
  if [ "$BACKEND_QUICK" -eq 1 ]; then
    scripts/verify-backend.sh --quick
  else
    scripts/verify-backend.sh "${PYTEST_ARGS[@]}"
  fi
fi

if [ "$RUN_FRONTEND" -eq 1 ]; then
  if [ "$FRONTEND_BUILD" -eq 1 ]; then
    scripts/verify-frontend.sh --build
  else
    scripts/verify-frontend.sh
  fi
fi

