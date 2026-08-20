# 9W4D Scope Questions

## Resolved

### Which package fits the pinned graph?

`@ai-sdk/openai@4.0.15`. The exact npm artifact depends on the same provider
and provider-utils versions already installed. Its `createOpenAI` factory accepts
an explicit API key, base URL, provider name, and custom fetch. NexusLoop uses
the explicit `.responses(modelId)` seam; no model-name API selection is trusted.

### Can execution remain one audited HTTP request per step?

Yes. Non-streaming `OpenAIResponsesLanguageModel.doGenerate` performs one
`postJsonToApi` call to `/responses`. AI SDK Core remains configured with
`maxRetries: 0`; the custom fetch is the existing audited connector bridge.

### Can Responses be stateless?

Yes for bounded text and ordinary client function calls. NexusLoop forces
`store:false` and rejects `previous_response_id`, `conversation`, `background`,
prompt references, context management, include expansion, and remote retrieval.
Client function continuation resends a bounded `function_call` and matching
`function_call_output` by exact `call_id`; no response ID is reused.

### Is reasoning-model continuation in scope?

No. With `store:false`, the package can request and replay encrypted reasoning
content. That opaque continuation is outside the generic Commander contract.
The initial conformance entries must use explicitly verified non-reasoning model
IDs. The bridge rejects reasoning items and reasoning request fields.

### Is native structured output enabled?

No. The package can emit Responses `text.format`, but 9W4D does not prove the
full schema subset and strictness semantics. Conformance remains
`supports_json_schema=false`; the existing bounded JSON fallback remains.

### Which response forms are accepted?

Only one completed response with one matching configured model, bounded usage,
bounded assistant output text, refusal, and ordinary completed client
`function_call` items. Unknown output items, annotations, reasoning, hosted
tool output, incomplete status, multiple/ambiguous final states, or malformed
arguments fail before the SDK result is trusted.

### What changes version?

Commander conformance policy gains v3. Model-configuration schema and Executor
mapping stay v1. V1 and v2 validation/hashes remain unchanged. V3 accepts all
previously valid transports and native Responses; Responses requires v3.

### Is the compatibility matrix authority?

No. It is a built-in immutable evidence snapshot describing exact protocol
implementations. It cannot select a profile, construct conformance, establish
readiness, resolve credentials, discover models, or choose fallback.

## Unresolved

None. Implementation must stop if the package or tests contradict these answers.

