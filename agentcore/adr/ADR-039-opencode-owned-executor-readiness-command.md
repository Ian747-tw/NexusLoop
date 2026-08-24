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

The readiness entry is dispatched before ordinary OpenCode bootstrap. It does not create global directories, migrate the database, refresh the models catalog, install or execute plugins, initialize provider SDKs, or make a model request. It reads a build-pinned catalog snapshot and bounded local config/auth state. Ordinary config is validated against the committed OpenAPI schema generated from `Config.Info`; file auth uses the schema shared with `Auth.Info`. This keeps schema acceptance complete without importing side-effecting services. Configured model aliases inherit status from the same earlier catalog or configured target used by normal provider construction. Dynamic plugin files, including symlinked JavaScript and TypeScript entries, non-bundled provider packages, remote configuration, custom catalog, and provider-specific discovery authority produce `unknown` rather than being executed or ignored. `OPENCODE_PURE` suppresses external configured and discovered plugin authority exactly as normal plugin startup does.

Credential values and source details remain inside OpenCode. Valid built-in OpenAI OAuth refresh authority can establish `connected`, but model availability is filtered through the same code-owned Codex OAuth model predicate used by normal provider initialization. OAuth mechanisms without equally exact offline semantics remain `unknown`. The observation contains only exact request identity, `available|unavailable|unknown`, `connected|disconnected|unknown`, and a deterministic credential-free evidence ID.

The bounded remote-configuration check resolves the same effective database path as OpenCode: an exact `OPENCODE_DB` override, the standard database for release channels or `OPENCODE_DISABLE_CHANNEL_DB`, and otherwise the sanitized channel-specific database. An in-memory database cannot be observed by the separate command and therefore yields incomplete evidence rather than an absent-account claim.

Configuration loading mirrors the pinned `ConfigPaths` precedence for project JSON/JSONC files and nested `.opencode` directories. Deprecated `theme`, `keybinds`, and `tui` keys are removed before server-config validation, matching normal normalization. Presence of the mutating legacy global TOML migration source makes the bounded read-only observation incomplete; readiness never performs that migration.

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
