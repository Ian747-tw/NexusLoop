# ADR-009: Single-Writer event log

## Context

Today there are TWO writers to `events.jsonl`:

- TS: `agentcore/server-fork/bridge/event-emitter.ts` uses `appendFileSync`
  with **no lock**.
- Python: `nxl_core/events/log.py` `EventLog.append` uses `portalocker` + fsync.

These do not coordinate. This is a latent corruption bug, not a future
hardening concern.

## Confirmed Python write call sites

- `mcps/journal/server.py:125, 166` — `log.append(event)` exposed as MCP tool
  `journal.append`
- `mcps/_shared/base.py:52` — `event_log.append(ToolRequested(...))` on every
  MCP tool call (hot path; file is FROZEN — cannot edit in P1)
- `mcps/conftest.py:15` and `mcps/_shared/test_helpers.py:12` — test fixtures
  only, leave alone

## Decision

The fork becomes the sole runtime writer to events.jsonl. Python MCPs that
need to record send `EventEmissionRequest` (PROTOCOL_v1.1.md) and the fork
serializes the append. Tests (which spin up isolated EventLog instances per
fixture) are exempt — the invariant binds runtime, not test harness.

## `ToolRequested` migration

This event currently fires from Python on every MCP call. Since the fork
already dispatches every tool through `gated-dispatch.ts`, the fork has the
information natively. Decision: **fork originates `ToolRequested` directly;
Python emission is removed**. This eliminates the per-tool-call IPC round-trip
that a naïve migration would impose. The `mcps/_shared/base.py` change is
gated on the FROZEN.lock entry being lifted; that's a separate negotiation,
not a P3 blocker.

## Performance budget (binding for P3)

IPC-mediated event emission for non-hot-path events must add ≤1 ms p99
latency vs. direct `EventLog.append`. Measured in P3 verifier; if exceeded,
design must change before merge.

## Consequences

- One coordination point eliminates the lock-mismatch bug
- Python schema stays canonical (see ADR-007); the fork's IPC handler
  validates against it
- Replay engine continues to read events.jsonl directly — read path unchanged

## Migration plan (P3 — do not implement here)

1. Update `bridge/event-emitter.ts` to be the canonical writer; acquire
   same portalocker-equivalent lock.
2. Add IPC handler for `EventEmissionRequest`.
3. Migrate `mcps/journal/server.py` to send `EventEmissionRequest` instead of
   direct append.
4. Negotiate FROZEN.lock lift for `mcps/_shared/base.py`; remove Python
   `ToolRequested` emission; have fork emit it from `gated-dispatch.ts` instead.
5. Add CI test: spawn fork; spawn Python MCP; both attempt event recording;
   assert exactly one writer fd and zero contention errors.
6. Add runtime assertion in `EventLog.append`: when invoked from a process
   whose name is not the fork binary AND not a test pid, raise
   `RuntimeError("only fork may write events.jsonl at runtime")`. Test harness
   flag bypasses.

## Implementation notes (P3.5e)

The original decision assumed `proper-lockfile` as the TS lock. However,
`proper-lockfile` uses mkdir-based locking which cannot coordinate with
portalocker's flock(2). Both sides must call the same OS primitive.

Resolution: TS now calls `flock(2)` directly via `bun:ffi` (see
`server-fork/src/util/posix-flock.ts`). Python portalocker and TS flock now
coordinate on `events.jsonl.lock`. The test `test_lock_compatibility.py`
verifies both directions block correctly.
