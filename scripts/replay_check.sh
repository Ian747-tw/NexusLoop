#!/usr/bin/env bash
set -euo pipefail

echo "Checking replay state consistency"
if test ! -f events.jsonl; then
  echo "No events.jsonl present; replay check skipped for foundation phase"
  exit 0
fi

if command -v nxl >/dev/null 2>&1; then
  nxl replay --check
else
  uv run nxl replay --check
fi
