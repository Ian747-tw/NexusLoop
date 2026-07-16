# Commander Agent Runtime SDK Fit Results

## Final Decision

hybrid_ai_sdk_core_with_nexusloop_loop

NexusLoop should use AI SDK Core as the generic one-step model transport layer
under a NexusLoop-owned Commander loop, tool executor, evidence working set,
authority checks, and durable state model.

## Weighted Matrix

| Candidate | Weighted score | Hard disqualified | Packages | Limitations |
| --- | ---: | --- | --- | --- |
| minimal_custom_adapter | 80.00 | no | none | Would require NexusLoop to own provider quirks, streaming normalization, native tool-call variants, and error taxonomy. |
| vercel_ai_sdk_core | 97.00 | no | ai@7.0.29<br>@ai-sdk/openai-compatible@3.0.11 | AI SDK Core should be used as one-step model transport only; ToolLoopAgent or stopWhen loops remain out of scope. |
| openai_agents_core | 62.00 | yes | @openai/agents@0.13.4<br>zod@4.4.3 | Full Runner ownership conflicts with NexusLoop loop/tool/session authority; lower-level controlled usage is possible but less portable for OpenAI-compatible providers. |

## Weights

- authority_interception_fit: 25%
- provider_local_model_portability: 20%
- bun_compatibility: 15%
- tool_schema_fidelity: 15%
- streaming_cancellation_usage_fidelity: 10%
- testability_determinism: 5%
- dependency_footprint: 5%
- license_maintenance_risk: 5%

## Hard Disqualifications

- minimal_custom_adapter: none
- vercel_ai_sdk_core: none
- openai_agents_core: Full Runner path owns too much loop/tool/session/tracing behavior for NexusLoop; only lower-level controlled usage remains viable.

## Authority Boundary

- SDK session != NexusLoop durable memory.
- SDK trace != NexusLoop event ledger.
- SDK approval != NexusLoop authority.
- SDK tool execution != NexusLoop tool execution.
- SDK agent loop != NexusLoop Commander run controller.

## 9W1 Recommendation

Build a NexusLoop-owned one-step model adapter boundary using AI SDK Core transport first, with Commander tool execution/kernel state remaining entirely in NexusLoop.

## Deterministic Result Hash

519019cade20bc0d0a0f4c9f4653d48b1f96e058ad7250975dc1b7a28622257f
