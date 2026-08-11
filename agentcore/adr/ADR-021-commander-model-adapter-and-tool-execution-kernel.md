# ADR-021 - Commander model adapter and tool execution kernel

## Status

Accepted for Branch 9W1.

## Context

ADR-020 selected `hybrid_ai_sdk_core_with_nexusloop_loop`: AI SDK Core is useful
as a one-request model transport and tool-call decoding layer, but it must not
own Commander run state, tool execution, persistence, approvals, or loop
continuation.

Branches 9U and 9V already define the curated Commander capability registry and
first-party internal read services. 9W1 productionizes the two narrow seams that
future 9W2 will compose:

- a provider-neutral Commander model-step contract backed by AI SDK Core
- a NexusLoop-owned Commander tool binding and safe-read execution kernel

## Decision

### AI SDK Core Production Dependency

Runtime depends on exact versions:

- `ai@7.0.29`
- `@ai-sdk/openai-compatible@3.0.11`

The isolated 9W0 spike remains decision evidence only. Production code does not
import the spike package and does not depend on OpenAI Agents, LangGraph, Claude
Agent SDK, ToolLoopAgent, SDK sessions, SDK approvals, or SDK persistence.

### One Request Only

The AI SDK adapter performs exactly one model request per invocation. It sets
`maxRetries=0`, does not configure `stopWhen`, does not provide AI SDK tool
`execute` callbacks, and does not issue repair or continuation requests.

NexusLoop messages are the canonical contract. AI SDK messages are derived at
the adapter boundary. Assistant messages support text plus multiple parallel
tool calls, and tool-result messages must reference the exact originating
`tool_call_id`.

### Derived Provider Schemas

Commander tool descriptors remain canonical. Provider tool schemas are derived
from registry descriptors, strip NexusLoop-only `schema_version`, and use a
request-scoped provider-name map such as `memory.search -> memory__search`.
Provider names are never decoded through global underscore replacement.

NexusLoop validates model-produced tool arguments with its own constrained
schema validator before execution. Provider validation is helpful transport
behavior, not authority.

### Explicit Binding Allowlist

Implemented descriptors are not automatically model-callable. 9W1 binds exactly:

- `commander.tool_search`
- `commander.tool_get`
- `commander.tool_profile`
- `authority.describe`
- `memory.search`
- `continuity.search`
- `repo.search_text`
- `repo.read_lines`
- `repo.git_status`
- `repo.git_diff`

Bindings are explicit closures over typed services. They do not dispatch through
generic runtime command names, slash commands, reflection, or
`RuntimeServer.command()`.

### Authority Preflight

Before a binding runs, the executor checks descriptor existence, binding
existence, implemented-read availability, phase-envelope eligibility, authority
mapping, safe-read risk, side-effect class, event/provider/network/credential
flags, approval/run-lock requirements, and the fixed Git process exception.

Only `repo.git_status` and `repo.git_diff` may use
`execution_backend="restricted_git_read"` with
`process_policy="fixed_git_read_only"`.

### Transient Results

Tool execution results are transient in 9W1. The executor appends no events,
persists no working set, writes no research DB records, mutates no mission or
proposal state, and performs no OpenCode action. Oversized handler output is
rejected rather than generically truncated by the executor.

9W3 will own durable working-set and recovery semantics.

## Consequences

Future 9W2 can orchestrate:

```text
NexusLoop Commander controller
-> AI SDK one-step adapter
-> NexusLoop tool executor
-> typed read services
```

But 9W1 itself has no autonomous provider loop, no Commander run records, no
proposal generation, no external read gateway, and no user-facing runtime or TUI
commands.

Branch 9W2A now composes the 9W1 adapter and executor in a bounded in-memory
controller. Provider connector/egress integration is split into 9W2B, and
durable working-set/recovery remains 9W3.

Existing one-shot MiniMax provider paths remain compatibility surfaces and are
not migrated by 9W1.

Branch 9W2B1 adds connector-backed egress for the new adapter. Branch 9W2B2
activates that connector-backed adapter inside RuntimeServer's internal
investigation method, with provider readiness, run-lock preflight, and one
persisted external API audit per configured provider request. Direct AI SDK
adapter construction remains useful for loopback tests, but production
connector mode supplies only a non-secret sentinel credential to the SDK and
routes every HTTP attempt through `ExternalApiRequestService`.

Branch 9W4A separates the shared AI SDK step engine from provider construction.
The existing OpenAI-compatible provider remains unchanged, while a closed
native Anthropic Messages factory uses the same message conversion, curated
client tools, validation, result normalization, cancellation, and hashing.
Dynamic providers and provider-defined tools remain outside this kernel.
