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
