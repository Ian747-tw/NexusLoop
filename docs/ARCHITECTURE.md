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
through `ExternalApiRequestService` and `ExternalApiTransport`. Branch 9W2B2
activates that substrate only for RuntimeServer's internal in-memory
investigation method, behind explicit credential-free provider config,
readiness checks, active/ready-lifecycle/run-lock preflight, and complete
external API audit accounting. Branch 9W3A adds a separate internal durable
method that writes bounded Commander investigation lifecycle events and turn
checkpoints to the existing EventStore for restart analysis. Branch 9W3B1 adds
a read-only recovery readiness preview over that journal. It does not add
resume, public commands, TUI state, proposal generation, or automatic recovery.
Branch 9W3B2A adds durable human-only recovery approval bound to the exact
recovery basis and plan hash. It records approval and stale-plan state only;
recovery execution remains future work. Branch 9W3B2B1 adds deterministic
recovery preparation and an internal scripted continuation kernel: it derives a
continuation seed, mandatory recovery notice, summary-only replay relationship,
pre-model gate-warning snapshot, and first fresh model-request preview, then
binds that preparation into the recovery packet and plan hash without consuming
approval or executing recovery.

```text
NexusLoop domain control plane
-> RuntimeServer provider config
-> readiness/lifecycle/run-lock provider gate
-> bounded in-memory Commander controller
-> connector-backed model adapter
-> production AI SDK one-step adapter
-> strict connector fetch bridge
-> ExternalApiRequestService
-> ExternalApiTransport
-> external API audit events
-> NexusLoop tool executor
-> typed read services
-> bounded in-memory working set
```

Durable Commander execution adds the journal boundary around the same
controller:

```text
RuntimeServer.runCommanderInvestigationDurable
-> bounded Commander controller
-> runtime_commander_investigation_model_step_started
-> external_api_request_executed|failed
-> runtime_commander_investigation_checkpointed
-> runtime_commander_investigation_finished
-> typed journal projection
```

Recovery preview reads that projection atomically and performs compatibility
analysis without execution:

```text
durable journal
-> atomic recovery source
-> tool/schema/authority compatibility checks
-> provider/model/capability compatibility checks
-> current connector/capability execution envelope hash
-> remaining-budget and context-derived schema-allocation checks
-> current continuity/human-control checks
-> bounded recovery packet
-> recovery-plan hash
-> human review required
-> no execution
```

Recovery approval records human authority without executing it:

```text
recovery preview
-> exact human approval input
-> fresh revalidation
-> recovery basis check
-> runtime_commander_investigation_recovery_approved
-> approved_waiting_for_execution
-> no provider/tool execution
```

Recovery preparation proves the approved state can form the next bounded
controller state without running it through RuntimeServer execution:

```text
durable checkpoint
-> recovery compatibility
-> deterministic continuation seed
-> fresh current bootstrap
-> mandatory recovery notice
-> pre-model human/provider gate-warning snapshot
-> summary-only protocol reconstruction
-> first fresh request preview
-> execution-preparation hash
-> recovery packet and plan hash
-> human approval
-> no execution in 9W3B2B1
```

Continuity comparison is structured: a current bootstrap that reports degraded
continuity cannot authorize recovery, while ordinary nonfatal continuity
warnings remain warnings. Recovery recommendations also separate corrupt
journals from current runtime incompatibility; injected adapters, provider
misconfiguration, schema drift, context overflow, and degraded continuity are
runtime reconfiguration blockers, not corrupt-record diagnoses.
For configured providers, the recovery plan additionally binds a stable
credential-free execution envelope derived from the current connector policy,
transport limits, model context/output limits, and Commander capability flags.
The preview exposes hashes and safe identifiers, not raw connector URLs, header
values, credential environment names, or credential values. Runtime started
state, run-lock state, and secret rotation do not change the plan hash.
Recovery approval binds that plan hash, the approval-insensitive recovery
basis, checkpoint and pending-boundary refs, provider execution-envelope hash,
and all compatibility hashes. Approval events are excluded from the recovery
basis so an approval does not stale itself. Current/stale approval reporting is
read-only; 9W3B2A does not consume approval, reopen terminal journals, clear
pending uncertainty, or run recovery.
9W3B2B1 extends the recovery packet and plan with the deterministic
execution-preparation hash and first request preview hash. It reconstructs
loaded descriptors from the current controller registry, recomputes actual
input/output schema metadata from schema objects, and deep-clones accepted
descriptors before any scripted continuation can build provider tool schemas.
The controller now feeds new investigations and recovery seeds into one shared
model/tool loop; the verified recovery identity is used for both provider gates
and provider request construction. The recovery seed binds the pending-boundary
hash for uncertain outcomes, and the approved first context uses canonical
bounded human/provider gate-warning snapshots. Existing approvals that predate
that semantic plan input become stale rather than corrupt. Uncertain pending
model steps remain uncertain, are conservatively charged as one unresolved
model attempt, and are never replayed or treated as known success/failure. The
controller validates that charge before accepting a recovery seed. Summary-only
assistant/tool replay messages are reconstructed from the authoritative
journal checkpoint's hash-verified durable replay exchange instead of treated as
seed or caller-supplied checkpoint authority.
Original investigation start time remains lineage metadata, while continuation
active duration counts prior elapsed active time plus current active work rather
than downtime.

The model SDK sits below the Commander controller. Tool schemas are derived from
the NexusLoop registry. The SDK never executes NexusLoop tools directly. In
connector-backed mode, AI SDK receives no real provider credential; connector
configuration owns base URL, host/method policy, credential references, timeout,
and response caps. RuntimeServer drains in-flight configured-provider
investigations before appending `runtime_shutdown` or releasing the run lock, so
provider audit writes remain inside the owning runtime lifecycle. Provider calls
append existing external API audit events. Durable Commander journal events are
separate from those provider audits and persist only bounded operational state:
objective preview/hash, loaded-tool refs, evidence cards, summary-only replay
protocol relationships, model-text fingerprints, checkpoint hashes,
repeat/no-progress guard state, and safe evidence-based conclusion cards. Full
provider transcripts, raw model prose, raw tool results, raw file/diff bodies,
chain of thought, credentials, SDK session state, exact assistant replay, and
automatic replay state are not persisted. Recovery preview therefore always
reports that exact replay is unsupported, original assistant prose is
unavailable, and any future recovery must construct a fresh bounded context
from compatible durable state.
The public
Commander provider loop remains disabled: there is no public investigation
command, TUI surface, recovery approval command, resumable investigation,
proposal gate, streaming
connector transport, provider failover, GitHub/MCP gateway, or external read
gateway. 9W3B2B1 exposes only an internal read-only preparation preview and
scripted controller continuation tests; RuntimeServer still has no recovery
execution method. 9W3B2B2 owns approval consumption, plan-hash revalidation,
uncertain-provider resolution by policy, fresh configured-provider requests,
read-tool execution, continued checkpoints, terminal persistence, and shutdown
drain. SDK session memory is not
research or operational memory, and SDK
tracing is disabled or non-authoritative. OpenCode remains the tactical
executor.

Follow-on sequencing:

- 9W2B2: RuntimeServer provider activation and audit gate.
- 9W3A: durable Commander investigation journal and checkpoints.
- 9W3B1: recovery readiness and compatibility preview.
- 9W3B2A: durable human approval and stale-plan gate.
- 9W3B2B1: recovery preparation and continuation kernel.
- 9W3B2B2: bounded recovery execution from approved state.
- 9W3C: public/operator investigation surface decision.
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
- `agentcore/adr/ADR-024-commander-provider-activation-and-audit-gate.md`
- `agentcore/adr/ADR-025-commander-durable-investigation-journal.md`
