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
  M0:1)
    echo "Checking Event schema — 18 discriminated union kinds"
    uv run pytest tests/unit/events/test_schema.py -v
    uv run python -c "from nxl_core.events.schema import Event; print('Event union imported OK')"
    ;;
  M0:2)
    echo "Checking EventLog append-only with file locking"
    uv run pytest tests/integration/events/test_log_concurrent.py -v
    ;;
  M0:3)
    echo "Checking deterministic replay"
    uv run pytest tests/integration/events/test_replay_deterministic.py -v
    ;;
  M0:4)
    echo "Checking logging module event emission"
    uv run pytest tests/integration/logging/ -v
    ;;
  M0:5)
    echo "Checking Hypothesis canonical hash"
    uv run pytest tests/unit/research/test_hypothesis_hash.py -v
    uv run python -c "from nxl_core.research.hypothesis import Hypothesis; print('Hypothesis imported OK')"
    ;;
  M0:6)
    echo "Checking Polymorphic Trial (9 kinds)"
    uv run pytest tests/unit/research/test_trial.py -v
    ;;
  M0:7)
    echo "Checking Polymorphic Evidence + closure rules"
    uv run pytest tests/unit/research/test_evidence.py -v
    ;;
  M0:8)
    echo "Checking ScoreVector + ParetoRanker"
    uv run pytest tests/unit/research/test_score.py -v
    ;;
  M0:9)
    echo "Checking noise floor estimator"
    uv run pytest tests/unit/research/test_noise_floor.py -v
    ;;
  M0:10)
    echo "Checking Typed Rule objects"
    uv run pytest tests/unit/policy/test_rules.py -v
    ;;
  M0:11)
    echo "Checking PolicyEngine.check()"
    uv run pytest tests/unit/policy/test_engine.py -v
    ;;
  M0:12)
    echo "Checking CapabilityToken machinery"
    uv run pytest tests/unit/policy/test_tokens.py -v
    ;;
  M0:13)
    echo "Checking Zone A/B/C transitions"
    uv run pytest tests/unit/policy/test_zones.py -v
    ;;
  M0:14)
    echo "Checking adversarial test suite (100 rule violations)"
    uv run pytest tests/adversarial/ -v
    ;;
  M0:15)
    echo "Checking ResumeCapsule deterministic builder"
    uv run pytest tests/unit/capsule/test_resume.py -v
    ;;
  M0:16)
    echo "Checking HandoffRecord"
    uv run pytest tests/unit/capsule/test_handoff.py -v
    ;;
  M0:17)
    echo "Checking three-tier compaction"
    uv run pytest tests/unit/capsule/test_compact.py -v
    ;;
  M0:18)
    echo "Checking ProjectSpec"
    uv run pytest tests/unit/spec/test_model.py -v
    ;;
  M0:19)
    echo "Checking compact + index generators"
    uv run pytest tests/unit/spec/test_index.py -v
    ;;
  M0:20)
    echo "Checking run.py event emission boundary"
    uv run pytest tests/integration/test_run_event_emission.py -v
    ;;
  *)
    echo "No verifier registered for ${phase} step ${step}" >&2
    exit 1
    ;;
esac