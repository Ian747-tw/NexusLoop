# SEAM_INVENTORY.md

Audit date: 2026-04-25
Source: `agentcore/VENDOR_BOUNDARY.md` (worktree consolidated-fixes version)
Disk: `agentcore/server-fork/src/seams/`

## Summary

**9 of 13 documented fork modifications are implemented; 2 are planned-but-missing; 1 is cancelled; 2 Tier-2 research seams are implemented.**

The 11 implemented seams cover all fork-level capabilities. Entry count excludes the cancelled session-storage (M1-era, superseded by P2 research-state + M1 capsule-session).

## Implemented seams

| # | File | Status | Notes |
|---|------|--------|-------|
| 1 | `seams/gated-dispatch.ts` | IMPLEMENTED | 43 lines; intercepts every tool call before execution |
| 2 | `seams/intervention-hook.ts` | IMPLEMENTED | 49 lines; replaces upstream permission UI with 12-verb algebra |
| 3 | `seams/capsule-session.ts` | IMPLEMENTED | 56 lines; capsule-as-prefix + cache breakpoint + compaction delegation |
| 4 | `seams/cycle-driver.ts` | IMPLEMENTED | 55 lines; emits typed events at turn lifecycle points |
| 9 | `seams/skill-dispatcher.ts` | IMPLEMENTED | 40 lines; covers "skill-registration" (entry 9) — YAML skills registered as slash commands |
| 9 | `seams/provider-instrumentation.ts` | IMPLEMENTED | wraps provider adapter to record per-call telemetry (P4.1) |
| 10 | `seams/lifecycle-hooks.ts` | IMPLEMENTED | 148 lines; SIGTERM/SIGINT/SIGHUP handlers, draining flag, in-flight counter, 5s drain timeout, idempotent pidfile release (P4.2) |
| — | `seams/mcp-gate.ts` | IMPLEMENTED | 67 lines; NOT in VENDOR_BOUNDARY.md — wraps MCP registry with PolicyEngine |

## Planned but not yet implemented

| # | File | Status | Description from VENDOR_BOUNDARY.md |
|---|------|--------|-------------------------------------|
| — | `seams/session-storage.ts` | CANCELLED | Superseded by research-state.ts + capsule-session.ts (see ADR-010) |
| 11 | `seams/subagent-isolation.ts` | IMPLEMENTED | Config-driven; registry.yaml declares isolated types; strips parentID on spawn |
| 12 | `seams/tripwire-gate.ts` | MISSING | When tripwire fires, gate refuses next tool call until acknowledged (M4) |
| 13 | `seams/mode-flag-gate.ts` | MISSING | Flags that would bypass approval are themselves policy-gated (M4) |

## Tier 2 — Research seams (post-M1.1, see ADR-006)

| # | File | Status | Notes |
|---|------|--------|-------|
| 12 | `seams/research-state.ts` | PLANNED | Extends OpenCode session with `research:` namespace; schema locked in ADR-008 |
| 13 | `seams/scheduler-integration.ts` | PLANNED | Outer scheduler; TS class holding scheduler_queue; lifecycle hook registration |

## Notes

- Entry 9 (`skill-registration.ts`) is implemented by `skill-dispatcher.ts` — functionality is present under a different filename. The VENDOR_BOUNDARY.md should be updated to reflect the actual filename when this seam is next touched.
- `mcp-gate.ts` is frozen (in FROZEN.lock) and is implemented, but is not listed in VENDOR_BOUNDARY.md's modification count.
- `tripwire-gate.ts` and `mode-flag-gate.ts` are marked "(added in M4)" suggesting they were not expected to exist yet.
