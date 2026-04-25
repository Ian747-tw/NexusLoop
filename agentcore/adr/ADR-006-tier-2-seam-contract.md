# ADR-006: Tier-2 seam contract

## Context

SEAM_CONTRACT.md was frozen at M1.1 with exactly 8 functions. Single Brain +
Two-Tier Scheduling architecture requires new public exports that the freeze
prohibits.

## Decision

Introduce a Tier 2 seam contract in `SEAM_CONTRACT_TIER2.md` (additive
sidecar). Tier 1 stays frozen. Tier 2 has its own freeze gate at M5.

## Consequences

- Two CI checks instead of one; clearer separation of "core IPC" vs
  "research-augmented" surface
- Preserves the original freeze discipline
- Tier 2 file lands in P1; populated as seams 12–13 are implemented in P2

## Migration

Tier 2 file lands in P1; populated as seams 12–13 are implemented in P2.
