# ADR-026 - Commander investigation recovery readiness preview

## Status

Accepted for Branch 9W3B1.

## Context

9W3A added bounded durable Commander investigation journal events and
checkpoints, but intentionally did not resume or recover investigations. Before
9W3B2 can add human-reviewed recovery execution, RuntimeServer needs a
deterministic way to inspect a durable record after restart and decide whether
the stored state is trustworthy enough to present for approval.

## Decision

Add a read-only Commander investigation recovery preview. The preview reads one
atomic journal projection source, classifies the record, verifies current
compatibility, builds a bounded recovery packet, and computes a deterministic
recovery-plan hash. It performs no provider call, tool call, journal append,
file write, research.db write, proposal mutation, mission mutation, OpenCode
action, GitHub action, MCP call, approval, or recovery execution.

The preview is evidence. It is not approval and it is not execution.

### Atomic Source

The journal service exposes `recoverySource(investigationId)`. It reads and
projects the journal once, then returns the projected record, validated
normalized input, immutable identity, latest accepted checkpoint, pending model
boundary, and terminal record from that single snapshot. Corrupt and
unsupported records may return diagnostics, but they do not expose an
authoritative checkpoint or normalized input.

### Classification

Missing records are `not_found`. Corrupt or unsupported records are blocked and
recommend corrupt-record inspection. Terminal journals are not reopened by
9W3B1; future work may start a new explicit continuation lineage. Nonterminal
records with an accepted checkpoint can become `ready_for_approval` only when
compatibility checks pass. Nonterminal records with a pending model-step
boundary are `human_review_required` because the provider outcome is uncertain.
External API audit counts do not resolve that uncertainty.

### Compatibility

Tool compatibility is exact. Every stored loaded-tool reference must still have
the same descriptor version, authority ID, provider-visible description hash,
input/output schema hashes, load policy, trust class, instruction semantics,
max output bytes, timeout, binding presence, phase eligibility, namespace
envelope, and safe-read authority. The fixed Git process exception remains
limited to `repo.git_status` and `repo.git_diff` with the restricted read-only
backend and fixed read-only process policy.

Provider compatibility revalidates the persisted provider/model/phase identity
against the current configured connector provider and Commander model
capability. Injected adapters remain internal/test overrides and do not become
the production recovery path. Preview can inspect state before start, after
shutdown, and without a run lock, but execution readiness remains separate.
For configured providers, preview also computes a credential-free recovery
execution envelope. The envelope binds the current connector ID, connector
policy hash, transport limits, model context/output limits, capability flags,
and capability envelope hash. Raw connector URLs, header values, credential
environment names, and credential values are not exposed. Runtime lifecycle
state, run-lock state, and credential values are deliberately excluded so that
starting the runtime or rotating a secret does not change the recovery plan.

Budget compatibility never resets counters or broadens stored limits. Remaining
budget is derived from the accepted checkpoint and current policy, using the
stricter value. Current tool-schema allocation is recomputed through the
runtime context-budget service, not from a static Commander profile fallback.
No-progress and repeated-result state stay part of the recovery state.

### Context And Continuity

Exact transcript replay is unsupported. The journal stores model text
fingerprints, pointer-only evidence, summary-only tool-result relationships,
and safe evidence-based conclusion cards. Recovery preview always reports:

- `exact_replay_supported=false`
- `original_assistant_text_available=false`
- `fresh_context_required=true`

Current continuity is compiled read-only from the persisted normalized input and
compared with the original bootstrap reference. Drift warns; current bootstrap
blockers block. The bootstrap compiler reports a structured continuity
assessment status: omitted continuity is allowed only when the preview caller
explicitly opts out and the phase is not mid-mission; degraded continuity means
the requested assessment did not complete and blocks recovery readiness. Current
stop, pause, correction, override, and escalation controls take precedence. A
human hold never recommends resume approval, and an OpenCode resume request is
not Commander recovery approval.
When continuity is explicitly omitted, preview still compiles the fresh
non-continuity bootstrap so context sizing includes the runtime authority and
objective kernel required by future recovery.

Recommended actions distinguish journal integrity from current runtime policy.
`inspect_corrupt_record` is reserved for corrupt or unsupported projections.
Provider misconfiguration, injected adapters, schema drift, context overflow,
and continuity degradation recommend runtime reconfiguration. Exhausted
model-turn, wall-time, or no-progress budgets recommend a new investigation.
Tool-call, tool-search, and cumulative-result-byte budgets at exactly zero do
not block a final model-only turn; overconsumed counters still block recovery.

### Recovery Packet And Plan Hash

The recovery packet is bounded and pointer-only. It contains immutable identity,
checkpoint references, pending-model uncertainty, loaded-tool refs, evidence
pointers, execution digests, repeat signatures, remaining budgets, current
human-control state, blockers, and warnings. It does not contain raw repository
lines, Git patches, full research records, provider prompts/responses, raw tool
results, assistant prose, credentials, or hidden reasoning. The packet is
rebuilt after context compatibility is classified so its blockers and hash bind
the same context-budget failures reported by the preview.

The recovery-plan hash binds the record hash, checkpoint hash, pending boundary,
tool/provider/budget/continuity/human compatibility hashes, the current provider
execution-envelope hash, recovery packet hash, recovery kind, and recommended
action. It excludes generated timestamps, EventStore event IDs, provider audit
request IDs, process IDs, runtime start/lock state, credential values, and
duration measurements. 9W3B2 must require a human-approved plan hash to still
match after revalidation.

## Consequences

The internal read-only stack is:

```text
durable journal
-> atomic recovery source
-> compatibility checks
-> current continuity/human-control checks
-> bounded recovery packet
-> recovery-plan hash
-> human review required
-> no execution
```

9W3B1 adds no recovery execution, disposition event, provider replay, tool
replay, public runtime command, RuntimeClient method, slash command, TUI
surface, authority record, proposal generation, OpenCode action, new tool
binding, connector streaming, or automatic startup recovery.

9W3B2 owns durable recovery disposition, plan-hash revalidation, uncertain
provider outcome resolution, fresh context reconstruction, and bounded recovery
execution. 9W3C owns public/operator controls.
