# Branch 9W4C Implementation Brief

## Protocol And Dependency

Add exactly `@ai-sdk/google@4.0.15` to runtime. Extend the closed transport
union with `google_generative_ai_connector`, provider kind `google`, adapter
policy `google_generative_ai_generate_content_v1`, and a fixed non-secret SDK
API-key sentinel.

## Provider And Bridge

Extend the shared AI SDK adapter factory with the Google chat model and no
streaming/native structured output. Extend the connector bridge with:

- exact `POST /models/<safe-id>:generateContent` URL;
- exact `x-goog-api-key` sentinel removal and connector-owned credential shape;
- exact request headers/body allowlist;
- strict response candidate/content/finish/usage validation;
- Google-compatible bounded HTTP failure synthesis;
- one dispatch and one durable audit per model step.

## Continuation

Add a module-private transient continuation store for bounded Gemini thought
signatures. Extract from AI SDK tool-call provider metadata, attach to the exact
normalized in-memory call, copy explicitly across defensive request snapshots,
and restore only for Gemini assistant tool-call parts. Do not expose a public
field or enumerable value. Reject missing/skip signatures for Gemini 3.

## Unified Profiles And Readiness

Add Gemini to Commander conformance policy v2 while retaining v1 validation for
existing snapshots. Add exact transport/provider pairing and Gemini path-safe
model activation. Legacy environment adaptation remains deterministic. Executor
schema, mapping policy, selection, launch, and auxiliary models are unchanged.

Readiness requires the existing connector plus exactly one unprefixed
`x-goog-api-key` environment credential reference, one allowed host, POST only,
no default headers, and all existing lifecycle/capability gates.

## Recovery

Bind Gemini package/adapter, endpoint-shape, auth/header, request/tool/structured
output, transient-continuation, and audit policy identity into only Gemini
execution envelopes. Existing OpenAI-compatible and Anthropic envelope shapes
remain unchanged. Drift stales affected approvals; no provider state or
historical request is replayed.

## Tests

Add red tests for parsing, conformance, profile role isolation, exact endpoint
and headers, request/response restrictions, model-path attacks, request/audit
counts, zero retries, cancellation/shutdown, redaction, tool calls, two-step
thought-signature continuation, concurrency isolation/cleanup, recovery drift,
and unchanged existing protocols. Add one real headless-TUI recovery E2E with a
local deterministic Gemini server.

## Documentation

Add ADR-037 and update ADR-034/035/036 consequences plus architecture/provider
docs with implemented behavior only.
