# ADR-020 - Commander agent-runtime SDK fit

## Status

Accepted for Branch 9W0.

## Context

Branches 9U and 9V define the Commander capability registry and first-party
internal read tools, but they deliberately do not implement a provider-driven
investigation loop. Before 9W1/9W2 bind model tool calls to NexusLoop tools, we
need to decide whether a generic model/tool-call SDK should sit below the
Commander controller.

The spike compares exactly three options in an isolated package:

- Vercel AI SDK Core using `ai@7.0.29` and
  `@ai-sdk/openai-compatible@3.0.11`
- OpenAI Agents SDK controlled lower-level usage using `@openai/agents@0.13.4`
  and `zod@4.4.3`
- a minimal custom NexusLoop model-step adapter baseline

Candidate dependencies are not added to production runtime or TUI packages.

## Decision

Adopt:

`hybrid_ai_sdk_core_with_nexusloop_loop`

NexusLoop should use AI SDK Core as the generic one-step model transport and
native tool-call decoding layer, while keeping the Commander run controller,
tool execution, authority checks, evidence normalization, persistence,
pause/resume, human controls, and governance gates entirely NexusLoop-owned.

The intended architecture is:

```text
NexusLoop domain control plane
-> NexusLoop Commander run controller
-> AI SDK Core one-step model adapter
-> NexusLoop tool executor
```

AI SDK Core is selected because the spike found the best fit for:

- one-step model request control
- OpenAI-compatible provider portability
- Bun import/runtime compatibility
- JSON-schema tool derivation from the NexusLoop registry
- streaming, cancellation, and usage normalization
- no SDK-owned sessions, tool execution, approval, or persistence in the
  intended integration path

## What NexusLoop Retains

NexusLoop remains authoritative for:

- Commander run state
- Commander tool registry and phase envelopes
- authority checks
- tool execution
- evidence normalization
- event ledger and projections
- context/working-set persistence
- wake scheduling and timeout policy
- human pause/stop/correction
- mission/proposal/review/apply gates
- GitHub governance
- OpenCode lifecycle

The SDK may own only generic model transport mechanics:

- provider request normalization
- model requests
- streaming transport
- native tool-call decoding
- structured output decoding
- cancellation plumbing
- token/usage extraction
- provider error normalization

## Non-Authoritative SDK Surfaces

The following equivalences are explicitly false:

- SDK session != NexusLoop durable memory
- SDK trace != NexusLoop event ledger
- SDK approval != NexusLoop authority
- SDK tool execution != NexusLoop tool execution
- SDK agent loop != NexusLoop Commander run controller

## Candidate Results

The deterministic matrix is generated in
`agentcore/spikes/commander-agent-runtime-sdk-fit/results.json` and rendered in
`RESULTS.md`.

Weighted scores:

- Vercel AI SDK Core: 97.00
- minimal custom adapter: 80.00
- OpenAI Agents controlled lower-level usage: 62.00

The full OpenAI Agents Runner path is not selected for Commander because it is
designed around an agent loop abstraction with tools, sessions, tracing, and
runner ownership implications. Lower-level controlled OpenAI Agents usage is
possible, but it was less portable for OpenAI-compatible providers and carried
more authority-overlap risk for NexusLoop.

The minimal custom adapter is not selected because it would force NexusLoop to
own provider quirks, streaming variants, native tool-call decoding, error
normalization, and usage extraction that a narrow SDK transport layer can
provide.

## Why LangGraph Is Not A Candidate

LangGraph is a graph/workflow runtime, not a narrow model-step transport
adapter. It would introduce a second run-state and persistence abstraction where
NexusLoop already owns Commander state, eventing, pause/resume, and authority.

## Why Claude Agent SDK Is Not A Candidate

The Commander investigation loop must be provider-neutral and support local or
OpenAI-compatible providers. A provider-specific agent SDK would not fit the
9W0 scope of selecting a generic lower model/tool-call layer.

## Why Full SDK Runners Are Not The Runtime

AI SDK ToolLoopAgent and OpenAI Agents Runner cannot automatically become the
NexusLoop runtime because NexusLoop must retain loop continuation, tool
execution, persistence, approvals, tracing authority, and event writes. Any SDK
runner that auto-executes tools, hides second model requests, or persists
session state outside NexusLoop is unsuitable as the Commander controller.

## Schema Compatibility

The spike converts real 9U/9V descriptors into candidate-specific tool schemas:

- `commander.tool_search`
- `memory.search`
- `continuity.search`
- `repo.search_text`
- `repo.read_lines`
- `repo.git_status`
- `repo.git_diff`

The NexusLoop descriptor remains canonical. Candidate schema objects are derived
adapters only. Tests verify required fields, `additionalProperties=false`,
minimum/maximum, `maxLength`, valid/invalid arguments, and descriptor hash
stability.

## Consequences

9W1 implements the NexusLoop-owned Commander model-step boundary and explicit
tool-binding execution kernel around an AI SDK Core adapter. Production uses
only `ai@7.0.29` and `@ai-sdk/openai-compatible@3.0.11`; the spike package
remains isolated evidence. Full OpenAI Agents Runner remains excluded, and the
lower-level OpenAI Agents candidate was evaluated but not selected.

9W2B1 connects the selected AI SDK transport to NexusLoop's existing External
API connector authority through a strict connector fetch bridge. The SDK still
does not receive real provider credentials or an unrestricted fetch path; base
URL, credentials, host policy, response caps, and audit persistence remain
owned by `ExternalApiRequestService` and `ExternalApiTransport`.

9W2B2 connects the selected AI SDK Core path through RuntimeServer's internal
in-memory investigation method using connector-backed transport and provider
audit gating. NexusLoop still owns the loop, tool authority, run lock, audit
semantics, and investigation state; the SDK remains only the one-request
transport/decoding layer.

9W2B2 still does not implement a public provider loop, durable working set, or
proposal gate.

9W2 should implement the bounded provider-neutral investigation loop on top of
that boundary.

9W3 should add durable working-set, pause/resume, and recovery semantics.

The losing candidate dependencies remain isolated in the 9W0 spike package. No
production package imports the spike or its candidate SDKs.
