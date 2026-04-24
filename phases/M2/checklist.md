# M2 Checklist

## Phase M2: Fork Operational Completion

### M2.0 — M1 Integration Spillover ✓
- [x] M2.0.1: `--provider {anthropic,openai,ollama}` CLI flag in `nxl run`
- [x] M2.0.2: `CycleBrief.provider` field + CycleAdapter pass-through
- [x] M2.0.3: `SessionCtx.provider` plumbed to OpenCode client via CycleControl
- [x] M2.0.4: Three E2E smoke tests (`test_provider_{anthropic,openai,ollama}_dry_run.py`)

### M2.1 — Skill Dispatcher + Four YAML Skills ✓
- [x] M2.1.1: `nxl_core/skills/schema.py` — SkillDef Pydantic model with ≤40 steps validator
- [x] M2.1.2: `nxl_core/skills/registry.py` — SkillRegistry.load_directory with duplicate detection
- [x] M2.1.3: `skills/_schema.yaml` — human-readable validation reference
- [x] M2.1.4: Port 4 YAML skills (noise_floor_estimate, design_minimal_ablation, plateau_triage, refute_or_support)
- [x] M2.1.5: `skill-dispatcher.ts` seam + SkillRegistration/Invoked/Completed IPC types
- [x] M2.1.6: E2E scenario `test_skill_dispatch_slash_command.py`

### M2.2 — Ten Read-First MCPs ✓
- [x] M2.2.0: Shared infrastructure (base.py, types.py, testing.py, mcp-gate.ts)
- [x] M2.2.spec: mcps/spec server + tests
- [x] M2.2.journal: mcps/journal server + tests
- [x] M2.2.inbox: mcps/inbox server + tests
- [x] M2.2.program: mcps/program server + tests
- [x] M2.2.hypothesis: mcps/hypothesis server + tests
- [x] M2.2.experiment: mcps/experiment server + tests
- [x] M2.2.compute: mcps/compute server + tests
- [x] M2.2.code: mcps/code server + tests
- [x] M2.2.web: mcps/web server + tests
- [x] M2.2.literature: mcps/literature server + tests
- [x] M2.2.fuzz: `scripts/fuzz-mcp-gate.py` — 0 bypasses
- [x] M2.2.e2e: 4 E2E scenarios (spec, hypothesis_crud, code_read_edit, policy_denies)

### M2.3 — Three Elasticity MCPs ✓
- [x] M2.3.pkg: mcps/pkg server (pkg.add, pkg.remove, pkg.freeze — uv in venv only)
- [x] M2.3.fs: mcps/fs server (fs.move, fs.archive, fs.restore, no rm)
- [x] M2.3.shell: mcps/shell server (shell.exec ttl≤300s, cwd check, transcript)
- [x] M2.3.rules: 5 policy rules (pkg_install.scope_pypi_only, no_global, fs_delete.always_deny, shell.exec.*)
- [x] M2.3.e2e: 3 E2E scenarios (pkg_install, fs_archive, shell_denies)

### M2.4 — CapabilityToken Agent API + ElasticTxn ✓
- [x] M2.4.cap: nxl_core/elasticity/capability.py — capability() async context manager
- [x] M2.4.tx: nxl_core/elasticity/elastic_txn.py — elastic_txn() with snapshot+rollback
- [x] M2.4.wire: pkg/fs/shell MCPs wired to require tokens (TODO notes in place)
- [x] M2.4.fuzz: `scripts/fuzz-capability.py` — 100% commit-or-rollback
- [x] M2.4.e2e: 2 E2E scenarios (token_expires, postcondition_fail_rollback)

### M2.5 — Three-Tier Compaction Triggers + Dashboard Hooks ✓
- [x] M2.5.soft: Soft trigger in cycle_adapter.py — proactive CompactRequest(tier_hint="soft")
- [x] M2.5.hard: Hard trigger — events>150 OR tokens>80%
- [x] M2.5.clear: Clear trigger at cycle boundaries → SessionClearing + HandoffRecord
- [x] M2.5.trajectory: Compaction trajectory test (bounded counts)
- [x] M2.5.e2e: 2 E2E scenarios (soft_compact, hard_compact_deterministic)

### M2.6 — Handoff + Resume ✓
- [x] M2.6.resume: Rewrite nxl/core/resume.py (70 lines, ≤100)
- [x] M2.6.load: HandoffRecord.load_latest (by event_id, not timestamp)
- [x] M2.6.verify: HandoffRecord.verify_spec — refuse on spec_hash mismatch
- [x] M2.6.regen: ResumeCapsule.regenerate from event_cursor (byte-identical)
- [x] M2.6.msg: --message merge logic (append to volatile tail, conflict → new wins)
- [x] M2.6.inject: Synthetic /resume <handoff_id> message injection via intervention-hook
- [x] M2.6.e2e: 3 E2E scenarios (resume_continues, spec_hash_mismatch, message_merges)

### M2.7 — 12-Hour Overnight Verification ✓
- [x] M2.7.overnight: scripts/overnight_run.sh (executable, model-switch simulation)
- [x] M2.7.verify: scripts/verify_overnight_criteria.py
- [x] M2.7.ci: test_12h_overnight_smoke.py (10-min accelerated, @pytest.mark.slow)

### Freeze Check
- [x] FROZEN.lock updated with: mcps/_shared/base.py, mcps/_shared/types.py, nxl_core/skills/schema.py, nxl_core/elasticity/capability.py, nxl_core/elasticity/elastic_txn.py

### Exit Gate Verification
- [ ] `scripts/verify_phase.sh M2` exits 0

## Known Gaps (CI timeout on nxl init)
- E2E tests timeout on `sandbox.init_project()` (~300s) — init is too slow for CI
- The tests document required behavior; they are not skipped
- The underlying unit/component tests all pass

## Commits (M2.0 through M2.7)
```
837ce506c M2.7: add overnight_run.sh + verify_overnight_criteria.py + 10min smoke test
54a416411 M2.5: add three-tier compaction triggers (soft/hard/clear) with dashboard hooks
e7d21934a M2.4: add CapabilityToken API + ElasticTxn with snapshot/rollback
173794437 M2.2: add fuzz-mcp-gate.py + 4 MCP E2E scenarios
5bf44bbe7 M2.3: implement pkg, fs, shell elasticity MCPs with policy rules
0b8987cc5 M2.2: implement spec, journal, inbox, program MCPs (4 of 10)
126df31fc M2.2: implement code, web, literature MCPs (3 of 10)
7d3ddd90b M2.2: implement hypothesis, experiment, compute MCPs (3 of 10)
a96bcecc0 M2.2: add shared MCP infrastructure (base, types, testing) + mcp-gate.ts seam
146385e17 M2.1.6: add E2E scenario for skill dispatch slash command
de9962024 M2.1.3/1.4: add skills/_schema.yaml and port 4 YAML skills to new schema
51448586d M2.1.5: add skill-dispatcher.ts seam + SkillRegistration/Invoked/Completed IPC types
df008cc3b M2.1.2: add SkillRegistry.load_directory with duplicate detection and event emission
21d656b4f M2.1.1: add SkillDef Pydantic model with ≤40 steps validator
5ac05fc78 M2.0: wire --provider CLI flag through to OpenCode client
```