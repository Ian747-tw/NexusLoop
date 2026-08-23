# Commander Provider Configuration

Commander provider authority is explicit RuntimeServer configuration. OpenCode
provider settings do not authorize Commander.

## Internal Model-Profile Contract

Branch 9W4B0 defines the internal configuration vocabulary, 9W4B1 activates
validated snapshots in an immutable RuntimeServer registry, and 9W4E adds an
append-only OpenTUI setup transaction over that same vocabulary. A model connection contains only bounded
provider/account authority identifiers, a model profile selects an exact model,
and independent role bindings select profiles for `commander` and `executor`.
The Executor role means the primary tactical OpenCode model only, not small,
title, summary, compaction, agent, command, or subagent models.

One profile may be selected for both roles, but this shares only selection
intent. Commander still requires a NexusLoop connector and exact static
conformance entry. Executor catalog presence, `provider.list` connectivity,
OpenCode configuration, plugins, environment discovery, and `auth.json` never
authorize Commander.

The validated `NXL_COMMANDER_INVESTIGATION_*` path is adapted to a deterministic
Commander-only compatibility registry while retaining the 9W4A connector and
readiness path. Explicit registry authority and legacy environment authority
cannot be merged. Under explicit authority, direct provider fields are exact
assertions; mismatches block. An injected Commander adapter is not connector,
credential, or conformance readiness evidence.

Executor availability and connection are resolved independently for the exact
selected projection. These observations cannot create provider mapping or
selection authority. A ready selection is supplied only to the primary
tactical `opencode run --model provider/model` seam. Conflicting existing
primary-model arguments block, while small, title, summary, compaction,
command, agent, and subagent model settings remain untouched.

Executor projection also requires a static NexusLoop provider-mapping entry
that binds the exact OpenCode provider ID, including any explicit aliases, to
the connection's provider kind. Its policy identity is part of the Executor
projection hash. OpenCode discovery and authentication cannot populate this
registry.

The kernel accepts no endpoint, base-URL, header, package, plugin, provider
option, environment-variable, OAuth, credential, or catalog authority field.
An exact model ID is inert external identifier data and is never parsed as an
endpoint, package, protocol, or capability; values such as URI-like catalog IDs
cannot create those absent authority fields. Hashes exclude display labels and
secret rotation behind an unchanged opaque credential authority, while exact
model, credential authority, and role-specific mappings are semantic.

## First-Run Setup Recipes

The v1 setup catalog is fixed code-owned authority. Commander offers only:

- Anthropic Messages with `claude-sonnet-4-5-20250929`;
- Google Generative AI with `gemini-2.5-flash`;
- OpenAI Responses with `gpt-4.1-mini`.

The primary Executor offers those same exact provider/model intents under the
static Executor mapping. Each role may remain unconfigured. OpenAI-compatible
custom endpoints are not offered because protocol compatibility alone does not
identify one exact endpoint/model conformance recipe.

Setup persists no connector URL, header, credential environment name/value,
provider object, OpenCode auth, or catalog observation. Commander connectors
retain the code-owned recipe connector IDs `anthropic-main`, `google-main`, and
`openai-main`; their actual connector/credential authority remains separately
configured and may leave readiness blocked. Executor readiness remains an
independent OpenCode-owned observation. The process-isolated observer receives
only the selected Executor identity and returns bounded availability and
credential-connection tri-states. It does not expose provider lists or auth
details, perform model requests, refresh catalogs, or authorize Commander. A
commit is pending until the next clean RuntimeServer start and never hot-reloads
active execution.
The production observer command and argument are code-owned. Runtime rejects
the former environment override keys; custom observer processes remain only a
package-internal unit-test seam.

## Support Taxonomy

- **Verified native protocols:** Anthropic Messages through
  `anthropic_messages_connector` and `@ai-sdk/anthropic@4.0.15`; Google
  Generative AI unary `generateContent` through
  `google_generative_ai_connector` and `@ai-sdk/google@4.0.15`; OpenAI
  Responses through `openai_responses_connector` and
  `@ai-sdk/openai@4.0.15`.
- **Verified OpenAI-compatible providers:** endpoints with deterministic
  NexusLoop conformance coverage through `openai_compatible_connector`.
- **Compatible but unverified endpoints:** not supported merely because they
  advertise an OpenAI-compatible API; operators must establish conformance.
- **Unsupported or deferred:** dynamic provider packages, ambient credentials,
  OAuth/browser flows, managed agents, retained runs, server tools, beta
  features, streaming connectors, model discovery, fallback, and failover.

## Shared Provider Fields

Provider activation uses the existing `NXL_COMMANDER_INVESTIGATION_*`
variables. Configuration identifies the transport, provider, connector, model,
enabled phases, limits, and explicit capability claims. Base URL and credential
references belong only to `NXL_EXTERNAL_API_CONNECTORS_JSON`.

The configured connector must own exact host, method, timeout, response-size,
and credential policy. Provider execution additionally requires active mode, a
ready RuntimeServer, the held run lock, and matching model capability.

## Anthropic Messages

Use:

```text
NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND=anthropic_messages_connector
NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND=anthropic
NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA=0
```

The connector base is normally `https://api.anthropic.com/v1`; NexusLoop
derives `/messages`. Its connector must allow only `POST`, allow exactly its
base host, define no default headers, and contain exactly one environment
credential reference injected as an unprefixed `x-api-key` header.

NexusLoop sends `anthropic-version: 2023-06-01`. It rejects bearer auth,
`anthropic-beta`, alternate paths, query parameters, arbitrary headers,
provider options, and Anthropic server-side tools. The credential environment
name and value are not exposed in readiness, compatibility hashes, audits,
journal records, or TUI state.

Native Anthropic JSON-schema output is not claimed. Commander uses its bounded
JSON fallback when a phase requires structured text. Client retries remain
zero.

## Google Generative AI

Use:

```text
NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND=google_generative_ai_connector
NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND=google
NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA=0
```

The connector base is normally `https://generativelanguage.googleapis.com/v1beta`.
NexusLoop derives exactly `/models/<model>:generateContent`, requires `POST`,
and accepts only a single safe ASCII model segment. The connector owns exactly
one unprefixed `x-goog-api-key` credential reference. Query credentials,
bearer auth, cookies, arbitrary headers, ambient Google/OpenCode auth, and URL
or path authority in the model ID are rejected.

The transport is stateless and unary. It permits bounded text and NexusLoop
client function tools only. Search, URL context, code execution, media, Files,
cache/thinking/safety authority, provider options, multiple candidates,
Interactions, streaming, retained state, retries, and all Google server tools
are rejected. Function-call thought signatures are carried only in transient
in-memory continuation state for matching live turns and are never persisted or
hashed. Native Gemini turn-complete recovery renders the bounded checkpoint
tool exchange as fresh summary context instead of replaying a native function
call that would require unavailable transient metadata. Existing
OpenAI-compatible and Anthropic recovery message envelopes remain unchanged.
Native Gemini JSON-schema output is not claimed; bounded NexusLoop JSON
fallback remains in use.

## OpenAI Responses

Use:

```text
NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND=openai_responses_connector
NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND=openai
NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA=0
```

The connector base is normally `https://api.openai.com/v1`; NexusLoop derives
exactly `/responses` and requires `POST`. The connector defines no default
headers and owns exactly one environment credential reference injected as
`Authorization` with the exact `Bearer ` prefix. The SDK receives only a fixed
non-secret sentinel. Ambient OpenAI/OpenCode credentials, organization/project
headers, cookies, query authentication, alternate paths, and caller headers are
rejected.

The transport is unary and stateless. It forces `store=false` and permits only
bounded messages, text, ordinary NexusLoop client functions and results,
generic tool choice, output limits, and proven sampling fields. Previous-
response chaining, conversations, background execution, retrieval, prompt
templates, include expansion, service-tier authority, hosted tools, reasoning
continuation, streaming, retries, and fallback are rejected. Successful raw
responses are reduced to bounded text, refusal, client function calls, and
usage before SDK normalization; response IDs and provider metadata are
discarded. Documented inert envelope metadata is strictly bounded and discarded.
The verified non-reasoning model family is `gpt-4.1-mini` and its exact dated
snapshots; reasoning-model IDs are rejected before readiness. Native Responses
JSON-schema output is not claimed.

Commander conformance policy v3 is required for native Responses and also
admits every protocol valid under v1/v2. The pure compatibility matrix records
the four executable protocol contracts as static evidence only; it cannot
select a model, establish readiness, resolve credentials, or authorize an
endpoint.

## OpenAI-Compatible Transport

`openai_compatible_connector` retains the existing `/chat/completions`
contract, connector-managed sentinel credential bridge, response
normalization, and recovery identity. Gemini support does not reinterpret or
migrate existing OpenAI-compatible records.

## Retained Boundaries

Provider requests remain internal to configured investigations and approved
one-shot recovery. Broad `provider_tool_loop_enabled` remains false. External
MCP/research execution remains deferred after v1, and proposal/governance
authority remains in later phases.
