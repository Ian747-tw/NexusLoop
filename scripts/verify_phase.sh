#!/usr/bin/env bash
set -euo pipefail

phase="${1:?usage: scripts/verify_phase.sh <phase>}"

echo "Checking full phase ${phase}"

run_e2e_for_phase() {
  local marker="${1:?marker required}"
  echo "Checking user-simulation E2E scenarios for ${phase}: ${marker}"
  uv run pytest tests/e2e_user/scenarios/ -v -m "${marker}"
}

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
    uv run pytest tests/smoke
    run_e2e_for_phase "phase_m_minus_1"
    ;;
  M0)
    run_e2e_for_phase "phase_m_minus_1 or phase_m0"
    ;;
  M1)
    run_e2e_for_phase "phase_m_minus_1 or phase_m0 or phase_m1"
    ;;
  M2)
    run_e2e_for_phase "phase_m_minus_1 or phase_m0 or phase_m1 or phase_m2"
    ;;
  M3)
    run_e2e_for_phase "phase_m_minus_1 or phase_m0 or phase_m1 or phase_m2 or phase_m3"
    ;;
  M4)
    run_e2e_for_phase "phase_m_minus_1 or phase_m0 or phase_m1 or phase_m2 or phase_m3 or phase_m4"
    ;;
  *)
    echo "No phase verifier registered for ${phase}" >&2
    exit 1
    ;;
esac
