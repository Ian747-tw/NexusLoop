#!/usr/bin/env bash
set -euo pipefail

duration="${1:?usage: scripts/chaos_run.sh <duration>}"
echo "Checking chaos run placeholder for duration ${duration}"
test -n "${duration}"
