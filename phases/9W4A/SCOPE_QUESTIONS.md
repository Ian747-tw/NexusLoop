# Branch 9W4A Scope Questions

## Resolved From Repository And Package Evidence

1. **What owns provider authority?** RuntimeServer configuration, the exact
   connector registry entry, capability registry, and recovery execution
   envelope. OpenCode provider configuration is not Commander authority.
2. **What protocols are in scope?** Exactly the existing
   `openai_compatible_connector` and new `anthropic_messages_connector`.
3. **What is shared?** AI SDK one-step execution, message/tool conversion,
   NexusLoop validation, result normalization, audit accounting, cancellation,
   controller sequencing, and recovery persistence.
4. **What is provider-specific?** Built-in SDK provider construction, exact
   endpoint/header/body policy, and SDK-compatible synthetic HTTP errors.
5. **Does the dependency fit?** Registry evidence for
   `@ai-sdk/anthropic@4.0.15` resolves to `@ai-sdk/provider@4.0.3` and
   `@ai-sdk/provider-utils@5.0.10`, matching the pinned `ai@7.0.29` graph. The
   package exposes an explicit custom fetch and native Messages model factory.
6. **How is authentication contained?** AI SDK receives one fixed non-secret
   sentinel. The strict bridge removes only that exact sentinel, and
   `ExternalApiRequestService` injects the one configured `x-api-key` ref.
7. **What Anthropic output contract is claimed?** Native text and client tools.
   JSON-schema support remains false/unknown; NexusLoop JSON fallback remains
   available without beta headers.
8. **How is compatibility preserved?** Existing OpenAI transport identity and
   endpoint policy remain unchanged. Protocol/package/request-policy identity
   is added only to the execution envelope so affected recovery authority
   stales deterministically.
9. **What is the v1 external-research decision?** 9XB remains post-v1 deferred;
   ADR-033 stays Proposed/NO-GO and all placeholders remain registry-only.

## Blocking Questions

None at branch start. Stop if package compilation requires a broad AI SDK
upgrade, strict custom fetch is bypassed, one model step causes multiple HTTP
requests, or deterministic CLI coverage cannot reach the production adapter.

