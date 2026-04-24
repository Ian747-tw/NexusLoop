# M1 Design Spec — OpenCode Fork Integration

## Status
Approved for implementation.

---

## 1. Overview

Fork OpenCode (`anomalyco/opencode`, MIT) into `agentcore/` at pinned commit `v1.14.22` (`38deb0f3eeedb9da68f80b398a694622602162bb`). Replace four server-side seams in the TypeScript server so every tool call is policy-gated, every intervention uses the 12-verb algebra, session context comes from NexusLoop's ResumeCapsule, and the turn loop emits events to `events.jsonl`. The Python harness owns policy enforcement, event logging, and session state; the TypeScript server owns LLM calls and tool execution.

---

## 2. Vendor Boundary

```
agentcore/
├── upstream/                    # git subtree, pinned v1.14.22 (38deb0f)
│   └── packages/opencode/      # what we fork
├── server-fork/                # our TypeScript workspace
│   ├── src/
│   │   └── seams/             # the 4 replaced modules
│   │       ├── gated-dispatch.ts
│   │       ├── intervention-hook.ts
│   │       ├── capsule-session.ts
│   │       └── cycle-driver.ts
│   ├── bridge/
│   │   ├── event-emitter.ts   # writes events.jsonl via fs
│   │   └── policy-client.ts   # IPC to Python PolicyEngine
│   └── package.json
├── client-py/                  # Python client (see §5)
├── VENDOR_BOUNDARY.md
├── SEAM_CONTRACT.md           # frozen — no new public functions
├── PROTOCOL.md
├── REBASE_JOURNAL.md
└── LICENSE.OPENCODE           # MIT, anomalyco/opencode
```

**Rule**: No file outside `seams/` or `bridge/` may import provider-specific SDKs (`@anthropic-ai/*`, `openai`, etc.) directly. All provider calls go through OpenCode's existing abstraction.

---

## 3. IPC Protocol

**Transport**: JSON-lines over stdio (Unix socket upgrade optional in M2).

### 3.1 Message Types

```typescript
// Python → TS
type PolicyDecision = "allow" | "deny" | "ask" | { verb: string; narrow_args: Record<string, unknown> }
type ToolCallRequest  = { id: string; name: string; args: Record<string, unknown>; ctx: SessionCtx }
type CapsuleRequest   = { cycle_id: string }
type CycleControl     = { action: "start" | "pause" | "resume" | "halt" }

// TS → Python
type ToolCallResult   = { id: string; allowed: boolean; result?: unknown; error?: string }
type Intervention     = { verb: string; payload: unknown }
type EventEmission    = { event: Record<string, unknown> }
type CapsuleResponse  = { prefix: string; cache_break: string }
```

### 3.2 Session Context

```typescript
type SessionCtx = {
  cycle_id: string
  turn: number
  capsule_bytes: string  // base64, from nxl_core
  provider: "anthropic" | "openai" | "ollama"
}
```

### 3.3 Cycle Result (Python side)

```python
@dataclass
class CycleResult:
    cycle_id: str
    events: list[Event]
    final_state: bytes
    tool_calls: int
    blocked: int
```

---

## 4. The Four Seams

### 4.1 `gated-dispatch.ts`

- **Replaces**: `packages/opencode/src/tool/registry.ts` and `tool/index.ts`
- **Behavior**: Every tool call (from any source) goes through `policy-client.check()` over IPC before dispatch
- **Fast-path**: Read-only tools (`read_file`, `glob`, `grep`) pass `check()` but are logged; deny is still possible
- **Blocking**: If `policy-client` does not respond within 5s, tool is denied (fail-closed)
- **Adversarial**: No code path exists that dispatches a tool without going through this file

### 4.2 `intervention-hook.ts`

- **Replaces**: `packages/opencode/src/permission/` (evaluate.ts, index.ts)
- **Behavior**: Receives typed `Intervention` messages from Python via IPC, stores them in a queue
- **Safe-point scheduler** (called from `cycle-driver.ts`): drains queue between turns
- **Verbs**: `ask`, `warn`, `narrow`, `deny`, `escalate`, `trap`, `scaffold`, `redirect`, `explain`, `guide`, `review`, `confirm` (the 12-verb algebra)
- **Emits**: `InterventionApplied` event for each verb consumed

### 4.3 `capsule-session.ts`

- **Replaces**: `packages/opencode/src/session/session.ts`, `session/llm.ts`
- **Behavior**:
  - Disables OpenCode's built-in context summarization/compaction
  - Before each cycle, issues `CapsuleRequest` → receives `CapsuleResponse` with pre-rendered prefix
  - Inserts `cache_break` marker at end of prefix (provider-specific: Anthropic honors it)
- **Cache verification**: When provider=anthropic, assert ≥80% cache hit rate on turns 2+ via provider adapter logs; skip when provider doesn't support caching

### 4.4 `cycle-driver.ts`

- **Replaces**: `packages/opencode/src/agent/agent.ts` and `server/server.ts`
- **Behavior**:
  - Owns the turn loop for NexusLoop cycles (not OpenCode's default loop)
  - At lifecycle points (turn start, tool call, tool result, turn end), sends `EventEmission` to Python
  - Python writes to `events.jsonl` via `EventLog.append()`
  - Respects `CycleControl` messages from Python (halt on tripwire, pause on intervention)

---

## 5. Python Client (`agentcore/client-py/`)

### 5.1 `process.py`

```python
class ServerProcess:
    def start() -> None:    # spawn TS server subprocess
    def health_check() -> bool:  # ping/pong over stdio
    def shutdown() -> None:  # graceful SIGTERM, force kill after 10s
    def restart_on_hang() -> None:
```

### 5.2 `protocol.py`

All message types from §3 as Pydantic v2 models. Round-trip tests required in CI (Python↔TS↔Python byte-identical).

### 5.3 `client.py`

```python
class OpenCodeClient:
    def run_cycle(brief: str, policy_endpoint: str, events_endpoint: str) -> CycleResult: ...
    def stream_events(cycle_id: str) -> AsyncIterator[Event]: ...
    def inject_intervention(verb: str, payload: object) -> None: ...
    def snapshot_session() -> SessionSnapshot: ...
```

---

## 6. Provider Support

- **Anthropic**: Full tool use, cache breakpoint support, cache hit rate ≥80% on turns 2+
- **OpenAI**: Tool use via function calling schema; cache breakpoints skipped (log notice)
- **Ollama**: Local models; tool use varies by model; cache skipped (log notice)

Provider keys live in `~/.nxl/providers.toml` or environment variables. The TS server reads them via OpenCode's existing provider adapter. Python side does NOT make LLM calls.

---

## 7. Rebase Drill

`scripts/rebase-upstream.sh`:
1. `git subtree pull --prefix=agentcore/upstream anomalyco/opencode v1.14.22`
2. Run `bun run typecheck` in `agentcore/server-fork/`
3. Run Python test suite
4. Report conflict line count and wall clock time

**Success criteria**: <2 hours, ≤30 lines conflict. Phase cannot exit if any drill exceeded 1 day.

---

## 8. `nxl/core/run.py` Decomposition

Target: `run.py` ≤80 lines. Decompose into:

```
nxl/core/
├── orchestrator/
│   ├── loop.py           # extracted turn loop from run.py
│   ├── bootstrap.py      # startup/shutdown from run.py
│   ├── cycle_adapter.py  # calls agentcore.client_py
│   └── events_bridge.py  # translates OpenCode events → nxl events
└── run.py                # entry point only (<80 lines)
```

---

## 9. Phase M1.1 Steps

| Step | Description |
|------|-------------|
| 1.1 | Vendor OpenCode at v1.14.22 into `agentcore/upstream/` via git subtree add |
| 1.2 | Identify server package; document UPSTREAM_MAP.md |
| 1.3 | Create `agentcore/server-fork/` overlay workspace with path aliases |
| 1.4 | Write `scripts/rebase-upstream.sh` |
| 2.1 | Define `PROTOCOL.md` with all message types |
| 2.2 | Write protocol contract tests (Python↔TS↔Python round-trip) |
| 3.1 | Implement `gated-dispatch.ts` |
| 3.2 | Implement fast-path for read-only tools |
| 3.3 | Adversarial fuzz test: 10,000 random tool calls, 0 bypasses |
| 4.1 | Implement `intervention-hook.ts` |
| 4.2 | Safe-point scheduler in `cycle-driver.ts` |
| 5.1 | Implement `capsule-session.ts` |
| 5.2 | Cache hit rate verification |
| 6.1 | Implement `cycle-driver.ts` |
| 7.1 | `client-py/process.py` |
| 7.2 | `client-py/client.py` |
| 7.3 | Rewrite `nxl/core/agent_runner.py` as streaming adapter |
| 8.1 | Decompose `run.py` to ≤80 lines |
| 9.1 | E2E on anthropic, openai, ollama |
| 9.2 | Synthetic rule violation test |
| 9.3 | First rebase drill |

---

## 10. Exit Gate

```bash
# Structure
test -d agentcore/upstream
test -f agentcore/PROTOCOL.md
test -f agentcore/SEAM_CONTRACT.md
test -f agentcore/LICENSE.OPENCODE
(cd agentcore/server-fork && bun run typecheck)
mypy --strict agentcore/client-py/ nxl_core/ nxl/
pytest agentcore/tests/ --cov-fail-under=85
python scripts/fuzz-policy-gate.py 10000  # 0 bypasses
nxl run --once --provider anthropic --dry-run
nxl run --once --provider openai --dry-run
nxl run --once --provider ollama --dry-run
test "$(wc -l < nxl/core/run.py)" -le 80
bash scripts/rebase-upstream.sh --dry
```

---

## 11. Open Questions

None — all resolved during design.

---

*Written: 2026-04-24*