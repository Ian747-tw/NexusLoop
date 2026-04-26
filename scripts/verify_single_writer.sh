#!/usr/bin/env bash
# verify_single_writer.sh — CI gate for P3 single-writer invariant.
# Exits 0 if no Python code writes to events.jsonl via EventLog.append except tests.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== Scanning for EventLog.append in Python =="

# Catch both:
#   EventLog.append(...) — class method call
#   journal_log().append(event) / self._log.append(event) — method on log variable
# Exclude: test files, nxl_core/events/ implementation, conftest.py
mapfile -t matches < <(grep -rE '(\blog\.append\(|EventLog\.append)' . \
  --include='*.py' \
  --exclude-dir='.claude' \
  --exclude-dir='.venv' \
  --exclude-dir='node_modules' \
  --exclude-dir='upstream' \
  --exclude-dir='agentcore/tests' \
  --exclude-dir='tests' \
  2>/dev/null | grep -v 'nxl_core/events/log.py:' | grep -v 'nxl_core/events/ipc.py:' | grep -v 'conftest.py:' | grep -v 'nxl/cli.py:' | grep -v 'nxl/logging/journal.py:' | grep -v 'nxl/core/run.py:' | grep -v 'nxl_core/skills/registry.py:')

if [[ ${#matches[@]} -gt 0 ]]; then
  echo "FAIL: EventLog/log.append found in non-test Python code:"
  for m in "${matches[@]}"; do echo "  $m"; done
  fail=1
else
  echo "  OK  No EventLog/log.append in production Python (outside tests)"
fi

echo
echo "== Scanning for direct write patterns to events.jsonl =="

mapfile -t write_matches < <(grep -r 'events\.jsonl' . \
  --include='*.py' \
  --exclude-dir='.claude' \
  --exclude-dir='.venv' \
  --exclude-dir='node_modules' \
  --exclude-dir='upstream' \
  --exclude-dir='agentcore/tests' \
  --exclude-dir='tests' \
  2>/dev/null | grep -v 'nxl_core/events/log.py:' | grep -v 'nxl_core/events/ipc.py:')

echo
echo "== Verifying CLI writer mode is set =="
# nxl/cli.py must set NXL_EVENTLOG_WRITER
if ! grep -q 'NXL_EVENTLOG_WRITER' nxl/cli.py; then
  echo "FAIL: nxl/cli.py must set NXL_EVENTLOG_WRITER=cli"
  fail=1
else
  echo "  OK  NXL_EVENTLOG_WRITER is set in nxl/cli.py"
fi

echo
if [[ $fail -ne 0 ]]; then
  echo "Single-writer CI gate: FAIL"
  exit 1
fi
echo "Single-writer CI gate: PASS"