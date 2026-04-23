#!/usr/bin/env bash
set -euo pipefail

phase="${1:?usage: scripts/verify_step.sh <phase> <step>}"
step="${2:?usage: scripts/verify_step.sh <phase> <step>}"

echo "Checking phase ${phase} step ${step}"

case "${phase}:${step}" in
  M-1:1)
    echo "Checking bootstrap files exist"
    test -f pyproject.toml
    test -f README.md
    test -f .gitignore
    test -f LICENSE
    count="$(git ls-files | wc -l | tr -d ' ')"
    echo "Checking tracked bootstrap file count is 4-6: ${count}"
    test "${count}" -ge 4
    test "${count}" -le 6
    ;;
  M-1:2)
    echo "Checking drl_autoresearch references are absent from renamed code and examples"
    test -d nxl
    if grep -R "drl_autoresearch" nxl examples 2>/dev/null; then
      exit 1
    fi
    ;;
  M-1:3)
    echo "Checking fork leftover root markdown files are removed"
    root_md="$(find . -maxdepth 1 -type f -name '*.md' -printf '%f\n' | sort | tr '\n' ' ')"
    echo "Root markdown files: ${root_md}"
    test "${root_md}" = "ACKNOWLEDGEMENTS.md AGENTS.md CLAUDE.md NON_NEGOTIABLE_RULES.md NON_NEGOTIABLE_RULES_dev.md README.md "
    ;;
  M-1:4)
    echo "Checking package metadata and CLI entrypoint"
    uv sync
    uv run nxl --help >/dev/null
    ;;
  M-1:5)
    echo "Checking CI workflow exists"
    test -f .github/workflows/ci.yml
    grep -q "ruff check" .github/workflows/ci.yml
    grep -q "mypy" .github/workflows/ci.yml
    grep -q "pytest" .github/workflows/ci.yml
    ;;
  M-1:6)
    echo "Checking verifier scripts exist and are executable"
    test -x scripts/verify_step.sh
    test -x scripts/verify_phase.sh
    test -x scripts/heartbeat.sh
    test -x scripts/replay_check.sh
    ;;
  M-1:7)
    echo "Checking CLAUDE.md has the execution contract"
    test -f CLAUDE.md
    lines="$(wc -l < CLAUDE.md | tr -d ' ')"
    echo "CLAUDE.md line count: ${lines}"
    test "${lines}" -ge 30
    grep -q "Before writing any code" CLAUDE.md
    ;;
  M-1:8)
    echo "Checking phase skeleton directories"
    for dir in phases/M-1 phases/M0 phases/M1 phases/M2 phases/M3 phases/M4; do
      test -d "${dir}"
      test -f "${dir}/checklist.md"
      test -f "${dir}/FORBIDDEN.md"
    done
    ;;
  M-1:9)
    echo "Checking FROZEN.lock is present and non-empty"
    test -s FROZEN.lock
    ;;
  M-1:10)
    echo "Checking full M-1 phase verifier"
    scripts/verify_phase.sh M-1
    ;;
  *)
    echo "No verifier registered for ${phase} step ${step}" >&2
    exit 1
    ;;
esac
