# ADR-027 - Commander recovery approval and stale-plan gate

## Status

Accepted for Branch 9W3B2A.

## Context

9W3B1 made Commander investigation recovery preview read-only and deterministic.
The next boundary is durable human approval for exactly one recovery plan, but
approval must not execute recovery or make stale state look safe.

## Decision

Add one human-only recovery approval gate. It appends exactly one new Commander
journal event kind:

- `runtime_commander_investigation_recovery_approved`

Approval records authority only. They do not call a provider, execute a tool,
replay a provider request, consume an approval, construct an execution context,
clear pending uncertainty, create a checkpoint, create a terminal record, or
set `resume_supported=true`.

### Basis And Plan Binding

Recovery approval uses an approval-insensitive recovery basis hash derived from
the accepted journal state: immutable investigation identity, validated
normalized input hash, latest accepted checkpoint reference, pending model-step
boundary when present, terminal hash when present, and recovery kind. Approval
events, approval IDs, approval notes, EventStore event IDs, generated preview
timestamps, runtime start/lock state, and approval counts are excluded.

The recovery plan hash binds that basis plus the recovery packet, provider
execution-envelope hash, and all compatibility hashes. Appending an approval
therefore changes the journal record/source hash and approval history, but it
does not invalidate the plan it approves. Any checkpoint, pending-boundary,
identity, normalized-input, provider-envelope, tool/schema/authority, budget,
context, continuity, or human-control change makes an older approval stale.

### Decisions And Acknowledgements

Two approval decisions exist:

- `approve_resume_from_checkpoint`
- `approve_continue_after_uncertain_provider_outcome`

Checkpoint approval requires a current preview that is
`ready_for_approval`, has recovery kind `checkpoint`, has no pending model-step
boundary, and recommends `approve_resume_from_checkpoint`.

Uncertain-provider approval requires a current preview that is
`human_review_required`, has recovery kind `uncertain_provider_outcome`, retains
the pending model-step boundary, has no hard blocker, has human controls in
`continue`, and recommends `review_uncertain_provider_outcome`.

Every approval requires explicit acknowledgement that fresh context is
required, exact replay is unavailable, provider-request replay is forbidden,
and tool-execution replay is forbidden. The uncertain-provider decision also
requires an explicit uncertainty acknowledgement. This decision means only that
future 9W3B2B may continue from the last accepted checkpoint with a fresh
request. It does not infer whether the prior provider request succeeded,
failed, returned a response, or caused tool execution.

### Persistence

Approval events live in the existing EventStore and participate in the
per-investigation journal sequence. Approval sequence starts at zero, is
contiguous, and is capped at sixteen accepted approvals per investigation.
Projection treats duplicate approval IDs, duplicate approval sequences,
malformed approval payloads, approval after terminal, missing checkpoints,
decision/kind mismatches, checkpoint or pending-boundary mismatches, and hash
mismatches as corrupt.

Approval records are allowlisted and bounded. They persist hashes and bounded
references: basis hash, plan hash, packet hash, checkpoint ref,
pending-boundary ref, provider execution-envelope hash, compatibility hashes,
human approver identity, bounded redacted note preview/hash, and explicit
acknowledgements. They do not persist raw connector URLs, headers, credential
refs, credential environment names or values, bootstrap bodies, full evidence
bodies, raw tool results, assistant prose, provider prompts/responses, or chain
of thought.

Exact duplicate approval input for the same investigation, current basis,
plan, decision, approver, and note hash is idempotent and appends no second
event. A changed plan can receive a new approval only after fresh revalidation.

### Runtime Authority

Approval preview is read-only and can run before start, after shutdown, and
without a run lock. Approval recording requires active mode, started and ready
RuntimeServer lifecycle, no shutdown request, held run lock, and configured
connector-backed provider authority. RuntimeServer tracks active approval
writes and drains them before appending `runtime_shutdown` or releasing the run
lock.

## Consequences

The internal stack is:

```text
recovery preview
-> exact human approval input
-> fresh revalidation
-> recovery basis check
-> bounded approval event
-> approved_waiting_for_execution
-> no execution
```

9W3B2A adds no public runtime command, RuntimeClient method, slash command, TUI
state, authority record, provider call, tool call, approval consumption,
recovery execution, proposal generation, OpenCode action, provider failover, or
exact transcript replay. Public `provider_tool_loop_enabled` remains false.

9W3B2B owns requiring a current unconsumed approval, revalidating the exact
plan, resolving pending uncertainty by policy rather than inference,
reconstructing fresh bounded context, issuing a new provider request, never
replaying the prior provider request, continuing checkpoint/terminal sequencing,
and consuming approval once. 9W3C owns public/operator controls.
