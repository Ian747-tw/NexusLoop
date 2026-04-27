# ADR-010: session-storage seam cancelled

## Context

VENDOR_BOUNDARY entry for `seams/session-storage.ts` was written in M1
with the intent: "replace upstream's message-list session store with a
thin pointer into events.jsonl. Source of truth is the event log."

In P4.3 we attempted implementation and found:

1. events.jsonl records SEMANTIC events (28 kinds: cycles, tools, research,
   policy, zones, capsule lifecycle). It does not record conversation
   tokens or message parts. Reading from it does not yield messages.
2. Upstream's `Session.Service` is woven into 15+ modules (SessionProcessor,
   SessionPrompt, HTTP routes, ACP agent, ToolRegistry, etc.). It cannot
   be replaced via a single fork seam without upstream-wide changes.
3. No Python-side session query infrastructure exists. Building one would
   be a new subsystem, not a fork seam.

## Decision

The session-storage seam is **cancelled**. Not implemented in P4 or any
future phase under the M1 spec.

The functions the original seam was meant to provide are already covered:

- Event-log projection: `seams/research-state.ts` (P2) provides
  `projectFromEventLog(cursor)` that reads events.jsonl forward from a
  cursor and reconstructs the research namespace.
- Conversation prefix: `seams/capsule-session.ts` (M1) manages the
  cached prefix and cache breakpoint.
- Operational message continuity: upstream's native session store, untouched.

## Consequences

- VENDOR_BOUNDARY count: 13 fork modifications (was 14).
- `audit-fork-depth.sh` expects one fewer file.
- Rebase impact reduced by ~3 hours.
- If a future requirement demands message-token-level replay determinism
  (e.g. reproducing exact LLM responses for audit), reopen as a NEW seam
  with the right primitives:
    1. Add MessageReceived/MessageEmitted/PartLogged event kinds to
       nxl_core/events/schema.py.
    2. Instrument upstream's Session.Service writes to emit those events.
    3. Build a Python session query server with an IPC channel.
  These are upstream/cross-system changes; do not attempt at fork-only level.

## Alternatives considered

- Build a thin read-only wrapper around upstream's message store and call
  it "session-storage." Rejected: the seam's stated purpose was to use
  events.jsonl as source of truth; a wrapper around the upstream store
  doesn't deliver that.
- Add message-event kinds to the schema in P4. Rejected: scope explosion
  (touches schema, replay, Python projection, TS projection, every
  Session.Service write site, Pydantic ↔ Zod parity, etc.). This is P5+
  work and only justified by an actual requirement.

## Replay contract clarification

NexusLoop's replay contract is "same events.jsonl → same research lineage."
It is NOT "same events.jsonl → same conversation tokens." The audit trail
covers semantic decisions (which hypothesis ran, what evidence was found,
which tier transitions happened), not the LLM's exact wordings.