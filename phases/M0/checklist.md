# M0 Checklist — Phase M0.1: Event Log Foundation

## M0.1 Step 1 — Event schema (18 Pydantic event kinds)

- [x] **Test written first**: `tests/unit/events/test_schema.py` — round-trip test for all 18 kinds via TypeAdapter
- [x] **nxl_core/events/schema.py** — discriminated union `Event` with all 18 kinds
- [x] `pytest tests/unit/events/test_schema.py -v` passes
- [x] `scripts/verify_step.sh M0 1` exits 0
- [x] Commit: `M0.1.1: Define 18-kind Event discriminated union`

## M0.1 Step 2 — EventLog append-only

- [x] **Test written first**: `tests/integration/events/test_log_concurrent.py` — 10-thread concurrent append, assert no corruption + correct order
- [x] **nxl_core/events/log.py** — `EventLog` class with portalocker-locked append, cursor management, `read_from()` iterator
- [x] `pytest tests/integration/events/test_log_concurrent.py -v` passes
- [x] `scripts/verify_step.sh M0 2` exits 0
- [x] Commit: `M0.1.2: EventLog with file-locked append and cursor-based read`

## M0.1 Step 3 — Deterministic replay

- [x] **Test written first**: `tests/integration/events/test_replay_deterministic.py` — replay 1000-event fixture twice, assert byte-identical state
- [x] **nxl_core/events/replay.py** — `project(events) → State` pure fold, no I/O, no time, no randomness
- [x] `pytest tests/integration/events/test_replay_deterministic.py -v` passes
- [x] `scripts/verify_step.sh M0 3` exits 0
- [x] Commit: `M0.1.3: Deterministic replay — same events produce byte-identical state`

## M0.1 Step 4 — Migrate existing logging modules

- [x] **Test written first**: `tests/integration/logging/test_event_emission.py` — assert an event appears for each public API call in journal/incidents/handoffs/registry
- [x] **nxl_core/events/singletons.py** — shared EventLog singleton with `set_shared()` / `reset()` for tests
- [x] **nxl/logging/journal.py** — internally calls `journal_log().append()` on `log_event()`
- [x] **nxl/logging/incidents.py** — internally calls `incident_log().append()` on `report()`; fixed missing `import time`
- [x] **nxl/logging/handoffs.py** — internally calls `handoff_log().append()` on `record_handoff()`; fixed missing `import time`
- [x] All existing tests pass
- [x] `pytest tests/integration/logging/ -v` passes
- [x] `scripts/verify_step.sh M0 4` exits 0
- [x] Commit: `M0.1.4: Migrate logging modules to emit events via EventLog.append()`

---

## M0.2: Research primitives (days 4–7)
## M0.3: Policy + capability tokens (days 8–10)
## M0.4: Capsule + compaction (days 11–12)
## M0.5: Spec model (day 13)
## M0.6: Wire current run.py to event log (day 14)

*(to be populated before each sub-phase begins)*