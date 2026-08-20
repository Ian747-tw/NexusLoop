# ADR-037 - Commander native Gemini provider protocol

## Status

Accepted for Branch 9W4C.

## Context

ADR-034 established a closed Commander protocol union and ADR-035/ADR-036
established immutable model-profile selection and RuntimeServer role readiness.
Gemini support must enter through those authorities without making inert model
IDs, OpenCode state, remote catalogs, or SDK defaults executable authority.

The audited dependency is `@ai-sdk/google@4.0.15` on the existing
`ai@7.0.29`, `@ai-sdk/provider@4.0.3`, and
`@ai-sdk/provider-utils@5.0.10` graph.

## Decision

1. Add the closed transport `google_generative_ai_connector` with
   `provider_kind=google`. It selects only NexusLoop's built-in, stateless,
   unary Google Generative AI `generateContent` policy.
2. Accept a Gemini model for activation only when it begins with `gemini-` and
   is one safe path segment: 1-120 ASCII letters, digits, `.`, `_`, or `-`,
   beginning with a letter or digit. The endpoint is exactly
   `<connector.base_url>/models/<model>:generateContent` using `POST`, with no
   query, fragment, URL credentials, alternate RPC, or streaming.
3. Give the Google SDK a fixed non-secret sentinel. The strict connector bridge
   removes only that sentinel; `ExternalApiRequestService` alone resolves and
   injects one unprefixed `x-goog-api-key` credential. Ambient authentication,
   bearer auth, cookies, caller headers, and query API keys are rejected.
4. Permit only bounded system/text messages, NexusLoop client function
   declarations/calls/responses, proven generic tool choice, output-token and
   temperature settings. Reject server tools, search, URL context, code
   execution, media, files, caches, thinking controls, safety-setting
   authority, provider options, multiple candidates, interactions, retained
   state, retries, fallback, and automatic tool execution.
5. Native JSON-schema output remains unsupported. Commander uses the existing
   bounded JSON fallback and publishes `supports_json_schema=false`.
6. Require exactly one candidate for ordinary responses. A bounded
   zero-candidate `promptFeedback` block is normalized only into a refusal;
   unknown or malformed prompt-block shapes fail closed. Returned
   `modelVersion` is optional, bounded, and non-authoritative: the configured
   model path remains the selection authority. Unsupported parts, malformed
   calls, ambiguous finish reasons, truncation, unblocked empty candidates,
   multiple candidates, or malformed usage fail closed.
7. Gemini function-call thought signatures are transient continuation data.
   A module-private identity map carries a bounded signature from one normalized
   call into only its matching next live request. Signatures are non-enumerable,
   investigation-local, provider-local, and excluded from events, audits,
   logs, errors, results, hashes, recovery authority, and durable state. A
   recovered native Gemini turn-complete checkpoint therefore renders its
   summary-only tool exchange as fresh user context; it never reconstructs a
   native function call or fabricates a missing thought signature. Existing
   OpenAI-compatible and Anthropic recovery message envelopes remain unchanged.
   New Gemini tool calls made during that recovery use ordinary live transient
   continuation.
8. Commander conformance policy v2 admits Gemini. Existing v1 OpenAI-compatible
   and Anthropic entries and their effective hashes remain unchanged. The model
   configuration schema and Executor mapping policy remain v1.
9. The configured-provider execution envelope binds the Google package,
   adapter, endpoint, credential/header, request, tool/structured-output,
   transient-continuation, and audit policy identities. Relevant drift stales
   only affected recovery authority.

## Consequences

Commander has three statically selected transport protocols: existing
OpenAI-compatible Chat Completions, native Anthropic Messages, and native
Google Generative AI `generateContent`. All use the same controller, one-step
AI SDK engine, connector credential boundary, durable audit, cancellation,
recovery, and RuntimeServer shutdown drain.

No Vertex AI, OAuth/service account, Interactions API, streaming, server tool,
provider discovery, fallback, retry, persistent SDK session, user-facing model
selection, Executor authority change, MCP, external research, proposal,
governance, or mutation capability is added. `resume_supported=false`,
`provider_tool_loop_enabled=false`, and `external_read_execution_enabled=false`
remain unchanged.
