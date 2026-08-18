# Branch 9W4B1 Scope Questions

All questions are resolved from source at base
`cb83208620e88b2f87f1f7bc8f4e446bc0ea8f8f`.

## Where is runtime selection authority held?

A package-internal immutable registry owns validated 9W4B0 configuration,
Commander conformance, Executor mapping, and their role projections. Runtime
construction accepts one frozen registry snapshot. It adds no persistence or
mutation surface.

## How does legacy Commander configuration coexist?

`readCommanderInvestigationProviderConfigFromEnv` remains the only parser for
`NXL_COMMANDER_INVESTIGATION_*`. A deterministic compatibility adapter creates
a Commander-only registry from that validated authority. If an explicit model
registry and any legacy Commander environment authority are both present,
launch configuration fails closed. Runtime provider config remains the exact
transport/capability assertion and must equal the registry projection.

## Can legacy authority satisfy static conformance safely?

Yes. The compatibility adapter is a fixed NexusLoop policy over the already
closed 9W4A transport discriminant. Its deterministic conformance entry repeats
the validated provider kind, provider ID, model ID, transport kind, and
connector ID; it cannot add a protocol or infer capability from names.

## How are credentials separated?

The shared opaque `credential_binding_id` is authority identity only.
Commander credential readiness is derived exclusively by composing the
existing connector/provider readiness preview. Executor readiness accepts only
a bounded role-owned observation interface containing exact selection identity
and boolean/unknown availability and connection facts. No secret or auth
artifact crosses either interface.

## Which Executor launch seam is used?

OpenCode `run` defines `--model` as `provider/model` and passes it as the
explicit model to `sdk.session.prompt`. The NexusLoop process launch adapter can
therefore append one runtime-owned `--model <provider>/<model>` argument without
editing upstream or global configuration. Existing model arguments conflict
and fail closed. No agent argument is introduced, so small/title/summary/
compaction/command/agent/subagent selection remains untouched.

## Is a new user-simulation scenario required?

No new public configuration path is added. Legacy Commander behavior remains
compatible and cannot select an Executor profile. Explicit registry activation
is package-internal RuntimeServer composition only. Existing CLI and historical
user simulations remain the regression gate; focused runtime tests exercise
the internal launch projection.
