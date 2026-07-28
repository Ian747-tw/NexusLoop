import { open, readFile, stat } from "node:fs/promises"
import { redactText, redactValue } from "../security/redaction"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderEvidenceCard, CommanderReadSourceRef } from "../commander-tools/commander-read-types"
import type { CommanderToolDescriptor } from "../commander-tools/commander-tool-types"
import { stableHash } from "./commander-model-schema"
import type { CommanderModelAssistantMessage, CommanderModelToolCallPart, CommanderModelToolResultMessage } from "./commander-model-types"
import type {
  CommanderInvestigationCheckpointSnapshot,
  CommanderInvestigationDurabilitySummary,
  CommanderInvestigationInput,
  CommanderInvestigationPersistenceObserver,
  CommanderInvestigationResult,
  CommanderInvestigationStartedSnapshot,
  CommanderInvestigationModelStepStartedSnapshot,
  CommanderInvestigationTurnSummary,
  CommanderInvestigationWorkingSet,
} from "./commander-investigation-types"
import type {
  CommanderDurableModelTextFingerprint,
  CommanderDurableAssistantMessage,
  CommanderDurableToolResultSummaryMessage,
  CommanderInvestigationCheckpoint,
  CommanderInvestigationFinishedPayload,
  CommanderInvestigationJournalSummary,
  CommanderInvestigationLoadedToolRef,
  CommanderInvestigationModelStepStartedPayload,
  CommanderInvestigationRecord,
  CommanderInvestigationStartedPayload,
  CommanderInvestigationTerminalRecord,
} from "./commander-investigation-journal-types"
import { projectCommanderInvestigationJournal } from "./commander-investigation-journal-projection"

const CHECKPOINT_DEFAULT_CAP = 64_000
const CHECKPOINT_HARD_CAP = 96_000
const MODEL_STEP_CAP = 8_000
const TERMINAL_CAP = 48_000
const STARTED_HARD_CAP = 112_000
const MIN_TEST_CAP = 16_000

export class CommanderInvestigationJournalConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CommanderInvestigationJournalConflictError"
  }
}

export class CommanderInvestigationPersistenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CommanderInvestigationPersistenceError"
  }
}

export type CommanderInvestigationJournalServiceOptions = {
  eventStore: EventStore
  now?: () => Date
  checkpointPayloadCapBytes?: number
}

export type CommanderInvestigationJournalListOptions = {
  status?: string
  statuses?: string[]
  phase?: string
  provider_id?: string
  session_id?: string
  mission_id?: string
  limit?: number
}

export type CommanderInvestigationJournalRun = {
  investigation_id: string
  observer: CommanderInvestigationPersistenceObserver
  state: CommanderInvestigationJournalRunState
}

export type CommanderInvestigationJournalRunState = {
  started_persisted: boolean
  terminal_persisted: boolean
  persistence_fenced: boolean
  in_flight_persistence: Set<Promise<unknown>>
  started_event_id?: string
  started_at?: string
  latest_checkpoint_event_id?: string
  finished_event_id?: string
  latest_checkpoint?: CommanderInvestigationCheckpoint
  checkpoint_count: number
  investigation_event_count: number
  journal_sequence: number
  checkpoint_sequence: number
  pending_model_request_id?: string
  requested_by: string
  objective_hash?: string
  warnings: string[]
}

export class CommanderInvestigationJournalService {
  private readonly now: () => Date
  private readonly checkpointPayloadCapBytes: number
  private readonly active = new Set<string>()

  constructor(private readonly options: CommanderInvestigationJournalServiceOptions) {
    this.now = options.now ?? (() => new Date())
    const cap = options.checkpointPayloadCapBytes ?? CHECKPOINT_DEFAULT_CAP
    this.checkpointPayloadCapBytes = Math.min(CHECKPOINT_HARD_CAP, Math.max(MIN_TEST_CAP, cap))
  }

  async createObserver(input: CommanderInvestigationInput): Promise<CommanderInvestigationJournalRun> {
    const investigationId = safeId(input.investigation_id)
    if (!investigationId) throw new CommanderInvestigationPersistenceError("durable investigation requires a bounded investigation_id")
    if (this.active.has(investigationId)) throw new CommanderInvestigationJournalConflictError("duplicate concurrent durable investigation")
    this.active.add(investigationId)
    const existing = await this.get(investigationId).catch((error) => {
      this.active.delete(investigationId)
      throw error
    })
    if (existing) {
      this.active.delete(investigationId)
      throw new CommanderInvestigationJournalConflictError(existing.status === "running" ? "existing durable investigation requires 9W3B recovery" : "durable investigation_id already exists")
    }
    const state: CommanderInvestigationJournalRunState = {
      started_persisted: false,
      terminal_persisted: false,
      persistence_fenced: false,
      in_flight_persistence: new Set(),
      checkpoint_count: 0,
      investigation_event_count: 0,
      journal_sequence: 0,
      checkpoint_sequence: 0,
      requested_by: bound(input.requested_by, 200),
      warnings: [],
    }
    return {
      investigation_id: investigationId,
      state,
      observer: {
        onStarted: (snapshot) => this.onStarted(state, snapshot),
        onModelStepStarted: (snapshot) => this.onModelStepStarted(state, snapshot),
        onCheckpoint: (snapshot) => this.onCheckpoint(state, snapshot),
      },
    }
  }

  release(run: CommanderInvestigationJournalRun): void {
    this.active.delete(run.investigation_id)
  }

  fence(run: CommanderInvestigationJournalRun, reason: string): void {
    run.state.persistence_fenced = true
    run.state.warnings = [...run.state.warnings, bound(reason, 240)].slice(-12)
  }

  inFlightPersistenceCount(run: CommanderInvestigationJournalRun): number {
    return run.state.in_flight_persistence.size
  }

  async settleInFlightPersistence(run: CommanderInvestigationJournalRun): Promise<void> {
    while (run.state.in_flight_persistence.size > 0) {
      await Promise.allSettled(Array.from(run.state.in_flight_persistence))
    }
  }

  async finish(run: CommanderInvestigationJournalRun, result: CommanderInvestigationResult): Promise<CommanderInvestigationDurabilitySummary> {
    assertNotFenced(run.state)
    if (!run.state.started_persisted || run.state.terminal_persisted) return this.durability(run.state)
    const checkpoint = run.state.latest_checkpoint
    if (!checkpoint) throw new CommanderInvestigationPersistenceError("cannot finish durable investigation without an initial checkpoint")
    let terminal: CommanderInvestigationTerminalRecord = {
      schema_version: 1,
      investigation_id: result.investigation_id,
      status: result.status,
      stop_reason: result.stop_reason,
      phase: checkpoint.phase,
      objective_hash: run.state.objective_hash ?? stableHash(result.objective_preview),
      provider_id: checkpoint.provider_id,
      provider_kind: checkpoint.provider_kind,
      model_id: checkpoint.model_id,
      tool_protocol: checkpoint.tool_protocol,
      final_output: result.final_summary ? durableModelTextFingerprint(result.final_summary) : undefined,
      conclusion: durableConclusion(result),
      bootstrap_id: checkpoint.bootstrap_ref.bootstrap_id,
      bootstrap_hash: checkpoint.bootstrap_ref.bootstrap_hash,
      budget_id: checkpoint.budget.budget_id,
      budget_hash: checkpoint.budget.budget_hash,
      last_checkpoint_id: checkpoint.checkpoint_id,
      last_checkpoint_sequence: checkpoint.checkpoint_sequence,
      last_checkpoint_hash: checkpoint.checkpoint_hash,
      pending_model_request_id: undefined,
      model_turn_count: result.model_turn_count,
      provider_request_count: result.provider_request_count,
      tool_call_count: result.tool_call_count,
      tool_search_call_count: result.tool_search_call_count,
      loaded_tool_ids: checkpoint.loaded_tools.map((tool) => tool.tool_id).slice(0, 24),
      evidence_cards: sanitizeEvidence(result.evidence).slice(0, result.budget.max_evidence_cards),
      turn_summaries: sanitizeTurnSummaries(result.turn_summaries),
      omitted_evidence_count: result.omitted_evidence_count,
      omitted_turn_count: result.omitted_turn_count,
      provider_audit: sanitizedProviderAudit(result.provider_audit),
      blockers: result.blockers.map((item) => bound(item, 300)).slice(0, 16),
      warnings: result.warnings.map((item) => bound(item, 300)).slice(0, 24),
      semantic_result_hash: result.result_hash,
      started_at: result.started_at,
      completed_at: result.completed_at,
      terminal_hash: "",
      transcript_persisted: false,
      raw_tool_results_persisted: false,
      chain_of_thought_persisted: false,
    }
    terminal = finalizeTerminalHash(redactValue(compactTerminal(terminal, TERMINAL_CAP - 512)) as CommanderInvestigationTerminalRecord)
    let payload = withPayloadHash({
      schema_version: 1 as const,
      investigation_id: result.investigation_id,
      journal_sequence: run.state.journal_sequence,
      requested_by: run.state.requested_by,
      occurred_at: this.now().toISOString(),
      terminal,
      event_payload_hash: "",
    } satisfies CommanderInvestigationFinishedPayload)
    while (eventBytes({ kind: "runtime_commander_investigation_finished", ...payload }) > TERMINAL_CAP) {
      const next = compactTerminalOnce(payload.terminal)
      if (next === payload.terminal) break
      terminal = finalizeTerminalHash(redactValue(next) as CommanderInvestigationTerminalRecord)
      payload = withPayloadHash({
        schema_version: 1 as const,
        investigation_id: result.investigation_id,
        journal_sequence: run.state.journal_sequence,
        requested_by: run.state.requested_by,
        occurred_at: payload.occurred_at,
        terminal,
        event_payload_hash: "",
      } satisfies CommanderInvestigationFinishedPayload)
    }
    const eventId = await this.trackedAppendCapped(run.state, "runtime_commander_investigation_finished", payload, TERMINAL_CAP)
    run.state.terminal_persisted = true
    run.state.finished_event_id = eventId
    run.state.investigation_event_count += 1
    run.state.journal_sequence += 1
    run.state.pending_model_request_id = undefined
    return this.durability(run.state)
  }

  async get(investigationId: string): Promise<CommanderInvestigationRecord | undefined> {
    const projection = projectCommanderInvestigationJournal(await this.readJournalEvents())
    return projection.records.find((record) => record.investigation_id === investigationId)
  }

  async list(options: CommanderInvestigationJournalListOptions = {}): Promise<CommanderInvestigationRecord[]> {
    return this.listProjected(options, 100, 20)
  }

  async listForOperationalMemorySearch(options: CommanderInvestigationJournalListOptions = {}): Promise<CommanderInvestigationRecord[]> {
    return this.listProjected(options, 800, 800)
  }

  private async listProjected(options: CommanderInvestigationJournalListOptions, maxLimit: number, defaultLimit: number): Promise<CommanderInvestigationRecord[]> {
    const projection = projectCommanderInvestigationJournal(await this.readJournalEvents())
    const limit = Math.max(1, Math.min(maxLimit, Number.isInteger(options.limit) ? Number(options.limit) : defaultLimit))
    return projection.records
      .filter((record) => !options.status || record.status === options.status)
      .filter((record) => !options.statuses?.length || options.statuses.includes(record.status))
      .filter((record) => !options.phase || record.phase === options.phase)
      .filter((record) => !options.provider_id || record.provider_id === options.provider_id)
      .filter((record) => !options.session_id || record.session_id === options.session_id)
      .filter((record) => !options.mission_id || record.mission_id === options.mission_id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.investigation_id.localeCompare(b.investigation_id))
      .slice(0, limit)
  }

  async latestCheckpoint(investigationId: string): Promise<CommanderInvestigationCheckpoint | undefined> {
    const projection = projectCommanderInvestigationJournal(await this.readJournalEvents())
    return projection.checkpoints.filter((checkpoint) => checkpoint.investigation_id === investigationId).sort((a, b) => b.checkpoint_sequence - a.checkpoint_sequence)[0]
  }

  async getCheckpoint(checkpointId: string): Promise<CommanderInvestigationCheckpoint | undefined> {
    const projection = projectCommanderInvestigationJournal(await this.readJournalEvents())
    return projection.checkpoints.find((checkpoint) => checkpoint.checkpoint_id === checkpointId)
  }

  async summary(): Promise<CommanderInvestigationJournalSummary> {
    const projection = projectCommanderInvestigationJournal(await this.readJournalEvents())
    const records = projection.records
    return {
      total: records.length,
      running_count: records.filter((record) => record.status === "running").length,
      terminal_count: records.filter((record) => record.status !== "running").length,
      final_count: records.filter((record) => record.status === "final").length,
      failed_count: records.filter((record) => record.status === "failed").length,
      cancelled_count: records.filter((record) => record.status === "cancelled").length,
      needs_human_review_count: records.filter((record) => record.status === "needs_human_review").length,
      checkpoint_available_count: records.filter((record) => record.checkpoint_available).length,
      uncertain_provider_outcome_count: records.filter((record) => record.uncertain_provider_outcome).length,
      corrupt_count: records.filter((record) => record.projection_status === "corrupt").length,
      last_investigation_id: records[0]?.investigation_id,
      last_checkpoint_id: records[0]?.latest_checkpoint_id,
      generated_at: this.now().toISOString(),
    }
  }

  async verify(investigationId: string): Promise<CommanderInvestigationRecord | undefined> {
    return this.get(investigationId)
  }

  private async readJournalEvents(): Promise<JsonlEvent[]> {
    try {
      const text = await readFile(this.options.eventStore.eventsPath, "utf8")
      const events: JsonlEvent[] = []
      text.split(/\r?\n/).forEach((line, index) => {
        if (!line) return
        try {
          events.push(JSON.parse(line) as JsonlEvent)
        } catch {
          const investigationId = recoverInvestigationIdFromMalformedLine(line, index)
          if (investigationId) events.push(malformedJournalLineEvent(investigationId, index))
        }
      })
      return events
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  private async onStarted(state: CommanderInvestigationJournalRunState, snapshot: CommanderInvestigationStartedSnapshot): Promise<void> {
    assertNotFenced(state)
    if (state.started_persisted) throw new CommanderInvestigationJournalConflictError("durable investigation already started")
    const objective = bound(snapshot.input.objective, 1000)
    if (objective.length !== snapshot.input.objective.replace(/\s+/g, " ").trim().length && snapshot.input.objective.replace(/\s+/g, " ").trim().length > 1000) {
      throw new CommanderInvestigationPersistenceError("durable investigation objective exceeds 1000 characters")
    }
    const identityErrors = persistedIdentityErrors(snapshot.input, snapshot.investigation_id)
    if (identityErrors.length) throw new CommanderInvestigationPersistenceError(`durable investigation identity is not persistable: ${identityErrors.join("; ")}`)
    const objectiveHash = stableHash(objective)
    state.objective_hash = objectiveHash
    const checkpoint = this.buildCheckpoint({
      snapshot,
      checkpointKind: "initial",
      checkpointSequence: 0,
      previous: undefined,
      turnIndex: 0,
      nextTurnIndex: 1,
      turnSummaries: [],
      latestToolResults: [],
      providerRequestCount: 0,
      elapsedActiveMs: 0,
      createdAt: snapshot.started_at,
    })
    const normalizedInput = sanitizeInput({ ...snapshot.input, investigation_id: snapshot.investigation_id })
    const payload = withPayloadHash({
      schema_version: 1 as const,
      investigation_id: snapshot.investigation_id,
      journal_sequence: 0 as const,
      requested_by: bound(snapshot.input.requested_by, 200),
      occurred_at: snapshot.started_at,
      normalized_input: normalizedInput,
      input_hash: stableHash(normalizedInput),
      phase: snapshot.input.phase,
      objective,
      objective_hash: objectiveHash,
      mission_id: snapshot.input.mission_id,
      session_id: snapshot.input.session_id,
      launch_id: snapshot.input.launch_id,
      provider_id: bound(snapshot.input.provider_id, 120),
      provider_kind: bound(snapshot.input.provider_kind, 80),
      model_id: bound(snapshot.input.model_id, 200),
      tool_protocol: snapshot.tool_protocol,
      budget: snapshot.budget,
      budget_hash: snapshot.budget.budget_hash,
      bootstrap_ref: { bootstrap_id: snapshot.bootstrap.bootstrap_id, bootstrap_hash: snapshot.bootstrap.bootstrap_hash },
      initial_loaded_tool_refs: loadedToolRefs(snapshot.loaded_tools),
      initial_checkpoint: checkpoint,
      started_at: snapshot.started_at,
      summary_preview: `${snapshot.input.phase}: ${objective}`.slice(0, 400),
      event_payload_hash: "",
    } satisfies CommanderInvestigationStartedPayload)
    const eventId = await this.trackedAppendCapped(state, "runtime_commander_investigation_started", payload, STARTED_HARD_CAP)
    state.started_persisted = true
    state.started_event_id = eventId
    state.started_at = snapshot.started_at
    state.latest_checkpoint = checkpoint
    state.latest_checkpoint_event_id = eventId
    state.checkpoint_count = 1
    state.investigation_event_count = 1
    state.journal_sequence = 1
    state.checkpoint_sequence = 1
  }

  private async onModelStepStarted(state: CommanderInvestigationJournalRunState, snapshot: CommanderInvestigationModelStepStartedSnapshot): Promise<void> {
    assertNotFenced(state)
    if (!state.started_persisted || !state.latest_checkpoint) throw new CommanderInvestigationPersistenceError("model-step boundary cannot be persisted before durable start")
    const payload = withPayloadHash({
      schema_version: 1 as const,
      investigation_id: snapshot.investigation_id,
      journal_sequence: state.journal_sequence,
      turn_index: snapshot.turn_index,
      model_request_id: snapshot.model_request_id,
      provider_id: bound(snapshot.input.provider_id, 120),
      provider_kind: bound(snapshot.input.provider_kind, 80),
      model_id: bound(snapshot.input.model_id, 200),
      tool_protocol: snapshot.tool_protocol,
      base_checkpoint_id: state.latest_checkpoint.checkpoint_id,
      base_checkpoint_sequence: state.latest_checkpoint.checkpoint_sequence,
      base_checkpoint_hash: state.latest_checkpoint.checkpoint_hash,
      working_set_hash: snapshot.working_set_hash,
      context_hash: snapshot.context_hash,
      input_bytes: snapshot.input_bytes,
      estimated_input_tokens: snapshot.estimated_input_tokens,
      loaded_tool_refs: loadedToolRefs(snapshot.loaded_tools),
      provider_request_count_before: snapshot.provider_request_count_before,
      external_api_audit_count_before: snapshot.external_api_audit_count_before,
      started_at: snapshot.started_at,
      requested_by: state.requested_by,
      occurred_at: this.now().toISOString(),
      event_payload_hash: "",
    } satisfies CommanderInvestigationModelStepStartedPayload)
    await this.trackedAppendCapped(state, "runtime_commander_investigation_model_step_started", payload, MODEL_STEP_CAP)
    state.pending_model_request_id = snapshot.model_request_id
    state.investigation_event_count += 1
    state.journal_sequence += 1
  }

  private async onCheckpoint(state: CommanderInvestigationJournalRunState, snapshot: CommanderInvestigationCheckpointSnapshot): Promise<void> {
    assertNotFenced(state)
    if (!state.started_persisted || !state.latest_checkpoint) throw new CommanderInvestigationPersistenceError("checkpoint cannot be persisted before durable start")
    if (!state.pending_model_request_id) throw new CommanderInvestigationPersistenceError("checkpoint cannot be persisted without a pending model-step boundary")
    const checkpoint = this.buildCheckpoint({
      snapshot,
      checkpointKind: "turn_complete",
      checkpointSequence: state.checkpoint_sequence,
      previous: state.latest_checkpoint,
      turnIndex: snapshot.turn_index,
      nextTurnIndex: snapshot.next_turn_index,
      turnSummaries: snapshot.turn_summaries,
      latestAssistant: snapshot.latest_assistant,
      latestToolResults: snapshot.latest_tool_results,
      providerRequestCount: snapshot.provider_request_count,
      elapsedActiveMs: snapshot.elapsed_active_ms,
      createdAt: snapshot.created_at,
      measureBytes: (candidate) => eventBytes({ kind: "runtime_commander_investigation_checkpointed", ...withPayloadHash({
        schema_version: 1 as const,
        investigation_id: snapshot.investigation_id,
        journal_sequence: state.journal_sequence,
        requested_by: state.requested_by,
        occurred_at: snapshot.created_at,
        checkpoint: candidate,
        event_payload_hash: "",
      }) }),
    })
    const payload = withPayloadHash({
      schema_version: 1 as const,
      investigation_id: snapshot.investigation_id,
      journal_sequence: state.journal_sequence,
      requested_by: state.requested_by,
      occurred_at: snapshot.created_at,
      checkpoint,
      event_payload_hash: "",
    })
    const eventId = await this.trackedAppendCapped(state, "runtime_commander_investigation_checkpointed", payload, this.checkpointPayloadCapBytes)
    state.latest_checkpoint = checkpoint
    state.latest_checkpoint_event_id = eventId
    state.checkpoint_count += 1
    state.checkpoint_sequence += 1
    state.investigation_event_count += 1
    state.journal_sequence += 1
    state.pending_model_request_id = undefined
  }

  private buildCheckpoint(input: {
    snapshot: CommanderInvestigationStartedSnapshot | CommanderInvestigationCheckpointSnapshot
    checkpointKind: "initial" | "turn_complete"
    checkpointSequence: number
    previous?: CommanderInvestigationCheckpoint
    turnIndex: number
    nextTurnIndex: number
    turnSummaries: CommanderInvestigationTurnSummary[]
    latestAssistant?: CommanderModelAssistantMessage
    latestToolResults: CommanderModelToolResultMessage[]
    providerRequestCount: number
    elapsedActiveMs: number
    createdAt: string
    measureBytes?: (checkpoint: CommanderInvestigationCheckpoint) => number
  }): CommanderInvestigationCheckpoint {
    const snapshot = input.snapshot
    const workingSet = durableWorkingSet(snapshot.working_set)
    const replay = input.latestAssistant ? replayExchange(input.turnIndex, input.latestAssistant, input.latestToolResults) : undefined
    const previous = input.previous
    let checkpoint: CommanderInvestigationCheckpoint = {
      schema_version: 1,
      checkpoint_id: "",
      investigation_id: snapshot.investigation_id,
      checkpoint_sequence: input.checkpointSequence,
      checkpoint_kind: input.checkpointKind,
      turn_index: input.turnIndex,
      next_turn_index: input.nextTurnIndex,
      phase: previous?.phase ?? snapshot.input.phase,
      objective_hash: previous?.objective_hash ?? stableHash(bound(snapshot.input.objective, 1000)),
      provider_id: previous?.provider_id ?? bound(snapshot.input.provider_id, 120),
      provider_kind: previous?.provider_kind ?? bound(snapshot.input.provider_kind, 80),
      model_id: previous?.model_id ?? bound(snapshot.input.model_id, 200),
      tool_protocol: previous?.tool_protocol ?? snapshot.tool_protocol,
      bootstrap_ref: previous?.bootstrap_ref ?? { bootstrap_id: snapshot.bootstrap.bootstrap_id, bootstrap_hash: snapshot.bootstrap.bootstrap_hash },
      budget: previous?.budget ?? snapshot.budget,
      loaded_tools: loadedToolRefs(snapshot.loaded_tools),
      working_set: workingSet,
      turn_summaries: sanitizeTurnSummaries(input.turnSummaries).slice(-snapshot.budget.max_turn_summaries),
      replay_exchange: replay,
      provider_request_count: input.providerRequestCount,
      external_api_audit_count: workingSet.provider_audit.external_api_audit_event_count,
      elapsed_active_ms: Math.max(0, Math.floor(input.elapsedActiveMs)),
      previous_checkpoint_id: input.previous?.checkpoint_id,
      previous_checkpoint_hash: input.previous?.checkpoint_hash,
      created_at: input.createdAt,
      created_by: bound(snapshot.input.requested_by, 200),
      semantic_state_hash: "",
      checkpoint_hash: "",
      resume_supported: false,
      full_transcript_persisted: false,
      raw_tool_results_persisted: false,
      chain_of_thought_persisted: false,
    }
    const measureBytes = input.measureBytes ?? ((candidate: CommanderInvestigationCheckpoint) => eventBytes({ checkpoint: candidate }))
    const finalize = (candidate: CommanderInvestigationCheckpoint): CommanderInvestigationCheckpoint => {
      const finalized = { ...candidate, checkpoint_id: "", semantic_state_hash: "", checkpoint_hash: "" }
      finalized.semantic_state_hash = stableHash(stableCheckpointState(finalized))
      finalized.checkpoint_id = `commander_inv_checkpoint_${finalized.checkpoint_sequence}_${finalized.semantic_state_hash.slice(0, 16)}`
      finalized.checkpoint_hash = stableHash({ ...finalized, checkpoint_hash: "" })
      return finalized
    }
    checkpoint = redactValue(compactCheckpoint(checkpoint, this.checkpointPayloadCapBytes, (candidate) => measureBytes(finalize(candidate)))) as CommanderInvestigationCheckpoint
    checkpoint = finalize(checkpoint)
    if (measureBytes(checkpoint) > this.checkpointPayloadCapBytes) throw new CommanderInvestigationPersistenceError("Commander investigation checkpoint exceeds durable event byte cap")
    return checkpoint
  }

  private async appendCapped(kind: string, payload: Record<string, unknown>, cap: number): Promise<string> {
    const redacted = redactValue(payload) as Record<string, unknown>
    if (eventBytes({ kind, ...redacted }) > cap) throw new CommanderInvestigationPersistenceError(`${kind} payload exceeds durable event byte cap`)
    await this.assertAppendSafeTail()
    return this.options.eventStore.append({ kind, ...redacted } as JsonlEvent)
  }

  private async trackedAppendCapped(state: CommanderInvestigationJournalRunState, kind: string, payload: Record<string, unknown>, cap: number): Promise<string> {
    const operation = this.appendCapped(kind, payload, cap)
    state.in_flight_persistence.add(operation)
    try {
      return await operation
    } catch (error) {
      state.persistence_fenced = true
      const message = error instanceof Error ? error.message : String(error)
      state.warnings = [...state.warnings, bound(`durable journal append for ${kind} failed with uncertain commit status: ${message}`, 240)].slice(-12)
      throw error
    } finally {
      state.in_flight_persistence.delete(operation)
    }
  }

  private async assertAppendSafeTail(): Promise<void> {
    let size = 0
    try {
      size = (await stat(this.options.eventStore.eventsPath)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    if (size === 0) return
    const handle = await open(this.options.eventStore.eventsPath, "r")
    try {
      const buffer = Buffer.alloc(1)
      await handle.read(buffer, 0, 1, size - 1)
      if (buffer[0] !== 0x0a) {
        throw new CommanderInvestigationPersistenceError("durable journal event log has an unterminated tail; refusing to append Commander investigation event")
      }
    } finally {
      await handle.close()
    }
  }

  durability(state: CommanderInvestigationJournalRunState): CommanderInvestigationDurabilitySummary {
    const summary = {
      mode: "event_journal" as const,
      started_persisted: state.started_persisted,
      initial_checkpoint_persisted: state.checkpoint_count > 0,
      terminal_persisted: state.terminal_persisted,
      investigation_event_count: state.investigation_event_count,
      started_event_id: state.started_event_id,
      latest_checkpoint_event_id: state.latest_checkpoint_event_id,
      finished_event_id: state.finished_event_id,
      latest_checkpoint_id: state.latest_checkpoint?.checkpoint_id,
      latest_checkpoint_sequence: state.latest_checkpoint?.checkpoint_sequence,
      latest_checkpoint_hash: state.latest_checkpoint?.checkpoint_hash,
      checkpoint_count: state.checkpoint_count,
      pending_model_request_id: state.pending_model_request_id,
      projection_status: "ready" as const,
      resume_supported: false as const,
      full_transcript_persisted: false as const,
      raw_tool_results_persisted: false as const,
      chain_of_thought_persisted: false as const,
      warnings: state.warnings.slice(0, 12),
      durability_hash: "",
    }
    summary.durability_hash = stableHash({ ...summary, started_event_id: "", latest_checkpoint_event_id: "", finished_event_id: "", durability_hash: "" })
    return summary
  }
}

function loadedToolRefs(tools: CommanderToolDescriptor[]): CommanderInvestigationLoadedToolRef[] {
  return tools.map((tool) => ({
    tool_id: tool.tool_id,
    descriptor_version: tool.version,
    authority_id: tool.authority_id ?? "",
    input_schema_hash: tool.schema_metadata.input_schema_hash,
    output_schema_hash: tool.schema_metadata.output_schema_hash,
    load_policy: tool.load_policy,
    trust_class: tool.trust_class,
    instruction_semantics: "none" as const,
  })).sort((a, b) => a.tool_id.localeCompare(b.tool_id))
}

function durableWorkingSet(input: CommanderInvestigationWorkingSet) {
  return {
    objective_preview: bound(input.objective_preview, 1000),
    phase: input.phase,
    loaded_tool_ids: [...input.loaded_tool_ids].sort(),
    evidence_cards: sanitizeEvidence(input.evidence_cards),
    recent_execution_digests: input.recent_execution_digests.map((digest) => redactValue({
      turn_index: digest.turn_index,
      tool_id: digest.tool_id,
      call_signature_hash: digest.call_signature_hash,
      execution_status: digest.execution_status,
      result_hash: digest.result_hash,
      evidence_ids: digest.evidence_ids.slice(0, 8),
      loaded_tool_outcome: bound(digest.loaded_tool_outcome, 160),
      blocker_warning_summary: bound(digest.blocker_warning_summary, 320),
      order: digest.order,
    })).slice(-24) as Array<Record<string, unknown>>,
    recent_load_outcomes: input.recent_load_outcomes.map((item) => bound(item, 240)).slice(-24),
    current_blockers: input.current_blockers.map((item) => bound(item, 300)).slice(-16),
    current_warnings: input.current_warnings.map((item) => bound(item, 300)).slice(-24),
    provider_audit: sanitizedProviderAudit(input.provider_audit),
    omitted_evidence_count: input.omitted_evidence_count,
    omitted_digest_count: input.omitted_digest_count,
    omitted_turn_count: input.omitted_turn_count,
    consecutive_no_progress_turns: input.consecutive_no_progress_turns,
    cumulative_tool_result_bytes: input.cumulative_tool_result_bytes,
    model_turn_count: input.model_turn_count,
    tool_call_count: input.tool_call_count,
    tool_search_call_count: input.tool_search_call_count,
    recent_result_signatures: input.recent_result_signatures.slice(-64),
    working_set_hash: input.working_set_hash,
  }
}

function sanitizeEvidence(cards: CommanderEvidenceCard[]): CommanderEvidenceCard[] {
  return cards.map((card) => {
    const contentBearing = card.content_included || ["repository_file", "repository_search_match", "repository_symbol", "git_diff", "test_manifest"].includes(card.source_kind)
    return redactValue({
      ...card,
      title: bound(card.title, 180),
      summary_preview: contentBearing ? durablePointerSummary(card) : bound(card.summary_preview, 500),
      source_refs: card.source_refs.map((ref: CommanderReadSourceRef) => ({
        ...ref,
        label: bound(ref.label, 160),
        summary_preview: contentBearing ? durablePointerSummary(card) : bound(ref.summary_preview, 240),
        pointer_only: true as const,
      })).slice(0, 8),
      warnings: [
        ...card.warnings.map((item: string) => bound(item, 200)),
        ...(contentBearing ? ["Durable journal stores pointer/hash metadata only for content-bearing evidence."] : []),
      ].slice(0, 6),
      content_included: false,
      content_truncated: card.content_truncated || contentBearing,
    }) as CommanderEvidenceCard
  })
}

function durablePointerSummary(card: CommanderEvidenceCard): string {
  return bound(`${card.source_kind} evidence content omitted from durable journal; use source_id=${card.source_id} evidence_hash=${card.evidence_hash ?? ""}`.trim(), 500)
}

function sanitizeTurnSummaries(turns: CommanderInvestigationTurnSummary[]): CommanderInvestigationTurnSummary[] {
  return turns.map((turn) => {
    const summary = {
      ...turn,
      warnings: turn.warnings.map((item) => bound(item, 220)).slice(0, 8),
      provider_audit_request_ids: turn.provider_audit_request_ids.map((item) => bound(item, 120)).slice(0, 24),
    }
    delete (summary as Partial<CommanderInvestigationTurnSummary>).output_tokens
    if (turn.assistant_text_preview) summary.assistant_text_preview = durableModelTextOmission(turn.assistant_text_preview, 300)
    else delete (summary as Partial<CommanderInvestigationTurnSummary>).assistant_text_preview
    return summary
  })
}

function replayExchange(turnIndex: number, assistant: CommanderModelAssistantMessage, toolResults: CommanderModelToolResultMessage[]) {
  const exchange = {
    turn_index: turnIndex,
    assistant_message: sanitizeAssistant(assistant),
    tool_result_messages: toolResults.slice(0, 4).map(durableToolResult),
    exchange_hash: "",
    summary_only: true as const,
    assistant_text_persisted: false as const,
    exact_replay_supported: false as const,
    protocol_relationship_preserved: true as const,
    full_tool_results_persisted: false as const,
  }
  exchange.exchange_hash = stableHash({ ...exchange, exchange_hash: "" })
  return exchange
}

function sanitizeAssistant(message: CommanderModelAssistantMessage): CommanderDurableAssistantMessage {
  return {
    role: "assistant" as const,
    content: message.content.map((part) => {
      if (part.type === "text") return { type: "text_fingerprint" as const, ...durableModelTextFingerprint(part.text) }
      const call = part as CommanderModelToolCallPart
      return {
        type: "tool_call" as const,
        tool_call_id: bound(call.tool_call_id, 120),
        tool_id: bound(call.tool_id, 120),
        arguments: redactValue(call.arguments) as Record<string, unknown>,
        raw_arguments: call.raw_arguments ? bound(call.raw_arguments, 800) : undefined,
        arguments_valid: call.arguments_valid,
        validation_errors: call.validation_errors.map((item) => bound(item, 200)).slice(0, 8),
        call_hash: call.call_hash,
      }
    }),
  }
}

function durableModelTextFingerprint(text: string): CommanderDurableModelTextFingerprint {
  return { text_persisted: false, text_hash: stableHash(text), text_chars: text.length }
}

function durableModelTextOmission(text: string, maxBytes: number): string {
  return bound(`model-visible text omitted from durable journal; text_hash=${stableHash(text)} text_chars=${text.length}`, maxBytes)
}

function durableConclusion(result: CommanderInvestigationResult) {
  const evidence = sanitizeEvidence(result.evidence).slice(0, result.budget.max_evidence_cards)
  const finalOutput = result.final_summary ? durableModelTextFingerprint(result.final_summary) : undefined
  return {
    status: result.status,
    stop_reason: result.stop_reason,
    evidence_ids: evidence.map((card) => bound(card.evidence_id, 160)).slice(0, 24),
    evidence_titles: evidence.map((card) => bound(card.title, 180)).slice(0, 24),
    safe_evidence_summaries: evidence.map((card) => bound(card.summary_preview, 500)).slice(0, 24),
    blockers: result.blockers.map((item) => bound(item, 300)).slice(0, 16),
    warnings: result.warnings.map((item) => bound(item, 300)).slice(0, 16),
    final_output_text_hash: finalOutput?.text_hash,
  }
}

function recoverInvestigationIdFromMalformedLine(line: string, index: number): string | undefined {
  if (!/"kind"\s*:\s*"runtime_commander_investigation_(started|model_step_started|checkpointed|finished)"/.test(line)) return undefined
  const match = line.match(/"investigation_id"\s*:\s*"([^"\\]{1,200})"/)
  if (match?.[1]) return bound(match[1], 200)
  return `malformed_commander_journal_line_${index}`
}

function malformedJournalLineEvent(investigationId: string, lineIndex: number): JsonlEvent {
  const event = {
    kind: "runtime_commander_investigation_started",
    schema_version: 1,
    investigation_id: investigationId,
    journal_sequence: 0,
    requested_by: "",
    occurred_at: "",
    malformed_jsonl_line: true,
    line_index: lineIndex,
    event_payload_hash: "",
  }
  event.event_payload_hash = stableHash({ ...event, event_payload_hash: "" })
  return event as JsonlEvent
}

function durableToolResult(message: CommanderModelToolResultMessage): CommanderDurableToolResultSummaryMessage {
  const summary = JSON.stringify({
    status: "summary_only",
    tool_id: message.tool_id,
    tool_call_id: message.tool_call_id,
    content_hash: message.content_hash,
    truncated: message.truncated,
  })
  return {
    role: "tool",
    tool_call_id: bound(message.tool_call_id, 120),
    tool_id: bound(message.tool_id, 120),
    content: summary.slice(0, 2_000),
    content_hash: stableHash(summary),
    truncated: message.truncated || summary.length > 2_000,
    durable_summary_only: true,
    source_execution_id: message.source_execution_id ? bound(message.source_execution_id, 160) : undefined,
  }
}

function compactCheckpoint(checkpoint: CommanderInvestigationCheckpoint, cap: number, measureBytes: (checkpoint: CommanderInvestigationCheckpoint) => number): CommanderInvestigationCheckpoint {
  let current = checkpoint
  while (measureBytes(current) > cap && current.turn_summaries.length > 0) {
    current = { ...current, turn_summaries: current.turn_summaries.slice(1), working_set: { ...current.working_set, omitted_turn_count: current.working_set.omitted_turn_count + 1 } }
  }
  while (measureBytes(current) > cap && current.working_set.recent_execution_digests.length > 0) {
    current = { ...current, working_set: { ...current.working_set, recent_execution_digests: current.working_set.recent_execution_digests.slice(1), omitted_digest_count: current.working_set.omitted_digest_count + 1 } }
  }
  while (measureBytes(current) > cap && current.working_set.evidence_cards.length > 0) {
    current = { ...current, working_set: { ...current.working_set, evidence_cards: current.working_set.evidence_cards.slice(1), omitted_evidence_count: current.working_set.omitted_evidence_count + 1 } }
  }
  if (measureBytes(current) > cap && current.replay_exchange) {
    current = { ...current, replay_exchange: compactReplayExchangeForCheckpointBudget(current.replay_exchange) }
  }
  return current
}

function compactReplayExchangeForCheckpointBudget(exchange: NonNullable<CommanderInvestigationCheckpoint["replay_exchange"]>): NonNullable<CommanderInvestigationCheckpoint["replay_exchange"]> {
  const compacted = {
    ...exchange,
    tool_result_messages: exchange.tool_result_messages.map((message) => {
      const content = JSON.stringify({ status: "omitted_for_checkpoint_budget", tool_id: message.tool_id, tool_call_id: message.tool_call_id }).slice(0, 400)
      return {
        ...message,
        content,
        content_hash: stableHash(content),
        truncated: true,
      }
    }),
    exchange_hash: "",
  }
  compacted.exchange_hash = stableHash({ ...compacted, exchange_hash: "" })
  return compacted
}

function compactTerminal(terminal: CommanderInvestigationTerminalRecord, cap: number): CommanderInvestigationTerminalRecord {
  let current = terminal
  while (eventBytes({ terminal: current }) > cap) {
    const next = compactTerminalOnce(current)
    if (next === current) break
    current = next
  }
  return current
}

function compactTerminalOnce(terminal: CommanderInvestigationTerminalRecord): CommanderInvestigationTerminalRecord {
  if (terminal.turn_summaries.length > 0) return { ...terminal, turn_summaries: terminal.turn_summaries.slice(1), omitted_turn_count: terminal.omitted_turn_count + 1 }
  if (terminal.evidence_cards.length > 0) return { ...terminal, evidence_cards: terminal.evidence_cards.slice(1), omitted_evidence_count: terminal.omitted_evidence_count + 1 }
  if (terminal.warnings.length > 0) return { ...terminal, warnings: terminal.warnings.slice(0, -1) }
  if (terminal.blockers.length > 0) return { ...terminal, blockers: terminal.blockers.slice(0, -1) }
  if (terminal.conclusion.safe_evidence_summaries.length > 0) return { ...terminal, conclusion: { ...terminal.conclusion, safe_evidence_summaries: terminal.conclusion.safe_evidence_summaries.slice(0, -1) } }
  if (terminal.conclusion.evidence_titles.length > 0) return { ...terminal, conclusion: { ...terminal.conclusion, evidence_titles: terminal.conclusion.evidence_titles.slice(0, -1) } }
  if (terminal.conclusion.warnings.length > 0) return { ...terminal, conclusion: { ...terminal.conclusion, warnings: terminal.conclusion.warnings.slice(0, -1) } }
  if (terminal.conclusion.blockers.length > 0) return { ...terminal, conclusion: { ...terminal.conclusion, blockers: terminal.conclusion.blockers.slice(0, -1) } }
  return terminal
}

function finalizeTerminalHash(terminal: CommanderInvestigationTerminalRecord): CommanderInvestigationTerminalRecord {
  const current = { ...terminal, terminal_hash: "" }
  current.terminal_hash = stableHash({ ...current, terminal_hash: "" })
  return current
}

function stableCheckpointState(checkpoint: CommanderInvestigationCheckpoint): unknown {
  return {
    ...checkpoint,
    checkpoint_id: "",
    checkpoint_hash: "",
    created_at: "",
    elapsed_active_ms: 0,
    provider_audit: undefined,
    working_set: {
      ...checkpoint.working_set,
      provider_audit: { ...checkpoint.working_set.provider_audit, audit_request_ids: [] },
      evidence_cards: checkpoint.working_set.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
    },
    turn_summaries: checkpoint.turn_summaries.map((item) => ({ ...item, provider_audit_request_ids: [], turn_hash: "" })),
  }
}

function sanitizedProviderAudit<T extends { audit_request_ids: string[] }>(audit: T): T {
  return { ...audit, audit_request_ids: audit.audit_request_ids.map((item) => bound(item, 120)).slice(0, 24) }
}

function sanitizeInput(input: CommanderInvestigationInput): Omit<CommanderInvestigationInput, "abort_signal"> {
  const { abort_signal: _ignored, ...rest } = input
  return redactValue({
    ...rest,
    objective: bound(input.objective, 1000),
    requested_by: bound(input.requested_by, 200),
    provider_id: bound(input.provider_id, 120),
    provider_kind: bound(input.provider_kind, 80),
    model_id: bound(input.model_id, 200),
  }) as Omit<CommanderInvestigationInput, "abort_signal">
}

function persistedIdentityErrors(input: CommanderInvestigationInput, investigationId: string): string[] {
  const errors: string[] = []
  const fields: Array<[string, unknown, number, boolean]> = [
    ["investigation_id", investigationId, 200, true],
    ["objective", input.objective, 1000, true],
    ["requested_by", input.requested_by, 200, true],
    ["provider_id", input.provider_id, 120, true],
    ["provider_kind", input.provider_kind, 80, true],
    ["model_id", input.model_id, 200, true],
    ["mission_id", input.mission_id, 200, false],
    ["session_id", input.session_id, 200, false],
    ["launch_id", input.launch_id, 200, false],
  ]
  for (const [key, value, max, required] of fields) {
    if (value === undefined && !required) continue
    if (typeof value !== "string") {
      errors.push(`${key} must be a string`)
      continue
    }
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized.length === 0) errors.push(`${key} is required`)
    if (normalized.length > max) errors.push(`${key} exceeds ${max} characters`)
    if (normalized !== value) errors.push(`${key} must already be normalized`)
  }
  return errors
}

function withPayloadHash<T extends { event_payload_hash: string }>(payload: T): T {
  const redacted = redactValue(payload) as T
  redacted.event_payload_hash = stableHash({ ...redacted, event_payload_hash: "" })
  return redacted
}

function assertNotFenced(state: CommanderInvestigationJournalRunState): void {
  if (state.persistence_fenced) throw new CommanderInvestigationPersistenceError("durable investigation persistence fenced after uncertain journal append")
}

function eventBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value)) + 256
}

function bound(value: unknown, max: number): string {
  return redactText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max)
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : undefined
}
