# OpenAI Responses Provider Surface Audit

## Exact artifact

- Package: `@ai-sdk/openai@4.0.15`
- Integrity: `sha512-JpTLQp5RUbRcs5nOyPEu5NRdxZLUnD/uCyT3qzy26D+iunCeL7KJV58ER9kwisAKnTjWravfNblaQNiWr20M9A==`
- Dependencies: `@ai-sdk/provider@4.0.3`, `@ai-sdk/provider-utils@5.0.10`
- Factory: `createOpenAI` in `src/openai-provider.ts`
- Explicit protocol seam: `provider.responses(modelId)`

## Request behavior

The non-streaming model calls `postJsonToApi` once at the factory-derived
`/responses` URL using the supplied custom fetch and abort signal. The public
factory strips a trailing base slash and loads an explicitly supplied API key
instead of ambient `OPENAI_API_KEY`. NexusLoop supplies a fixed sentinel and no
organization, project, or caller headers.

The package supports broad provider options including conversations,
`previousResponseId`, includes, prompt caching, reasoning, service tiers,
storage, truncation, context management, and hosted tools. None are trusted.
The bridge allowlists the exact stateless request shape and forces `store:false`.

## Tool behavior

Ordinary AI SDK function tools map to Responses `{type:"function"}` entries.
The response maps a completed `function_call` to the exact `call_id`, name, and
JSON arguments. A later request can resend that function call and a matching
`function_call_output` without `previous_response_id` or response retrieval.
Every provider-defined tool type is rejected at both request and response
validation boundaries.

## Response behavior

The package parser accepts many output item kinds and exposes response IDs,
provider metadata, annotations, reasoning, and hosted-tool results. NexusLoop
therefore validates the raw JSON before returning it to the package. Only the
strict subset in `SCOPE_QUESTIONS.md` is accepted. Response IDs, timestamps,
raw bodies, and provider metadata are not Commander authority or durability.

## Retry, audit, and lifecycle

AI SDK Core receives `maxRetries:0`. One model step invokes the custom fetch at
most once. That fetch is the existing `ExternalApiRequestService` bridge, so an
attempted dispatch requires one durable audit result before the response is
published. Cancellation and RuntimeServer drain remain owned by the existing
configured-provider lifecycle.

## Primary documentation cross-check

OpenAI's Responses reference documents `POST /responses`, function tools,
stored responses, previous-response chaining, conversations, background mode,
and hosted tools. OpenAI's data-controls documentation states Responses are
stored by default unless `store:false`; therefore explicit stateless validation
is mandatory rather than relying on SDK defaults.
