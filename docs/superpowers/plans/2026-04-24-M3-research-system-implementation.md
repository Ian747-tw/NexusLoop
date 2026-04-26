# M3 Research System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform NexusLoop from "reliable agent driver" into "research system" with autonomous hypothesis generation, program state machine, literature stack, second-review subagent, and streaming dashboard.

**Architecture:** M3 builds four new `nxl_core/` packages (scheduler/pools, program/, literature/, agentcore/subagents/), rewrites the dashboard, and adds deterministic replay. All new code lives in `nxl_core/` with TypeScript seams unchanged. Event schema is frozen — no new event types.

**Tech Stack:** Python (nxl_core), FastAPI + WebSocket (dashboard), networkx (citation graph), scikit-optimize (surrogate pool), SQLite (literature cache), Playwright (dashboard E2E).

---

## M3.0 — M2 Formal Closure (2 days)

### Step 0.1 — Commit scripts/bench_init.py

**Files:**
- Create: `scripts/bench_init.py`
- Modify: `.github/workflows/ci.yml`
- Modify: `phases/M2/checklist.md`

- [ ] **Step 1: Create scripts/bench_init.py**

```python
#!/usr/bin/env python3
"""Benchmark nxl init time — must be ≤ 2s median."""
import subprocess
import statistics
import sys


def main() -> None:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    times = []
    for _ in range(runs):
        start = statistics.default_timer()
        subprocess.run(["nxl", "init"], check=False, capture_output=True)
        times.append(statistics.default_timer() - start)
    median = statistics.median(times)
    print(f"Median init time: {median:.3f}s (threshold: 2.0s)")
    sys.exit(0 if median <= 2.0 else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run bench_init.py to verify it works**

Run: `python scripts/bench_init.py 3`
Expected: Median reported, exits 0

- [ ] **Step 3: Wire into CI**

Modify `.github/workflows/ci.yml` to add a job:
```yaml
  bench-init:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -e .
      - run: python scripts/bench_init.py 3
```

- [ ] **Step 4: Commit**

```bash
git add scripts/bench_init.py .github/workflows/ci.yml
git commit -m "M3.0: add bench_init.py to CI (≤2s threshold)"
```

### Step 0.2 — Run full E2E suite with fast init

**Files:**
- Modify: `phases/M3/checklist.md`

- [ ] **Step 1: Run M2 E2E scenarios**

Run: `uv run pytest tests/e2e_user/ -m "phase_m2_or_earlier" -v`
Expected: All 13 M2 scenarios pass

- [ ] **Step 2: Tick checklist item and commit**

- [ ] **Step 3: If any fail, file in phases/M3/ISSUES.md and fix before proceeding**

### Step 0.3 — 12-hour overnight run

**Files:**
- Create: `scripts/overnight_run.sh`

- [ ] **Step 1: Create scripts/overnight_run.sh**

```bash
#!/bin/bash
set -e
DURATION=${1:-12}
echo "Starting ${DURATION}h overnight run..."
# Placeholder — implement once cycle loop exists
# Target: ≥100 cycles, ≥3 handoffs, 0 NON_NEGOTIABLE violations, replay byte-exact
echo "Overnight run: IMPLEMENT IN M3.1 once cycle loop is available"
```

- [ ] **Step 2: Tag M2-complete and commit**

---

## M3.1 — Program State Machine (2 days)

### Step 1.1 — State machine core

**Files:**
- Create: `nxl_core/program/state_machine.py`
- Create: `nxl_core/program/__init__.py`
- Create: `tests/nxl_core/program/test_state_machine.py`

- [ ] **Step 1: Write the failing test for all four states**

```python
# tests/nxl_core/program/test_state_machine.py
import pytest
from nxl_core.program.state_machine import ProgramState, ProgramStateMachine
from nxl_core.events.schema import HypothesisCreated, TrialCompleted


def test_bootstrapping_transitions_after_n_baseline_trials():
    """BOOTSTRAPPING → PROBING when ≥ N baseline trials completed."""
    # ... implement full test
    pass


def test_probing_transitions_on_noise_floor():
    """PROBING → DIVERSIFYING when ≥ 5 consecutive trials in noise floor."""
    pass


def test_diversifying_transitions_on_stall():
    """DIVERSIFYING → REFRAMING when ≥ 15 cycles without T2+ promotion."""
    pass


def test_reframing_transitions_back_on_promotion():
    """REFRAMING → PROBING when new hypothesis promoted to T2+."""
    pass
```

Run: `pytest tests/nxl_core/program/test_state_machine.py -v`
Expected: FAIL (import error — module doesn't exist)

- [ ] **Step 2: Implement state_machine.py**

```python
# nxl_core/program/state_machine.py
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class ProgramState(str, Enum):
    BOOTSTRAPPING = "bootstrapping"
    PROBING = "probing"
    DIVERSIFYING = "diversifying"
    REFRAMING = "reframing"


class ProgramStateChanged(BaseModel):
    """Emitted when state transitions."""
    from_state: ProgramState
    to_state: ProgramState
    reason: str


class ProgramStateMachine:
    def __init__(self, noise_floor: float = 0.05, baseline_threshold: int = 3):
        self.state = ProgramState.BOOTSTRAPPING
        self.noise = noise_floor
        self.baseline_threshold = baseline_threshold
        self._consecutive_noise_trials = 0
        self._cycles_since_t2_promotion = 0

    def consider_transition(self, registry: "HypothesisRegistry") -> Optional[ProgramStateChanged]:
        """Called at end of every cycle. Returns transition event if state changed."""
        new_state = self._evaluate(registry)
        if new_state != self.state:
            event = ProgramStateChanged(from_state=self.state, to_state=new_state, reason=self._explain(registry))
            self.state = new_state
            return event
        return None

    def _evaluate(self, registry) -> ProgramState:
        """Deterministic — same registry → same verdict. No timestamps."""
        if self.state == ProgramState.BOOTSTRAPPING:
            completed = [h for h in registry.hypotheses if h.status == "completed"]
            if len(completed) >= self.baseline_threshold:
                return ProgramState.PROBING
            return ProgramState.BOOTSTRAPPING

        if self.state == ProgramState.PROBING:
            # Placeholder — implement noise floor detection from registry
            self._consecutive_noise_trials += 1
            if self._consecutive_noise_trials >= 5:
                return ProgramState.DIVERSIFYING
            return ProgramState.PROBING

        if self.state == ProgramState.DIVERSIFYING:
            self._cycles_since_t2_promotion += 1
            if self._cycles_since_t2_promotion >= 15:
                return ProgramState.REFRAMING
            return ProgramState.DIVERSIFYING

        if self.state == ProgramState.REFRAMING:
            # Placeholder — check for T2 promotion
            return ProgramState.PROBING  # transitions back when promotion found

    def _explain(self, registry) -> str:
        return f"Transition {self.state} → ?, implement reason"
```

Run: `pytest tests/nxl_core/program/test_state_machine.py -v`
Expected: FAIL (tests call methods not yet implemented)

- [ ] **Step 3: Implement the full state machine with proper registry access**

- [ ] **Step 4: Run tests until all pass**

- [ ] **Step 5: Commit**

```bash
git add nxl_core/program/
git commit -m "M3.1: add ProgramStateMachine with 4 states and transition rules"
```

### Step 1.2 — Transition integration with cycle loop

**Files:**
- Modify: `nxl_core/research/hypothesis.py` (add HypothesisRegistry stub if needed)
- Create: `nxl_core/program/transitions.py`

- [ ] **Step 1: Add HypothesisRegistry to hypothesis.py**

- [ ] **Step 2: Integrate state machine into cycle adapter**

- [ ] **Step 3: Write E2E scenarios**

```python
# tests/e2e_user/scenarios/test_program_transitions_to_probing_after_bootstrap.py
# tests/e2e_user/scenarios/test_program_transitions_to_reframing_on_long_stall.py
```

- [ ] **Step 4: Run E2E scenarios and commit**

---

## M3.2 — Six Proposer Pools (6 days)

### Step 2.1 — Pool base class and scheduler

**Files:**
- Create: `nxl_core/scheduler/pools/base.py`
- Create: `nxl_core/scheduler/pools/__init__.py`
- Create: `nxl_core/scheduler/priority.py`
- Create: `tests/nxl_core/scheduler/pools/test_base.py`

- [ ] **Step 1: Write Pool base class test**

```python
# tests/nxl_core/scheduler/pools/test_base.py
import pytest
from abc import ABC


def test_pool_is_abc():
    from nxl_core.scheduler.pools.base import Pool
    assert issubclass(Pool, ABC)


def test_pool_has_name_and_source_tag():
    from nxl_core.scheduler.pools.base import Pool
    assert hasattr(Pool, "name")
    assert hasattr(Pool, "source_tag")
```

Run: `pytest tests/nxl_core/scheduler/pools/test_base.py -v`
Expected: FAIL

- [ ] **Step 2: Implement base.py**

```python
# nxl_core/scheduler/pools/base.py
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from nxl_core.research.hypothesis import Hypothesis


class PoolBudget(BaseModel):
    max_proposals: int = 5
    max_cost: float = 1.0


class Pool(ABC):
    name: str = "base"
    source_tag: str = "base"

    @abstractmethod
    def propose(
        self,
        state: "ProgramState",
        registry: "HypothesisRegistry",
        budget: PoolBudget,
    ) -> list["Hypothesis"]:
        """Return zero or more new hypotheses. No side effects on registry."""
        return []

    def _validate_weights(self, weights: dict[str, float]) -> None:
        """Pool weights must sum to 1.0."""
        total = sum(weights.values())
        assert abs(total - 1.0) < 1e-6, f"Weights must sum to 1.0, got {total}"
```

- [ ] **Step 3: Implement all 6 pools (human_directive, failure_driven, ablation, diversification, literature, surrogate)**

- [ ] **Step 4: Write E2E scenarios for each pool**

- [ ] **Step 5: Commit each pool separately**

### Pool-by-pool implementation notes

**human_directive pool** (day 1):
- Reads inbox_mcp for pending items → creates Hypothesis with source=human

**failure_driven pool** (day 1):
- Tails event log for TrialFailed/CycleFailed events → proposes diagnostic hypotheses

**ablation pool** (day 2):
- Identifies best hypothesis by ScoreVector → proposes ±ε variants on each axis

**diversification pool** (day 2):
- Hash-distance against last N proposals → rejects high-similarity proposals

**literature pool** (day 3, after M3.3):
- Queries literature_mcp → extracts 1-3 claims per paper → creates cited hypotheses

**surrogate pool** (day 3-4, after M3.3):
- scikit-optimize GP → expected improvement → fallback to random if < 5 trials

---

## M3.3 — Literature Stack (3 days)

### Step 3.1 — Paper cache (SQLite)

**Files:**
- Create: `nxl_core/literature/cache.py`
- Create: `nxl_core/literature/__init__.py`
- Create: `tests/nxl_core/literature/test_cache.py`

- [ ] **Step 1: Write failing tests for 3 invariants**

```python
# tests/nxl_core/literature/test_integrity.py
import pytest


def test_no_orphan_citations():
    """I1: Every hypothesis.citations entry must resolve to a Paper in cache."""
    pass


def test_no_duplicate_claims():
    """I2: No two papers may contain claims with identical canonical_hash."""
    pass


def test_citation_reachability():
    """I3: Every literature-sourced hypothesis must have a path to ≥1 paper."""
    pass
```

Run: `pytest tests/nxl_core/literature/test_integrity.py -v`
Expected: FAIL (module doesn't exist)

- [ ] **Step 2: Implement cache.py (SQLite store)**

- [ ] **Step 3: Implement graph.py (networkx citation DAG)**

- [ ] **Step 4: Implement integrity.py (3 invariants)**

- [ ] **Step 5: Commit**

---

## M3.4 — Second-Review Subagent (2 days)

### Step 4.1 — Subagent core

**Files:**
- Create: `agentcore/subagents/second_review.py`
- Create: `tests/agentcore/subagents/test_second_review.py`

- [ ] **Step 1: Write PromotionPacket schema test**

```python
# tests/agentcore/subagents/test_second_review.py
import pytest
from agentcore.subagents.second_review import PromotionPacket


def test_promotion_packet_rejects_extra_fields():
    """Schema must be frozen — no accidental context leaks."""
    pass


def test_context_firewall_no_leak():
    """50 random poison-pill packets → 0 parent-context leaks in subagent output."""
    pass
```

Run: `pytest tests/agentcore/subagents/test_second_review.py -v`
Expected: FAIL

- [ ] **Step 2: Implement second_review.py with context firewall**

- [ ] **Step 3: Write E2E scenarios**

- [ ] **Step 4: Commit**

---

## M3.5 — Dashboard Rewrite (6 days)

### Step 5.1 — Backend scaffolding

**Files:**
- Create: `nxl/dashboard/server.py` (≤200 lines)
- Create: `nxl/dashboard/auth.py`
- Create: `nxl/dashboard/stream.py`
- Create: `nxl/dashboard/policies/csp.py`
- Create: `nxl/dashboard/policies/rate_limit.py`
- Create: `nxl/dashboard/policies/no_traceback.py`
- Create: `nxl/dashboard/views/live.py`
- Create: `nxl/dashboard/views/leaderboard.py`
- Create: `nxl/dashboard/views/lineage.py`

- [ ] **Step 1: Write auth test**

```python
# tests/nxl/dashboard/test_auth.py
def test_token_required_for_websocket():
    """Requests without token get 401."""
    pass
```

Run: `pytest tests/nxl/dashboard/ -v`
Expected: FAIL

- [ ] **Step 2: Implement auth.py (token-based)**

- [ ] **Step 3: Implement stream.py (websocket)**

- [ ] **Step 4: Implement policies (CSP, rate limit, no traceback)**

- [ ] **Step 5: Implement server.py (FastAPI, ≤200 lines)**

- [ ] **Step 6: Commit**

### Step 5.2 — Three tabs (Live, Leaderboard, Lineage)

**Files:**
- Create: `nxl/dashboard/static/live/index.html`
- Create: `nxl/dashboard/static/leaderboard/index.html`
- Create: `nxl/dashboard/static/lineage/index.html`
- Vendored: `nxl/dashboard/static/vendor/chart.umd.js`

- [ ] **Step 1: Implement Tab 1 — Live Control Room**

- [ ] **Step 2: Implement Tab 2 — Leaderboard**

- [ ] **Step 3: Implement Tab 3 — Lineage**

- [ ] **Step 4: Write Playwright E2E scenarios**

- [ ] **Step 5: Commit**

---

## M3.6 — Deterministic Replay + 24h Verification (3 days)

### Step 6.1 — Replay command

**Files:**
- Create: `nxl/core/replay.py`
- Create: `tests/nxl/core/test_replay.py`

- [ ] **Step 1: Write replay projection test**

```python
# tests/nxl/core/test_replay.py
def test_replay_byte_exact_on_golden_fixtures():
    """3 golden runs replay byte-exact."""
    pass
```

Run: `pytest tests/nxl/core/test_replay.py -v`
Expected: FAIL

- [ ] **Step 2: Implement nxl/core/replay.py**

- [ ] **Step 3: Create golden fixtures**

- [ ] **Step 4: Commit**

### Step 6.2 — 24h unsupervised verification

**Files:**
- Create: `scripts/unsupervised_run.sh`
- Create: `scripts/verify_unsupervised_criteria.py`

- [ ] **Step 1: Implement scripts**

- [ ] **Step 2: Run and verify criteria**

- [ ] **Step 3: Commit**

---

## Exit Gate

```bash
python scripts/bench_init.py 3               # median ≤ 2s
pytest tests/e2e_user/ -m phase_m2_or_earlier
bash scripts/overnight_run.sh 12
python scripts/verify_phase_M3.sh
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|-----------------|------|
| 4 program states + 4 transitions | M3.1 Step 1.1–1.2 |
| State machine deterministic (100 canned streams) | M3.1 Step 1.1 |
| 6 proposer pools each produce ≥10 valid hypotheses | M3.2 Step 2.1 |
| Pool blending weights vary by program state | M3.2 Step 2.1 |
| Literature stack 3 invariants | M3.3 Step 3.1 |
| Second-review context firewall (50-packet fuzz, 0 leaks) | M3.4 Step 4.1 |
| Dashboard 3 tabs + websocket + auth + CSP | M3.5 Step 5.1–5.2 |
| nxl replay byte-exact on 3 golden runs | M3.6 Step 6.1 |
| 24h unsupervised: ≥50 hypotheses, ≥5 T2, 0 violations | M3.6 Step 6.2 |
| SEAM_CONTRACT + PROTOCOL.md unchanged | All phases |
