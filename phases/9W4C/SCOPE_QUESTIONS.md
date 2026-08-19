# Branch 9W4C Scope Questions

All production-blocking questions are resolved from base source, the exact npm
tarball, and primary Google/Vercel documentation.

## Which package version fits the pinned graph?

`@ai-sdk/google@4.0.15` depends exactly on `@ai-sdk/provider@4.0.3` and
`@ai-sdk/provider-utils@5.0.10`, matching `ai@7.0.29` and the existing provider
graph. Registry tarball integrity is
`sha512-09hZQoM3liYX/.../o4ZQdI6vWmIfg==`; the downloaded tarball SHA-256 is
`1486d3b5d78319ac65ed1f690c2eb986eca4cb1872b9b8ec7b4af04f22796257`.
No broad upgrade is required.

## Does custom fetch preserve the audit boundary?

Yes. `GoogleLanguageModel.doGenerate` calls `postJsonToApi` once with the
configured fetch and abort signal. NexusLoop supplies `maxRetries=0`, rejects
streaming, and routes that one fetch through `ExternalApiRequestService`.

## What endpoint is authorized?

Exactly `POST <connector-base>/models/<safe-model-segment>:generateContent`.
The generic model ID remains inert. Gemini activation separately requires one
ASCII segment beginning with `gemini-`, with letters, digits, dots, underscores,
and hyphens only. Slash, colon, percent, query, fragment, controls, whitespace,
and backslash are rejected before SDK construction.

## How are credentials contained?

The SDK receives one fixed non-secret sentinel as `apiKey` and an explicit
custom fetch, so ambient `GOOGLE_GENERATIVE_AI_API_KEY` lookup is not used. The
bridge removes only that exact `x-goog-api-key`; `ExternalApiRequestService`
injects the connector-owned unprefixed header credential. No credential name or
value enters model authority or safe outputs.

## Which provider features are accepted?

Only unary text `generateContent`, system text, ordinary text history,
NexusLoop client function declarations/calls/responses, generic tool choice,
`maxOutputTokens`, and bounded temperature. The bridge rejects provider
options, safety settings, thinking config, caches, server tools, multimodal
parts, multiple candidates, and every alternate endpoint.

## Is native JSON-schema output enabled?

No. Although the package can emit `responseMimeType` and `responseSchema`, the
wire subset and schema semantics are broader than this branch proves.
Gemini conformance requires `supports_json_schema=false`; NexusLoop retains its
bounded JSON fallback.

## How are thought signatures handled?

The package maps a function-call part's `thoughtSignature` to per-call provider
metadata and reads it back from assistant tool-call `providerOptions`. NexusLoop
copies only a bounded Gemini signature into module-private transient metadata on
the in-memory normalized call. The next Gemini request restores it to the exact
function-call part. It is neither enumerable nor serializable and is cleared by
object lifetime. Missing, malformed, oversized, cross-provider, or synthetic
skip signatures fail closed; NexusLoop never relies on the SDK's skip sentinel.

## How is returned model identity handled?

The exact selected model remains authority. The `generateContent` response does
not need `modelVersion` to establish identity, and returned aliases/metadata do
not rewrite it. If `modelVersion` is present, it is treated as non-authoritative
and must be a bounded safe string; it is not persisted or hashed.

## What policy version changes?

The model-configuration schema remains v1 and Executor provider-mapping policy
remains v1. The previously closed Commander conformance policy v1 named only
OpenAI-compatible and Anthropic transports, so Gemini is introduced under
`nexusloop_commander_conformance_policy_v2`. Runtime revalidation accepts
validated v1 snapshots for existing protocols and v2 snapshots for all three;
Gemini requires v2. Existing effective OpenAI/Anthropic transport and recovery
envelopes remain unchanged.

## Is deterministic real-CLI coverage reachable?

Yes. The established headless-TUI recovery fixture configures connector and
Commander environment authority and a local HTTP server without importing
runtime modules. A Gemini variant can exercise the production adapter and
durable audit path.

## Unresolved Questions

None. Stop if implementation disproves any answer above.
