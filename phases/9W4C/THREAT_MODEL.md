# Branch 9W4C Threat Model

## Assets

- exact unified-profile Commander selection and role isolation;
- connector-owned endpoint, credential, timeout, and response policy;
- one-request/one-audit model-step accounting;
- transient Gemini function-call continuation without durable provider state;
- existing recovery, cancellation, and shutdown guarantees.

## Threats And Controls

| Threat | Control |
| --- | --- |
| Model ID escapes endpoint | Gemini-only one-segment grammar plus exact URL equality before dispatch. |
| Ambient Google/OpenCode auth authorizes Commander | Explicit SDK sentinel/custom fetch and static Commander conformance only. |
| Header or query credential escape | Exact header allowlist; strip only sentinel; reject query, bearer, cookie, and arbitrary headers. |
| SDK activates Google features | Exact request-body allowlist rejects provider options, server tools, caches, safety/thinking authority, media, and multiple candidates. |
| Hidden requests/retries | Unary `doGenerate`, `maxRetries=0`, bridge request count and durable audit equality. |
| Partial/ambiguous response becomes success | Pre-SDK strict response validation requires exactly one supported candidate and known finish/content shape. |
| Truncation becomes final | `MAX_TOKENS` maps to non-success and is rejected by NexusLoop finalization policy. |
| Thought signature is lost | Bounded module-private transient metadata is attached to the exact call and restored on the next Gemini request. |
| Thought signature leaks | Non-enumerable/private storage; omitted from hashes, events, audits, errors, logs, DTOs, and persistence. |
| SDK skip signature hides a bug | Request validator rejects documented skip sentinels; missing required Gemini 3 signature blocks before dispatch. |
| Server tool becomes client authority | Provider/server tool request fields and provider-executed response parts fail closed. |
| Provider metadata changes authority | Returned metadata is non-authoritative and cannot change selection or recovery identity. |
| Shutdown races audit/journal work | Existing RuntimeServer ownership, abort composition, and drain remain the only execution boundary. |
| Gemini selection changes Executor | Role-specific projections/hashes and unchanged OpenCode launch seam. |

## Residual Risk

Google may change model-specific behavior without discovery. Support therefore
means conformance to the pinned package and NexusLoop wire policy for explicit
models, not general Gemini compatibility. New features or model families require
new static conformance evidence.
