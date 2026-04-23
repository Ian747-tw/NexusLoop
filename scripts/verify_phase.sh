#!/usr/bin/env bash
set -euo pipefail

phase="${1:?usage: scripts/verify_phase.sh <phase>}"

echo "Checking full phase ${phase}"

case "${phase}" in
  M-1)
    scripts/verify_step.sh M-1 2
    scripts/verify_step.sh M-1 3
    scripts/verify_step.sh M-1 4
    scripts/verify_step.sh M-1 5
    scripts/verify_step.sh M-1 6
    scripts/verify_step.sh M-1 7
    scripts/verify_step.sh M-1 8
    scripts/verify_step.sh M-1 9
    echo "Checking nxl --help works"
    uv run nxl --help >/dev/null
    echo "Checking CI-equivalent commands"
    uv run ruff check .
    uv run mypy nxl
    uv run pytest
    ;;
  *)
    echo "No phase verifier registered for ${phase}" >&2
    exit 1
    ;;
esac
