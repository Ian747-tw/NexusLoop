#!/usr/bin/env bash
set -euo pipefail

echo "Checking working tree is committed"
test -z "$(git status --porcelain)"

echo "Checking no untracked files in nxl/"
if git status --porcelain -- nxl | grep -q '^??'; then
  exit 1
fi

echo "Checking replay consistency"
scripts/replay_check.sh
