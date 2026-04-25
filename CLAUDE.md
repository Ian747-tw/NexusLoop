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

