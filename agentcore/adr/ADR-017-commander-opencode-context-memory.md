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

Compiled packets are future Branch 9B work. Branch 9B0 audits OpenCode native context compatibility first; later 9B branches should make packets bounded, redacted, reproducible from durable memory plus explicit runtime state, and scoped to the recipient context window.

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

Human escalation remains explicit. Branch 9A stores question and human-control policy metadata only; it does not implement the question flow.

## Session Continuity Modes

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

Branch 9B0 should build on this contract with an OpenCode native context compatibility audit. Later 9B branches should add the context compiler, model capability registry, context budgets, research retrieval, and explicit Commander/OpenCode/wake packet construction.
