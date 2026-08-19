# Gemini Provider Surface Audit

Audit date: 2026-08-19. Base:
`c2287ea88f55a2800e41ba304a03c281ee1eda57`.

## Exact Package

Selected: `@ai-sdk/google@4.0.15`.

- npm shasum: `3c766e69b20fb1cdc4c2e1507e06df1fdc1c36e0`;
- tarball SHA-256:
  `1486d3b5d78319ac65ed1f690c2eb986eca4cb1872b9b8ec7b4af04f22796257`;
- dependencies: `@ai-sdk/provider@4.0.3` and
  `@ai-sdk/provider-utils@5.0.10`;
- peer: `zod ^3.25.76 || ^4.1.8`;
- no change to `ai@7.0.29`, Anthropic, or OpenAI-compatible packages.

The inspected npm tarball includes source. `createGoogle` canonicalizes the
base URL, accepts explicit `apiKey` and `fetch`, and otherwise would read
`GOOGLE_GENERATIVE_AI_API_KEY`. NexusLoop supplies both explicitly. The package
also contains image, video, speech, files, realtime, Interactions, and provider
tools; 9W4C calls only the language-model chat factory and the bridge rejects
every non-authorized wire shape.

## Unary Request Contract

`GoogleLanguageModel.doGenerate` performs one `postJsonToApi` call:

```text
POST <baseURL>/models/<modelId>:generateContent
x-goog-api-key: <SDK sentinel>
content-type: application/json
x-vercel-ai-sdk-version: ai-sdk/google/4.0.15
```

The body may be produced from system instruction, text contents, client
function declarations, tool choice, `maxOutputTokens`, and temperature. The SDK
can also emit many forbidden fields from provider options and response formats;
the NexusLoop bridge validates an exact subset before dispatch.

`generateText` receives `maxRetries=0`; the provider's unary `doGenerate` has no
internal retry or pagination. One model step therefore reaches at most one
custom-fetch call.

## Tool Mapping

AI SDK function tools map to one Gemini `functionDeclarations` object.
`auto`, `none`, `required`, and exact-tool choices map to `AUTO`, `NONE`, `ANY`,
and `ANY + allowedFunctionNames`. Provider-defined Google tools are a separate
package path and are rejected both before SDK use and in the bridge body.

Function-call responses map to AI SDK client tool calls with exact provider ID,
name, JSON arguments, and per-part provider metadata. Function responses are
sent as user-role `functionResponse` parts. Multimedia function results are not
accepted by NexusLoop.

## Thought Signatures

The response decoder reads `thoughtSignature` on function-call parts and places
it in `providerMetadata.google.thoughtSignature`. The message converter reads
`providerOptions.google.thoughtSignature` and emits it on the corresponding
historical function-call part. This is the exact seam used for transient
continuation.

The package can inject `skip_thought_signature_validator` for Gemini 3 when
metadata is missing. NexusLoop does not accept that behavior as proof of native
continuation: the strict body validator rejects the skip sentinel and requires
the observed signature on the first function call of a Gemini 3 step.

## Response Contract

The package accepts candidate text, function calls, media, provider/server tool
parts, grounding metadata, prompt feedback, and broad finish reasons. NexusLoop
narrows this before SDK decoding to:

- exactly one candidate for success;
- text and ordinary client `functionCall` parts only;
- bounded IDs, names, object arguments, and thought signatures;
- known finish reasons `STOP`, `MAX_TOKENS`, safety/content-filter reasons, and
  `MALFORMED_FUNCTION_CALL`;
- bounded nonnegative usage counters;
- prompt blocking with zero candidates as refusal/blocked evidence, never
  success;
- no inline data, executable code, server tool call/response, grounding, URL
  context, citations, or unsupported content.

The package maps `STOP` with client calls to `tool-calls`, `MAX_TOKENS` to
`length`, safety reasons to `content-filter`, malformed function calls to
`error`, and unknown reasons to `other`. NexusLoop rejects length, error, other,
empty/ambiguous content, and multiple candidates as final success.

`modelVersion`, `responseId`, and provider metadata are not selection authority.
The selected profile/model and request path remain authoritative.

## Structured Output

The package can emit `responseMimeType=application/json` and a converted OpenAPI
schema. 9W4C does not claim that broader schema subset. Gemini conformance sets
`supports_json_schema=false` and uses NexusLoop JSON fallback.

## Lifecycle Fit

The custom fetch receives the AI SDK abort signal. Existing connector transport
owns DNS/host policy, redirects, timeout, response bytes, durable audit, and
shutdown drain. No production code uses the package's streaming, Interactions,
realtime, files, image, video, speech, embedding, or provider-tool factories.

## Audit Conclusion

GO for one closed `google_generative_ai_connector` unary `generateContent`
transport with `@ai-sdk/google@4.0.15`, strict request/response validation,
module-private transient thought-signature continuation, and native structured
output disabled.
