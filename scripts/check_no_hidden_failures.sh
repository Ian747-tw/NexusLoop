#!/usr/bin/env bash
# check_no_hidden_failures.sh — mechanical guard for the failure-hiding rules.
#
# Runs against the diff between BASE (default: origin/main) and HEAD.
# Fails CI if any of these patterns appear in ADDED lines:
#   - @pytest.mark.skip / @pytest.mark.skipif / @pytest.mark.xfail
#   - bare pytest.skip( call
#   - --ignore=<path> in any .github/workflows/ file
#   - -k filter in CI other than canonical "not test_ts"
#   - test file renamed to a non-collected pattern (test_*.py → testx_*.py, etc.)
#
# These rules are mandated by NON_NEGOTIABLE_RULES.md
# "Anti-Hallucination and Failure-Hiding Rules" §1.
#
# Local override is NOT supported. If you need to skip a test, the test must be
# DELETED in the same commit (not skipped) per Rule 1.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"
fail=0

# Resolve BASE to a commit. In CI, fetch-depth must be 0 for this to work.
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "ERROR: cannot resolve $BASE. CI checkout needs fetch-depth: 0."
  exit 2
fi

MERGE_BASE=$(git merge-base "$BASE" HEAD 2>/dev/null || echo "")
if [[ -z "$MERGE_BASE" ]]; then
  echo "ERROR: no merge-base between $BASE and HEAD."
  exit 2
fi

echo "== Diff range: $MERGE_BASE..HEAD =="
echo

# ---------------------------------------------------------------------------
# Guard 1: no new skip/xfail markers in Python
# ---------------------------------------------------------------------------
echo "== Guard 1: no new pytest.skip / xfail markers =="
ADDED_SKIPS=$(
  git diff "$MERGE_BASE"..HEAD -- '*.py' \
    | grep -E '^\+[^+]' \
    | grep -E '@pytest\.mark\.(skip|skipif|xfail)|pytest\.skip\(' \
    || true
)
if [[ -n "$ADDED_SKIPS" ]]; then
  echo "FAIL: new skip/xfail markers introduced:"
  echo "$ADDED_SKIPS" | sed 's/^/  /'
  echo
  echo "Per NON_NEGOTIABLE_RULES.md Rule 1: 'You may NEVER add"
  echo "@pytest.mark.skip... unless the test is being deleted in the same"
  echo "commit and replaced by a better test.'"
  fail=1
else
  echo "  OK"
fi
echo

# ---------------------------------------------------------------------------
# Guard 2: no --ignore in CI workflows
# ---------------------------------------------------------------------------
echo "== Guard 2: no --ignore flags in CI =="
ADDED_IGNORES=$(
  git diff "$MERGE_BASE"..HEAD -- '.github/workflows/*' \
    | grep -E '^\+[^+]' \
    | grep -e '--ignore=' \
    || true
)
if [[ -n "$ADDED_IGNORES" ]]; then
  echo "FAIL: new --ignore flags in CI:"
  echo "$ADDED_IGNORES" | sed 's/^/  /'
  fail=1
else
  echo "  OK"
fi
echo

# ---------------------------------------------------------------------------
# Guard 3: no -k filters except canonical "not test_ts"
# ---------------------------------------------------------------------------
echo "== Guard 3: -k filters allow only 'not test_ts' =="
# Extract -k arguments from CI workflow files
BAD_K=$(
  grep -rE -- '-k\s+"[^"]+"' .github/workflows/ 2>/dev/null \
    | grep -vE '"not test_ts"\s*$' \
    || true
)
if [[ -n "$BAD_K" ]]; then
  echo "FAIL: -k filter beyond canonical 'not test_ts':"
  echo "$BAD_K" | sed 's/^/  /'
  echo
  echo "Per NON_NEGOTIABLE_RULES.md Rule 1: 'The only acceptable filter is"
  echo "not test_ts for non-pytest TS files; nothing else.'"
  fail=1
else
  echo "  OK"
fi
echo

# ---------------------------------------------------------------------------
# Guard 4: no test files renamed to non-collected patterns
# ---------------------------------------------------------------------------
echo "== Guard 4: test files not renamed to dodge collection =="
RENAMES=$(
  git diff --name-status -M "$MERGE_BASE"..HEAD \
    | awk '
      $1 ~ /^R/ {
        old=$2; new=$3
        # Old name was a test file (test_*.py)
        if (old ~ /\/test_[^/]*\.py$/ || old ~ /^test_[^/]*\.py$/) {
          # New name does NOT match pytest collection
          if (new !~ /\/test_[^/]*\.py$/ && new !~ /^test_[^/]*\.py$/ && \
              new !~ /\/[^/]*_test\.py$/ && new !~ /^[^/]*_test\.py$/) {
            print "  " old " -> " new
          }
        }
      }
    '
)
if [[ -n "$RENAMES" ]]; then
  echo "FAIL: test file renamed to non-collected pattern:"
  echo "$RENAMES"
  fail=1
else
  echo "  OK"
fi
echo

# ---------------------------------------------------------------------------
# Guard 5: this script itself wasn't gutted
# ---------------------------------------------------------------------------
echo "== Guard 5: this guard script not weakened =="
SELF_CHANGED=$(
  git diff "$MERGE_BASE"..HEAD -- 'scripts/check_no_hidden_failures.sh' \
    | grep -E '^-[^-]' \
    | grep -E 'fail=1|grep -E|exit 1' \
    || true
)
if [[ -n "$SELF_CHANGED" ]]; then
  echo "WARN: scripts/check_no_hidden_failures.sh was modified."
  echo "Lines removed that contain rule-enforcement logic:"
  echo "$SELF_CHANGED" | sed 's/^/  /'
  echo "Modifications to this script require human authorization."
  # Don't auto-fail; surface for review. Architect will catch via PR diff.
fi
echo

# ---------------------------------------------------------------------------
# Final
# ---------------------------------------------------------------------------
if [[ $fail -ne 0 ]]; then
  echo "============================================================"
  echo "check_no_hidden_failures.sh: FAIL"
  echo "============================================================"
  echo "Fix the root cause, not the guard. Per NON_NEGOTIABLE_RULES.md:"
  echo "'When you find yourself thinking this can't be fixed so I'll"
  echo "just hide the test — that is the moment to stop and post the"
  echo "question.'"
  exit 1
fi
echo "check_no_hidden_failures.sh: PASS"