# 9W4E Scope Questions

All authority-affecting questions are resolved from the base source.

## What is durable authority?

One append-only `runtime_model_setup_committed` event in `.nxl/events.jsonl`.
The event contains exact built-in recipe references, semantic hashes, a
contiguous revision, and the prior hash. Startup reconstructs and fully
revalidates the ADR-035 configuration from those code-owned recipes. Projection
rejects malformed, duplicate, truncated,
unknown-version, or hash-invalid records.

## How is startup activation possible without hot reload?

Launch construction projects setup records before constructing RuntimeServer.
The resulting 9W4B1 registry is immutable for that process. A commit made by a
running server is pending for the next process start; the active registry is
never replaced in place.

## How are connector and credential authority kept separate?

Commander recipes contain only code-owned non-secret execution assertions:
transport, provider, connector ID, model, capability booleans, and hard limits.
Connector URL/header/credential source remains in
`ExternalApiConnectorRegistry` and `ExternalApiRequestService`. Setup events do
not contain those values. Missing connector credentials produce blocked
readiness without invalidating a safe selection.

## Which Commander recipes are selectable?

Only exact native-model contracts already proven on the base:

- Anthropic Messages: `claude-sonnet-4-5-20250929`;
- Google Generative AI: `gemini-2.5-flash`;
- OpenAI Responses: `gpt-4.1-mini`.

OpenAI-compatible Chat Completions remains a verified protocol family but has
no single code-owned endpoint/model onboarding recipe, so it is not offered.
The compatibility matrix cannot create setup authority.

## Which Executor choices are selectable?

The same three exact provider/model pairs are offered as bounded built-in
choices under the static Executor provider mapping. This branch does not add
catalog discovery. Executor means only the primary tactical `--model` seam.

## What happens when both roles choose the same model?

The candidate records the same provider/model intent through two explicit role
choices and two independent role bindings. Role-owned credential authority and
readiness remain separate; equal opaque credential-binding IDs, if introduced
by a future code-owned recipe, would not share a resolver or secret.

## How do authority sources interact?

Persisted setup, an explicitly injected runtime registry, and legacy Commander
environment authority are pairwise exclusive. Any simultaneous presence
blocks startup. They are never merged or prioritized.

## Does the default fake/real client policy change?

No. `NXL_RUNTIME_CLIENT` retains its current behavior. Production proof uses
the existing real-client setting and RuntimeServer path.

## Is a controlled restart automatic?

No active workload is silently restarted. Commit reports
`restart_required=true`. First-run headless/user flow cleanly shuts down and a
subsequent invocation activates the committed setup. Later changes follow the
same staged-next-start rule.

## How is production Executor readiness observed?

The prior injected-only resolver was insufficient for production launch. 9W4E
adds a process-isolated OpenCode-side observation protocol. Runtime sends the
already-selected exact Executor projection; the child consults the pinned
OpenCode `ModelsDev`, `Config`, and `Auth` services and emits only exact identity plus
`available|unavailable|unknown` and `connected|disconnected|unknown`.
Runtime validates identity and computes the credential-free evidence ID.

The public `provider.list` route is not used because its `connected` list can
include configured providers without proving a usable credential source. The
child checks model availability and credential-source presence independently;
only built-in `anthropic`, `google`, and `openai` credential observations can
be definitive. Missing or incomplete catalog state remains `unknown`.

The observer executable and arguments are fixed by NexusLoop to the checked-in
OpenCode-side child through a checked-in empty Bun configuration, so project
preloads cannot run. `NXL_OPENCODE_EXECUTOR_READINESS_COMMAND` and
`NXL_OPENCODE_EXECUTOR_READINESS_ARGS_JSON` are rejected; environment or CLI
input cannot replace the production observer. Direct process injection exists
only inside package-internal unit tests for malformed-output and lifecycle
adversaries.

The observer is not discovery authority. It cannot return choices, change a
profile, create a mapping, authorize Commander, or select fallback. Its process
is registered before the first await, bounded by timeout/output/concurrency,
cancelled and drained during shutdown, and freshly invoked by the launch gate.
An injected resolver remains a package-internal test seam and is never
constructed from production environment configuration.

## How does a shared exact model remain usable by both roles?

The Runtime capability registry derives role eligibility from the two immutable
selection projections, not from readiness evidence. If Commander and Executor
select the same exact provider kind and model, Runtime creates one combined
context-capability view with both roles while preserving the Commander limits.
Different selections retain separate role capabilities. This does not change
either projection hash, conformance, mapping, credential authority, or
readiness result.
