# ADR-029 - Commander recovery transaction and one-shot approval consumption

## Status

Accepted for Branch 9W3B2B2A.

## Context

9W3B2A records human authority for one exact recovery plan, and 9W3B2B1
deterministically prepares the continuation state and first fresh request. Live
configured-provider recovery also requires RuntimeServer lifecycle ownership,
external API audit, real bound read tools, abort handling, and shutdown drain.
Those concerns remain in 9W3B2B2B.

This branch establishes the durable transaction boundary and proves it with an
injected scripted continuation runner. Approval consumption must never be
separate from recording the attempt it authorizes.

## Decision

Add exactly one event kind:

```text
runtime_commander_investigation_recovery_started
```

The event atomically records one recovery attempt and consumes one current,
unconsumed approval. There is no separate approval-consumed, recovery-finished,
recovery-retried, or recovery-completed event. Existing model-step-started,
checkpointed, and finished events continue the same investigation journal.

### Transaction Authority

The package-internal transaction service snapshots bounded input, serializes by
investigation ID, reruns recovery and execution-preparation previews, and
requires exact approval ID/hash, basis, plan, packet, preparation, first-request
preview, checkpoint, pending boundary, provider execution envelope, and all
compatibility hashes. The caller cannot supply a seed, checkpoint, pending
boundary, decision, provider, budget, prompt, credential, retry, replay, or
force override.

The journal rereads the source within its recovery-start serialization boundary,
reruns preparation in the expected-tail window, and uses EventStore
compare-and-append. The continuation runner is invoked only after the exact
attempt ID/hash is confirmed durable. An ambiguous append is reconciled by
rereading the projection; an absent attempt fails closed and invokes no runner.

Attempt sequence starts at zero. B2B2A permits one attempt only. Attempt identity
is deterministic from semantic authority and excludes EventStore IDs,
timestamps, approval notes, credentials, and generated preview time.

### Approval Consumption

The recovery-start event is the consumption. Projection marks the selected
approval consumed by the attempt and records the consumption time. The approval
remains historical but is excluded from current-approval lookup and cannot
authorize another start. Concurrent duplicates serialize to one start and one
runner invocation; later exact calls report already started. A different request
is blocked.

New approvals explicitly carry the execution-preparation and first-request
preview hashes already bound by the plan. Older approvals remain readable but
cannot authorize a start without those explicit references. A malformed or
hash-valid mismatched start makes the projection corrupt and exposes no
authoritative attempt or consumed approval.

### Pending Provider Boundary

Checkpoint recovery records `not_applicable`. Uncertain-provider recovery records
`continue_from_checkpoint_with_fresh_request`. This is a human-approved policy
decision, not a factual provider outcome. The prior request may have been sent;
its response remains unavailable, old tool execution remains unknown, and no
provider or tool replay is allowed.

Projection clears the active pending boundary only after accepting the start,
retains a bounded resolved-boundary record with `outcome_remains_unknown=true`,
and requires the fresh request to use the approved next turn and noncolliding
recovery prefix. The conservative unresolved-attempt charge remains in budget
authority.

### Existing Lifecycle Events

Recovery model-step, checkpoint, and terminal payloads carry optional attempt
and consumed-approval linkage. Older non-recovery events remain readable. After
a recovery start, missing or mismatched linkage is corrupt. Checkpoint sequence
continues from the accepted checkpoint and journal sequence remains contiguous.
The recovery observer rejects `onStarted`.

A final-only scripted continuation writes recovery-start, model-step-started,
and the existing finished event. Tool turns add existing checkpoint events.
Terminal records retain original identity and start lineage, final absolute
counters, attempt/approval references, recovery kind, plan/preparation hashes,
and unresolved-attempt count. They do not claim network transport or external
API audit.

If terminal persistence cannot be confirmed, the approval remains consumed and
the attempt remains nonterminal. Projection requires future human review; it
does not retry, reuse approval, or start a second attempt.

### Scope And Security

Scripted tests use injected model adapters, fake safe-read executors, control
gates, and provider gates. The transaction service imports no connector or
ExternalApi service and is not instantiated by RuntimeServer. RuntimeServer has
no recovery execution method, command, client method, slash command, TUI state,
or authority entry. Public `provider_tool_loop_enabled` and stored
`resume_supported` remain false.

Attempt events use an explicit bounded allowlist and contain identifiers,
hashes, references, statuses, and counters only. They omit connector URLs,
headers, credentials, prompts/responses, model messages, schemas, raw tool
results, repository lines, patches, assistant prose, execution arguments, and
chain of thought.

## Consequences

```text
current approved recovery plan
-> fresh plan/preparation revalidation
-> atomic recovery-start / approval-consumption event
-> recovery-aware persistence observer
-> injected scripted continuation kernel
-> existing model-step/checkpoint/finished events
-> terminal or interrupted-attempt projection
```

9W3B2B2B owns RuntimeServer active/ready/run-lock authority, configured
connector-backed provider execution, external API audit, real bound safe-read
tools, abort and shutdown drain, and continued terminal persistence. It must
still use the same start transaction and must never replay the old pending
request. 9W3C owns public/operator controls.
