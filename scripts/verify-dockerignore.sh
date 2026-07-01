#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERIGNORE="$ROOT/.dockerignore"

required_patterns=(
  "data/"
  "strm/"
  "logs"
  "*.db"
  "*.sqlite3"
  ".env"
  ".env.*"
  "backend/.env"
  "frontend/.env.local"
  ".cursor"
  ".kiro"
)

missing=0
for pattern in "${required_patterns[@]}"; do
  if ! grep -Fxq "$pattern" "$DOCKERIGNORE"; then
    echo "Missing .dockerignore pattern: $pattern" >&2
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo ".dockerignore runtime-data boundary is present"

