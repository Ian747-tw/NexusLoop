# ADR-038 - Commander native OpenAI Responses and compatibility matrix

## Status

Accepted for Branch 9W4D.

## Context

ADR-034 established statically selected Commander protocols, ADR-035 and
ADR-036 separated model selection from role readiness, and ADR-037 added native
Gemini. OpenAI Responses is a materially different wire protocol from the
existing OpenAI-compatible Chat Completions path. It must not inherit Responses
storage, hosted-tool, retrieval, or background-work authority from SDK defaults.

The audited dependency is `@ai-sdk/openai@4.0.15` on the existing
`ai@7.0.29`, `@ai-sdk/provider@4.0.3`, and
`@ai-sdk/provider-utils@5.0.10` graph.

## Decision

1. Add the closed transport `openai_responses_connector`, requiring
   `provider_kind=openai`. It uses unary `POST <connector.base_url>/responses`.
2. The SDK receives only a fixed non-secret bearer sentinel and the strict
   NexusLoop fetch bridge. `ExternalApiRequestService` alone resolves and
   injects one connector-owned `Authorization: Bearer ...` credential.
3. Every request forces `store=false`. Previous-response IDs, conversations,
   background work, retrieval, include expansion, prompt templates, service-
   tier authority, hosted tools, provider options, streaming, retries, and
   fallback are rejected before dispatch.
4. Permit only bounded system/text messages, NexusLoop client function
   declarations, ordinary function calls/results, proven generic tool choice,
   output-token limits, and sampling fields. Native JSON-schema output remains
   unverified; bounded NexusLoop JSON fallback remains in use.
5. Validate a successful raw response before the SDK can trust it. Accept only
   one completed bounded response containing assistant text, refusal, or
   ordinary client function calls with valid object arguments and consistent
   usage. Reject unknown output items, hosted-tool output, reasoning state,
   incomplete/truncated output, malformed calls, model mismatch, and ambiguous
   combinations. A returned model may equal the configured ID or be its exact
   calendar-date snapshot; the configured model remains authoritative. The
   initial verified model family is `gpt-4.1-mini` and its dated snapshots;
   reasoning-model configuration fails before readiness. Documented inert
   envelope fields are bounded and discarded before SDK normalization.
6. Synthesize a minimal SDK response after validation. Provider response IDs,
   aliases, echoed options, service-tier observations, and raw metadata do not
   enter Commander results, journals, audits, hashes, or future requests.
7. Ordinary tool continuation resends the bounded live function call and its
   matching result by exact call ID. It does not use `previous_response_id`,
   response retrieval, stored state, or durable provider continuation data.
8. Commander conformance policy v3 admits Responses and every protocol valid
   under v1/v2. V1 and v2 behavior and hashes remain unchanged; Responses
   requires v3. Model-configuration schema and Executor mapping remain v1.
9. Recovery identity binds the Responses package/adapter, endpoint, bearer-
   sentinel, stateless request, client-tool, structured-output, continuation,
   and audit policies. Historical provider requests and tool execution are
   never replayed.
10. Publish one pure immutable compatibility matrix containing four exact
    protocol evidence entries. It is credential-free descriptive evidence and
    cannot create conformance, selection, readiness, endpoint, discovery,
    credential, fallback, or Executor authority.

## Consequences

Commander has four closed protocol families: OpenAI-compatible Chat
Completions, Anthropic Messages, Google Generative AI `generateContent`, and
native OpenAI Responses. All share the existing controller, connector audit,
cancellation, recovery, and RuntimeServer shutdown ownership while retaining
protocol-specific request and response policy.

No model-selection UX, profile persistence, discovery, hosted tool, remote
response retrieval, background work, streaming, fallback, retry, shared
Commander/Executor credential, MCP, external research, proposal, governance,
or mutation authority is added. `resume_supported=false`,
`provider_tool_loop_enabled=false`, and `external_read_execution_enabled=false`
remain unchanged.
