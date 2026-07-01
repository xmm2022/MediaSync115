#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="all"

usage() {
  cat <<'EOF'
Usage: scripts/verify-compose.sh [--all|--local|--dev|--nas]

Default: --all
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --all)
      MODE="all"
      shift
      ;;
    --local)
      MODE="local"
      shift
      ;;
    --dev)
      MODE="dev"
      shift
      ;;
    --nas)
      MODE="nas"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

check_compose() {
  echo "Checking: docker compose $* config --quiet"
  docker compose "$@" config --quiet
}

if [ "$MODE" = "all" ] || [ "$MODE" = "local" ]; then
  check_compose -f compose.yaml
  check_compose -f compose.yaml -f compose.anirss.yaml
  check_compose -f compose.pansou.yaml
  check_compose -f compose.pansou.yaml -f compose.anirss.yaml
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "dev" ]; then
  check_compose -f compose.dev.yaml
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "nas" ]; then
  check_compose -f compose.nas.yaml
  check_compose -f compose.nas.pansou.yaml
fi
