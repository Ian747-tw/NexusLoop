# Extended Principles (post-M1.1)

CLAUDE.md is frozen at M1.1 and contains 3 principles: Decision, Integration,
Fork Discipline. This file extends them with 2 additional principles + 1
invariant introduced for the Single Brain + Two-Tier Scheduling architecture.

Read this file alongside CLAUDE.md. Both bind execution.

## The Single Brain Principle

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

## The Two-Tier Scheduling Principle

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
