# agentcore/SEAM_CONTRACT_TIER2.md — Research Seams (Tier 2)

`SEAM_CONTRACT.md` (Tier 1) is frozen at M1.1 with exactly 8 public functions
across 4 seams. This file declares **Tier 2**: post-M1.1 seams introduced for
the Single Brain + Two-Tier Scheduling architecture (see ADR-007, ADR-008).

Tier 2 has its own freeze gate at the **M5 exit**. Until then, additions
require an ADR + entry in `VENDOR_BOUNDARY.md`.

## Tier 2 Public Surface

### seams/research-state.ts  (planned, see ADR-008)
```typescript
export function getResearchNamespace(session: Session): ResearchNamespace
export function projectFromEventLog(cursor: string | null): Promise<ResearchNamespace>
export function applyEvent(ns: ResearchNamespace, event: Event): ResearchNamespace
```

### seams/scheduler-integration.ts  (planned, see ADR-008)
```typescript
export class OuterScheduler {
  tick(ns: ResearchNamespace): SchedulerDecision
  enqueueProposal(p: CycleProposal): void
  registerWithCycleDriver(driver: CycleDriverHooks): void
}
```

## Relationship to Tier 1

- Tier 1 (`SEAM_CONTRACT.md`) remains frozen. Do not add new exports there.
- Tier 2 may **call into** Tier 1 functions but never modifies their signatures.
- The CI check on Tier 1 (`grep -c "^export " | grep '^8$'`) is unchanged.
- A separate CI check on Tier 2 enforces the surface listed here.

## CI Check

```bash
# Tier 2 surface count (currently 6: 3 in research-state, 3 in scheduler-integration)
N=$(grep -cE "^export " agentcore/server-fork/src/seams/research-state.ts agentcore/server-fork/src/seams/scheduler-integration.ts 2>/dev/null || echo 0)
test "$N" -le 6 || { echo "Tier 2 surface drift"; exit 1; }
```
