# Test Strategy

This document describes the intended validation strategy for the runtime-server
architecture and OpenTUI product shell.

## Test Layers

NexusLoop should maintain five complementary test layers:

- unit
- integration
- end-to-end user simulation
- stress
- benchmark

Each layer answers a different question. None is a substitute for the others.

## Unit Tests

Unit tests validate deterministic local behavior in isolation.

Examples:

- event schema validation
- projection rebuild logic
- spec versioning rules
- policy gate predicates
- parser and extraction post-processing

Unit tests should not pretend to prove whole-system behavior.

## Integration Tests

Integration tests validate contracts between components.

Examples:

- runtime server to projection rebuild flows
- OpenCode lifecycle hook integration
- commander write barriers
- spec backend approval transitions
- event-to-database projection logic

These tests should focus on interface correctness and state transitions rather
than UI realism.

## End-To-End User Simulation

E2E scenarios remain the final local release gate for user-facing behavior.

They should cover:

- first-open initialization
- resume flows
- approval and clarification flows
- spec adjustment through the unified message box
- research search and record inspection
- interrupted-session recovery

The rule remains: if a user can do it, an E2E scenario should simulate it.

## OpenTUI Keyboard Simulation

OpenTUI requires explicit keyboard-driven E2E coverage.

Scenarios should validate:

- navigation between panels
- focus changes
- message entry and submission
- approval selection
- resize behavior for panels
- recovery after blocked or interrupted runtime states

These tests should operate through the real TUI interaction model rather than
module-level shortcuts.

## Stress Tests

Stress tests validate long-running and high-volume behavior.

Examples:

- sustained event emission
- large research registries
- repeated projection rebuilds
- high approval churn
- session resume under long histories

Stress tests help catch degradation and state-drift problems that normal E2E
cases miss.

## Benchmarks

Benchmarks track cost and responsiveness expectations.

Examples:

- OpenTUI startup time
- resume time from large event logs
- projection rebuild throughput
- search latency over research records
- approval round-trip latency

Benchmarks should be treated as product constraints, not vanity metrics.

## CI Versus Release Gate

Default CI and local release validation should remain distinct.

- Default CI should run unit and integration tests, plus any fast non-E2E
  checks that give strong signal.
- User-simulation E2E, especially full OpenTUI keyboard scenarios, should be a
  release-gate suite run locally or in explicitly heavier validation workflows.
- Stress and benchmark suites should run in dedicated lanes, not on every small
  change by default.

This preserves fast developer feedback while keeping the final product gate tied
to realistic behavior.
