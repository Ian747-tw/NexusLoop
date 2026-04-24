# agentcore/PROTOCOL.md — IPC Protocol Specification (v1.0)

## Transport
- JSON-lines over stdio (Unix socket upgrade in M2)
- Each message is a single JSON object followed by `\n`
- No batched messages; one request/response per line

## Session Context (carried in requests)

```typescript
interface SessionCtx {
  cycle_id: string
  turn: number
  capsule_bytes: string  // base64, from nxl_core
  provider: "anthropic" | "openai" | "ollama"
}
```

## Message Types

### Python → TS (Decisions and State)

```typescript
// Policy gate result
type PolicyDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; verb: string; payload: unknown }
  | { kind: "narrow"; narrowed_args: Record<string, unknown>; reason: string }

// Capsule assembled by nxl_core at cycle start
interface CapsuleResponse {
  prefix: string          // pre-rendered session prefix
  cache_break: string     // provider-specific cache breakpoint marker
}

// Compaction produced by nxl_core.capsule.compact
interface CompactResponse {
  new_prefix: string
  new_cache_break: string
  events_emitted: number  // how many CompactionEvents were written
}

// Intervention queued by Python side
interface Intervention {
  verb: InterventionVerb
  payload: unknown
}

// Cycle lifecycle control
interface CycleControl {
  action: "start" | "pause" | "resume" | "halt"
}
```

### TS → Python (Requests and Events)

```typescript
// Request policy decision before tool dispatch
interface ToolCallRequest {
  id: string
  name: string
  args: Record<string, unknown>
  ctx: SessionCtx
}

// Result of tool call attempt
interface ToolCallResult {
  id: string
  allowed: boolean
  result?: unknown
  error?: string
}

// Request capsule prefix at cycle start
interface CapsuleRequest {
  cycle_id: string
}

// Upstream detected context overflow; request compaction
interface CompactRequest {
  cycle_id: string
  tier_hint: "soft"|"hard"|"clear"
  current_token_count: number
  reason: string
}

// Generic event emission at lifecycle points
interface EventEmission {
  event: Record<string, unknown>
}
```

## Protocol Contract Tests

Round-trip: Python encodes → TS decodes → TS re-encodes → Python decodes → bytes identical.

Run: `pytest agentcore/tests/test_protocol_contract.py`
