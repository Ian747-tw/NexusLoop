# ADR-017: Commander/OpenCode Context Memory Architecture

## Status

Accepted for Branch 9A as an architecture contract. Implementation beyond durable planned OpenCode session records is deferred.

## Product Invariant

NexusLoop preserves independent context windows for Commander and OpenCode.

- Commander owns strategic and research direction.
- OpenCode owns tactical execution inside a bounded session.
- Runtime owns durable authority, events, projections, lifecycle state, and permission boundaries.
- `research.db` is searchable memory. It is not root authority and does not replace `events.jsonl`, approved specs, proposal/review/apply records, checkpoints, or runtime projections.

Branch 9A creates durable planned OpenCode session records and policy metadata only. It does not compile full context packets, query `research.db`, launch OpenCode, run wake supervision, enforce timeouts, execute question/guidance flow, or ingest results.

## Memory Layers

NexusLoop uses three memory layers.

Durable memory:

- `.nxl/events.jsonl`
- approved spec backend state
- `research.db`
- artifact records
- checkpoints
- proposal, review, and apply records
- planned and future launched OpenCode session records

Runtime working memory:

- active session summary
- active Commander plan
- progress reports
- pending questions
- human interventions
- recent deltas

Compiled context packets:

- `CommanderContextPacket`
- `OpenCodeContextPacket`
- `WakeSupervisorContextPacket`
- `ResearchDecisionContextPacket`

Branch 9B0 audits OpenCode native context compatibility first. Branch 9B1 adds
the read-only model capability and context budget registry used to answer what a
model/context can afford. Branch 9B2 adds a read-only context packet compiler
skeleton that previews bounded sections, source pointers, omissions, and
warnings. It does not generate executable prompts, call providers, query
`research.db`, call MCPs, or decide research direction.

## Commander Context Rules

Commander context should include:

- approved spec
- mission objective
- current research frontier
- relevant `research.db` findings and trials
- active OpenCode session summaries
- pending questions
- recent human corrections
- proposal, review, and apply state

Commander context excludes by default:

- full `research.db`
- raw OpenCode logs
- full event log
- full repository dump
- all old proposals
- all external papers
- all MCP tool schemas

Commander may request targeted retrievals in future branches, but the context compiler must account for model limits, section budgets, source authority, and redaction.

## OpenCode Context Rules

OpenCode context should include:

- tactical objective
- success criteria
- relevant files and modules
- latest Commander guidance
- session memory and progress summary
- blockers and questions
- timeout and report policy

OpenCode context excludes by default:

- full Commander strategic history
- full `research.db`
- all previous runs
- full proposal, review, and apply history
- raw event log

OpenCode receives tactical context seeded by Commander and runtime records. It does not receive raw Commander chat or the entire runtime event stream.

## Long-Research Novelty Process

Commander should not propose serious training or research missions blindly. Before serious research proposals, Commander should consult durable research memory or explicitly state why no relevant memory exists.

Future branches should define `ResearchNoveltyCheck` with:

- `proposed_question`
- `proposed_method`
- `proposed_config`
- `nearest_prior_results`
- `duplicate_risk`
- `novelty_score`
- `difference_summary`
- `reason_not_duplicate`

Repeating prior research is allowed only with an explicit justification, such as:

- changed model
- changed dataset
- changed method
- changed hyperparameter or configuration
- bug fix
- replication
- previous result was inconclusive

The novelty check is a context and authority aid, not a prose-only bypass. Durable evidence and runtime authority remain the source of truth.

## Model And Context Budgets

Future context compilation must support provider and model differences through `ModelCapability` and `ContextBudget` concepts.

`ModelCapability` should include:

- `provider_kind`
- `model_id`
- `max_context_tokens`
- `max_output_tokens`
- `supports_tools`
- `supports_json_schema`
- `supports_mcp`

`ContextBudget` should include:

- provider and model identity
- total context allowance
- safety margin
- section budgets for spec, mission, research, proposals, sessions, questions, recent deltas, and output reserve

MiniMax is currently a validation provider, not the final assumption. The context compiler must support cloud providers and local models with different context sizes, tool support, schema support, and MCP availability.

## Wake Scheduler Supervision

Future wake supervision should compile a bounded wake packet containing:

- active session progress
- heartbeat status
- timeout status
- pending OpenCode questions
- relevant `research.db` retrievals
- recent human corrections
- Commander supervision decision

Wake supervision must not silently perform high-impact mutations. It should present or execute only through the existing runtime authority gates for the relevant action.

## OpenCode Asks Commander

Future OpenCode-to-Commander communication should use explicit records rather than raw chat coupling.

`OpenCodeCommanderQuestion` should capture:

- session id
- tactical blocker
- question text
- urgency
- related files or artifacts
- current OpenCode summary
- created time

`CommanderGuidance` should capture:

- linked question or session id
- guidance text
- strategic rationale summary
- constraints
- human escalation status
- created time

Human escalation remains explicit. Branch 9A stores question and human-control policy metadata only; it does not implement the question flow. Branch 9G implements the durable OpenCode-to-Commander question/request side by recording bounded pending `OpenCodeCommanderQuestion` events from explicit operator input, 9E progress evidence, and 9F watchdog/forced-report evidence. It does not answer questions, call Commander providers, inject guidance, send prompts to OpenCode, control processes, run wake supervision, write `research.db`, or mutate missions. Branch 9H records bounded `CommanderGuidance` answers and marks linked questions answered by projection only. It does not generate answers with providers, deliver guidance to OpenCode, send prompts, control processes, run wake supervision, write `research.db`, or mutate missions. Branch 9I adds the explicit delivery gate. In the real runtime path it records bounded operator handoff metadata and projects guidance to `pending_delivery`; it does not claim delivered status, send a prompt to OpenCode, call providers/MCPs, control processes, run wake supervision, write `research.db`, or mutate missions. Branch 9J records durable human-control metadata for launched sessions. Human pause/resume/stop/correction/override/report/note records are authoritative human input for future Commander/wake review, but they do not pause, kill, stop, or resume OS processes, send prompts to OpenCode, call providers/MCPs, write `research.db`, mutate missions, or mark mission/session success or failure. Branch 9L records explicit wake-supervisor execution ticks and capped batches from 9K previews. These records persist what the supervisor saw and recommended with `action_execution_status=not_executed`; they do not execute recommended commands, call providers/MCPs, send OpenCode prompts, control processes, write `research.db`, mutate missions, create checkpoints, or ingest results. Branch 9M adds a separate wake recommended-action execution gate for safe metadata-only actions. It consumes one 9L execution record and may call only typed allowlisted metadata APIs for watchdog records, forced-report requests, Commander question creation, or explicit operator-handoff delivery; it blocks arbitrary commands, provider calls, OpenCode prompts, process control, result review, `research.db` writes, mission mutation, checkpoints, and result ingestion. Branch 9N records bounded OpenCode result reports for completion, partial, failure, inconclusive, blocked, and status outcomes. These reports are executor evidence for future Commander review only; they do not complete missions or sessions, accept/reject results, write or ingest `research.db`, create checkpoints, call providers/MCPs, send OpenCode prompts, control processes, or mutate missions/proposals/reviews/apply records. Branch 9O adds bounded Commander/human result-review decisions for 9N reports. Accepted/rejected decisions are evidence-review dispositions only; they do not complete or fail missions, write or ingest `research.db`, create checkpoints or follow-up missions, call providers/MCPs, send OpenCode prompts, control processes, or mutate mission/proposal/review/apply authority. Branch 9P adds an explicit research-memory ingestion gate for one accepted-as-evidence 9O review. It writes only bounded reviewed evidence with pointer-only provenance into the existing research-memory/research.db backend and blocks rejected, unreviewed, deferred, revision-needed, and follow-up-needed reviews; it does not mutate missions, create checkpoints or follow-up missions, call providers/MCPs/online research, send OpenCode prompts, control processes, or decide future research direction.

## Session Continuity Modes

Branch 9Q expands the research-memory read path before Commander proposal generation. Search remains bounded lexical retrieval over accepted research-memory evidence and supported projections; inspection returns one bounded pointer-only record by ID; near-duplicate preview is advisory only; the search profile reports scan limits and that semantic, vector, FTS, provider, MCP, and online research are disabled. 9Q appends no events, writes no `research.db` rows, creates no proposals or follow-up missions, launches/prompts no OpenCode process, and makes no research-direction decision.

Branch 9R adds the read-only Commander continuity packet compiler. It introduces a packet layer above the existing event/projection services:

- short-term session memory from planned/launched OpenCode sessions, latest progress, watchdog state, Commander questions/guidance/delivery, human controls, wake supervision/execution/action records, result reports, and result reviews
- mid-term project/session continuity from recent sessions, result-report/review/ingestion lineage, and best-effort thread cards when explicit proposal thread IDs do not exist yet
- long-term research memory from the 9Q bounded lexical search, near-duplicate, inspection, and search-profile surfaces

The proposal packet requires an objective and returns readiness, open loops, research-memory profile/search/near-duplicate summaries, source refs, recommended commands, token-budget estimates, and omitted/truncated section metadata. The mid-mission packet requires a session or launch and returns active execution state, dialogue/guidance/delivery state, human-control state, wake/result state, open loops, source refs, and omissions. Both packet kinds are bounded evidence objects, not Commander reasoning or proposal text.

Open-loop detection in 9R is event/projection-derived and pointer-only. It can flag pending Commander questions, pending guidance delivery or operator handoff, human pause/stop/correction/override records, result reports needing review, accepted reviews not yet ingested, failed ingestions, timed-out or stale watchdogs, and blocked/manual wake actions. Open loops influence packet readiness, but 9R does not execute any recommended command.

9R appends no continuity events, writes no `research.db` rows, creates no Commander proposal or follow-up mission, calls no provider/MCP/online research, sends no OpenCode prompts, launches or controls no OpenCode process, creates no checkpoints, and mutates no mission/proposal/review/apply state. Future Branch 9S may consume 9R packets at an explicit Commander research proposal gate.

Future OpenCode launch modes should be explicit:

- `fresh`
- `continue_same_session`
- `fork_from_session`
- `patch_session`
- `resume_from_checkpoint`

The launch mode must determine which durable records and summaries are eligible for OpenCode context. It must not merge Commander and OpenCode context windows.

## Branch 9A Limitation

Branch 9A is intentionally narrow:

- creates durable planned OpenCode session records
- stores Commander/OpenCode context boundary summaries and hashes through session metadata
- stores timeout, question, and human-control policy metadata
- lists, gets, summarizes, previews, and dry-runs planned sessions
- rejects mismatched linked source IDs and terminal linked sources

Branch 9A does not:

- launch OpenCode
- start or attach an OpenCode process
- send prompts to OpenCode
- call MiniMax or any provider
- run Commander cycle
- compile full context packets
- query or write `research.db`
- run wake supervision
- poll progress
- enforce timeouts
- execute question/guidance flow
- mutate missions
- create checkpoints
- submit results

Branch 9B0 builds on this contract with an OpenCode native context compatibility audit. Branch 9B1 adds the read-only model capability and context budget registry used to answer what a model/context can afford. Branch 9B2 adds the read-only context packet compiler skeleton for Commander, OpenCode executor, wake supervisor, research retrieval, and open-question contexts. Branch 9B3 materializes bounded per-session OpenCode instruction/config artifacts under `.nxl/opencode/sessions/<session_id>/` with `launch_ready=false`; it does not launch OpenCode, mutate global repo memory, call providers, call MCPs, or query `research.db`. Branch 9B4 adds read-only research memory retrieval and novelty-check previews that return bounded source refs, duplicate-risk, novelty-score, and repetition-justification metadata. It does not decide research direction, call providers/MCPs, browse online sources, write `research.db`, ingest research, create missions/proposals, launch OpenCode, or run Commander cycle/synthesis. Branch 9C adds a read-only launch-readiness preview that verifies planned-session, instruction-pack, manifest/config, packet/budget, advisory novelty, and static native launch assumptions. It does not grant launch authority, start OpenCode, call providers/MCPs, write files, write `research.db`, mutate missions, or run wake/scheduler behavior. Branch 9D adds the first explicit high-impact launch gate for one ready planned session and records bounded launch metadata. It still does not supervise progress, enforce timeout, inject Commander guidance, implement OpenCode questions, call providers/MCPs from NexusLoop, write `research.db`, mutate missions/proposals/reviews/apply records, or run wake/scheduler behavior. Branch 9E adds typed heartbeat, progress, blocker, and question report metadata anchored to 9D launch records. It does not poll OpenCode, enforce timeouts, answer questions, inject Commander guidance, write `research.db`, mutate missions/proposals/reviews/apply records, or run wake/scheduler behavior. Branch 9F adds timeout watchdog assessments and forced-report request metadata anchored to 9A timeout policy, 9D launches, and 9E progress. It does not pause/kill/stop/resume OpenCode, send prompts, answer questions, inject Commander guidance, run wake supervision, call providers/MCPs, write `research.db`, mutate missions/proposals/reviews/apply records, or mark mission/session success or failure. Branch 9G adds durable pending `OpenCodeCommanderQuestion` records from explicit operator input, progress question/blocker evidence, watchdog assessments, and forced-report requests. It does not answer questions, inject guidance, call providers/MCPs, send OpenCode prompts, control processes, run wake supervision, write `research.db`, mutate missions/proposals/reviews/apply records, or mark mission/session success or failure. Branch 9H adds durable `CommanderGuidance` answer records and answered-question projection events. Delivery remains not delivered; it does not call providers/MCPs, send OpenCode prompts, control processes, run wake supervision, write `research.db`, mutate missions/proposals/reviews/apply records, or mark mission/session success or failure. Branch 9I adds the explicit delivery gate and records operator-handoff delivery requests as `pending_delivery` only. Because no safe running-session adapter send path exists yet, it does not mark real runtime guidance as delivered or send prompts to OpenCode. Branch 9J adds durable human-control metadata for launched sessions and projects pause/resume/stop/correction/override/report/note intent while always recording that no process control, OpenCode prompt send, or mission mutation occurred. Branch 9K adds a read-only wake supervisor preview that aggregates launched-session evidence across 9A/9D/9E/9F/9G/9H/9I/9J, produces bounded context sections and recommended commands, and appends no wake events, sends no prompts, controls no processes, calls no providers/MCPs, writes no `research.db`, and mutates no missions. Branch 9L adds scheduled wake supervisor execution metadata for explicit single-session and capped batch ticks. It appends bounded `opencode_wake_supervisor_execution_recorded` and batch records with `action_execution_status=not_executed`; it does not execute recommended commands, call providers/MCPs, send OpenCode prompts, control processes, write `research.db`, mutate missions, create checkpoints, or ingest results. Branch 9M adds gated execution for safe metadata-only wake recommendations. It can append action-execution records and call typed existing metadata services for watchdog, forced-report, question, or operator-handoff delivery actions only when the requested action matches the 9L recorded recommendation; it blocks mismatched overrides, arbitrary command execution, answer generation, real OpenCode delivery, result review, provider/MCP calls, process control, `research.db` writes, mission mutation, checkpoints, and result ingestion. Branch 9N adds result-report metadata for launched sessions. It records bounded executor-reported dispositions and review-needed state, but it does not accept/reject results, complete missions or sessions, ingest research, create checkpoints, call providers/MCPs, send OpenCode prompts, control processes, or mutate missions/proposals/reviews/apply records. Branch 9O adds Commander/human result-review decisions for 9N reports. Branch 9P adds the accepted-review research-memory ingestion gate: it can write bounded reviewed evidence into the existing research-memory/research.db backend with full provenance, but it does not create missions, complete sessions, call providers/MCPs, send OpenCode prompts, create checkpoints, or mutate mission/proposal/review/apply records. Branch 9Q upgrades research-memory search and inspection for future Commander proposal work while remaining read-only and bounded. Branch 9R compiles those long-term memory refs together with short-term session state and mid-term continuity into read-only Commander continuity packets for future proposal-time and mid-mission decisions.
