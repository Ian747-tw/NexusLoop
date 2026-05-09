# ADR-013: runtime server redesign

## Context

Earlier NexusLoop plans described a Python orchestrator and browser dashboard as
the primary runtime structure. That direction conflicts with the current
architecture principles:

- the forked TypeScript runtime already owns the session lifecycle and tool loop
- OpenCode is the tactical execution engine
- durable authority should live in runtime events and rebuildable projections
- UI should not become the de facto runtime brain

We need an architecture that makes the runtime server, not a Python sidecar, the
central authority.

## Decision

Adopt a runtime-server-centered architecture:

- the **TS Runtime Server** is the backend brain
- **OpenCode** remains the tactical executor within that runtime
- **Commander** is the mission/state/research decision layer operating through
  runtime-owned interfaces
- `events.jsonl` is the source of truth for authoritative runtime history
- Python remains a library/tooling surface, not the primary orchestrator

## Rationale

This decision aligns the system with the Single Brain and Single Writer
principles.

- State that matters should live where the session already lives.
- Tactical reasoning should happen where the LLM already executes.
- Durable authority should not depend on a separate Python runtime remembering
  what happened.
- Rebuildable projections become possible only when authoritative events are
  emitted by the runtime.

## Consequences

- New core runtime features should target the TS runtime server first.
- Python orchestration code may exist only as compatibility glue, migration
  support, offline tooling, or deterministic backend helpers.
- Browser dashboard work is no longer the default product direction.
- Future runtime APIs should assume OpenTUI is the primary shell.

## Non-Goals

This ADR does not claim the redesign is already implemented. It defines the
target architecture future implementation must follow.
