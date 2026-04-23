# M0 Checklist — Phase M0.1: Event Log Foundation

## M0.1 Step 1 — Event schema (18 Pydantic event kinds) ✓

## M0.1 Step 2 — EventLog append-only ✓

## M0.1 Step 3 — Deterministic replay ✓

## M0.1 Step 4 — Migrate existing logging modules ✓

---

## M0.2: Research primitives (days 4–7)

### M0.2 Step 1 — Hypothesis with canonical hash

- [ ] **Test written first**: `tests/unit/research/test_hypothesis_hash.py` — two hypotheses with same axis content but reordered keys → same hash
- [ ] **nxl_core/research/hypothesis.py** — `Hypothesis` with `compute_hash()` validator (canonical hash of axis_family, hyperparam_diff sorted, evaluator, dataset_rev)
- [ ] `pytest tests/unit/research/test_hypothesis_hash.py -v` passes
- [ ] `scripts/verify_step.sh M0 5` exits 0
- [ ] Commit: `M0.2.1: Hypothesis with canonical hash for duplicate detection`

### M0.2 Step 2 — Polymorphic Trial (9 kinds)

- [ ] **Test written first**: `tests/unit/research/test_trial.py` — each of 9 kinds round-trips; invalid kind rejected at parse time
- [ ] **nxl_core/research/trial.py** — discriminated union `Trial` with 9 kinds (baseline, ablation, diversification, surrogate, etc.)
- [ ] `pytest tests/unit/research/test_trial.py -v` passes
- [ ] `scripts/verify_step.sh M0 6` exits 0
- [ ] Commit: `M0.2.2: Polymorphic Trial — 9 discriminated union kinds`

### M0.2 Step 3 — Polymorphic Evidence + closure rules

- [ ] **Test written first**: `tests/unit/research/test_evidence.py` — matrix: all 6 evidence kinds × support / refute / inconclusive outcomes
- [ ] **nxl_core/research/evidence.py** — 6 evidence kinds + `closure_<kind>(evidence, hypothesis) → ClosureDecision`
- [ ] `pytest tests/unit/research/test_evidence.py -v` passes
- [ ] `scripts/verify_step.sh M0 7` exits 0
- [ ] Commit: `M0.2.3: Polymorphic Evidence with closure rules`

### M0.2 Step 4 — ScoreVector + ParetoRanker

- [ ] **Test written first**: `tests/unit/research/test_score.py` — known Pareto fixtures → expected frontier; each of 4 rankers
- [ ] **nxl_core/research/score.py** — `ScoreVector` (8-dim), `dominates(a, b)`, `frontier(scores)`, 4 pluggable rankers (weighted_sum, lex, elo, constraint)
- [ ] `pytest tests/unit/research/test_score.py -v` passes
- [ ] `scripts/verify_step.sh M0 8` exits 0
- [ ] Commit: `M0.2.4: ScoreVector with ParetoRanker and 4 pluggable rankers`

### M0.2 Step 5 — Noise floor estimator

- [ ] **Test written first**: `tests/unit/research/test_noise_floor.py` — synthetic data with known noise → estimator within 10% of true σ
- [ ] **nxl_core/research/noise_floor.py** — MAD-based σ estimate; `is_signal(delta, sigma, k=3) → bool`
- [ ] `pytest tests/unit/research/test_noise_floor.py -v` passes
- [ ] `scripts/verify_step.sh M0 9` exits 0
- [ ] Commit: `M0.2.5: MAD-based noise floor estimator with k·σ signal rule`

---

## M0.3: Policy + capability tokens (days 8–10)

### M0.3 Step 1 — Typed Rule objects

- [ ] **Test written first**: `tests/unit/policy/test_rules.py` — each NON_NEGOTIABLE rule has its own test; synthetic violation triggers correct rule
- [ ] **nxl_core/policy/rules.py** — `Rule` with scope_pattern, predicate, effect, reason_template, priority; all 14 rules as typed Rules
- [ ] `pytest tests/unit/policy/test_rules.py -v` passes
- [ ] `scripts/verify_step.sh M0 10` exits 0
- [ ] Commit: `M0.3.1: Typed Rule objects — replaces substring matching in policy.py`

### M0.3 Step 2 — PolicyEngine.check()

- [ ] **Test written first**: `tests/unit/policy/test_engine.py` — 100 synthetic actions → expected decisions in fixture
- [ ] **nxl_core/policy/engine.py** — `PolicyEngine.check()` deterministic, runs all matching rules, highest-priority effect wins
- [ ] `pytest tests/unit/policy/test_engine.py -v` passes
- [ ] `scripts/verify_step.sh M0 11` exits 0
- [ ] Commit: `M0.3.2: PolicyEngine.check() with priority-based rule resolution`

### M0.3 Step 3 — CapabilityToken machinery

- [ ] **Test written first**: `tests/unit/policy/test_tokens.py` — token used after TTL → rejected; postcondition fail → rollback triggered
- [ ] **nxl_core/policy/tokens.py** — mint with TTL/scope/postcondition, consume() validates postcondition, expire() on TTL
- [ ] `pytest tests/unit/policy/test_tokens.py -v` passes
- [ ] `scripts/verify_step.sh M0 12` exits 0
- [ ] Commit: `M0.3.3: CapabilityToken mint/consume/expire machinery`

### M0.3 Step 4 — Zone A/B/C transitions

- [ ] **Test written first**: `tests/unit/policy/test_zones.py` — zone transitions appear in event log; metrics counter increments
- [ ] **nxl_core/policy/zones.py** — explicit `enter_zone(zone, reason) → ZoneEntered` events; A/B/C transition logic
- [ ] `pytest tests/unit/policy/test_zones.py -v` passes
- [ ] `scripts/verify_step.sh M0 13` exits 0
- [ ] Commit: `M0.3.4: Zone A/B/C transition machinery`

### M0.3 Step 5 — Adversarial test suite

- [ ] **Test written first**: `tests/adversarial/test_rule_violations.py` — 100 synthetic hallucination scenarios, table-driven
- [ ] All 100 scenarios blocked by PolicyEngine
- [ ] `pytest tests/adversarial/ -v` → 100 pass, 0 grant-throughs
- [ ] `scripts/verify_step.sh M0 14` exits 0
- [ ] Commit: `M0.3.5: Adversarial test suite — 100 rule violation scenarios blocked`

---

## M0.4: Capsule + compaction (days 11–12)

### M0.4 Step 1 — ResumeCapsule deterministic builder

- [ ] **Test written first**: `tests/unit/capsule/test_resume.py` — same cursor → byte-identical capsule (run 10×, assert all equal)
- [ ] **nxl_core/capsule/resume.py** — `ResumeCapsule` (10 sections, ≤2000t), `build(event_cursor)` pure function
- [ ] `pytest tests/unit/capsule/test_resume.py -v` passes
- [ ] `scripts/verify_step.sh M0 15` exits 0
- [ ] Commit: `M0.4.1: ResumeCapsule deterministic builder`

### M0.4 Step 2 — HandoffRecord

- [ ] **Test written first**: `tests/unit/capsule/test_handoff.py` — token counts enforced at construction
- [ ] **nxl_core/capsule/handoff.py** — `HandoffRecord` ({from_agent, to_agent, reason, summary ≤500t, hints ≤200t})
- [ ] `pytest tests/unit/capsule/test_handoff.py -v` passes
- [ ] `scripts/verify_step.sh M0 16` exits 0
- [ ] Commit: `M0.4.2: HandoffRecord with token count enforcement`

### M0.4 Step 3 — Three-tier compaction

- [ ] **Test written first**: `tests/unit/capsule/test_compact.py` — 500-event stream → ≤3 hard, ≤1 clear; no critical events lost
- [ ] **nxl_core/capsule/compact.py** — `soft_trim()`, `hard_regen()`, `clear_handoff()` — each emits typed event
- [ ] `pytest tests/unit/capsule/test_compact.py -v` passes
- [ ] `scripts/verify_step.sh M0 17` exits 0
- [ ] Commit: `M0.4.3: Three-tier compaction (soft_trim, hard_regen, clear_handoff)`

---

## M0.5: Spec model (day 13)

### M0.5 Step 1 — ProjectSpec

- [ ] **Test written first**: `tests/unit/spec/test_model.py` — example project.yaml loads, dumps, reloads → byte-identical
- [ ] **nxl_core/spec/model.py** — `ProjectSpec` Pydantic model matching project.yaml schema; round-trips through YAML
- [ ] `pytest tests/unit/spec/test_model.py -v` passes
- [ ] `scripts/verify_step.sh M0 18` exits 0
- [ ] Commit: `M0.5.1: ProjectSpec Pydantic model with YAML round-trip`

### M0.5 Step 2 — Compact + index generators

- [ ] **Test written first**: `tests/unit/spec/test_index.py` — golden file diff test for spec_compact.md and spec_index.json
- [ ] **nxl_core/spec/index.py** — `spec_compact.md` + `spec_index.json` generators from typed spec
- [ ] `pytest tests/unit/spec/test_index.py -v` passes
- [ ] `scripts/verify_step.sh M0 19` exits 0
- [ ] Commit: `M0.5.2: Compact and index generators from ProjectSpec`

---

## M0.6: Wire current run.py to event log (day 14)

### M0.6 Step 1 — Boundary event emission

- [ ] **Test written first**: `tests/integration/test_run_event_emission.py` — 1-cycle smoke run → events.jsonl has ≥10 expected events
- [ ] **nxl/core/run.py** — inject `EventLog.append()` at bootstrap start/end, subprocess agent invocation start/end, policy decisions
- [ ] `nxl run --once --dry-run` smoke test passes
- [ ] `.nxl/events.jsonl` exists and has ≥10 events
- [ ] `pytest tests/integration/test_run_event_emission.py -v` passes
- [ ] `scripts/verify_step.sh M0 20` exits 0
- [ ] Commit: `M0.6.1: Wire run.py to emit boundary events to events.jsonl`

---

## Phase M0 Exit Gate

- [ ] `scripts/verify_phase.sh M0` exits 0
- [ ] All M0.1–M0.6 steps complete and committed