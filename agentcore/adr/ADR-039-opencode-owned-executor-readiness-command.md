# ADR-039: OpenCode-Owned Executor Readiness Command

Status: Accepted

## Context

9W4B1 defines an Executor selection projection and an observation-only readiness contract. The first 9W4E attempt invoked TypeScript under `agentcore/upstream` from Runtime. That path worked only when a developer checkout already had undeclared upstream dependencies installed. A detached exact-head checkout failed the historical gate, proving that source execution was not a production boundary.

Runtime also cannot reproduce OpenCode's catalog, configuration, plugin, and authentication semantics without creating duplicate authority and drift.

## Decision

The pinned OpenCode CLI packages an internal command:

```text
opencode nexusloop executor-readiness-v1
```

The command accepts one bounded versioned JSON assertion on stdin and emits one bounded versioned observation on stdout. It reports only the exact requested provider/model availability and credential connection status. It never returns alternatives and therefore cannot select, normalize, recommend, or authorize a model.

The readiness entry is dispatched before ordinary OpenCode bootstrap. It does not create global directories, migrate the database, refresh the models catalog, install or execute plugins, initialize provider SDKs, or make a model request. It reads a build-pinned catalog snapshot and bounded local config/auth state. Ordinary config is validated against the committed OpenAPI schema generated from `Config.Info`; file auth uses the schema shared with `Auth.Info`. This keeps schema acceptance complete without importing side-effecting services. Dynamic plugin, remote configuration, custom catalog, and provider-specific discovery authority produce `unknown` rather than being executed or ignored.

Credential values and source details remain inside OpenCode. Valid built-in OpenAI OAuth refresh authority can establish `connected`; OAuth mechanisms without equally exact offline semantics remain `unknown`. The observation contains only exact request identity, `available|unavailable|unknown`, `connected|disconnected|unknown`, and a deterministic credential-free evidence ID.

The native package build uses the repository's pinned catalog fixture and Bun 1.3.13. The upstream workspace pins the previously locked `ghostty-web` revision instead of resolving a moving branch during frozen install.

## Consequences

- A future Runtime resolver must invoke the same packaged executable used for Executor launch and revalidate every identity field.
- Runtime must own timeout, cancellation, output cap, subprocess drain, and launch gating.
- OpenCode observations remain evidence. NexusLoop model profiles and Executor provider mapping remain selection authority.
- Missing, partial, dynamic, malformed, or interrupted evidence is never ready.
- PR #132 remains frozen. 9W4E must be reworked on this packaged boundary after the prerequisite merges.
- Commander does not import or invoke this command and gains no OpenCode auth or catalog authority.

## Non-Goals

This ADR does not implement Runtime resolver integration, first-run setup, TUI model selection, credential mutation, provider discovery, fallback, or model execution.
