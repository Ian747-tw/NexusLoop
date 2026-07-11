# OpenCode Native Context Compatibility Audit

Branch: 9B0  
Audit date: 2026-06-28  
Baseline: Branch 9A merge `9d78faa620a86bae6dffa0711e330bb55ca40790`

This audit is documentation only. It does not launch OpenCode, start a process, send prompts, call providers, call MCPs, mutate missions or proposals, compile context packets, or implement real launch.

## Sources Inspected

Local NexusLoop sources:

- `agentcore/runtime/src/opencode/*`
- `agentcore/runtime/src/opencode-session/*`
- `agentcore/runtime/src/tui/runtime-server-client.ts`
- `agentcore/runtime/src/server.ts`
- `agentcore/runtime/src/authority/command-authority-registry.ts`
- `tests/e2e_user/scenarios/test_opencode_*.py`
- `docs/ARCHITECTURE.md`
- `docs/TUI_UX.md`
- `docs/SPEC_BACKEND.md`
- `docs/RESEARCH_BACKEND.md`
- `docs/TEST_STRATEGY.md`
- `agentcore/adr/ADR-017-commander-opencode-context-memory.md`

Vendored and installed OpenCode evidence:

- Vendored package: `agentcore/upstream/packages/opencode/package.json`, version `1.14.22`.
- Installed CLI: `/home/ianchen951011/.opencode/bin/opencode`, version `1.14.41`.
- CLI help inspected only: `opencode --help`, `opencode run --help`, `opencode session --help`, `opencode serve --help`, `opencode agent --help`, and `opencode debug --help`.
- Vendored implementation inspected under `agentcore/upstream/packages/opencode/src`, including config, instruction loading, session routes, question routes, run command, agent configuration, compaction, overflow, and sync/event code.

Official online docs inspected on 2026-06-28:

- `https://opencode.ai/docs/`
- `https://opencode.ai/docs/config/`
- `https://opencode.ai/docs/cli/`
- `https://opencode.ai/docs/agents/`
- `https://opencode.ai/docs/permissions/`
- `https://opencode.ai/docs/sdk/`

The official site is partly client-rendered in fetched HTML, so the strongest evidence in this audit comes from local vendored source and installed CLI help. The online docs corroborate that config, CLI, agents, permissions, SDK, server, providers, models, MCP servers, and `AGENTS.md` are public OpenCode concepts.

## Executive Conclusion

Build an upper layer over OpenCode; no rewrite needed.

OpenCode already provides native conversation/session context, project instructions, configurable instruction files, provider/model selection, sessions, resume/fork controls, non-interactive `run`, server/SDK routes, questions, permissions, agents/subagents, step limits, and compaction. NexusLoop should reuse these as tactical executor mechanics.

NexusLoop still needs a thin adapter extension before real launch. The current NexusLoop process adapter speaks a custom JSONL handoff contract and does not yet bind to OpenCode native session IDs, per-session config directories, `opencode run --format json`, server/SDK session routes, native abort, native questions, or native fork/resume. That gap does not justify rewriting OpenCode. It does mean Branch 9C/9D should adapt to OpenCode's native surfaces instead of expanding the custom protocol blindly.

Forking OpenCode should remain a last resort, limited to cases where native surfaces cannot reliably support session-specific launch config, resume by session ID, structured progress/report extraction, stop/pause/report control, guidance injection, or durable artifact/log capture.

## Current NexusLoop OpenCode Integration Inventory

Current adapter kinds:

- `FakeOpenCodeAdapter` is deterministic and test-oriented. It does not launch OpenCode.
- `ProcessOpenCodeAdapter` starts a configured process with `spawn`, writes NexusLoop JSONL envelopes to stdin, reads stdout, and handles only the custom `nxl.executor_tool_call` output as actionable.

Current real process path:

- Configured by `NXL_OPENCODE_ADAPTER=process`, `NXL_OPENCODE_COMMAND`, `NXL_OPENCODE_ARGS_JSON`, and related timeout variables.
- Sends `nxl.session_start`, `nxl.mission_packet`, and `nxl.executor_tool_result` envelopes.
- Does not use native `opencode run`, native session IDs, native SDK routes, native config directories, or native progress events.
- `pauseAtSafeBoundary` and `resumeWithMissionUpdate` are interface methods but throw "not implemented" in the real process adapter.

Process smoke behavior:

- `opencode-process-smoke-service` has preview and dry-run paths that do not launch.
- Actual smoke execution is opt-in through `NXL_REAL_OPENCODE_SMOKE=1`.
- The smoke path starts a process adapter only for explicit opt-in smoke verification and records bounded smoke metadata.

Handoff readiness behavior:

- Read-only readiness combines process smoke preview, authority profile, handoff preview, and follow-up evidence.
- It does not launch OpenCode and reports whether handoff execution appears gated.

Result packet behavior:

- Result review packets are read-only projections over handoff, follow-up, mission, progress, result, proposal, and review evidence.
- They do not consume native OpenCode logs or native progress streams.

Existing no-start rules:

- `RuntimeServerClient` has no-start handling for preview, list, get, summary, dry-run session planning, handoff readiness, smoke previews, result review packets, result-review metadata, and research-ingestion previews/dry-runs.
- Non-dry planned-session creation does not auto-start OpenCode. It must fail cleanly unless runtime write gates are already active.

Existing authority registry records:

- OpenCode smoke, handoff, handoff readiness, result review packets, result-review metadata, and session-planning slash commands are registered with explicit risk profiles.
- `/opencode-session-plan` is a high-impact durable intent write, but its profile states that it creates only a planned session record and does not launch OpenCode.

Existing E2E coverage:

- Process smoke TUI scenarios.
- Handoff and handoff readiness scenarios.
- Result review packet and follow-up scenarios.
- Branch 9A planned OpenCode session model scenarios.
- Command authority inventory scenarios.

Not implemented yet:

- Native OpenCode launch.
- Native session attach/resume/fork integration.
- Session-specific OpenCode config writer.
- Context packet compiler.
- Research memory retrieval.
- Progress polling or streaming ingestion.
- Timeout/watchdog enforcement.
- Commander guidance injection.
- OpenCode asks Commander protocol.
- Real pause/stop/resume semantics.
- Result ingestion into typed research records.

## OpenCode Native Memory And Context Features

| Feature | Status | Evidence | Integration implication | Risk |
| --- | --- | --- | --- | --- |
| `AGENTS.md` or project instructions | Supported | `session/instruction.ts` loads `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md`; docs mention `AGENTS.md`. | Use for stable repo guidance only. | Putting long research history here would bloat every session. |
| Configurable instruction files/globs | Supported | Config schema has `instructions`; instruction service resolves local globs and remote URLs. | Future session config can include generated tactical files. | Remote instruction URLs should be disabled or tightly governed for NexusLoop launches. |
| Per-session config | Partially supported | `OPENCODE_CONFIG_DIR` and config loading exist; CLI/server do not expose a clear first-class per-session config field. | Prefer generated config directories per launched process or explicit server instance. | Shared server config may leak between sessions if not isolated. |
| Per-session model/provider selection | Supported | CLI `--model`; config `model`; server prompt payload includes model fields. | Map executor model from NexusLoop session launch policy. | Commander and OpenCode may use different providers and context budgets. |
| Compaction or summarization | Supported | `session/compaction.ts`, `session/overflow.ts`, `POST /session/:id/summarize`. | Reuse for tactical conversation management. | Native compaction is not authoritative research memory. |
| Context pruning | Supported | Config `compaction.prune`, tail turns, preserve recent tokens, reserved buffer. | Let OpenCode prune tactical logs; keep durable NexusLoop summaries separately. | Pruned raw context may lose evidence if NexusLoop has not captured reports. |
| Session persistence | Supported | Native `session list`, server session list/get, session DB/sync source. | Store native session ID on launched session records. | Native storage is not NexusLoop root authority. |
| Session resume/continue | Supported | CLI `--continue`, `--session`; server `session.prompt`. | Use for `continue_same_session`. | Need verify ID stability and workspace isolation in real launch tests. |
| Session IDs | Supported | CLI `--session`; server `/:sessionID` routes. | Link OpenCode native ID to NexusLoop session record. | Do not confuse native session ID with NexusLoop durable planned session ID. |
| Server/API/SDK attach | Supported | `opencode serve`, `run --attach`, SDK docs link, server routes. | Prefer SDK/server for controlled launch and progress extraction. | Authentication, lifecycle, and multi-session isolation need tests. |
| Subagents/agent modes | Supported | Config and agent source define primary/subagent/all modes. | Useful inside tactical execution, not for Commander authority. | Role confusion if Commander strategy is delegated to executor subagents. |
| Step/iteration limits | Supported | Agent config has positive integer `steps`. | Use native steps as inner executor bound. | Wall-clock and no-progress timeouts still belong to NexusLoop. |
| Permission controls | Supported | Permission config, `permission.asked`, server permission reply route. | Map NexusLoop launch authority into OpenCode permission profile. | Native permission approval must not bypass NexusLoop authority. |
| Tool restrictions | Supported | Config `tools`; permission keys include read/edit/bash/task/question/search/MCP-related controls. | Disable or scope executor tools per session. | Over-broad tools can mutate outside intended tactical scope. |
| Output logs | Supported | CLI `--print-logs`; run JSON events; native events/sync. | Capture bounded logs or progress reports, not raw dumps. | Raw logs can leak secrets and bloat events. |
| Session summaries | Supported | Session summary fields and summarize route. | Use as one evidence source for progress report generation. | Summary is model-generated, not sufficient for authority. |
| Event/progress stream | Supported | `opencode run --format json`; SDK event subscription in run implementation. | Candidate source for heartbeat/progress UI. | Needs schema pinning and redaction before durable ingestion. |
| Stop/interrupt | Supported | Server abort route calls prompt cancel. | Map to future stop/pause controls carefully. | Abort is not the same as safe pause/report. |
| Pause/resume | Unknown/partial | Native abort exists; no explicit safe pause route found. | Implement upper-layer paused/blocked state and resume/continue. | Killing a session may corrupt unreported progress. |
| Non-interactive/headless run | Supported | `opencode run`, `opencode serve`, `run --attach`. | Good fit for real launch branch. | Headless run still calls providers; must be gated. |
| Structured output mode | Partial | `run --format json` emits tool/step/text/reasoning/error events. | Use as transport for bounded extraction. | It is not a typed NexusLoop result schema. |
| Current working directory isolation | Supported/partial | CLI `--dir`; session path records cwd/root. | Launch per workspace/session directory policy. | Multiple sessions in same worktree can conflict. |
| Environment variable control | Supported/partial | `OPENCODE_CONFIG_DIR`, permission/config flags, NexusLoop adapter env. | Generate per-session env for launch. | Env inheritance can leak secrets or config. |

## Compatibility Matrix

| NexusLoop need | OpenCode native support | Proposed integration | Risk | Future branch |
| --- | --- | --- | --- | --- |
| Stable repo guidance | `AGENTS.md`, config instructions | Keep stable rules in repo/global instructions. | Bloat and stale policy if abused. | 9B3 |
| Session-specific tactical context | Config `instructions`, CLI files, prompt input | Generate bounded session files and include them at launch. | No first-class per-session config on shared server yet. | 9B2, 9B3 |
| Session resume | `--continue`, `--session`, server session routes | Store native session ID on launched record. | Need verify resume semantics across process/server restarts. | 9C |
| Fork/patch/resume modes | `--fork`, session fork route | Map future launch modes to native fork/session plus NexusLoop metadata. | Patch/resume_from_checkpoint need NexusLoop policy. | 9C, 9D |
| Context compaction | Native compaction and summarize | Reuse for tactical conversation only. | Compaction can hide raw details; store durable progress reports. | 9B2, 9E |
| Step/time limits | Native agent `steps`; no wall-clock watchdog | Use native steps plus NexusLoop watchdog. | Native step limit is not enough for hung processes. | 9F |
| Commander guidance injection | Prompt/command routes can send follow-up input | Inject bounded guidance on resume/continue, never raw Commander history. | Running-session guidance semantics need tests. | 9H |
| OpenCode asks Commander | Native question routes exist | Prefer upper-layer `OpenCodeCommanderQuestion` records, possibly backed by native question tool. | Default run denies `question`; role/authority needs design. | 9G |
| Progress reporting | JSON events, server events, summaries | Extract bounded progress reports from event stream or explicit report command. | Raw event stream is too noisy for authority. | 9E |
| Timeout report | No direct forced report found | NexusLoop watchdog asks for report or aborts/resumes with report request. | Cannot guarantee report before abort. | 9F |
| Pause/stop | Abort exists; safe pause unknown | Model pause/stop/resume first as explicit NexusLoop human-control metadata, then add native process control only behind a later gate. | Workspace may be mid-change; metadata intent is not proof of OS/process control. | 9F, 9J |
| Permissions | Native permission rules and replies | Derive OpenCode permission profile from runtime authority. | Native allow must not exceed NexusLoop authority. | 9C, 9D |
| Provider/model switching | CLI/config/prompt model selection | Use model capability registry and per-session executor model. | Different models have different context/tool support. | 9B1 |
| Local model support | Provider config model abstraction | Treat local models as provider capabilities. | Tool/schema/context differences may be large. | 9B1 |
| Raw log/artifact capture | Logs, JSON events, diffs, messages | Capture bounded artifacts and summaries only. | Secret leakage and event bloat. | 9E, 9M |
| `research.db` retrieval | Not native authority | Commander/NexusLoop retrieves, compiles bounded findings. | Dumping research history into executor context. | 9B4, 9L |
| Wake scheduler supervision | Not native | Wake compiles supervisor packet, records explicit ticks, and executes only typed allowlisted metadata actions through a separate gate. | Silent high-impact mutation if authority gates are skipped. | 9J, 9K, 9L, 9M |

## Proposed Layering

OpenCode native layer owns:

- conversation/session context
- `AGENTS.md` and project instructions
- config and instruction files
- compaction/pruning
- tactical tool execution
- subagents, if useful for tactical execution
- step limits, if configured
- native permissions and permission prompts
- provider/model execution

NexusLoop upper layer owns:

- approved spec
- `research.db` memory
- Commander strategy
- planned and launched OpenCode session records
- context packet compiler
- session-specific instruction/config writer
- progress reports
- timeout/watchdog state
- Commander questions and guidance
- human pause/override records
- proposal/review/apply authority
- event rebuildability and projections

Decision:

NexusLoop should not rewrite OpenCode internals unless required for session-specific config launch, resume/continue by session ID, structured progress/report extraction, stop/pause/report control, guidance injection into a running session, or reliable artifact/log capture. The first implementation should be an upper-layer wrapper with a thin adapter extension.

## Context Mapping Design

Stable repo memory should map to:

- `AGENTS.md` or equivalent project instructions.
- Project rules, test commands, coding conventions, and durable execution constraints.
- Long-lived permission and safety expectations.

Session tactical memory should map to generated bounded files such as:

- `.nxl/opencode/sessions/<session_id>/TASK.md`
- `.nxl/opencode/sessions/<session_id>/CONTEXT.md`
- `.nxl/opencode/sessions/<session_id>/GUIDANCE.md`
- `.nxl/opencode/sessions/<session_id>/SESSION_MEMORY.md`
- `.nxl/opencode/sessions/<session_id>/POLICY.md`
- `.nxl/opencode/sessions/<session_id>/MANIFEST.json`
- `.nxl/opencode/sessions/<session_id>/opencode-session-config.json`

Branch 9B3 writes these files as bounded, per-session future-launch artifacts with `launch_ready=false`. It does not launch OpenCode, mutate `AGENTS.md`, mutate global OpenCode config, call providers, call MCPs, or query `research.db`. Branch 9C adds a read-only launch-readiness preview that verifies the planned session, instruction-pack event metadata, on-disk generated file hashes, `MANIFEST.json`, `opencode-session-config.json`, context packet/budget status, advisory novelty metadata, and static native launch assumptions without spawning OpenCode. Branch 9D adds the first explicit launch gate: it rebuilds readiness, requires a ready planned session and matching instruction pack, supports preview/dry-run/list/get without starting OpenCode, and records bounded launch metadata for one explicit launch attempt. Fake launch remains process-free for tests; real external launch requires explicit opt-in and still does not supervise progress, enforce timeout, inject guidance, call providers/MCPs, or mutate missions. Branch 9E adds typed, bounded progress and heartbeat records anchored to 9D launch records. These reports capture heartbeat/progress/blocker/question metadata for future supervision without polling OpenCode, reading raw logs, enforcing timeouts, answering questions, injecting Commander guidance, writing `research.db`, or mutating missions. Branch 9G converts explicit operator input plus eligible 9E progress questions/blockers and 9F watchdog/forced-report evidence into durable `OpenCodeCommanderQuestion` records. It records the question side only and does not answer, call Commander providers, send prompts to OpenCode, inject guidance, control processes, run wake supervision, write `research.db`, or mutate missions. Branch 9H records bounded `CommanderGuidance` answers for pending questions and projects the linked question as answered. Delivery remains `not_delivered`; it does not call providers, send prompts to OpenCode, inject guidance into a process, control processes, run wake supervision, write `research.db`, or mutate missions. Branch 9I adds an explicit delivery gate for one `CommanderGuidance` record. Because the current adapter surface has no safe tested running-session prompt injection path, real/runtime delivery uses `operator_handoff` only: it records `pending_delivery` metadata and an operator handoff preview, but does not claim OpenCode received the guidance. `adapter_send` remains blocked until a later branch adds explicit opt-in and a safe adapter path. Branch 9J adds durable human-control records for pause/resume/stop/correction/override/report/note intent. These records project human intent for future Commander/wake supervision, but always record `process_control_performed=false`, `open_code_prompt_sent=false`, and `mission_mutated=false`. Branch 9K adds a read-only wake supervisor preview across launch/progress/watchdog/question/guidance/delivery/human-control evidence. Branch 9L records explicit wake-supervisor execution ticks and capped batches from the 9K preview while persisting `action_execution_status=not_executed`; it does not execute recommended commands, send OpenCode prompts, call providers/MCPs, control processes, write `research.db`, mutate missions, create checkpoints, or ingest results. Branch 9M adds a separate recommended-action execution gate for typed metadata-only actions. It may call existing 9F watchdog/forced-report, 9G question, or 9I operator-handoff services through explicit allowlisted APIs only when the requested action matches the 9L recorded recommendation; it blocks mismatched action overrides and never executes arbitrary recommended command text, calls providers/MCPs, sends OpenCode prompts, controls processes, writes `research.db`, mutates missions, creates checkpoints, or ingests results. Branch 9N adds bounded OpenCode result-report records for completion, partial, failure, inconclusive, blocked, and status reports. Result reports are executor evidence only: they do not mark missions or sessions complete, accept or reject results, write or ingest `research.db`, create checkpoints, call providers/MCPs, send OpenCode prompts, control processes, mutate missions/proposals/reviews/apply records, or run Commander review. Branch 9O adds the explicit Commander/human result-review gate. It records bounded review decisions such as accepted, rejected, needs revision, needs follow-up, inconclusive, deferred, or needs human review, but those decisions are report-evidence metadata only: they do not complete missions or sessions, ingest research, write `research.db`, create checkpoints or follow-up missions, call providers/MCPs, send OpenCode prompts, control processes, or mutate missions/proposals/reviews/apply records. Branch 9P adds the explicit research-memory ingestion gate for one 9O accepted-as-evidence review. It writes only bounded reviewed evidence into the existing research-memory/research.db backend and appends provenance metadata; rejected, unreviewed, revision-needed, follow-up-needed, and deferred reviews are blocked. It does not mutate missions, create checkpoints or follow-up missions, call providers/MCPs/online research, send OpenCode prompts, control processes, or decide future research direction. Branch 9Q upgrades research-memory search and inspection as read-only bounded lexical retrieval with explicit profile/limits and semantic/vector/FTS disabled. Branch 9R adds the Commander continuity packet compiler that combines short-term OpenCode session state, mid-term project/session/result-review/open-loop continuity, and long-term 9Q research-memory refs into proposal-time and mid-mission packets. It appends no events, writes no `research.db`, creates no Commander proposals, calls no providers/MCPs/online research, launches/prompts/controls no OpenCode process, creates no checkpoints or follow-up missions, and mutates no mission/proposal/review/apply records. Branch 9S upgrades research-memory search to bounded structured-filter + SQLite FTS/BM25 + lexical rerank when FTS is available, with deterministic lexical fallback and profile disclosure. The FTS index is incrementally maintained as projection/search infrastructure: legacy or new-version indexes are transactionally backfilled once through the write-authorized projection repair path, normal consistent `ResearchDb.open()` does not rebuild the complete index, read-only opens do not create missing FTS tables and fall back instead of repairing dirty FTS state, explicit `rebuildFromEvents` reconstructs the projection, and missing or inconsistent FTS membership is repaired internally without appending research evidence events when write authority is held. Session-scoped research-memory search remains best-effort; when source projections do not carry session IDs and global memory is used, the preview explicitly warns that session-scoped memory is unavailable. 9S creates no proposals, writes no research evidence, calls no providers/MCPs/online research, launches/prompts/controls no OpenCode process, creates no checkpoints or follow-up missions, and mutates no mission/proposal/review/apply records.

Durable memory remains:

- `.nxl/events.jsonl`
- approved spec backend state
- `research.db`
- planned and launched OpenCode session records
- progress reports
- result reports
- result review records
- `CommanderGuidance`
- `OpenCodeCommanderQuestion`
- `HumanIntervention`
- artifact registry
- proposal/review/apply records and checkpoints

Rules:

- Do not store long research history in `AGENTS.md`.
- Do not inject the whole `research.db` into OpenCode.
- Do not rely on OpenCode compaction as authoritative research memory.
- Do not copy raw Commander chat into OpenCode context.
- Do not treat native OpenCode session storage as NexusLoop root authority.

## Session Continuity Model

| Mode | OpenCode receives | Commander keeps | Runtime records | Must not inject |
| --- | --- | --- | --- | --- |
| `fresh` | Tactical task packet, generated session files, permission/model config. | Strategic rationale and research frontier. | Launched session record, native session ID, context hashes. | Full Commander history or full research DB. |
| `continue_same_session` | Native session ID plus bounded new guidance/progress request. | Strategic state and why continuation is needed. | Continuation event, guidance hash, expected report policy. | Raw event log or all prior proposals. |
| `fork_from_session` | Native fork source ID plus bounded fork reason and updated tactical context. | Branching rationale and alternative hypothesis. | Parent/child linkage and fork reason. | Unrelated previous runs. |
| `patch_session` | Target native session plus bounded patch instructions. | Why patch is allowed and what authority approved it. | Patch intent, files/artifacts in scope, result expectation. | Global repo memory changes as a shortcut. |
| `resume_from_checkpoint` | Checkpoint summary, relevant artifacts, and bounded task state. | Checkpoint selection rationale and research decision. | Checkpoint ID, replay basis, context hash. | Full checkpoint dump or unrelated artifacts. |

## Timeout And Trying-Too-Long Implications

Future launch should use dual control:

- OpenCode native step/agent limits as inner executor bounds.
- NexusLoop wall-clock timeout, no-progress timeout, heartbeat interval, and report-required policy as outer runtime supervision.
- Bounded progress reports as durable evidence.
- Forced pause/report behavior where safe.
- Commander wake review for timeout or no-progress cases.

Branch 9B0 does not implement timers, pause, abort, progress polling, or watchdog execution.

Branch 9F adds the first watchdog metadata layer: it previews and records wall-clock, no-progress, heartbeat, blocker, and question status from 9A timeout policy, 9D launch records, and 9E progress records. It can also record a bounded forced-report request. It does not poll OpenCode, send prompts, pause, kill, stop, resume, inject Commander guidance, answer OpenCode questions, execute wake supervision, write `research.db`, call providers/MCPs, mutate missions/proposals/reviews/apply records, or mark mission/session success or failure.

## OpenCode Asks Commander Implications

Native evidence:

- Server question routes can list, reply to, and reject pending questions.
- Permission routes can answer permission prompts.
- The non-interactive `run` command has permission/question handling, and its default permission rules deny `question`, `plan_enter`, and `plan_exit`.

Proposed upper-layer protocol:

- `OpenCodeCommanderQuestion` records tactical blocker/question text, urgency, source evidence, bounded context summary, options considered, executor recommendation, and creation time.
- `CommanderGuidance` records bounded answer/guidance, strategic rationale summary, constraints, and human escalation status.
- Runtime can mark a session paused or blocked until guidance is available.
- Guidance is injected only as bounded follow-up input on resume/continue.

Branch 9B0 does not implement this protocol. Branch 9G implements the durable question/request side only. It creates pending Commander question records from explicit input, 9E progress evidence, and 9F watchdog/forced-report evidence; it does not implement Commander answers, guidance injection, provider calls, OpenCode prompt sends, process pause/kill/stop, wake execution, or mission/proposal/review/apply mutation. Branch 9H implements the durable answer/guidance record side only. It creates `CommanderGuidance` metadata, appends an answered-question projection event, and leaves delivery status as `not_delivered`. Branch 9I implements the explicit delivery gate as operator handoff metadata only in the real runtime path: it can preview, dry-run, and record `opencode_commander_guidance_delivery_requested`, which projects guidance to `pending_delivery`; it still does not send a prompt to OpenCode, call providers/MCPs, control processes, run wake supervision, write `research.db`, mutate missions, or mark guidance as `delivered`. Branch 9J adds explicit human-control metadata for launched sessions. It can record pause/resume/stop/correction/override/report/note intent for later supervision, but it does not perform OS/process control, send OpenCode prompts, call providers/MCPs, execute wake supervision, write `research.db`, mutate missions, or claim OpenCode received the instruction. Branch 9L records wake-supervisor execution metadata from 9K previews only; it can persist single-session and batch tick records, but `action_execution_status` remains `not_executed` and no recommended action is performed. Branch 9M consumes one 9L execution record through an explicit gate and executes only typed metadata actions when they match the 9L recommendation: `record_watchdog`, `request_forced_report`, `create_commander_question`, and optional operator-handoff delivery. It blocks mismatched overrides, answer generation, real guidance delivery, result review, unsupported actions, and all arbitrary command execution. Branch 9N records bounded executor result reports for later Commander review; it does not accept results, complete missions, ingest research, create checkpoints, or mutate authority records beyond the result-report event. Branch 9O records the explicit Commander/human result-review decision for one 9N report. Accepted means accepted as evidence for future ingestion, rejected means rejected as evidence, and revision/follow-up decisions are recommendations only; 9O does not complete/fail missions, write or ingest `research.db`, create checkpoints or follow-up missions, call providers/MCPs, send OpenCode prompts, control processes, or mutate mission/proposal/review/apply authority. Branch 9P consumes only an accepted-as-evidence 9O review through an explicit ingestion command, writes bounded provenance-preserving research-memory evidence, and blocks rejected/unreviewed/deferred/revision/follow-up reviews. The ingestion record remains evidence storage, not mission completion, checkpoint creation, provider synthesis, online research, OpenCode delivery, or a research-direction decision. Branch 9Q expands read-only research-memory search and inspection with bounded lexical scoring explanations, record inspection by ID, near-duplicate previews, and search profile/limit reporting. It still does not write `research.db`, call providers/MCPs/online research, create proposals or follow-up missions, launch or prompt OpenCode, control processes, create checkpoints, or decide research direction.

## Provider And Model Support Implications

- MiniMax is currently a validation provider, not the final assumption.
- Future support includes multiple cloud providers and local models.
- Branch 9B1 implements the read-only model capability and context budget registry needed before packet compilation.
- Branch 9B2 implements a read-only context packet compiler skeleton. It previews packet sections, source refs, omitted refs, budget estimates, blockers, and warnings only; it does not generate executable prompts, call providers, launch OpenCode, query `research.db`, call MCPs, mutate runtime authority records, or decide research direction.
- Context packets must be model-capability aware.
- OpenCode native model config may be used for the executor model.
- Commander provider and OpenCode provider may differ.
- Do not assume Commander and OpenCode have the same context size, tool support, JSON schema support, MCP availability, or output budget.

## Research-Memory Implications

- Commander should search `research.db` before proposing serious research or training missions, or explicitly record why no relevant memory exists.
- Current 9S search is bounded hybrid retrieval: structured filters first, SQLite FTS/BM25 over bounded accepted research-memory fields when available, then deterministic lexical rerank/fallback. The profile reports FTS availability/fallback, scan limits, and disabled semantic/vector/embedding/provider search so Commander can evaluate retrieval limits honestly. FTS lifecycle state is durable in the research projection metadata; first migration or schema-version changes may backfill the index transactionally through the write-authorized projection repair path, but a consistent reopen performs no full delete/reinsert rebuild, and read-only opens with missing or dirty FTS state do not create/repair the FTS table and use bounded lexical fallback instead. Search results do not prove novelty, and session-scoped search explicitly warns when it can only provide global memory because source projections lack session IDs.
- OpenCode should usually receive only bounded retrieved findings, Commander guidance, and tactical constraints.
- Future `ResearchNoveltyCheck` should compare proposed work to prior trials/findings and explain why a run is not a duplicate.
- MCP online research should route through Commander/research tooling. It should not be dumped directly into OpenCode tactical context.
- OpenCode compaction can preserve executor continuity, but it cannot replace durable research records or proposal/review/apply authority.

## Risks And Open Questions

- Can NexusLoop reliably address and resume OpenCode sessions by ID across process and server boundaries?
- Can NexusLoop inject guidance into an existing running session without role confusion or duplicate execution?
- Can NexusLoop force a structured progress report before timeout or abort?
- Can NexusLoop stop or pause without corrupting workspace state?
- Can NexusLoop capture progress without raw-log bloat or secret leakage?
- Can NexusLoop configure instructions per session without modifying global repo memory?
- Can OpenCode compaction be controlled per session and model?
- Can multiple sessions be isolated safely in one worktree?
- Does NexusLoop need a thin OpenCode adapter extension for native SDK/server routes?
- Does NexusLoop need a fork, or is the wrapper enough after native launch testing?
- What is the stable schema contract for `opencode run --format json` and SDK event streams?
- How should NexusLoop reconcile native OpenCode permission prompts with runtime authority gates?

## Recommended Future Branch Plan

- 9B1: model capability + context budget registry (read-only planning surface)
- 9B2: context packet compiler skeleton (read-only packet previews; no executable prompt compilation)
- 9B3: session-specific OpenCode config/instruction writer (bounded artifact writer only; no launch)
- 9B4: `research.db` retrieval + novelty-check planner
- 9C: real OpenCode launch readiness (read-only; no launch authority)
- 9D: real OpenCode launch gate (explicit one-session launch metadata; no progress/timeout/guidance supervision)
- 9E: progress report / heartbeat model (typed report metadata only; no polling, timeout enforcement, Commander guidance, wake supervision, or mission mutation)
- 9F: timeout watchdog / forced report request model (metadata only; no process pause/kill, Commander guidance, question answer, wake execution, provider/MCP call, research.db write, or mission mutation)
- 9G: OpenCode asks Commander protocol (durable pending question records only; no answer, guidance, provider call, OpenCode prompt send, process control, wake execution, research.db write, or mission mutation)
- 9H: Commander guidance answer protocol (records bounded answer metadata and answered-question projection; no delivery)
- 9I: Commander guidance delivery gate (operator handoff/pending-delivery metadata only unless a future safe adapter_send path is added)
- 9J: human live control metadata gate (pause/resume/stop/correction/override/report intent only; no process control or OpenCode prompt send)
- 9K: wake supervisor preview (read-only aggregate evidence/context surface across 9A/9D/9E/9F/9G/9H/9I/9J records; no scheduled wake tick, provider call, OpenCode prompt send, process control, `research.db` write, or mission mutation)
- 9L: scheduled wake supervision execution metadata (single/batch records with `action_execution_status=not_executed`; no recommended command execution)
- 9M: wake recommended-action execution gate (typed allowlisted metadata actions only; no arbitrary command execution, provider call, OpenCode prompt send, process control, `research.db` write, mission mutation, result ingestion, or checkpoint creation)
- 9N: OpenCode result report model (executor evidence only; no Commander acceptance, mission completion, research ingestion, or checkpoint creation)
- 9O: Commander result review gate (bounded review-decision metadata only; no mission completion, research ingestion, checkpoint/follow-up mission creation, provider call, OpenCode prompt, process control, or mission/proposal/review/apply mutation)
- 9P: research.db ingestion promotion gate (accepted-as-evidence reviews only; bounded research-memory write with provenance; no mission mutation, checkpoint/follow-up mission creation, provider/MCP call, OpenCode prompt, process control, or research-direction decision)
- 9Q: research memory search/inspection expansion (bounded lexical read-only search, inspection, near-duplicate, and profile; no writes or proposal generation)
- 9R: Commander continuity packet compiler (read-only short/mid/long-term continuity packets; no proposal generation or writes)
- 9S: lightweight hybrid research-memory search (structured filters + SQLite FTS/BM25 when available + lexical fallback/rerank; no semantic/vector/provider/MCP search, research-evidence writes, proposal generation, or mission mutation)
- Future: Commander research proposal gate and end-to-end supervised training demo

## Branch 9B0 Explicit Out Of Scope

Branch 9B0 does not:

- launch OpenCode
- start or attach an OpenCode process
- send prompts to OpenCode
- call MiniMax or any provider
- call MCPs
- mutate missions, proposals, reviews, or apply records
- create new planned sessions beyond existing tests
- compile full context packets
- write session-specific OpenCode config
- poll progress
- enforce timeouts
- execute pause, stop, resume, question, or guidance flows
- query or write `research.db`
- run wake supervision
- create checkpoints
- ingest results
