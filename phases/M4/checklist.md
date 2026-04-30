# M4 Checklist

- [ ] User-simulation E2E tests for this phase's features written, tagged `phase_m4`, passing
- [ ] Manually verified the feature by following README instructions on a fresh sandbox (not just running tests)
- [ ] Re-audit `agentcore/upstream/packages/opencode/src/tool/task.ts` on every upstream rebase until ADR-012 can remove the first-read `ctx.sessionID` interception dependency

### Deferred from P5.0 — server.ts session spawn

server.ts currently initializes seams and waits on stdin but does
not spawn the upstream OpenCode session. Sufficient for lifecycle
integration tests (signal-handling); insufficient for any test that
needs the actual tool-call path.

Required by: subagent-isolation runtime integration (P7),
provider-instrumentation integration (P5+), end-to-end cycle test (P9).

Implementation requires understanding upstream's startup sequence
(probably importing AppRuntime + spawning a Session via its normal
init). Estimate: 1 day.

### Deferred to P7 — subagent-isolation runtime integration

P4.4 shipped the isolation seam (registry, config, wrapper logic)
but P5.4 verification revealed the seam wraps a module-level
TaskTool export that upstream's ToolRegistry never traverses.
The wrapper's logic is correct (verified at unit level); it is
just never invoked in the real runtime path.

Required redesign (P7 work, before second_review goes live):
  - Read upstream's session/processor.ts and ToolRegistry to find
    the actual tool-resolution hook point
  - Determine whether to (a) intercept ToolRegistry registration,
    (b) replace TaskTool via Effect runtime layer, or (c) some
    other mechanism
  - Reimplement initSubagentIsolation to attach at the new hook
  - Restore the strengthened test from this commit (currently
    refactored to wrapper-level only) to its full integration form
  - Verify with secret-token test against real upstream task path

Owner: P7 lead
Required by: second_review subagent activation
Reference: subagent-isolation.ts comment block + ADR-012 Runtime
Integration Gap section

### Validate snapshot performance at scale (P9)

bench_snapshot_replay.py at 10K events shows full≈snapshot≈12ms;
the snapshot strategy's value is unproven at this scale. P9 overnight
run will produce realistic event volumes (100K+); re-run the bench
against that output to validate the architecture pays off in practice.
