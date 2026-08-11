# Branch 9W4A Threat Model

## Assets And Authority

RuntimeServer owns provider selection, connector identity, credentials,
endpoint policy, request bounds, Commander tools, audit settlement, lifecycle,
and recovery authority. AI SDK owns only one request's protocol encoding and
response decoding.

## Threats And Required Controls

| Threat | Control |
| --- | --- |
| Protocol confusion | Closed transport union; provider kind and protocol must agree. |
| Endpoint escape | Runtime-derived exact origin and `/messages`; POST only; no query, fragment, or URL credentials. |
| Credential escape | Fixed sentinel in SDK; exact `x-api-key` stripping; real credential injected only by request service. |
| Header smuggling | Exact header allowlist; reject authorization, beta, cookies, credential-like, and arbitrary headers. |
| Provider feature escalation | Strict body schema rejects server tools, MCP, files, containers, caching, thinking, service tiers, and unknown authority fields. |
| Hidden retries | `maxRetries=0`; bridge and audit require one request per model step. |
| False provider success | Model output is trusted only after one matching durable audit outcome. |
| Secret/error persistence | Redact and cap before SDK propagation, audit, result, journal, or TUI. |
| Cancellation ambiguity | Abort reaches request service/transport; post-boundary uncertainty is not converted into known failure or retry authority. |
| Shutdown race | Runtime owns work before external await and drains audit/journal work before `runtime_shutdown`. |
| Recovery protocol drift | Execution envelope binds protocol, endpoint, package/adapter, request policy, capability, connector, limits, tools, and audit policy. |
| Ambient OpenCode authority | Commander factory accepts only RuntimeServer's static provider config. |

## Trust Boundaries

Provider responses are untrusted transport data. NexusLoop validates the SDK
normalization and model-produced tool arguments independently. Neither response
metadata nor provider-advertised tools can create Commander authority.

