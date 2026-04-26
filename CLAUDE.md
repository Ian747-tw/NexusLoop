# NexusLoop execution rules

## Before writing any code
1. State which phase you are in and which step number
2. Read `phases/M<N>/FORBIDDEN.md` — do not modify anything listed
3. Read `phases/M<N>/checklist.md` — find the current unchecked step
4. Read the test for that step (if missing, write the test first)
5. Run the test. It must fail. If it passes, the feature already exists — skip to next step
6. Implement the smallest change to make the test pass
7. Run `scripts/verify_step.sh <phase> <step>` — must exit 0
8. Tick the box in `checklist.md`, commit with message `M<N>.<step>: <description>`
9. Those phase mds and scripts may not exists in the folder, but the content will appear in the prompt, if the user enter a long prompt, collect information and create those mds and scripts first before writing any code. and constantly update or delete those mds and scripts when new information is provided and olds are done. 
10. 'NON_NEGOTIABLE_RULES_dev.md' is the dev version of 'NON_NEGOTIABLE_RULES.md', it is used for development purposes only while 'NON_NEGOTIABLE_RULES.md' is for run time research rules for users only. 

## Forbidden behaviors
- Never edit `NON_NEGOTIABLE_RULES.md` and `NON_NEGOTIABLE_RULES_dev.md`
- Never create hard code cheat tests to pass the tests and pretend it works. the tests should be generic and reusable for the users' needs.
- Never write to `events.jsonl` except via `EventLog.append()`
- Never modify a file listed in `FROZEN.lock`
- Never invent a file path; if a file does not exist, ask before creating
- Never claim a step is done without running its verifier
- Never skip a failing test by marking it `xfail` or `skip`
- Never install packages globally (NON_NEGOTIABLE #4)

## When stuck
- If a verifier fails 3 times for the same reason, stop and report; do not "try alternative approaches" indefinitely
- If a test reveals a design problem, stop and ask before changing the design
- If you discover scope creep, write the new requirement to `phases/M<N>/SCOPE_QUESTIONS.md` and continue with the original scope

## The Decision Principle

Every decision in NexusLoop is one of three kinds. Before implementing,
classify it:

- RESEARCH DECISION (LLM drives via OpenCode):
  Choosing what to try, prioritizing candidates, interpreting evidence,
  judging when to pivot strategy, deciding novel vs. trivial, diagnosing
  unexpected states. → Belongs in an LLM call inside OpenCode.

- SYSTEM DECISION (algorithm drives, deterministic):
  Was an action permitted? Did a programmatic postcondition hold?
  Is a hash a duplicate? Is a spec_hash matched? Is a budget exceeded?
  Is an event well-formed? → Belongs in deterministic Python.

- HYBRID DECISION:
  LLM proposes the judgment; algorithm verifies constraints and records
  the event; second-review LLM sometimes adjudicates.

Default bias: when unsure, lean LLM. OpenCode is the main character.
The harness exists so OpenCode can be trusted to do its job, not to
do OpenCode's job for it.

## The Integration Principle

NexusLoop never runs an LLM call from Python.

Every LLM-driven decision happens inside OpenCode, by the LLM running
in OpenCode's session. NexusLoop provides:
- MCPs (tools the LLM calls)
- Skills as slash commands (composed flows)
- Subagent configs (isolated reasoning contexts)

If you find yourself writing:
- a Python module that calls OpenCode's API and parses the response → STOP
- a Python "agent" that wraps an LLM call → STOP
- an external orchestrator that drives OpenCode from outside → STOP

Instead, write:
- an MCP that exposes the operation as a tool the LLM can call
- a YAML skill that composes MCP calls + reasoning
- a subagent config that OpenCode spawns natively

If a behavior can't be expressed in these primitives, the gap is in
NexusLoop's tool surface, not in the design. Add the missing tool.

## The Fork Discipline

The fork (`agentcore/`) exists for things plug-ins cannot do:
- intercept every tool call (gated-dispatch)
- replace the permission UI (intervention-hook)
- control cache breakpoint + delegate compaction (capsule-session)
- emit events at every turn lifecycle point (cycle observer)
- instrument every provider call (prompt/response/tokens/cache)
- enforce subagent context firewall
- swap session storage to events.jsonl
- flush events on lifecycle exit
- gate tripwire-blocked dispatches

Anything that does not require fork-level access belongs as a plug-in,
MCP, skill, or subagent — not in the fork.

If you find yourself adding code to the fork that could be a plug-in,
move it out. If you find yourself adding code as a plug-in that
requires intercepting upstream behavior, it must move into the fork
and be added to VENDOR_BOUNDARY.md.

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

