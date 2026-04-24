# agentcore/SEAM_CONTRACT.md — Frozen Seam APIs

These 4 public functions are the ONLY public API surface of `client-py/`.
No new public functions may be added without a phase gate.

## Python Side (agentcore/client-py/client.py)

```python
class OpenCodeClient:
    def run_cycle(brief: str, policy_endpoint: str, events_endpoint: str) -> CycleResult: ...
    def stream_events(cycle_id: str) -> AsyncIterator[Event]: ...
    def inject_intervention(verb: str, payload: object) -> None: ...
    def snapshot_session() -> SessionSnapshot: ...
```

## TS Side (agentcore/server-fork/src/seams/)

```typescript
// seams/gated-dispatch.ts
export function checkToolPolicy(req: ToolCallRequest): Promise<PolicyDecision>

// seams/intervention-hook.ts
export function enqueueIntervention(v: Intervention): void
export function drainInterventionQueue(): Intervention[]

// seams/capsule-session.ts
export async function requestCapsule(cycle_id: string): Promise<CapsuleResponse>
export async function requestCompact(req: CompactRequest): Promise<CompactResponse>

// seams/cycle-driver.ts
export function startCycle(brief: str): Promise<void>
export function pauseCycle(): void
export function resumeCycle(): void
export function haltCycle(): void
```

## CI Anti-Hallucination Check

```bash
# Must have zero new public functions outside this list
grep -r "export (function|class|const)" agentcore/server-fork/src/seams/ | wc -l
# Must equal exactly 8 (4 seams × 2 minimum exports)
```

No additions allowed after M1.1 freeze.
