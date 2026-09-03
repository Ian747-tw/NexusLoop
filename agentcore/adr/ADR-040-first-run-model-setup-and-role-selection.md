# ADR-040 - First-run model setup and role selection

## Status

Accepted for Branch 9W4E.

## Context

ADR-035 defines credential-free model connections, profiles, and independent
Commander/Executor bindings. ADR-036 activates those snapshots in one immutable
RuntimeServer registry. ADR-037 and ADR-038 add native Gemini and OpenAI
Responses. None provides durable user selection or a first-run product flow.

Model setup must not turn compatibility evidence, OpenCode discovery, or TUI
state into provider authority. It also cannot mutate the active registry or
store connector credentials.

## Decision

1. Add the code-owned `nexusloop_model_setup_catalog_v1`. It offers exactly
   three Commander recipes backed by static conformance and three primary
   Executor recipes backed by the static provider mapping: Anthropic Claude
   Sonnet 4.5, Google Gemini 2.5 Flash, and OpenAI GPT-4.1 mini. Either role may
   remain explicitly unconfigured.
2. RuntimeServer reconstructs a complete ADR-035 candidate from exact recipe
   IDs. The compatibility matrix, OpenCode catalog/authentication, and caller
   provider/model assertions cannot add recipes or conformance.
3. Preview is read-only and returns the current revision plus candidate,
   configuration, and role-projection hashes. Confirmation requires the exact
   revision, candidate hash, bounded human identity, and
   `CONFIRM_MODEL_SETUP`.
4. The sole durable transition is
   `runtime_model_setup_committed` under
   `nexusloop_model_setup_event_v1`. Its allowlist contains recipe IDs,
   contiguous revision linkage, semantic hashes, bounded human identity, and
   time. It contains no complete configuration, connector URL, header,
   credential reference name/value, environment name, provider object, or
   OpenCode authentication state.
5. `EventStore.appendIfLatestKind` provides atomic expected-kind comparison
   without allowing unrelated journal traffic to starve setup confirmation.
   Exact duplicate confirmation is idempotent; stale, different, malformed,
   truncated, duplicate-revision, unknown-version, or hash-invalid authority
   fails closed.
6. Startup projects the append-only event stream before RuntimeServer
   construction and builds the existing immutable ADR-036 registry. Persisted
   setup, explicit registry/provider authority, and legacy Commander
   environment authority are mutually exclusive.
7. A commit never replaces the active registry. It is pending for the next
   process start. Setup writes are RuntimeServer-owned, acquire or reuse the
   run lock, and drain before `runtime_shutdown`.
8. Commander and Executor readiness remain independent evidence. A safe
   selection may persist while connector or credential readiness is blocked or
   unknown. Neither role falls back to the other.
9. Production Executor readiness invokes the 9W4E0 command `opencode
   nexusloop executor-readiness-v1`. Runtime sends only the exact immutable
   Executor projection. The packaged OpenCode command checks pinned
   catalog/config/plugin/auth semantics, discards unrelated identities and raw
   state, and returns only matching tri-state evidence. Runtime owns
   timeout, output bounds, concurrency, identity validation, cancellation, and
   shutdown drain. The observation cannot select, map, normalize, recommend,
   fall back, or authorize Commander.
   Production uses the exact validated OpenCode executable configured for
   Executor launch and fixes readiness arguments internally. No separate
   executable, source module, preload, dependency path, or environment
   assertion may replace it; process injection is package-internal test
   machinery only.
10. OpenTUI extends the existing initialization/onboarding surface with
   keyboard selection, preview, separate explicit confirmation, current and
   pending hashes, blocked readiness, cancellation, and restart-required
   rendering. Cached UI state is never mutation authority.
11. Executor selection still reaches only the primary tactical OpenCode run as
    one exact `--model provider/model` argument. Auxiliary models and OpenCode
    global/user configuration are unchanged.
12. The unset TUI runtime-client mode is `auto`: legacy fake behavior is
    limited to pre-spec onboarding, while an approved project constructs the
    real RuntimeServer client. Explicit fake mode remains non-production
    fixture authority and cannot prove a durable setup commit.

## Consequences

First-run and later model selection now have one credential-free, append-only,
restart-only authority path. Connector construction and both role-owned
credential resolvers remain separate. Custom endpoints, arbitrary model
discovery, credentials in TUI state, OpenCode `auth.json` mutation, hot reload,
fallback, retry, streaming, auxiliary model selection, MCP, proposals,
governance, and mutation remain out of scope.

OpenCode's public provider-list response is not Runtime authority and is not
crossed into RuntimeServer. The packaged command performs no provider execution
request, retry, mutation, or catalog refresh. Observation failure,
partial state, timeout, truncation, cancellation, or shutdown remains unknown.

`resume_supported=false`, `provider_tool_loop_enabled=false`, and
`external_read_execution_enabled=false` remain unchanged.
