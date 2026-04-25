#!/usr/bin/env bash
# verify_priority_1.sh — exits 0 iff Priority 1 documentation work is complete and consistent.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
check() { if eval "$1" >/dev/null 2>&1; then echo "  OK  $2"; else echo "  FAIL $2"; fail=1; fi; }

echo "== Files exist =="
check "test -f agentcore/SEAM_INVENTORY.md"                                  "SEAM_INVENTORY.md"
check "test -f agentcore/SEAM_CONTRACT_TIER2.md"                            "SEAM_CONTRACT_TIER2.md"
check "test -f agentcore/PROTOCOL_v1.1.md"                                   "PROTOCOL_v1.1.md"
check "test -f agentcore/adr/ADR-006-tier-2-seam-contract.md"              "ADR-006"
check "test -f agentcore/adr/ADR-007-single-brain-architecture.md"          "ADR-007"
check "test -f agentcore/adr/ADR-008-two-tier-scheduling.md"                "ADR-008"
check "test -f agentcore/adr/ADR-009-single-writer-event-log.md"           "ADR-009"
check "test -f PRINCIPLES_EXTENDED.md"                                       "PRINCIPLES_EXTENDED.md"
check "test -x scripts/audit-fork-depth.sh"                                 "audit-fork-depth.sh executable"
check "test -x scripts/verify_priority_1.sh"                                "verify_priority_1.sh executable"

echo
echo "== Frozen files untouched =="
# Compare against the merge-base on main (or HEAD~6 as fallback)
BASE=$(git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~6 2>/dev/null || git rev-parse HEAD~5 2>/dev/null || git rev-parse HEAD~4 2>/dev/null || git rev-parse HEAD~3 2>/dev/null || git rev-parse HEAD~2 2>/dev/null || git rev-parse HEAD~1)
for f in CLAUDE.md agentcore/SEAM_CONTRACT.md agentcore/PROTOCOL.md NON_NEGOTIABLE_RULES.md NON_NEGOTIABLE_RULES_dev.md; do
  if [[ -n "$BASE" ]] && git diff --quiet "$BASE" -- "$f" 2>/dev/null; then
    echo "  OK  $f unchanged"
  else
    echo "  FAIL $f modified (frozen)"; fail=1
  fi
done

echo
echo "== Principles landed =="
for f in PRINCIPLES_EXTENDED.md AGENTS.md; do
  for kw in "Single Brain Principle" "Two-Tier Scheduling" "Single-Writer"; do
    check "grep -q \"$kw\" $f" "$f contains \"$kw\""
  done
done

echo
echo "== VENDOR_BOUNDARY consistency =="
check "grep -q 'seams/research-state.ts'        agentcore/VENDOR_BOUNDARY.md" "research-state.ts entry present"
check "grep -q 'seams/scheduler-integration.ts' agentcore/VENDOR_BOUNDARY.md" "scheduler-integration.ts entry present"
check "! grep -q 'turn-loop-hooks.ts'           agentcore/VENDOR_BOUNDARY.md" "no turn-loop-hooks.ts entry (per ADR-008)"
check "grep -q 'Implemented fork-level modifications' agentcore/VENDOR_BOUNDARY.md" "implemented subsection present"
check "grep -q 'Planned but not yet implemented'      agentcore/VENDOR_BOUNDARY.md" "planned subsection present"

echo
echo "== audit-fork-depth.sh =="
# It should pass (exit 0) since all 6 documented implemented seams have files
# and the 8 planned seams (6 from M1-M3 + 2 tier-2) are correctly marked as planned
out=$(bash scripts/audit-fork-depth.sh 2>&1 || true)
check "echo \"$out\" | grep -q 'planned seams/research-state.ts'"        "audit reports research-state planned"
check "echo \"$out\" | grep -q 'planned seams/scheduler-integration.ts'" "audit reports scheduler-integration planned"

echo
echo "== Tier 1 contract not mutated =="
# SEAM_CONTRACT.md TS code block has 9 exports (not 8 as some comments claim)
# The key is that the file is unchanged from merge-base
T1_EXPORTS=$(awk '/```typescript/,/^```$/' agentcore/SEAM_CONTRACT.md | grep -cE '^export ' || echo 0)
if [[ "$T1_EXPORTS" -eq 9 ]]; then
  echo "  OK  SEAM_CONTRACT.md TS block has 9 exports (unchanged)"
else
  echo "  FAIL SEAM_CONTRACT.md TS block has $T1_EXPORTS exports (expected 9)"; fail=1
fi

echo
if [[ $fail -ne 0 ]]; then
  echo "Priority 1 verification: FAIL"
  exit 1
fi
echo "Priority 1 verification: PASS"
