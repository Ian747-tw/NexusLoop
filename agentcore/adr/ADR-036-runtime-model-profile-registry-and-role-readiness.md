# ADR-036: Runtime Model-Profile Registry And Role Readiness

Status: Accepted for Branch 9W4B1.

## Context

ADR-035 defined immutable connections, profiles, role bindings, static Commander
conformance, and static Executor provider mappings without runtime activation.
Runtime activation must preserve those pure projection hashes while keeping
Commander connector credentials and OpenCode-owned Executor observations in
separate authority domains.

OpenCode has many model ingresses: global `config.model`, CLI/session model
arguments, agent and command overrides, auxiliary small/title/summary/
compaction models, subagents, recent defaults, `provider.list`, `models.dev`,
plugins, packages, environment authentication, and `auth.json`. None is a safe
replacement for NexusLoop selection authority. The verified narrow primary
run seam is the explicit `opencode run --model provider/model` argument.

## Decision

1. RuntimeServer may own one immutable `ModelProfileRuntimeRegistry` built only
   from already validated, detached, deeply frozen ADR-035 snapshots.
2. Registry construction revalidates role projections and stores a detached,
   frozen snapshot. Missing role bindings remain unconfigured and never fall
   back to the other role.
3. Selection hashes remain independent of readiness. Role readiness has its
   own versioned semantic hash and treats unavailable evidence as unknown, not
   ready.
4. Existing validated `NXL_COMMANDER_INVESTIGATION_*` configuration is adapted
   deterministically to one Commander-only compatibility registry. Compatibility
   identifiers use non-secret connector/protocol/provider/model authority and
   never credential values or environment names.
5. Explicit registry authority and legacy Commander environment authority are
   mutually exclusive. With an explicit registry, direct provider fields are
   exact assertions and cannot override selection.
6. Commander readiness composes the existing configured-connector readiness.
   An injected test adapter is not connector, credential, or conformance
   evidence. Commander code does not read OpenCode config, auth, catalog,
   provider services, plugins, or `auth.json`.
7. Executor readiness uses a separate role-owned resolver returning only a
   bounded observation for the exact projection hash, provider, model, and
   opaque credential-binding ID. Availability and connection must both be
   observed before readiness is true. The observation cannot create provider
   mapping or selection authority.
8. When an Executor selection is active, caller provider/model values are
   assertions. OpenCode launch readiness rejects disagreement and requires
   exact current Executor readiness.
9. The selected Executor model is supplied only to the primary tactical run as
   one `--model provider/model` argument. Existing `--model` or `-m` arguments
   conflict and fail closed. Global/user configuration and auxiliary models
   remain untouched.
10. The opaque credential-binding ID identifies authority only. Commander and
    Executor resolvers remain separate; equal IDs do not imply shared storage,
    shared secret objects, or cross-role authorization.

## Security Properties

- Registry inputs require own enumerable data properties, plain frozen
  snapshots, dense arrays, no symbols/accessors/custom prototypes, and no live
  or revoked proxies.
- Readiness observations are exact-key, bounded, redacted, detached data.
- No credential value, environment name, URL, header, auth artifact, package,
  plugin, callback, fetch function, or provider object enters model authority,
  hashes, events, errors, or launch previews.
- Secret rotation behind an unchanged opaque binding may change readiness
  evidence but does not change selection hashes.
- OpenCode catalog/auth/config observations cannot authorize Commander.

## Consequences

9W4B1 activates an internal RuntimeServer registry and exact primary Executor
launch projection. It adds no persistent model configuration, hot reload,
command, CLI/TUI selector, provider discovery, provider execution protocol,
fallback, or upstream edit. Existing 9W4A Commander execution and recovery
identity remain unchanged.

9W4C adds native Gemini `generateContent` through this authority without
changing Executor selection or readiness. 9W4D adds OpenAI Responses and the
verified compatibility matrix, and 9W4E owns first-run setup and role-model
selection UX. External research MCP remains post-v1.

`resume_supported=false`, `provider_tool_loop_enabled=false`, and
`external_read_execution_enabled=false` remain unchanged.
