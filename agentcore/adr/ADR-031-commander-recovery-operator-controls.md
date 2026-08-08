# ADR-031 - Commander recovery operator controls

## Status

Accepted for Branch 9W3C.

## Context

ADR-026 through ADR-030 established read-only recovery evidence, exact human
approval, deterministic continuation preparation, one-shot recovery start, and
configured-provider execution. Those services intentionally had no public
operator surface. Exposing them requires thin adapters that preserve their
authority hashes and keep cancellation reachable while execution is active.

## Decision

### Exact Public Surface

9W3C adds exactly six canonical command pairs:

| Slash command | Runtime command |
| --- | --- |
| `/commander-recoveries` | `runtime.list_commander_investigation_recoveries` |
| `/commander-recovery-show` | `runtime.get_commander_investigation_recovery` |
| `/commander-recovery-preview` | `runtime.preview_commander_investigation_recovery` |
| `/commander-recovery-approve` | `runtime.approve_commander_investigation_recovery` |
| `/commander-recovery-execute` | `runtime.execute_commander_investigation_recovery` |
| `/commander-recovery-cancel` | `runtime.cancel_commander_investigation_recovery` |

There is no public investigation-start or resume command. Recovery constructs a
fresh continuation from accepted summary-level state; stored
`resume_supported` remains false.

### Reads And Human Approval

List and show use one typed journal projection and expose bounded, redacted
operator DTOs. List does not fan out current recovery previews and states
`current_compatibility_checked=false`. Preview always requests current
continuity and performs no provider, tool, network, event, file, mission,
proposal, OpenCode, GitHub, or MCP action.

Approval remains a distinct human-only write. The operator supplies the exact
plan hash, decision, identity, optional bounded note, and every required
fresh-context/no-replay acknowledgement. Uncertain-provider continuation also
requires acknowledging that the outcome remains unknown. RuntimeServer reruns
the existing approval service and never trusts TUI state as authority.

### Separate Execution

Execute accepts only the existing transaction identity: investigation,
approval ID/hash, recovery-plan hash, and execution-preparation hash. It calls
RuntimeServer's configured recovery method. The existing active/ready/run-lock,
provider-envelope, compatibility, durable-start, audit, safe-read tool,
checkpoint, one-attempt, and no-replay boundaries remain authoritative.

### Owned Operations And Cancellation

RuntimeServer registers a bounded active operation before configured recovery's
first await. Execute returns the opaque operation ID without waiting for the
continuation, so another client/TUI command can request cancellation. The
operation owns an AbortController composed by the configured recovery path with
RuntimeServer lifecycle cancellation. Settled operations leave the active map;
a bounded recent summary supports truthful status and duplicate handling.

Cancel requires the investigation, active operation ID, approval ID, and the
attempt ID once durable recovery start makes it available. It returns
`cancellation_requested`, `already_requested`, `not_active`, or
`operation_identity_mismatch`. Calling `AbortController.abort()` is not a
durable cancellation or provider-outcome claim. Before recovery start, a
winning cancellation leaves approval unconsumed. After start, approval remains
consumed. After a model-step boundary, uncertain execution remains pending and
terminal persistence is omitted unless an outcome was safely observed.

Shutdown and operator cancellation share the existing lifecycle abort and
drain ownership. No recovery or audit event may append after
`runtime_shutdown`.

### OpenTUI And Authority

OpenTUI presents bounded discovery, selected detail, exact preview hashes,
separate approval and execution confirmations, active operation status, and
reachable cancellation. It says "fresh recovery continuation", "approval
recorded", "cancellation requested", and "provider outcome unknown". Cached UI
state is evidence only; RuntimeServer revalidates every mutation.

Authority records classify list/show/preview as safe reads, approval as a
human-only durable write, execution as high-impact provider-capable work, and
cancel as explicit operation control with no direct event or provider call.
Approve, execute, and cancel are not Commander tools or provider-visible
schemas.

## Consequences

The public flow is:

```text
typed durable list/show
-> current recovery preview
-> exact explicit human approval
-> separate execution confirmation
-> RuntimeServer-owned configured recovery operation
-> optional cancellation request
-> durable terminal or consumed nonterminal human-review state
```

No approval revocation, retry, second attempt, automatic recovery, exact
transcript replay, provider failover, broad provider loop, new Commander tool,
GitHub/MCP read gateway, proposal generation, mission mutation, or OpenCode
action is added. Public `provider_tool_loop_enabled` remains false. 9X owns
external GitHub/research reads, 9Y owns evidence-backed proposals, and 9Z owns
GitHub governance mutations.

Branch 9XA supplies bounded GitHub reads only inside configured Commander
investigations. It adds no direct GitHub operator command and does not change
the 9W3C approval, execution, cancellation, one-shot, or uncertainty contracts.
