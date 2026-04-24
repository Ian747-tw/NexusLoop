# M1 Checklist

## Phase M1: OpenCode Fork Integration

### M1.1 — Fork Setup (Step 1)
- [ ] **1.1** Vendor OpenCode at v1.14.22 into `agentcore/upstream/` via git subtree add
- [ ] **1.2** Identify server package; document UPSTREAM_MAP.md
- [ ] **1.3** Create `agentcore/server-fork/` overlay workspace with path aliases
- [ ] **1.4** Write `scripts/rebase-upstream.sh`

### M1.2 — IPC Protocol (Step 2)
- [ ] **2.1** Define `PROTOCOL.md` with all 9 message types
- [ ] **2.2** Write protocol contract tests (Python↔TS↔Python round-trip)

### M1.3 — Tool Dispatch Gate (Step 3)
- [ ] **3.1** Implement `gated-dispatch.ts` — synchronous policy gate, 5s timeout, fail-closed
- [ ] **3.2** Implement fast-path for read-only tools (`read_file`, `glob`, `grep`)
- [ ] **3.3** Adversarial fuzz test: 10,000 random tool calls, 0 bypasses

### M1.4 — Intervention Hook (Step 4)
- [ ] **4.1** Implement `intervention-hook.ts` — 12-verb algebra from INTERVENTION_ALGEBRA.md
- [ ] **4.2** Safe-point scheduler in `cycle-driver.ts`

### M1.5 — Capsule/Session Wiring (Step 5)
- [ ] **5.1** Implement `capsule-session.ts` — delegate compaction to nxl, preserve detector
- [ ] **5.1a** Add `CompactRequest`/`CompactResponse` to PROTOCOL.md; contract tests
- [ ] **5.1b** Wire Python `nxl_core.capsule.compact.{soft_trim, hard_regen, clear_handoff}` as responders
- [ ] **5.2** Cache hit rate verification (≥80% on turns 2+ for anthropic)

### M1.6 — Cycle Driver (Step 6)
- [ ] **6.1** Implement `cycle-driver.ts` — owns turn loop, emits events at lifecycle points

### M1.7 — Python Client (Step 7)
- [ ] **7.1** Implement `client-py/process.py` — spawn, health check, graceful shutdown, restart on hang
- [ ] **7.2** Implement `client-py/client.py` — 4 seam APIs (run_cycle, stream_events, inject_intervention, snapshot_session)
- [ ] **7.3** Rewrite `nxl/core/agent_runner.py` as streaming adapter

### M1.8 — run.py Decomposition (Step 8)
- [ ] **8.1** Decompose `nxl/core/run.py` (1436 → ≤80 lines) into `orchestrator/{loop,bootstrap,cycle_adapter,events_bridge}.py`

### M1.9 — End-to-End Verification (Step 9)
- [ ] **9.1** E2E on anthropic, openai, ollama (nxl run --once --dry-run each)
- [ ] **9.2** Synthetic rule violation test (TripwireFired, cycle halts cleanly)
- [ ] **9.3** First rebase drill (<2h, ≤30 lines conflict)

### Exit Gate
- [ ] `test -d agentcore/upstream`
- [ ] `test -f agentcore/PROTOCOL.md`
- [ ] `test -f agentcore/SEAM_CONTRACT.md`
- [ ] `test -f agentcore/INTERVENTION_ALGEBRA.md`
- [ ] `test -f agentcore/LICENSE.OPENCODE`
- [ ] `(cd agentcore/server-fork && bun run typecheck)` passes
- [ ] `mypy --strict agentcore/client-py/ nxl_core/ nxl/` passes
- [ ] `pytest agentcore/tests/ --cov-fail-under=85` passes
- [ ] `python scripts/fuzz-policy-gate.py 10000` — 0 bypasses
- [ ] `python scripts/test_compaction_flow.py` — bounded
- [ ] `nxl run --once --provider anthropic --dry-run` passes
- [ ] `nxl run --once --provider openai --dry-run` passes
- [ ] `nxl run --once --provider ollama --dry-run` passes
- [ ] `test "$(wc -l < nxl/core/run.py)" -le 80`
- [ ] `bash scripts/rebase-upstream.sh --dry` passes

## User-Simulation E2E Tests (phase_m1)
- [ ] User-simulation E2E tests for this phase's features written, tagged `phase_m1`, passing
- [ ] Manually verified the feature by following README instructions on a fresh sandbox (not just running tests)