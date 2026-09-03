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
runtime records, OpenCode session metadata, repository files, fixed read-only
Git evidence, and six deferred runtime-owned GitHub evidence tools. The GitHub
gateway accepts only exact configured repositories and fixed operation inputs,
uses existing external-request audit/lifecycle ownership, and returns bounded
untrusted evidence with `instruction_semantics=none`. External research remains
future 9XB work. Runtime must not expose direct shell, edit, patch, commit,
push, provider call, MCP execution, OpenCode prompt send, process control, or
direct GitHub mutation tools as Commander tools.

The GitHub gateway is capped per tool call at four requests, two pages, fifty
items, and 8,000 normalized bytes, with one active gateway read. Every request
has an existing external API audit outcome and consumes Commander tool budget.
Exact commit metadata uses the patch-free Git object endpoint; pull-request
file summaries use a fixed metadata-only GraphQL selection. Partial or malformed
responses fail closed rather than fabricating absent fields as known facts.
Exact-SHA checks and review evidence never substitute a moving branch head;
truncated review-thread evidence reports unknown completeness.

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
Branch 9W3B2B2A adds one atomic recovery-start/approval-consumption event and a
package-internal persistence observer. Injected scripted tests continue the
existing model-step/checkpoint/finished journal sequence; RuntimeServer still
does not expose or execute recovery, and no configured provider or network path
is activated.
Branch 9W3B2B2B composes that same one-shot transaction under RuntimeServer
active/ready/run-lock authority. A configured connector-backed continuation now
uses the existing external API audit service and real bound safe-read executor,
while remaining an internal TypeScript method with no command, client, or TUI
surface.
Branch 9W4A separates provider construction from the shared AI SDK one-step
engine and adds the closed `anthropic_messages_connector` native Messages
protocol beside the unchanged `openai_compatible_connector` protocol. Both use
the same controller, audited connector transport, cancellation, recovery, and
shutdown ownership. See `docs/COMMANDER_PROVIDERS.md` and ADR-034.
Branch 9W4B0 adds a pure model-configuration kernel. Connections, profiles,
and independent Commander/Executor role bindings express selection intent.
Commander projection additionally
requires exact NexusLoop conformance; OpenCode catalog, auth, plugins, and
provider connectivity can never satisfy that requirement. See ADR-035.

```text
NexusLoop model configuration
├── model connections
├── model profiles
└── role bindings
    ├── Commander selection projection -> static Commander conformance required
    └── Executor selection projection  -> primary tactical provider/model only
```

A shared profile shares provider/model intent only. Credentials, provider
objects, contexts, tools, lifecycle, retries, streaming, and network authority
remain role-owned. Branch 9W4B1 activates validated snapshots in one immutable
RuntimeServer registry without adding persistent, CLI, or TUI configuration.
Legacy Commander environment authority is adapted deterministically and keeps
the existing connector/readiness path. Executor readiness is independent
bounded evidence, and its exact selection reaches only the primary tactical
`opencode run --model provider/model` argument. Conflicting primary-model
arguments fail closed; auxiliary OpenCode models remain untouched. See ADR-036.

Branch 9W4C adds the third closed Commander protocol,
`google_generative_ai_connector`, through that registry. It uses native unary
Google Generative AI `generateContent`, one path-safe model segment, connector-
owned `x-goog-api-key` injection, one audited request per model step, strict
single-candidate response validation, and transient in-memory thought
signatures for client-tool continuation. Google server tools, Interactions,
streaming, retries, discovery, and cross-role authority remain excluded. See
ADR-037.

Branch 9W4D adds `openai_responses_connector` as a fourth closed protocol. It
uses native unary OpenAI Responses with `store=false`, exact connector-owned
bearer injection, one audited request per model step, strict request and raw-
response validation, and stateless ordinary client-function continuation.
Stored/background responses, previous-response chaining, retrieval, hosted
tools, reasoning continuation, streaming, and retries are rejected. Commander
conformance policy v3 admits all earlier protocols plus Responses without
changing v1/v2 hashes. A pure immutable four-entry compatibility matrix records
tested protocol facts but creates no selection or readiness authority. See
ADR-038.

Branch 9W4E0 packages an observation-only Executor readiness command into the
pinned native OpenCode executable. The command reads one exact NexusLoop
selection assertion, consults only bounded schema-validated local OpenCode catalog,
configuration, and authentication state, and returns enum-only readiness
evidence. Dynamic or remote authority is reported as unknown without plugin,
network, provider, or mutation activity. Runtime source execution under
`agentcore/upstream` is not a supported boundary. See ADR-039.

Branch 9W4E adds the code-owned six-recipe setup catalog and one append-only
`runtime_model_setup_committed` transition. Runtime reconstructs the existing
ADR-035 configuration and ADR-036 registry only at the next process
construction; commits never hot-reload an active registry. Persisted setup,
explicit registry authority, and legacy Commander environment authority are
pairwise exclusive.

Executor readiness invokes the exact configured OpenCode launch executable
with the fixed packaged arguments `nexusloop executor-readiness-v1`. Runtime
validates the exact projection/provider/model/binding echo and tri-state
evidence under fixed process, byte, timeout, concurrency, cancellation, and
shutdown limits. The observation remains evidence only. OpenTUI stages
independent Commander/Executor choices, previews exact hashes, requires
confirmation, and renders active versus pending-next-start state. See ADR-040.

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

The transaction boundary remains package-internal:

```text
current approved recovery plan
-> final recovery basis/plan/preparation revalidation
-> runtime_commander_investigation_recovery_started
   (approval consumed atomically)
-> recovery-aware persistence observer
-> injected scripted continuation kernel
-> existing model-step/checkpoint/finished events
-> terminal or interrupted-attempt projection
-> no configured-provider execution in 9W3B2B2A
```

Configured live recovery adds RuntimeServer lifecycle ownership around that
same durable transaction:

```text
current approved recovery plan
-> RuntimeServer active/ready/run-lock/configured-provider gate
-> fresh plan and execution-preparation revalidation
-> runtime_commander_investigation_recovery_started
   (approval consumed atomically)
-> fresh model-step boundary
-> connector-backed provider request
-> external API audit event
-> current bound safe-read tools when requested
-> existing checkpoint before another provider request
-> existing finished event, or consumed interrupted-attempt state
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
seed or caller-supplied checkpoint authority. Replay availability is derived
from that journal checkpoint, not from copied seed flags.
At the continuation-kernel boundary, effective ceilings are re-derived with the
same canonical budget function used during preparation from the accepted
checkpoint plus current phase/model/context policy. Loaded-tool identity is
likewise selected only from accepted checkpoint references, then revalidated
against current bindings, eligibility, safe-read authority, and actual schema
objects. Seed budget fields and seed tool references can prove equality with an
approved preparation, but they cannot broaden or substitute execution authority.
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
scripted controller continuation tests. 9W3B2B2A owns atomic approval
consumption, recovery-start persistence, and scripted lifecycle continuation;
9W3B2B2B owns the package-internal RuntimeServer configured-provider method,
external API audit, real bound safe-read tools, conservative post-boundary
uncertainty, and lifecycle/shutdown drain. It adds no public command, client,
TUI state, authority entry, automatic recovery, second attempt, provider replay,
or tool replay. SDK session memory is not
research or operational memory, and SDK
tracing is disabled or non-authoritative. OpenCode remains the tactical
executor.

Follow-on sequencing:

- 9W2B2: RuntimeServer provider activation and audit gate.
- 9W3A: durable Commander investigation journal and checkpoints.
- 9W3B1: recovery readiness and compatibility preview.
- 9W3B2A: durable human approval and stale-plan gate.
- 9W3B2B1: recovery preparation and continuation kernel.
- 9W3B2B2A: recovery transaction and scripted persistence.
- 9W3B2B2B: configured-provider live recovery execution.
- 9W3C: public/operator investigation surface decision.
- 9XA: bounded GitHub read gateway.
- 9XB0: external research/MCP contract and provider-fit gate (`NO-GO`; no
  runtime activation).
- 9W4A: static Commander provider protocols and native Anthropic Messages.
- 9W4B0: unified model-profile authority and pure role projections.
- 9W4B0 Executor projections require a static NexusLoop provider-ID-to-kind
  mapping registry; OpenCode catalog/auth observations are not that authority.
- 9W4B1: immutable runtime registry, legacy Commander environment adapter,
  scoped primary Executor projection, and independent role readiness.
- 9W4C: native Gemini `generateContent` through unified model profiles.
- 9W4D: native OpenAI Responses and verified compatibility matrix.
- 9W4E0: reproducibly packaged OpenCode-owned Executor readiness command.
- 9W4E: first-run provider setup and TUI role-model selection.
- post-v1 9XB1: first exact external-research descriptor only after fresh
  provider requalification; v1 does not activate external MCP or
  `external_research.*`.
- 9Y: evidence-backed proposal gate after 9W4E.
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

## Commander Recovery Operator Flow

Interrupted durable Commander investigations are exposed through one narrow
operator path:

```text
typed journal list/show
-> current continuity recovery preview
-> exact human approval with explicit no-replay acknowledgements
-> separate configured execution request
-> atomic recovery start and approval consumption
-> fresh provider request plus external API audit
-> current bound safe-read tools
-> existing checkpoint/terminal events
```

RuntimeServer owns each active public recovery operation before its first
asynchronous preflight and returns an opaque operation ID. Operator cancellation
requests abort that owned operation but do not claim provider cancellation or a
known outcome. A cancellation before durable start leaves approval unconsumed;
after start, consumed nonterminal attempts require human review and cannot be
retried. Historical provider requests and tool execution are never replayed.
OpenTUI state is evidence, not authority.

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
- `agentcore/adr/ADR-026-commander-investigation-recovery-readiness.md`
- `agentcore/adr/ADR-027-commander-recovery-approval-gate.md`
- `agentcore/adr/ADR-028-commander-recovery-continuation-kernel.md`
- `agentcore/adr/ADR-029-commander-recovery-transaction.md`
- `agentcore/adr/ADR-030-commander-configured-live-recovery-execution.md`
- `agentcore/adr/ADR-031-commander-recovery-operator-controls.md`
- `agentcore/adr/ADR-032-commander-bounded-github-read-gateway.md`
- `agentcore/adr/ADR-033-commander-external-research-mcp-gateway.md`
- `agentcore/adr/ADR-034-commander-model-provider-protocols.md`
- `agentcore/adr/ADR-035-unified-model-profiles-and-role-bindings.md`
- `agentcore/adr/ADR-036-runtime-model-profile-registry-and-role-readiness.md`
- `agentcore/adr/ADR-039-opencode-owned-executor-readiness-command.md`
- `agentcore/adr/ADR-040-first-run-model-setup-and-role-selection.md`
