# ADR-030 - Commander configured-provider live recovery execution

## Status

Accepted for Branch 9W3B2B2B.

## Context

ADR-029 added the one-shot recovery transaction and proved journal continuation
with an injected scripted adapter. That transaction intentionally recorded a
scripted transport and rejected external API audits. Reusing it unchanged for a
configured provider would produce false transport and network claims.

Live recovery also needs RuntimeServer lifecycle ownership. It must not call a
provider or tool until the approved recovery-start event is durable, and
shutdown must not release the run lock while provider audit or Commander journal
writes may still settle.

## Decision

### RuntimeServer Authority

RuntimeServer exposes one package-internal TypeScript recovery method. It is not
a runtime command, RuntimeClient method, CLI command, slash command, TUI state,
launch option, or authority-registry capability.

Execution requires active mode, a started and ready non-stopping lifecycle, the
held run lock, a configured connector-backed Commander provider, complete
provider readiness, an inactive durable investigation, and no overlapping
approval write. The method combines caller cancellation with RuntimeServer's
Commander lifecycle signal. Abort state is operational only and never enters
approval, plan, attempt, or journal hashes.

### Transaction Reuse And Execution Modes

The existing recovery transaction has an explicit execution-mode contract:

- `injected_scripted_adapter` preserves B2B2A's zero-network behavior.
- `configured_connector_provider` requires the configured connector transport
  and complete external API audit metadata.

Both modes use the same final approval, recovery basis, plan, packet,
preparation, first-request, checkpoint, pending-boundary, provider-envelope,
and compatibility revalidation. Both atomically consume approval only through
`runtime_commander_investigation_recovery_started`. Existing scripted events
remain readable.

The durable recovery-start must be confirmed before the persistence observer or
continuation runner is invoked. The controller then persists each fresh
model-step boundary before calling the provider. Tool turns persist an existing
checkpoint before another provider request. The existing finished event closes
a safely known terminal result.

### Configured Provider And Audit

Configured recovery reuses:

```text
ConnectorBackedCommanderModelStepAdapter
-> AI SDK Core one-step adapter with maxRetries=0
-> ExternalApiRequestService
-> ExternalApiTransport
-> existing external API audit event
```

The controller requires one complete connector audit per configured provider
request and validates connector identity, event kind/count, and no-persisted-
secret flags. Recovery results report configured model turns, provider calls,
network attempts, and newly appended audit counts from observed execution facts.
Scripted results retain zero provider/network/audit claims.

Audit request IDs remain operational metadata and do not alter semantic model
or recovery hashes. Prompt/response bodies, tool schemas, headers, connector
URLs, credential references or values, assistant prose, raw tool results,
repository content, patches, execution arguments, and chain of thought remain
absent from Commander journal events.

### Safe-Read Tool Execution

The live continuation uses RuntimeServer's current Commander registry, exact
binding allowlist, `CommanderToolExecutor`, phase/namespace eligibility,
authority records, and actual schema verification. Neither the seed nor durable
metadata can add or substitute a tool. No new tool or binding is introduced.

### Failure And Uncertainty

Failure before recovery-start leaves approval unconsumed and calls no provider.
An ambiguous start append is reconciled from projection; execution starts only
when the exact attempt is durable. Model-step append failure calls no provider.

After a fresh model-step boundary, abort, timeout, transport loss, thrown
execution, or other unknown outcome leaves the request pending and omits the
terminal event. The consumed attempt requires human review and cannot restart.
A checkpoint append failure prevents another provider request. A terminal
append failure leaves the approval consumed and the attempt nonterminal. There
is no automatic retry, second attempt, approval reuse, force override, provider
request replay, or tool-execution replay.

Successfully observed final, refusal, or structurally known malformed response
may proceed to terminal persistence. Historical pending-provider outcomes remain
unknown; their approved disposition only permits a fresh noncolliding request
from the accepted checkpoint.

### Lifecycle And Shutdown

Configured recoveries are RuntimeServer-owned work. Shutdown marks lifecycle
stopping, aborts the shared Commander lifecycle signal, waits for provider
transport, external API audit, controller, and journal persistence, and appends
`runtime_shutdown` only after settlement. On drain timeout, the recovery journal
run is fenced. If in-flight persistence cannot settle safely, shutdown fails and
retains the run lock. No recovery or audit event may append after
`runtime_shutdown`.

Concurrent exact calls serialize through the transaction and invoke the
continuation once. Later exact calls report the existing attempt without another
provider request. Different authority is blocked. Only one recovery attempt is
supported.

## Consequences

The internal live path is:

```text
RuntimeServer active/ready/run-lock/configured-provider gate
-> fresh recovery and preparation revalidation
-> atomic recovery-start and approval consumption
-> recovery persistence observer
-> configured connector provider and external API audit
-> current bound safe-read tools
-> existing checkpoints and terminal event
-> terminal or consumed interrupted-attempt projection
```

No new event kind is added in this branch. Public
`provider_tool_loop_enabled=false` and stored `resume_supported=false` remain
unchanged. 9W3C owns public read, approval, execution, cancellation, and TUI
controls. GitHub/MCP gateways, proposals, mission mutation, OpenCode actions,
provider failover, automatic recovery, and exact transcript replay remain out of
scope.

9W3C now wraps this method in a bounded RuntimeServer-owned public operation.
The operation is registered before asynchronous preflight, composes operator
cancellation with this ADR's lifecycle signal, and is removed from the active
map only after settlement. Cancellation remains an operational request and does
not add an event or weaken post-boundary uncertainty rules.

Branch 9XA binds current GitHub descriptor, binding, allowlist, and transport
policy identity into recovery compatibility. A loaded GitHub tool whose gateway
is unavailable blocks recovery; changed gateway authority stales approval and
requires a new preview rather than replaying any historical request.
