# ADR-028 - Commander recovery preparation and continuation kernel

## Status

Accepted for Branch 9W3B2B1.

## Context

9W3B2A records durable human approval for an exact recovery plan, but it does
not prove that approved durable state can be turned into the precise controller
state and first fresh model request a later execution branch would use. Live
recovery also needs approval consumption, provider execution, tool execution,
continued checkpoints, terminal persistence, and shutdown draining. Those
authority changes remain out of scope for this branch.

## Decision

Add a read-only Commander recovery execution-preparation layer and an internal
controller continuation kernel. Preparation is deterministic evidence; it does
not execute recovery, consume approval, append events, call providers, execute
tools through RuntimeServer, mutate missions/proposals/OpenCode state, or expose
public runtime/TUI/authority surfaces.

### Preparation Order

Continuation preparation is computed before approval so that the preparation
hash can be included in the recovery packet and recovery-plan hash:

```text
journal state
-> compatibility
-> continuation seed
-> first fresh request preview
-> execution-preparation hash
-> recovery packet
-> recovery-plan hash
-> human approval
-> approved preparation preview
-> no execution
```

Approval state is excluded from the execution-preparation hash. Appending an
approval therefore does not change the preparation hash or the plan it approved.
Pre-B2B1 approvals that lack the new preparation-bound plan semantics become
stale rather than corrupt, and a fresh human approval is required.

### Continuation Seed

The continuation seed is derived from the accepted journal recovery source,
current compatibility checks, current bootstrap, restored durable working set,
summary-only replay exchange, mandatory recovery notice, and first request
preview. It preserves investigation identity, normalized input hash, checkpoint
reference, pending boundary reference when present, original bootstrap reference,
current bootstrap hash, loaded tool refs, effective absolute budget, consumed
counters, evidence pointers, turn summaries, repeat signatures, no-progress
state, provider/audit counters, and elapsed active time.

The stable preparation hash uses identity, hashes, descriptor/schema references,
counter summaries, replay hashes, notice hash, the pre-model gate snapshot hash,
original investigation start time, and first-request preview hash. It excludes
generated timestamps, runtime lifecycle state, run-lock state, EventStore event
IDs, external API audit request IDs, approval IDs, approval timestamps, approver
identity, and approval notes.

The seed carries loaded-tool references for deterministic planning, but live
descriptor objects are not execution authority. The controller reconstructs
loaded descriptors from its current registry by stored tool ID, recomputes
input/output schema hashes, byte sizes, and token estimates from the actual
schema objects, compares those values with both durable refs and descriptor
metadata, and deep-clones/freeze-bounds the accepted descriptors before building
provider tool schemas. A mutable seed or aliased descriptor cannot substitute a
different schema under unchanged metadata.

For uncertain-provider recovery, the seed also carries the journal recovery
basis's pending-boundary hash. Controller validation recomputes the recovery
basis with that pending hash before accepting the seed, so a copied seed cannot
erase the pending model-step reference, swap in a non-pending notice, and still
look preparation-valid.

### Budgets And Counters

Recovery does not reset counters. Effective absolute ceilings are the stored
original budget bounded by current phase/model/context policy and existing hard
caps. Consumed model turns, provider requests, tool calls, tool-search calls,
result bytes, elapsed active time, evidence counts, loaded schema counts,
no-progress counts, omitted counters, and repeat signatures are preserved.

For an uncertain pending model-step boundary, preparation conservatively charges
one unresolved model attempt, advances the next turn beyond the pending turn,
keeps the pending request unresolved, and never charges tool-call budget because
tool execution is unknown. If that conservative charge exhausts the model-turn
budget, preparation blocks and no execution is allowed.

### Context And Replay

Recovery context is reconstructed, not replayed exactly. The current bootstrap
is compiled read-only and compared with the stored bootstrap reference. A
mandatory recovery notice is inserted before the restored working-set message.
The notice states whether the previous provider outcome is not pending or
uncertain, forbids provider-request and tool-execution replay, marks exact
assistant replay unavailable, and requires a fresh request.

Preparation also captures a bounded semantic pre-model gate snapshot: the
current human-control action and warnings plus provider-preflight warnings. That
snapshot is included in the preparation hash and approved first context. The
controller rechecks the same semantics immediately before the first recovered
request; a changed action or warning blocks as stale preparation instead of
silently sending a different request.

Regular recovery preview builds this snapshot without requiring live execution
readiness. Approved execution-preparation preview supplies the current provider
preflight and fails closed when it returns blockers. When the first recovered
request is later constructed in scripted controller tests, context uses the
canonical bounded snapshot warnings rather than raw gate-warning strings.

Only summary-level assistant/tool protocol relationships are reconstructed:
tool-call IDs, canonical tool IDs, redacted provider-visible arguments,
validation metadata, call hashes, summary-only tool-result messages, result
hashes, truncation flags, and evidence references. Assistant prose, raw
arguments, execution arguments, raw tool output, full memory records, repository
lines, Git patches, provider prompts/responses, credentials, and chain of
thought are not reconstructed.

Replay arguments are recursively compacted as structured JSON. Oversized or
unrecoverable summary arguments return a structured blocker; recovery preview
does not truncate serialized JSON and then parse the broken result.

### First Request Preview

Preparation builds a safe first-model-request preview with request ID, provider
identity, turn index, protocol, output cap, input size estimates, message roles,
loaded tool IDs, loaded schema hash, context hash, recovery notice hash, old
pending request ID when present, and preview hash. It exposes no raw messages,
schema bodies, provider payload, connector URL, or credentials.

Recovery request IDs use a deterministic recovery prefix derived from the
investigation, checkpoint sequence, and preparation state. They do not include
approval IDs and cannot equal a historical or pending model request ID.

### Controller Kernel

`CommanderInvestigationController.run(input)` remains the normal new-run entry
point and still performs input validation, bootstrap derivation, initial tool
loading, and `onStarted` observation. The internal
`runFromRecoverySeed(seed, ...)` entry point validates the seed hash and
canonical recovery identity, skips new-run bootstrap/start semantics, restores
the loaded tools and working set, uses the recovery request prefix and mandatory
notice, preserves prior counters, and feeds the same prepared-loop state type
used by new investigations into one shared model/tool loop.

The verified identity object is the single authority for both provider-gate
checks and provider request construction. Recovery cannot present one
provider/model identity to the gate and send a different provider/model identity
to the adapter.

Recovery keeps two timing concepts separate. `original_started_at` remains the
investigation lineage timestamp and is bound into the preparation hash.
Continuation active duration is measured from the current process plus the
checkpoint's prior elapsed active time; downtime does not become active budget
consumption.

B2B1 does not wire this continuation path to RuntimeServer execution. The only
RuntimeServer addition is a read-only preparation preview method that requires
a current approval and revalidates the current source and preparation before
returning a safe preview.

## Consequences

The internal stack for this branch is:

```text
durable checkpoint
-> recovery compatibility
-> deterministic continuation seed
-> fresh bootstrap
-> mandatory recovery notice
-> summary-only protocol reconstruction
-> first fresh request preview
-> preparation hash
-> recovery plan
-> human approval
-> no execution in B2B1
```

9W3B2B1 adds no event kind, no approval consumption, no provider call, no tool
execution through RuntimeServer, no external API audit, no recovery-start or
terminal event, no public command, no RuntimeClient method, no slash command, no
TUI state, no authority record, no new tool binding, no proposal generation, no
OpenCode action, no provider replay, and no exact transcript replay.
`resume_supported` remains false and public `provider_tool_loop_enabled` remains
false.

9W3B2B2 owns requiring a current unconsumed approval, final plan/preparation
revalidation, durable recovery-start and approval-consumption boundaries, fresh
configured-provider requests, read-tool execution, continued checkpoints,
terminal persistence, and shutdown drain. 9W3C owns public/operator controls.
