# NexusLoop Architecture

This document is the canonical architecture target for future NexusLoop work.
It describes the intended runtime-server + OpenTUI + research/spec backend
design. Historical plans that center a Python orchestrator or dashboard are
retained for context only and are deprecated.

## System Roles

NexusLoop is organized around four primary runtime surfaces:

- **TS Runtime Server** is the backend brain. It owns session runtime state,
  event emission, policy gates, lifecycle hooks, and the durable interfaces
  between execution, approvals, spec state, and research state.
- **OpenCode** is the tactical executor. It performs turn-by-turn reasoning,
  tool use, and subagent execution inside the runtime server session.
- **Commander** is the mission/state/research decision layer. It proposes and
  adjudicates higher-level research actions, interprets evidence, requests
  clarification, and writes approved state transitions through runtime-owned
  barriers.
- **OpenTUI** is the default user experience shell. Users should interact with
  NexusLoop through the TUI, not a browser dashboard.

Python remains important, but only as a library/tooling surface for MCPs,
schemas, replay verification, extraction pipelines, and similar deterministic
components. Python is not the primary runtime brain.

## Authority Model

### Event Log Is Source Of Truth

`events.jsonl` is the authoritative runtime ledger.

- Runtime facts are durable only after they are emitted as events.
- Session recovery, projections, approvals, spec state, and research state must
  be reconstructible from the event log.
- No component may treat prose summaries, transient caches, or UI state as
  authoritative.

### Research DB Is A Projection

`research.db` is a rebuildable projection over the event log.

- It exists to support fast search, structured views, filtering, aggregation,
  and operator ergonomics.
- If `research.db` is deleted or corrupted, the runtime must be able to rebuild
  it from `events.jsonl`.
- Projection code may normalize and index research records, but it may not
  invent missing authority.

### Spec Backend Is Approved Project Truth

`spec.db` or its equivalent spec backend stores the approved project truth:

- normalized project spec state
- approved constraints and policy overlays
- version history and superseded revisions
- clarification records and approval decisions

The runtime may stage extracted or proposed spec changes, but they become
binding only after approval and durable recording. Plain text source material
remains important input, not final authority by itself.

## Operational Principles

### No Trusted LLM Memory

NexusLoop must not rely on the model "remembering" facts across turns.

- Important state must be captured in durable records, not assumed to live in
  the model context window.
- Research candidates, findings, approvals, trials, and mission state require
  runtime-owned storage and evented reconstruction.
- Prompting may expose relevant state to the model, but prompt context is a
  delivery mechanism, not a trust boundary.

### No Completion Or Promotion From Prose

Free-form text from the model is never enough by itself to:

- mark a mission complete
- promote a candidate or finding
- mutate approved project spec
- declare a trial successful
- close required clarification or approval steps

Prose may propose these actions. The runtime must convert them into structured,
validated, durable records before they become authoritative.

### Runtime-Owned Write Barriers

All important state transitions must cross deterministic write barriers owned by
the runtime server. That includes:

- approval outcomes
- research result registration
- spec version adoption
- mission status changes
- candidate promotion/demotion

The LLM can recommend actions. The runtime decides whether the required shape,
constraints, and approvals are satisfied.

## Execution Flow

1. The user enters or resumes a mission through OpenTUI.
2. OpenTUI connects to the TS Runtime Server and renders the live state.
3. The runtime restores state from `events.jsonl` and rebuilds projections as
   needed.
4. OpenCode executes tactical work inside the runtime-managed session.
5. Commander evaluates mission progress, research decisions, and clarification
   needs using runtime-visible state rather than trusted model memory.
6. Approved actions are emitted to `events.jsonl`; projections such as
   `research.db` and the spec backend update from those events.
7. OpenTUI reflects live status, operator interventions, approvals, and search
   results from authoritative backend state.

## Explicit Non-Goals

The target architecture is **not**:

- a Python orchestrator that acts as the main runtime brain
- a browser dashboard as the primary product shell
- a system where prompt engineering alone enforces policy or authority
- a system where in-memory runtime objects are the only source of mission,
  research, or candidate state
- a system where prose alone can complete work, approve state, or promote
  research outcomes

## Canonical Companion Docs

- `docs/TUI_UX.md`
- `docs/SPEC_BACKEND.md`
- `docs/RESEARCH_BACKEND.md`
- `docs/TEST_STRATEGY.md`
- `agentcore/adr/ADR-013-runtime-server-redesign.md`
- `agentcore/adr/ADR-014-spec-and-custom-policy-backend.md`
- `agentcore/adr/ADR-015-research-db-results-registry.md`
- `agentcore/adr/ADR-016-opentui-product-shell.md`
