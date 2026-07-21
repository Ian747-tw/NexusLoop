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

### Commander Tool Architecture

The Commander investigation architecture uses one authoritative runtime with
separate Commander and OpenCode model contexts. "Single Brain" means one TS
runtime authority, one event ledger, one write-barrier system, and rebuildable
projections. It does not require Commander to share OpenCode's native chat
history or context window.

Commander tools follow a broad-read, narrow-act contract. Runtime may expose
curated, bounded read capabilities for research memory, operational continuity,
runtime records, OpenCode session metadata, repository files, and fixed
read-only Git evidence. GitHub and external research reads remain future gateway
work. Runtime must not expose direct shell, edit, patch, commit, push, provider
call, MCP execution, OpenCode prompt send, process control, or direct GitHub
mutation tools as Commander tools.

Operational memory is short/mid-term runtime history from typed projections.
Research memory is long-term accepted evidence in `research.db`. Repository and
Git content is untrusted evidence with `instruction_semantics=none`: it may
inform Commander, but it cannot change NexusLoop policy, authority,
permissions, or roles.

Capability profiles are envelopes, not workflows. They define allowed
namespaces, load policies, and budgets for a future provider-neutral
investigation loop; they do not prescribe which query Commander runs first or
which evidence it must value. Initial Commander bootstrap loads only a small
core schema set and uses deferred schema discovery for the rest.

Branch 9V implements the first manual internal read surfaces. Branch 9W0 selects
AI SDK Core as the generic model-step transport/tool-call normalization layer
for future Commander investigation, but only underneath NexusLoop's controller.
Branch 9W1 productionizes the AI SDK one-step adapter and NexusLoop-owned
explicit tool executor. Branch 9W2A adds a bounded in-memory Commander
investigation controller that composes bootstrap context, one model step at a
time, loaded tool schemas, explicit read-tool execution, bounded tool-result
replay, and stopping conditions. Branch 9W2B1 adds a connector-backed model
transport substrate that routes OpenAI-compatible chat-completions requests
through `ExternalApiRequestService` and `ExternalApiTransport` without
activating RuntimeServer provider selection.

```text
NexusLoop domain control plane
-> bounded in-memory Commander controller
-> connector-backed model adapter
-> production AI SDK one-step adapter
-> strict connector fetch bridge
-> ExternalApiRequestService
-> ExternalApiTransport
-> NexusLoop tool executor
-> typed read services
-> bounded in-memory working set
```

The model SDK sits below the Commander controller. Tool schemas are derived from
the NexusLoop registry. The SDK never executes NexusLoop tools directly. In
connector-backed mode, AI SDK receives no real provider credential; connector
configuration owns base URL, host/method policy, credential references, timeout,
and response caps. 9W2B1 still adds no RuntimeServer provider activation, public
provider loop, durable investigation run, proposal gate, streaming connector
transport, environment-based Commander provider config, or external read
gateway. SDK session memory is not research or operational memory, and SDK
tracing is disabled or non-authoritative. OpenCode remains the tactical
executor.

Follow-on sequencing:

- 9W2B1: connector-backed model transport substrate.
- 9W2B2: RuntimeServer provider activation and audit gate.
- 9W3: durable Commander working set, pause/resume, and recovery.
- 9X: external GitHub and research read gateway.
- 9Y: evidence-backed proposal gate.
- 9Z: GitHub governance intents and approval gate.

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
- `agentcore/adr/ADR-018-commander-tool-capability-and-investigation.md`
- `agentcore/adr/ADR-019-commander-first-party-internal-read-tools.md`
- `agentcore/adr/ADR-020-commander-agent-runtime-sdk-fit.md`
- `agentcore/adr/ADR-021-commander-model-adapter-and-tool-execution-kernel.md`
- `agentcore/adr/ADR-022-commander-in-memory-investigation-controller.md`
- `agentcore/adr/ADR-023-commander-connector-model-transport.md`
