#!/usr/bin/env bash
set -euo pipefail

DRY=""
if [[ "${1:-}" == "--dry" ]]; then
  DRY="echo DRY_RUN:"
fi

UPSTREAM="agentcore/upstream"
CURRENT=$(cd "$UPSTREAM" && git rev-parse HEAD)
TARGET="${2:-v1.14.22}"

START_TIME=$(date +%s)
CONFLICT_LINES=0

# Pull via subtree
$DRY git subtree pull --prefix=$UPSTREAM https://github.com/anomalyco/opencode.git $TARGET --squash

# Detect conflicts (count lines containing conflict markers)
CONFLICT_LINES=$(git diff 2>/dev/null | grep -cE '^(<<<<<<<|=======|>>>>>>>)$' || true)

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

# Record in journal
echo "$(date -Iseconds) | $TARGET | ${ELAPSED}s | conflicts:${CONFLICT_LINES}" >> agentcore/REBASE_JOURNAL.md

# Type check
if [[ -z "$DRY" ]]; then
  (cd agentcore/server-fork && bun run typecheck)
fi

echo "Rebase complete: ${ELAPSED}s, ${CONFLICT_LINES} conflict lines"
if [[ $CONFLICT_LINES -gt 30 ]] || [[ $ELAPSED -gt 7200 ]]; then
  echo "ERROR: exceeded limits (30 lines / 2h)"
  exit 1
fi
