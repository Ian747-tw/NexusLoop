# ADR-025 - Commander durable investigation journal and checkpoints

## Status

Accepted for Branch 9W3A.

## Context

9W2A added the bounded Commander investigation controller. 9W2B2 activated the
connector-backed provider path internally and required complete external API
audit events for configured provider requests. The controller still held its
working set only in memory.

9W3A adds durable restart-analysis records without adding resume execution,
public commands, TUI state, proposal generation, OpenCode actions, or another
persistence backend.

## Decision

Use the existing `EventStore` as the only durability substrate. Commander
investigation records are ordinary runtime events written by RuntimeServer
under the normal single-writer run lock. There is no SQLite table, checkpoint
file, SDK session store, snapshot directory, or background persistence process.

Add exactly four lifecycle event kinds:

- `runtime_commander_investigation_started`
- `runtime_commander_investigation_model_step_started`
- `runtime_commander_investigation_checkpointed`
- `runtime_commander_investigation_finished`

The in-memory method remains available and event-free. Durable execution is a
separate internal method, `RuntimeServer.runCommanderInvestigationDurable(...)`.

### Checkpoint Boundaries

A started event contains checkpoint sequence zero. It is written after input
validation, provider preflight, budget/protocol resolution, bootstrap
compilation, and initial loaded-tool resolution, but before the first model
request or any tool execution.

A model-step-start event is written before every provider request. This creates
the durable uncertain-outcome boundary that 9W3B will inspect. Provider HTTP
audit events remain the existing `external_api_request_*` events and are not
part of the Commander journal sequence.

One completed-turn checkpoint is written after all tool calls in an assistant
turn complete sequentially. 9W3A intentionally does not write per-tool
checkpoints; if a process dies between tools, 9W3B must classify that turn as
uncertain rather than invent completion.

Every durably started investigation attempts one terminal event. Terminal
records are explicit allowlists, not blind spreads of the in-memory result.

### Persisted State

Checkpoints persist operational state needed for restart analysis:

- budget and bootstrap references
- loaded-tool references with descriptor/schema hashes
- bounded evidence cards
- bounded execution digests and turn summaries
- provider audit counts
- repeat/no-progress signatures
- the latest assistant/tool replay exchange as summary-only protocol state
- a terminal conclusion card derived from safe evidence titles, safe evidence
  summaries, blockers, warnings, status, stop reason, and model-output
  fingerprint metadata

Full transcripts, raw provider payloads, raw tool execution results, raw
repository file lines, raw Git patches, raw research records, hidden reasoning,
credentials, and SDK session state are not persisted.

Replay exchange stores tool-call IDs/tool IDs with redacted bounded arguments
and model-text fingerprints. It explicitly records that assistant text is not
persisted and exact replay is unsupported in 9W3A. Tool-result replay messages
are durable summaries only and preserve protocol relationships without storing
full tool result JSON. 9W3B must reconstruct a fresh bounded context from
durable state instead of replaying original assistant prose verbatim.

### Integrity

Each journal event has schema version 1, a contiguous journal sequence, and a
payload hash over the redacted persisted payload. Checkpoints have a semantic
state hash and checkpoint hash. Terminal records have a terminal hash.

Projection replays typed event objects in append order and verifies:

- one started event, first
- contiguous journal and checkpoint sequences
- checkpoint previous ID/hash links
- unique model request IDs
- immutable identity continuity from the started event through model-step
  boundaries, checkpoints, and terminal records
- at most one terminal event
- no lifecycle event after terminal
- payload, checkpoint, and terminal hashes

One corrupt investigation record does not make unrelated investigation records
unreadable.

9W3B1 adds a read-only recovery-source projection over the same replay. The
journal service reads the event log once, projects the record, and returns the
validated normalized input, immutable identity, accepted latest checkpoint,
pending model-step boundary, and terminal metadata from that single snapshot.
Corrupt and unsupported records expose diagnostics only; they do not expose an
authoritative checkpoint or normalized input for recovery.

### Failure And Lifecycle

Persistence failures stop execution. A start or model-step-start append failure
prevents provider calls. A checkpoint failure prevents the next provider call.
A terminal append failure returns `persistence_failed` and leaves the projection
nonterminal for 9W3B recovery analysis.

Existing investigation IDs are never overwritten. Concurrent duplicate durable
runs and existing terminal or nonterminal IDs are blocked. 9W3A does not resume.

RuntimeServer tracks durable investigations in its lifecycle drain. Shutdown
aborts active durable investigations, waits for provider audit and terminal
journal persistence to settle, then appends `runtime_shutdown` and releases the
run lock. No Commander investigation event may be appended after
`runtime_shutdown`.

### Result Semantics

The semantic investigation `result_hash` is independent of EventStore event IDs,
checkpoint IDs, journal timestamps, external API audit request IDs, and
durability mode. Durability metadata has a separate `durability_hash`.

Durable results truthfully report investigation lifecycle events separately from
external API provider audits. Provider audits do not mean the Commander working
set or transcript was persisted.

### Operational Memory

Projected Commander investigation records are added to typed operational-memory
search with source kind `commander_investigation`. Search uses the typed
projection, not raw JSON text. It can find completed, needs-human-review,
nonterminal checkpoint, and uncertain-provider-outcome records as pointer-only
operational memory.

## Consequences

The internal durable stack is:

```text
durable investigation method
-> bounded controller
-> model-step boundary event
-> provider audit event
-> completed-turn checkpoint
-> terminal event
-> typed projection
```

The public Commander provider profile remains disabled:
`provider_tool_loop_enabled=false`. There is no public command, TUI surface,
automatic restart recovery, resumable investigation, scheduled Commander run,
proposal generation, GitHub/MCP gateway, external research tool, or OpenCode
action in 9W3A.

9W3B1 owns read-only recovery preview, checkpoint compatibility checks,
uncertain provider outcome classification, current continuity/human-control
inspection, and recovery-plan hashes. It writes no journal event and leaves
`resume_supported=false` in stored records. 9W3B2 owns durable recovery
disposition, plan-hash revalidation, uncertain-provider resolution, fresh
context reconstruction, and human-reviewed resume. 9W3C owns any
public/operator start/list/show/pause/resume/cancel surface decision. 9Y owns
proposal generation.
