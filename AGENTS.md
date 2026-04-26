# NexusLoop Execution Rules

Same content as CLAUDE.md — keep in sync.

Codex agents must follow the same execution contract as [CLAUDE.md](CLAUDE.md).

## End-to-end user-simulation testing

In addition to unit, integration, and adversarial tests, NexusLoop has **user-simulation E2E tests** in `tests/e2e_user/`. These are distinct from all other test types and represent the final ground truth for local release validation.

### Rules for E2E tests

1. **Every new user-facing feature must ship with an E2E scenario.** If a user can run it, we must simulate a user running it.

2. **E2E scenarios use only the real CLI.** Never import NexusLoop modules inside an E2E test. Never monkey-patch internals. If you feel the urge to patch, the test belongs in `tests/integration/`, not `tests/e2e_user/`.

3. **Every E2E scenario runs inside a fresh sandbox.** Use the `sandbox` fixture from `conftest.py`. It creates a fresh temp dir, fresh venv, fresh config; it does not share state with other tests or the developer's machine.

4. **Every E2E scenario is tagged with its minimum phase.** `@pytest.mark.phase_m<N>` — so earlier phases don't run scenarios that require features they haven't built yet.

5. **When an E2E test fails, the bug is in NexusLoop — not in the test.** Never "relax" an E2E assertion to make it pass. Reproduce the failure manually, fix the bug, re-run.

6. **E2E tests run locally, not in default GitHub CI.** Keep the user-simulation harness as a local developer/release gate. The default CI pipeline runs non-E2E checks only.

7. **Never skip an E2E test.** If it's flaky, fix the flakiness. If it's slow, optimize runtime or run it manually outside default CI. Never `@pytest.mark.skip`.

### Workflow when adding any user-facing feature

1. Write the E2E scenario first (red)
2. Write the unit tests (red)
3. Implement the feature
4. E2E (local) + unit/non-E2E tests (CI) go green
5. Commit as `M<phase>.<step>: <description>`

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

---

## Extended Principles (post-M1.1)

These principles also live in `PRINCIPLES_EXTENDED.md` (canonical for sessions
reading CLAUDE.md, which is frozen at M1.1).

### The Single Brain Principle

NexusLoop is research-augmented OpenCode. It is **one system, not two.**

- The cycle, program state, registry, scheduler are TS objects living in the
  fork's session. They are not Python objects mediated by IPC.
- The LLM running inside the fork sees research state in its prompt natively.
  It does not fetch state via MCP for every decision.
- OpenCode's native loop drives the research cycle. The fork extends turn-start,
  turn-end, and cycle-end hooks to make the loop research-aware.
- Python is a **library**: schemas, replay verification, ML primitives. It does
  not run the research cycle.
- MCPs and OpenCode's native tools are both *executors* the LLM uses. Neither
  commands the other.

If you find yourself building a Python module that holds runtime state and
sends decisions to OpenCode → STOP. State belongs in the fork's session.

### Single-Writer Invariant (sub-rule)

The fork is the only writer to `events.jsonl` at runtime. Python MCPs that
need to record state changes send `EventEmissionRequest` (PROTOCOL_v1.1.md)
to the fork; the fork serializes the append. Python may freely **read**
`events.jsonl`. Test fixtures using isolated EventLog instances are exempt
(invariant binds runtime, not the harness).

See ADR-007 (Single Brain) and ADR-009 (Single-Writer) for rationale.

### The Two-Tier Scheduling Principle

Two schedulers, two layers, two time scales — no conflict.

- **Inner scheduler** (OpenCode native, untouched): orders tool calls within
  a single turn. Milliseconds-to-seconds. Owns: per-turn pending tool calls,
  results buffer.
- **Outer scheduler** (NexusLoop, lives in fork session state, planned at
  seam #13): picks the next hypothesis cycle. Minutes-to-hours. Owns: cycle
  queue, program state, registry projection, tier state, capsule cursor.

Outer scheduler **never** mutates per-turn state. Inner scheduler **never**
decides which cycle runs. They hook at different lifecycle points (cycle
boundary vs. tool call). Hierarchical, not competitive.

The outer scheduler always picks from a queue populated by the LLM (research
decision, Decision Principle). TS code may rank and gate (system decision)
but never enqueue from scratch.

See ADR-008 for the lifecycle diagram and the locked `research:` namespace
schema.

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
