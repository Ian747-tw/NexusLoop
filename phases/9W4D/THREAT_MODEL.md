# 9W4D Threat Model

| Threat | Boundary |
| --- | --- |
| Ambient or caller credential reaches SDK | Fixed non-secret sentinel only; bridge accepts and removes that exact bearer value; connector injects the real secret. |
| Alternate endpoint or method | Exact configured origin and canonical `/responses`, POST only, no query, fragment, credentials, or redirects. |
| Server-managed state becomes authority | Force `store:false`; reject previous response, conversation, background, prompt, retrieval, context-management, and include fields. |
| Hosted tool escalation | Request tools must be exact NexusLoop client functions; response accepts only message/refusal/function-call items. |
| Unknown provider output becomes success | Strict operation-specific response validation before AI SDK parsing; incomplete/unknown states fail closed. |
| Retry duplicates uncertain work | AI SDK `maxRetries=0`; one bridge dispatch and one durable audit per step. |
| Response ID or alias rewrites selection | IDs are bounded non-authoritative and discarded; response model must match configured authority exactly. |
| Matrix becomes selection/readiness authority | Matrix is pure, immutable, credential-free evidence with no runtime activation or lookup side effects. |
| Recovery replays network state | Protocol policy enters the execution envelope; no response ID, request body, result body, or provider continuation is persisted or replayed. |
