# Rule / Mechanism
1. Schema before code: Define Pydantic model + test, run test (red), then implement (green)
2. Test before feature: Every public API needs a failing test in tests/ before its implementation
3. No scope creep mid-phase: Each phase has a FORBIDDEN.md; touching anything in it must fail CI
4. Acceptance script must pass: Each phase has scripts/verify_phase_<N>.sh; exit gate = green
5. No silent edits to frozen files: M-1 ends with FROZEN.lock listing files that subsequent phases may not modify
6. Typed boundaries: mypy --strict on nxl_core/; failure blocks merge
7. Append-only state: After M0, events.jsonl is the only state mutator; direct file writes to state.json are forbidden
8. Replay diff = zero: After every change, nxl replay must reproduce stored final state byte-for-byte
9. Reference fixtures for golden tests: tests/fixtures/golden/ holds expected outputs; tests diff against these, not regenerate them
10. Daily heartbeat: At end of each work session, run scripts/heartbeat.sh; commits that fail it are reverted

## Anti-Hallucination and Failure-Hiding Rules

These rules are binding for every coding agent in every session. They are
the result of repeated failure modes observed in past sessions and override
any ad-hoc shortcut.

### 1. Failure-hiding is forbidden

You may NEVER:
- Rename a test file to dodge pytest collection (`test_*.py` → `testx_*.py`,
  `_test.py` → `_testx.py`, moving to a non-collected directory, etc.).
- Add `@pytest.mark.skip`, `@pytest.mark.skipif`, `@pytest.mark.xfail`,
  `unittest.skip`, or any equivalent decorator/comment to a failing test
  unless the test is being deleted in the same commit and replaced by a
  better test.
- Add a `-k`, `-m`, `--ignore`, `--deselect`, or `not <name>` exclusion to
  any CI command or `pytest.ini` to silence a specific failing test by
  name. The only acceptable filter is `not test_ts` for non-pytest TS
  files; nothing else.
- Comment out or delete failing assertions to make a test pass.
- Narrow an assertion to make a failing test pass (e.g. `assert x == 10`
  → `assert x >= 0`).
- Add a test-mode fallback that bypasses the contract under test (e.g.
  if `EventEmissionClient.emit()` is supposed to send IPC, do not have
  it short-circuit to direct writes when an env var is set).
- Write a CI guard that excludes the directory or file pattern where the
  bug class lives. Run the guard against a known-bad state during
  development to confirm it can fail.

### 2. The "pre-existing failure" claim requires proof

Before labeling any failure as "pre-existing" or "unrelated":
1. Check out `main` in a clean worktree.
2. Run the same command that produced the failure on your branch.
3. Paste the exact reproduction steps and the failure output from `main`.

If the failure does not reproduce on `main`, it is YOUR failure — fix it
in your phase, not later. A package added in your phase cannot have a
"pre-existing" issue. A test added in your phase is not "pre-existing"
either.

### 3. Completion claims require verifier output

You may NEVER declare a phase, sub-task, or PR complete without:
1. Running the full verifier specified in the brief.
2. Pasting the verifier output VERBATIM in your report — not a summary.
3. Mapping each commit in your branch to the corresponding sub-task in
   the brief (or explicitly explaining why a sub-task was collapsed).

Saying "all phases complete" without the verifier output is not a status
report; it is a wish. Reports that lack verifier output will be rejected.

### 4. Architecture push-back is a STOP signal

When a verifier reveals the architecture doesn't work as designed:
- DO NOT route around the failure with renames, fallbacks, name-pattern
  exclusions, or scope reductions.
- DO NOT downgrade the contract under test.
- DO NOT mark the test as a "known issue" and ship.
- STOP. Report the exact failure. Wait for the architect to either
  redesign or authorize a documented gap.

When you find yourself thinking "this can't be fixed, so I'll just hide
the test" — that is the moment to stop and post the question.

### 5. Anti-hallucination

You may NEVER:
- Invent a file path, function name, line number, or commit SHA. Verify
  each by reading or grepping before writing it down.
- Cite a test as passing without running it in the current session.
- Cite a number (test count, line count, file count) without producing
  it via a command in the current session.
- Extrapolate from one passing test to "all tests pass." Run the suite.
- Assume a tool, package, or API exists. Check imports, versions, docs.
- Generalize a one-off observation into a "pattern" or "all instances
  do X" without enumeration.
- Add code that calls a function or imports a module without first
  verifying it exists at the path you reference.

### 6. Scope reporting must be exhaustive

When reporting "what was migrated" / "what was changed":
- Enumerate every file affected, not "and other files" / "etc."
- Run `git diff --stat` and reference its full output.
- If the change is a refactor across many files, paste the full file
  list, not a representative sample.

A scope description that under-counts callers, files, or test cases
will be treated as a deliberate misrepresentation.

### 7. Frozen-file discipline

- Do not modify any file in `FROZEN.lock` without explicit
  authorization in the current session.
- Authorization is scoped to the specific commit and purpose stated.
  Do not extend it to other commits or other files.
- After an authorized edit, the file remains in `FROZEN.lock`. Do not
  remove the entry unless the human explicitly says to.

### 8. When in doubt, stop and ask

These rules are designed to bind even when you think the rule is being
applied too strictly. If you are tempted to make an exception "just
this once," that is the strongest signal that you should stop and ask.
The cost of a five-minute pause is negligible. The cost of a hidden
failure compounds across phases.