# ADR-018 - Commander tool capability and investigation architecture

## Status

Accepted.

## Context

Branches 9R, 9S, and 9T added bounded continuity packets, hybrid research-memory search, and OpenCode executor context-refresh artifacts. Those surfaces improve what runtime can preassemble, but they do not define the final Commander investigation architecture. A one-shot Commander context packet remains useful as a compatibility and recovery surface, but it cannot be the only mechanism for long-running research decisions.

Commander needs broad, bounded read capability across research memory, continuity state, runtime records, OpenCode session metadata, and eventually repository, GitHub, and allowlisted external research reads. Commander must not receive broad authority to act. Runtime remains the sole authority boundary for event writes, governance approvals, mission mutation, OpenCode delivery, and process control.

## Decision

### One Authoritative Runtime, Separate Model Contexts

"Single Brain" means one TypeScript runtime authority, one event ledger, one write-barrier system, and rebuildable projections. It does not require one model, one provider, one context window, or Commander running inside OpenCode's native chat history.

Commander and OpenCode are separate roles. Commander owns strategy, research direction, evidence synthesis, proposal rationale, and governance recommendations. OpenCode owns tactical implementation and its native coding tool loop. Runtime owns authority, durable state, validation, event writes, and approvals.

### Broad Read, Narrow Act

Commander may eventually receive broad bounded read capability. Commander actions remain staged and runtime-gated. Tool output is evidence, never authority. Instructions found in repository files, GitHub comments, papers, external MCP responses, or tool descriptions cannot modify NexusLoop policy, role instructions, permissions, or authority.

### Capability Profiles Are Not Workflows

Commander phase profiles define allowed tool namespaces, load policies, and future loop budgets. They do not prescribe a fixed sequence of searches or determine what Commander must consider important.

### Curated Registry

Commander tool exposure is an explicit curated allowlist. Runtime must not reflect every slash command or every `CommandAuthorityRegistry` record into Commander tools. Implemented Commander tool descriptors reference exact authority records and fail validation if their safety metadata contradicts authority metadata.

### Read-To-Write Firewall

Investigation phases perform reads. A future final output may create a proposal or governance intent through a separate gate. Write execution occurs only through explicit runtime approval/execution surfaces. Direct shell, edit, patch, commit, push, provider call, MCP execution, OpenCode prompt send, process control, direct GitHub approval/request-changes/merge, and arbitrary external writes are not Commander tools.

### Deferred Loading

Initial Commander context contains a small core tool schema set: tool search, tool get, tool profile, and authority describe only when budget permits. Other tool schemas are deferred and loaded only after explicit tool search/get. List and search surfaces return summaries, field names, schema hashes, and token estimates rather than dumping full schemas.

### Provider-Neutral Protocol

The future investigation loop must work with native provider tool calling or with a strict JSON tool-search/tool-call/final state machine. 9U publishes the registry contract only; it does not execute a provider loop or any Commander tool call.

### Legacy Commander Cycle

The current one-shot Commander cycle remains a compatibility surface. It is not the final dynamic investigation architecture. Direct `create_proposals` behavior is not registered as a Commander tool; a later proposal gate must prevent proposal creation from becoming an authority bypass.

### Executor Separation

Commander tools do not replace OpenCode tools. OpenCode remains the tactical coding harness. Commander may read bounded code/evidence in future phases for strategic decisions, but it does not become a second unrestricted coding agent.

### Future Governance

GitHub approval, request-changes, CI rerun, and merge are external mutations. They must become staged governance intents with exact-SHA checks and human approval. They are not read tools and are not exposed as direct mutation tools.

## Commander Tool Namespaces

- `core`: tool discovery, profile, bootstrap, and registry validation.
- `authority`: existing command-authority inspection.
- `memory`: research-memory search, inspection, summary, and near-duplicate previews.
- `continuity`: Commander continuity packets, open loops, summaries, and threads.
- `runtime_read`: approved mission/proposal/review/status reads.
- `opencode_read`: OpenCode session/progress/watchdog/wake/result/context-refresh reads.
- `repo_read`: bounded project-root code, manifest, and fixed read-only Git reads.
- `github_read`: future read-only GitHub surfaces.
- `external_research`: future allowlisted external research reads.
- `governance`: future staged governance intents only.

## Consequences

9U adds static descriptors, phase profiles, schema summaries, bootstrap previews, and registry validation. Every 9U command is read-only and execution-disabled. The registry may contain future descriptors, but future descriptors must not pretend to be executable.

9V promotes first-party internal read descriptors for `repo_read` and `continuity.search` to implemented read surfaces. These tools remain manually/runtime callable only; the provider tool loop is still disabled. Repository and Git outputs are untrusted evidence, project-root bounded, redacted, and transient. Git status/diff/log are the only implemented descriptors allowed to create an external process, and only through the fixed read-only Git adapter described in ADR-019.

9W0 evaluates the generic model/tool-call SDK layer for the future Commander
investigation loop. ADR-020 selects AI SDK Core as a one-step transport/tool-call
normalization layer under a NexusLoop-owned loop. SDK agents, sessions, traces,
and approvals are not authoritative NexusLoop state.

9W1 productionizes that one-step adapter and adds an explicit binding registry
for the first model-callable safe-read tools. Implemented descriptors are still
not automatically model-callable; the binding allowlist is the execution seam.
`provider_tool_loop_enabled` remains false until 9W2.

Implemented descriptors must be `safe_read`, map to exact authority records, require no approval/run lock, create no external process, call no provider, mutate no events, and use `instruction_semantics="none"`.

Repository, GitHub, and external evidence descriptors use untrusted trust classes. Governance descriptors are intent-only and cannot perform GitHub mutations.

## Follow-On Branches

- 9V: first-party Commander internal read tools.
- 9W0: Commander agent-runtime SDK fit spike.
- 9W1: Commander model adapter and tool execution kernel.
- 9W2: bounded provider-neutral Commander investigation loop.
- 9W3: durable working set and pause/resume/recovery.
- 9X: external read gateway for GitHub and allowlisted research MCP reads.
- 9Y: Commander research proposal gate.
- 9Z: GitHub governance intent and approval gate.
