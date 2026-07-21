# ADR-022 - Bounded in-memory Commander investigation controller

## Status

Accepted for Branch 9W2A.

## Context

9W1 added a one-request AI SDK Core model adapter and an explicit NexusLoop
tool executor, but it intentionally did not orchestrate model turns. Commander
still needs a controller that lets the model choose a bounded investigation path
inside the curated capability envelope.

9W2A proves that controller mechanic without adding provider credential wiring,
public runtime commands, TUI state, durable investigation records, proposal
generation, or external read gateways.

## Decision

### Model Freedom Inside Runtime Authority

The model may decide whether to finalize, search the tool catalog, load a tool
schema, call a loaded read tool, or stop. Runtime owns the phase envelope,
loaded schemas, binding allowlist, authority preflight, tool execution, context
construction, budgets, human interruption checks, and stopping conditions.

The controller does not prescribe a fixed research sequence. `memory.search`,
repository reads, operational continuity search, and Git reads are available
only after model-selected discovery/loading and runtime validation.

### Progressive Schema Disclosure

The initial tool set comes from the existing Commander bootstrap catalog and is
limited to core discovery/profile schemas when budget permits. Search results do
not automatically load tools. `commander.tool_get` loads a schema only when the
target descriptor is implemented, bound, phase-valid, not forbidden, and within
schema-count/byte/token budgets.

Loaded schema state is an additional execution requirement. A bound and
phase-valid tool is still not callable until its schema has been loaded for the
current investigation.

### Sequential Tool Execution

One assistant turn may contain multiple tool calls. 9W2A executes them
sequentially in provider order for deterministic replay, simpler interruption
handling, and bounded repository/Git access. Parallel execution remains out of
scope.

### Rolling Context

Each model step receives:

- runtime-owned authority kernel
- current objective and bounded bootstrap
- bounded in-memory working set
- the immediately preceding assistant tool-call message
- matching bounded tool-result messages

Older full model messages and full tool results are evicted. Evidence cards,
execution digests, loaded-tool state, warnings, and blockers summarize prior
turns. No model-generated compaction call is made.

### Budgets And Stops

The controller derives limits from `CommanderToolProfile` and
`ContextBudgetService`. It enforces model-turn, total tool-call, tool-search,
loaded-schema, per-turn tool-call, cumulative tool-result byte, context
byte/token, wall-time, repeated-call, and consecutive no-progress stops.

There is no automatic provider retry and no malformed-output repair turn.

### Human Control

Caller cancellation and session-bound human control checks happen before every
model step and before every tool execution. Pause, stop, correction, override,
and escalation stop the in-memory run with `needs_human_review`. 9W2A does not
create durable resume state.

### In-Memory Only

Investigation state is transient. 9W2A appends no events, writes no files,
writes no research DB records, mutates no missions/proposals/reviews/apply
state, and performs no OpenCode or GitHub action.

## Consequences

The internal runtime seam can now compose:

```text
bounded bootstrap
-> in-memory Commander controller
-> one-step AI SDK adapter
-> explicit tool executor
-> typed internal read services
-> bounded working set
-> final/stop
```

The public Commander tool profile remains conservative:
`provider_tool_loop_enabled=false`. 9W2A adds no public command, slash command,
TUI surface, durable run record, provider connector setup, or credential path.
9W2B1 adds only a connector-backed model transport substrate; it does not
activate live providers inside this controller.

9W2B2 owns RuntimeServer provider activation, connector preflight, run-lock
policy, model capability registration, and investigation audit reporting. 9W3
owns durable working sets, pause/resume, and recovery. 9Y owns proposal
generation.

Existing one-shot Commander-cycle provider behavior remains a compatibility
surface.
