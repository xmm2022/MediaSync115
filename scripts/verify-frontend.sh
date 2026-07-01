#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/frontend"

RUN_BUILD=0

usage() {
  cat <<'EOF'
Usage: scripts/verify-frontend.sh [--build]

Default runs npm test.
Options:
  --build   Also run npm run build.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build)
      RUN_BUILD=1
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

npm test
if [ "$RUN_BUILD" -eq 1 ]; then
  npm run build
fi
