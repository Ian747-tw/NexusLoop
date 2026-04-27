# agentcore/PROTOCOL.md — Additions for v1.1

`PROTOCOL.md` v1.0 is frozen. v1.1 is **additive only** — no v1.0 message
type may be redefined here. New types live below.

## v1.1 Additions

### EventEmissionRequest (Python → TS)
```typescript
interface EventEmissionRequest {
  // Issued by a Python MCP that needs to record state. The fork serializes
  // the append to events.jsonl. Fork is the only writer at runtime.
  request_id: string             // ULID, used to correlate ack
  event: Record<string, unknown> // must match nxl_core/events/schema.py kinds
  origin_mcp: string             // e.g. "journal", "evidence"
}

interface EventEmissionAck {
  request_id: string
  event_id: string | null        // ULID assigned by EventLog, or null on reject
  error?: string                 // present iff event_id is null
}
```

### PolicyDecision — deny_non_negotiable variant
```typescript
// New discriminated-union variant added to the PolicyDecision union.
// When a NON_NEGOTIABLE rule fires, Python's PolicyEngine returns this
// variant instead of the plain deny variant. TS switches on `kind` — no
// string pattern matching.

interface PolicyDecisionDenyNonNegotiable {
  kind: "deny_non_negotiable"
  rule_id: string   // stable rule identifier, e.g. "no_non_negotiable_modification"
  reason: string    // human-readable explanation
}
```

### TripwireAcknowledgment (Python → TS)
```typescript
// Human operator has acknowledged a fired tripwire. Sent by the Python
// harness over the same stdio channel as other TS ← Python messages.

interface TripwireAcknowledgment {
  kind: "TripwireAcknowledgment"
  tripwire_id: string         // ULID assigned when tripwire fired
  acknowledged_by: string      // operator identifier
  reason?: string              // optional operator notes
}
```

### TripwireAcknowledgmentResult (TS → Python)
```typescript
// Response to a TripwireAcknowledgment. Returned over stdio.

interface TripwireAcknowledgmentResult {
  kind: "TripwireAcknowledgmentResult"
  tripwire_id: string
  cleared: boolean             // true if tripwire was active and is now cleared
  error?: string              // present iff cleared is false
}
```

### Backwards compatibility

- v1.0 clients that don't know `deny_non_negotiable` or tripwire messages
  simply never trigger them. The new variants are additive.
- v1.0 `deny` continues to work for all non-NON_NEGOTIABLE denials.
- The fork accepts both v1.0 and v1.1 messages on the same transport.
- See ADR-009 for rationale (Single-Writer invariant).
