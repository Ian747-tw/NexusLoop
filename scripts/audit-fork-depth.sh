#!/usr/bin/env bash
# audit-fork-depth.sh — verify VENDOR_BOUNDARY.md "implemented" claims match disk.
# Exits 0 only if every "Implemented fork-level modifications" entry has a file.
# Reports planned-but-missing as informational (does not fail).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VB="$REPO_ROOT/agentcore/VENDOR_BOUNDARY.md"
SEAMS_DIR="$REPO_ROOT/agentcore/server-fork/src/seams"

[[ -f "$VB" ]] || { echo "VENDOR_BOUNDARY.md not found at $VB"; exit 2; }

# Parse entries of the form: `seams/<name>.ts`
# (matches both implemented and tier-2 sections; we use VB section headers as boundaries)

extract_section() {
  # $1 = section header (regex)
  awk -v section="$1" '
    $0 ~ section {capture=1; next}
    capture && /^### / {capture=0}
    capture {print}
  ' "$VB"
}

implemented=$(extract_section '^### Implemented fork-level modifications' | grep -oE 'seams/[a-z-]+\.ts' | sort -u)
planned=$(extract_section '^### Planned but not yet implemented' | grep -oE 'seams/[a-z-]+\.ts' | sort -u)
tier2=$(extract_section '^### Tier 2 — Research seams' | grep -oE 'seams/[a-z-]+\.ts' | sort -u)

fail=0

echo "=== Implemented seams (must exist on disk) ==="
for s in $implemented; do
  path="$REPO_ROOT/agentcore/server-fork/src/$s"
  if [[ -f "$path" ]]; then
    echo "  OK      $s"
  else
    echo "  MISSING $s   <-- VENDOR_BOUNDARY claims implemented, no file"
    fail=1
  fi
done

echo
echo "=== Planned seams (informational; not yet implemented) ==="
for s in $planned $tier2; do
  path="$REPO_ROOT/agentcore/server-fork/src/$s"
  if [[ -f "$path" ]]; then
    echo "  EXISTS  $s   <-- promote to Implemented section"
  else
    echo "  planned $s"
  fi
done

if [[ $fail -ne 0 ]]; then
  echo
  echo "FAIL: at least one implemented seam is missing its file."
  exit 1
fi

echo
echo "OK: all implemented seams have files on disk."
