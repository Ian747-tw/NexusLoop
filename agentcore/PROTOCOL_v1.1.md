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

### Backwards compatibility

- v1.0 clients that don't know `EventEmissionRequest` simply never send it.
- The fork accepts both v1.0 and v1.1 messages on the same transport.
- See ADR-009 for rationale (Single-Writer invariant).
