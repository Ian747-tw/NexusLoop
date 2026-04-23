#!/usr/bin/env bash
set -euo pipefail

iterations="${1:?usage: scripts/policy_fuzz.sh <iterations>}"
echo "Checking policy fuzz placeholder for ${iterations} iterations"
test "${iterations}" -ge 0
