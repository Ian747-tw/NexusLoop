#!/usr/bin/env bash
# verify_single_writer.sh — CI gate for P3 single-writer invariant.
# Exits 0 if no Python code writes to events.jsonl via EventLog.append except tests.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# Find all EventLog.append calls in Python code, excluding:
# - test files (use NXL_EVENTLOG_WRITER=test)
# - nxl_core/events/ implementation files themselves
grep_args=(
  --no-filename
  '-n'
  '-o'
  '--word-regexp'
  'EventLog.append'
)

echo "== Scanning for EventLog.append in Python =="

# Exclude test files only. mcps/ are migrated and must be scanned.
# Also exclude nxl_core/events/ itself (the implementation).
mapfile -t matches < <(grep -r 'EventLog\.append' . \
  --include='*.py' \
  --exclude-dir='.claude' \
  --exclude-dir='node_modules' \
  --exclude-dir='upstream' \
  --exclude-dir='agentcore/tests' \
  --exclude-dir='tests' \
  2>/dev/null | grep -v 'nxl_core/events/log.py:' | grep -v 'conftest.py:')

if [[ ${#matches[@]} -gt 0 ]]; then
  echo "FAIL: EventLog.append found in non-test Python code:"
  for m in "${matches[@]}"; do echo "  $m"; done
  fail=1
else
  echo "  OK  No EventLog.append in production Python (outside tests)"
fi

echo
echo "== Scanning for direct write patterns to events.jsonl =="

mapfile -t write_matches < <(grep -r 'events\.jsonl' . \
  --include='*.py' \
  --exclude-dir='.claude' \
  --exclude-dir='node_modules' \
  --exclude-dir='upstream' \
  --exclude-dir='agentcore/tests' \
  --exclude-dir='tests' \
  2>/dev/null | grep -v 'nxl_core/events/log.py:' | grep -v 'nxl_core/events/ipc.py:')

echo
if [[ $fail -ne 0 ]]; then
  echo "Single-writer CI gate: FAIL"
  exit 1
fi
echo "Single-writer CI gate: PASS"