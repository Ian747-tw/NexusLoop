# Branch 9W4B1 Implementation Brief

## Runtime Registry

Add package-internal registry and readiness modules under
`agentcore/runtime/src/model-configuration/`. Construction requires frozen
validated 9W4B0 snapshots, recomputes role projections, stores detached frozen
state, and exposes no mutation or discovery API.

## Legacy Commander Adapter

Add a pure adapter from validated `CommanderInvestigationProviderConfig` to a
Commander-only model configuration and conformance snapshot. IDs derive from a
fixed policy plus non-secret transport/provider/model/connector authority.
RuntimeServer composes the resulting selection with the existing configured
provider path and `previewCommanderInvestigationProviderReadiness`.

## Role Readiness

Add credential-free readiness DTOs and hashes. Commander maps the existing
readiness checks. Executor uses a separate bounded observation resolver keyed
to exact projection and credential-binding identity. Selection hashes never
include observations, timestamps, credential values, or environment names.

## Executor Launch Projection

Extend the existing launch preview/input adapter contract with an internal
primary-model selection. Runtime-owned launch readiness rejects caller
provider/model mismatch, requires exact Executor readiness, and passes only
`--model <provider>/<model>` to the process launch adapter. Existing model
arguments block. Global config and auxiliary model selectors are untouched.

## Tests

Add red tests for registry hardening, role isolation, legacy mapping/conflict,
readiness truthfulness and hash behavior, Commander/OpenCode import isolation,
exact launch arguments, argument conflicts, and unchanged auxiliary model
state. Run existing 9W4A/9W4B0, Commander recovery, OpenCode launch, CLI, TUI,
and complete historical regressions.

## Documentation

Add ADR-036 and update architecture/provider documentation with implemented
runtime behavior only. No CLI/TUI model selection is claimed.
