# Commander Provider Configuration

Commander provider authority is explicit RuntimeServer configuration. OpenCode
provider settings do not authorize Commander.

## Internal Model-Profile Contract

Branch 9W4B0 defines an internal configuration vocabulary; it is not yet a CLI,
TUI, or RuntimeServer feature. A model connection contains only bounded
provider/account authority identifiers, a model profile selects an exact model,
and independent role bindings select profiles for `commander` and `executor`.
The Executor role means the primary tactical OpenCode model only, not small,
title, summary, compaction, agent, command, or subagent models.

One profile may be selected for both roles, but this shares only selection
intent. Commander still requires a NexusLoop connector and exact static
conformance entry. Executor catalog presence, `provider.list` connectivity,
OpenCode configuration, plugins, environment discovery, and `auth.json` never
authorize Commander. Role readiness and credential resolution are deferred to
9W4B1.

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

## Support Taxonomy

- **Verified native protocols:** Anthropic Messages through
  `anthropic_messages_connector` and `@ai-sdk/anthropic@4.0.15`.
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

## OpenAI-Compatible Transport

`openai_compatible_connector` retains the existing `/chat/completions`
contract, connector-managed sentinel credential bridge, response
normalization, and recovery identity. This branch does not reinterpret or
migrate existing OpenAI-compatible records.

## Retained Boundaries

Provider requests remain internal to configured investigations and approved
one-shot recovery. Broad `provider_tool_loop_enabled` remains false. External
MCP/research execution remains deferred after v1, and proposal/governance
authority remains in later phases.
