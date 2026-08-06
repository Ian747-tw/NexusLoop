import { open, stat } from "node:fs/promises"
import { redactText, redactValue } from "../security/redaction"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderToolDescriptor } from "../commander-tools/commander-tool-types"
import { commanderProviderVisibleDescriptionHash, stableHash } from "./commander-model-schema"
import { durableCommanderEvidenceCards, durableCommanderInvestigationWorkingSet } from "./commander-investigation-working-set"
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
import { COMMANDER_INVESTIGATION_EVENT_KINDS } from "./commander-investigation-journal-types"
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
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import type {
  CommanderInvestigationRecoveryApprovalAppendInput,
  CommanderInvestigationRecoveryApprovalRecord,
  CommanderInvestigationRecoveryApprovalResult,
  CommanderInvestigationRecoveryApprovalSummary,
  CommanderInvestigationRecoveryApprovedPayload,
} from "./commander-investigation-recovery-approval-types"
import { isCommanderInvestigationRecoveryApprovalRecord, projectCommanderInvestigationJournal } from "./commander-investigation-journal-projection"
import { isCommanderInvestigationRecoveryAttempt } from "./commander-investigation-journal-projection"
import type {
  CommanderInvestigationRecoveryAttempt,
  CommanderInvestigationRecoveryAttemptSummary,
  CommanderInvestigationRecoveryStartAppendInput,
  CommanderInvestigationRecoveryStartedPayload,
} from "./commander-investigation-recovery-transaction-types"
import type { CommanderInvestigationRecoveryFirstModelRequestPreview } from "./commander-investigation-recovery-execution-types"

const CHECKPOINT_DEFAULT_CAP = 64_000
const CHECKPOINT_HARD_CAP = 96_000
const MODEL_STEP_CAP = 8_000
const TERMINAL_CAP = 48_000
const APPROVAL_CAP = 16_000
const RECOVERY_START_CAP = 24_000
const STARTED_HARD_CAP = 112_000
const MIN_TEST_CAP = 16_000
const COMMANDER_INVESTIGATION_EVENT_KIND_SET = new Set<string>(COMMANDER_INVESTIGATION_EVENT_KINDS)
const PERSISTED_INPUT_INTEGER_LIMITS = {
  max_model_turns: 24,
  max_tool_calls: 32,
  max_tool_search_calls: 8,
  max_loaded_schemas: 12,
  max_tool_calls_per_turn: 4,
  max_cumulative_tool_result_bytes: 96_000,
  max_wall_time_ms: 120_000,
  max_consecutive_no_progress_turns: 3,
  max_evidence_cards: 24,
  max_turn_summaries: 12,
  max_context_tokens: 1_000_000,
  max_context_bytes: 65_536,
} as const

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

function assertRecoveryStartNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CommanderInvestigationJournalConflictError("Commander recovery was cancelled before the durable recovery-start boundary")
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
  recovery_state?: string
  recovery_approval_state?: "none" | "current" | "stale" | "consumed"
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
  recovery_attempt?: CommanderInvestigationRecoveryAttemptSummary
  expected_first_model_request?: CommanderInvestigationRecoveryFirstModelRequestPreview
  recovery_request_id_prefix?: string
  first_recovery_model_step_persisted?: boolean
  recovery_model_step_event_count?: number
  recovery_checkpoint_event_count?: number
}

function recoveryApprovalState(record: CommanderInvestigationRecord): "none" | "current" | "stale" | "consumed" {
  if (record.projection_status !== "ready") return "none"
  if (record.recovery_approval_consumed) return "consumed"
  if (record.recovery_approval_recorded) return "current"
  return record.recovery_approval_count > 0 ? "stale" : "none"
}

export class CommanderInvestigationJournalService {
  private readonly now: () => Date
  private readonly checkpointPayloadCapBytes: number
  private readonly active = new Set<string>()
  private readonly activeApprovals = new Map<string, Promise<void>>()
  private readonly activeRecoveryStarts = new Map<string, Promise<void>>()

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
    if (run.state.recovery_attempt) await this.assertActiveRecoveryAttempt(run.state)
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
      evidence_cards: durableCommanderEvidenceCards(result.evidence).slice(0, result.budget.max_evidence_cards),
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
      recovery_attempt_id: run.state.recovery_attempt?.recovery_attempt_id,
      consumed_approval_id: run.state.recovery_attempt?.approval_id,
      recovery_kind: run.state.recovery_attempt?.recovery_kind,
      recovery_plan_hash: run.state.recovery_attempt?.recovery_plan_hash,
      execution_preparation_hash: run.state.recovery_attempt?.execution_preparation_hash,
      unresolved_provider_attempt_count: run.state.recovery_attempt?.recovery_kind === "uncertain_provider_outcome" ? 1 : run.state.recovery_attempt ? 0 : undefined,
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
    const journal = await this.readJournalEventsWithDiagnostics()
    const projection = projectCommanderInvestigationJournal(journal.events)
    const limit = Math.max(1, Math.min(maxLimit, Number.isInteger(options.limit) ? Number(options.limit) : defaultLimit))
    return projection.records
      .map((record) => {
        const reason = journal.unassignable_dropped_commander_event
          ? "unassignable Commander journal event prevents authoritative recovery"
          : journal.dropped_commander_events_by_investigation_id.get(record.investigation_id)?.[0]
        return reason ? recoveryRecordBlockedByDroppedCommanderEvent(record, reason) : record
      })
      .filter((record) => !options.status || record.status === options.status)
      .filter((record) => !options.statuses?.length || options.statuses.includes(record.status))
      .filter((record) => !options.recovery_state || record.recovery_state === options.recovery_state)
      .filter((record) => !options.recovery_approval_state || recoveryApprovalState(record) === options.recovery_approval_state)
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

  async recoverySource(investigationId: string): Promise<CommanderInvestigationRecoverySource | undefined> {
    const journal = await this.readJournalEventsWithDiagnostics()
    const projection = projectCommanderInvestigationJournal(journal.events)
    const source = projection.recovery_sources.find((candidate) => candidate.investigation_id === investigationId)
    if (!source) return source
    if (journal.unassignable_dropped_commander_event) return recoverySourceBlockedByDroppedCommanderEvent(source, "unassignable Commander journal event prevents authoritative recovery")
    const droppedReasons = journal.dropped_commander_events_by_investigation_id.get(investigationId)
    if (droppedReasons?.length) return recoverySourceBlockedByDroppedCommanderEvent(source, droppedReasons[0] ?? "dropped Commander journal event prevents authoritative recovery")
    return source
  }

  async recordRecoveryApproval(input: CommanderInvestigationRecoveryApprovalAppendInput): Promise<{ status: "recorded" | "already_recorded"; approval: CommanderInvestigationRecoveryApprovalRecord; event_id?: string; events_appended: boolean }> {
    return this.recordRecoveryApprovalAfterRevalidation(input.approval.investigation_id, async () => input)
  }

  async recordRecoveryApprovalAfterRevalidation(
    investigationId: string,
    revalidate: () => Promise<CommanderInvestigationRecoveryApprovalAppendInput>,
  ): Promise<{ status: "recorded" | "already_recorded"; approval: CommanderInvestigationRecoveryApprovalRecord; event_id?: string; events_appended: boolean }> {
    const lockKey = investigationId
    const previous = this.activeApprovals.get(lockKey) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chain = previous.catch(() => undefined).then(() => current)
    this.activeApprovals.set(lockKey, chain)
    await previous.catch(() => undefined)
    try {
      if (this.active.has(investigationId)) {
        throw new CommanderInvestigationJournalConflictError("Commander recovery approval requires inactive durable investigation")
      }
      const expectedLatestEventId = await this.options.eventStore.latestEventId()
      const input = await revalidate()
      return await this.recordRecoveryApprovalUnlocked(input, expectedLatestEventId)
    } finally {
      release()
      if (this.activeApprovals.get(lockKey) === chain) this.activeApprovals.delete(lockKey)
    }
  }

  async recordRecoveryStartAfterRevalidation(
    investigationId: string,
    revalidate: () => Promise<CommanderInvestigationRecoveryStartAppendInput>,
    operational: { abort_signal?: AbortSignal } = {},
  ): Promise<{ recovery_attempt: CommanderInvestigationRecoveryAttempt; event_id: string; events_appended: true }> {
    const previous = this.activeRecoveryStarts.get(investigationId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const chain = previous.catch(() => undefined).then(() => current)
    this.activeRecoveryStarts.set(investigationId, chain)
    await previous.catch(() => undefined)
    try {
      assertRecoveryStartNotAborted(operational.abort_signal)
      if (this.active.has(investigationId)) throw new CommanderInvestigationJournalConflictError("Commander recovery transaction requires inactive durable investigation")
      const expectedLatestEventId = await this.options.eventStore.latestEventId()
      assertRecoveryStartNotAborted(operational.abort_signal)
      const input = await revalidate()
      assertRecoveryStartNotAborted(operational.abort_signal)
      const attempt = input.recovery_attempt
      if (!isCommanderInvestigationRecoveryAttempt(attempt) || stableHash({ ...attempt, started_at: "", attempt_hash: "" }) !== attempt.attempt_hash) {
        throw new CommanderInvestigationPersistenceError("Commander recovery attempt failed durable schema validation")
      }
      const source = await this.recoverySource(investigationId)
      assertRecoveryStartNotAborted(operational.abort_signal)
      const approval = source?.recovery_approvals?.find((candidate) => candidate.approval_id === attempt.approval_id)
      if (!source || source.projection_status !== "ready" || source.record?.status !== "running" || !source.latest_checkpoint || !source.recovery_basis || source.current_recovery_attempt || source.recovery_attempts?.length) {
        throw new CommanderInvestigationJournalConflictError("Commander recovery start requires a ready nonterminal journal without an existing attempt")
      }
      if (!approval || approval.consumed || source.record.latest_recovery_approval_id !== approval.approval_id) throw new CommanderInvestigationJournalConflictError("Commander recovery start requires the current unconsumed approval")
      assertRecoveryStartMatchesSource(attempt, source, approval)
      const payload = withPayloadHash({
        schema_version: 1 as const,
        investigation_id: attempt.investigation_id,
        journal_sequence: source.source_event_count,
        requested_by: attempt.approved_by,
        occurred_at: attempt.started_at,
        recovery_attempt: attempt,
        event_payload_hash: "",
      } satisfies CommanderInvestigationRecoveryStartedPayload)
      assertRecoveryStartNotAborted(operational.abort_signal)
      const eventId = await this.appendCapped(
        "runtime_commander_investigation_recovery_started",
        payload,
        RECOVERY_START_CAP,
        expectedLatestEventId,
        () => assertRecoveryStartNotAborted(operational.abort_signal),
      )
      return { recovery_attempt: attempt, event_id: eventId, events_appended: true }
    } finally {
      release()
      if (this.activeRecoveryStarts.get(investigationId) === chain) this.activeRecoveryStarts.delete(investigationId)
    }
  }

  async createRecoveryObserver(input: {
    investigation_id: string
    recovery_attempt_id: string
    consumed_approval_id: string
    recovery_start_event_id: string
    expected_first_model_request: CommanderInvestigationRecoveryFirstModelRequestPreview
    recovery_request_id_prefix: string
  }): Promise<CommanderInvestigationJournalRun> {
    if (this.active.has(input.investigation_id)) throw new CommanderInvestigationJournalConflictError("duplicate concurrent durable investigation")
    this.active.add(input.investigation_id)
    let source: CommanderInvestigationRecoverySource | undefined
    try {
      source = await this.recoverySource(input.investigation_id)
      const attempt = source?.current_recovery_attempt
      const checkpoint = source?.latest_checkpoint
      if (!source || source.projection_status !== "ready" || !attempt || !checkpoint || attempt.recovery_attempt_id !== input.recovery_attempt_id || attempt.approval_id !== input.consumed_approval_id) {
        throw new CommanderInvestigationJournalConflictError("recovery persistence observer requires the active confirmed recovery attempt")
      }
    } catch (error) {
      this.active.delete(input.investigation_id)
      throw error
    }
    const attempt = source.current_recovery_attempt!
    const checkpoint = source.latest_checkpoint!
    const state: CommanderInvestigationJournalRunState = {
      started_persisted: true,
      terminal_persisted: false,
      persistence_fenced: false,
      in_flight_persistence: new Set(),
      started_event_id: input.recovery_start_event_id,
      started_at: source.record?.started_at,
      latest_checkpoint: checkpoint,
      checkpoint_count: checkpoint.checkpoint_sequence + 1,
      investigation_event_count: source.source_event_count,
      journal_sequence: source.source_event_count,
      checkpoint_sequence: checkpoint.checkpoint_sequence + 1,
      requested_by: source.record?.requested_by ?? "recovery_operator",
      objective_hash: source.record?.objective_hash,
      warnings: [],
      recovery_attempt: attempt,
      expected_first_model_request: input.expected_first_model_request,
      recovery_request_id_prefix: input.recovery_request_id_prefix,
      first_recovery_model_step_persisted: false,
      recovery_model_step_event_count: 0,
      recovery_checkpoint_event_count: 0,
    }
    return {
      investigation_id: input.investigation_id,
      state,
      observer: {
        onStarted: () => { throw new CommanderInvestigationPersistenceError("recovery persistence observer must not receive onStarted") },
        onModelStepStarted: (snapshot) => this.onModelStepStarted(state, snapshot),
        onCheckpoint: (snapshot) => this.onCheckpoint(state, snapshot),
      },
    }
  }

  private async recordRecoveryApprovalUnlocked(
    input: CommanderInvestigationRecoveryApprovalAppendInput,
    expectedLatestEventId: string | null,
  ): Promise<{ status: "recorded" | "already_recorded"; approval: CommanderInvestigationRecoveryApprovalRecord; event_id?: string; events_appended: boolean }> {
      const approval = input.approval
      assertPersistableRecoveryApproval(approval)
      const source = await this.recoverySource(approval.investigation_id)
      if (!source || source.projection_status !== "ready" || !source.record || source.record.status !== "running" || !source.recovery_basis || !source.latest_checkpoint) {
        throw new CommanderInvestigationJournalConflictError("Commander recovery approval requires a ready nonterminal journal with an accepted checkpoint")
      }
      if (source.recovery_basis.basis_hash !== input.expected_basis.basis_hash || source.recovery_basis.basis_hash !== approval.recovery_basis_hash) {
        throw new CommanderInvestigationJournalConflictError("Commander recovery basis changed before approval append")
      }
      if (source.latest_checkpoint.checkpoint_id !== approval.checkpoint_ref.checkpoint_id || source.latest_checkpoint.checkpoint_sequence !== approval.checkpoint_ref.checkpoint_sequence || source.latest_checkpoint.checkpoint_hash !== approval.checkpoint_ref.checkpoint_hash) {
        throw new CommanderInvestigationJournalConflictError("Commander recovery checkpoint changed before approval append")
      }
      if (approval.decision === "approve_resume_from_checkpoint" && source.pending_model_step) {
        throw new CommanderInvestigationJournalConflictError("checkpoint recovery approval cannot be appended while a model step is pending")
      }
      if (approval.decision === "approve_continue_after_uncertain_provider_outcome") {
        if (!source.pending_model_step || !approval.pending_model_step_ref) throw new CommanderInvestigationJournalConflictError("uncertain-provider approval requires the current pending model boundary")
        if (approval.pending_model_step_ref.model_request_id !== source.pending_model_step.model_request_id || approval.pending_model_step_ref.context_hash !== source.pending_model_step.context_hash) {
          throw new CommanderInvestigationJournalConflictError("pending model boundary changed before approval append")
        }
      }
      const duplicate = source.recovery_approvals?.find((candidate) => isSameRecoveryApprovalAuthority(candidate, approval))
      if (duplicate) {
        return {
          status: "already_recorded",
          approval: {
            ...approval,
            approval_id: duplicate.approval_id,
            approval_sequence: duplicate.approval_sequence,
            approved_at: duplicate.approved_at,
            approval_hash: duplicate.approval_hash,
          },
          events_appended: false,
        }
      }
      if ((source.recovery_approvals?.length ?? 0) >= 16) throw new CommanderInvestigationJournalConflictError("Commander recovery approval history cap reached")
      const journalSequence = source.source_event_count
      const approvalSequence = source.recovery_approvals?.length ?? 0
      const sequencedApproval = finalizeApprovalHash({ ...approval, approval_sequence: approvalSequence, approval_id: approval.approval_id || `commander_recovery_approval_${approval.recovery_plan_hash.slice(0, 16)}_${approvalSequence}` })
      assertPersistableRecoveryApproval(sequencedApproval)
      const payload = withPayloadHash({
        schema_version: 1 as const,
        investigation_id: sequencedApproval.investigation_id,
        journal_sequence: journalSequence,
        requested_by: sequencedApproval.approved_by,
        occurred_at: sequencedApproval.approved_at,
        approval: sequencedApproval,
        event_payload_hash: "",
      } satisfies CommanderInvestigationRecoveryApprovedPayload)
      const eventId = await this.appendCapped("runtime_commander_investigation_recovery_approved", payload, APPROVAL_CAP, expectedLatestEventId)
      return { status: "recorded", approval: sequencedApproval, event_id: eventId, events_appended: true }
  }

  private async readJournalEvents(): Promise<JsonlEvent[]> {
    return (await this.readJournalEventsWithDiagnostics()).events
  }

  private async readJournalEventsWithDiagnostics(): Promise<{ events: JsonlEvent[]; unassignable_dropped_commander_event: boolean; dropped_commander_events_by_investigation_id: Map<string, string[]> }> {
    try {
      const text = await this.options.eventStore.readText()
      const events: JsonlEvent[] = []
      let unassignable = false
      const dropped = new Map<string, string[]>()
      const lines = text.split(/\r?\n/)
      const lastNonemptyIndex = (() => {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (lines[index]) return index
        }
        return -1
      })()
      lines.forEach((line, index) => {
        if (!line) return
        try {
          const event = JSON.parse(line) as JsonlEvent
          const droppedCommander = droppedCommanderEventDiagnostic(event)
          if (droppedCommander) {
            if (droppedCommander.investigation_id) {
              const current = dropped.get(droppedCommander.investigation_id) ?? []
              current.push(droppedCommander.reason)
              dropped.set(droppedCommander.investigation_id, current.slice(-12))
            } else {
              unassignable = true
            }
          }
          events.push(event)
        } catch {
          const recovered = recoverInvestigationIdFromMalformedLine(line, index, index === lastNonemptyIndex)
          if (recovered.investigation_id) events.push(malformedJournalLineEvent(recovered.investigation_id, index))
          if (recovered.unassignable_commander_tail) unassignable = true
        }
      })
      return { events, unassignable_dropped_commander_event: unassignable, dropped_commander_events_by_investigation_id: dropped }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], unassignable_dropped_commander_event: false, dropped_commander_events_by_investigation_id: new Map() }
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
    if (state.recovery_attempt) {
      await this.assertActiveRecoveryAttempt(state)
      const expected = state.expected_first_model_request
      if (!state.first_recovery_model_step_persisted) {
        if (!expected || snapshot.model_request_id !== expected.request_id || snapshot.turn_index !== expected.turn_index || snapshot.context_hash !== expected.context_hash || snapshot.input_bytes !== expected.input_bytes || snapshot.estimated_input_tokens !== expected.estimated_input_tokens) {
          throw new CommanderInvestigationJournalConflictError("first recovered model step does not match approved request preview")
        }
      } else if (!state.recovery_request_id_prefix || !snapshot.model_request_id.startsWith(`${state.recovery_request_id_prefix}_turn_`)) {
        throw new CommanderInvestigationJournalConflictError("recovered model request does not use approved request prefix")
      }
    }
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
      recovery_attempt_id: state.recovery_attempt?.recovery_attempt_id,
      consumed_approval_id: state.recovery_attempt?.approval_id,
    } satisfies CommanderInvestigationModelStepStartedPayload)
    await this.trackedAppendCapped(state, "runtime_commander_investigation_model_step_started", payload, MODEL_STEP_CAP)
    state.pending_model_request_id = snapshot.model_request_id
    state.investigation_event_count += 1
    state.journal_sequence += 1
    if (state.recovery_attempt) state.first_recovery_model_step_persisted = true
    if (state.recovery_attempt) state.recovery_model_step_event_count = (state.recovery_model_step_event_count ?? 0) + 1
  }

  private async onCheckpoint(state: CommanderInvestigationJournalRunState, snapshot: CommanderInvestigationCheckpointSnapshot): Promise<void> {
    assertNotFenced(state)
    if (!state.started_persisted || !state.latest_checkpoint) throw new CommanderInvestigationPersistenceError("checkpoint cannot be persisted before durable start")
    if (!state.pending_model_request_id) throw new CommanderInvestigationPersistenceError("checkpoint cannot be persisted without a pending model-step boundary")
    if (state.recovery_attempt) await this.assertActiveRecoveryAttempt(state)
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
      recoveryAttempt: state.recovery_attempt,
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
    if (state.recovery_attempt) state.recovery_checkpoint_event_count = (state.recovery_checkpoint_event_count ?? 0) + 1
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
    recoveryAttempt?: CommanderInvestigationRecoveryAttemptSummary
  }): CommanderInvestigationCheckpoint {
    const snapshot = input.snapshot
    const workingSet = durableCommanderInvestigationWorkingSet(snapshot.working_set)
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
      recovery_attempt_id: input.recoveryAttempt?.recovery_attempt_id,
      consumed_approval_id: input.recoveryAttempt?.approval_id,
    }
    const measureBytes = input.measureBytes ?? ((candidate: CommanderInvestigationCheckpoint) => eventBytes({ checkpoint: candidate }))
    const finalize = (candidate: CommanderInvestigationCheckpoint): CommanderInvestigationCheckpoint => {
      const finalized = { ...candidate, checkpoint_id: "", semantic_state_hash: "", checkpoint_hash: "" }
      finalized.semantic_state_hash = stableHash(stableCheckpointState(finalized))
      finalized.checkpoint_id = `commander_inv_checkpoint_${finalized.checkpoint_sequence}_${finalized.semantic_state_hash.slice(0, 16)}`
      finalized.checkpoint_hash = stableHash({ ...finalized, checkpoint_hash: "" })
      return finalized
    }
    checkpoint = withCheckpointNestedHashes(redactValue(compactCheckpoint(checkpoint, this.checkpointPayloadCapBytes, (candidate) => measureBytes(finalize(candidate)))) as CommanderInvestigationCheckpoint)
    checkpoint = finalize(checkpoint)
    if (measureBytes(checkpoint) > this.checkpointPayloadCapBytes) throw new CommanderInvestigationPersistenceError("Commander investigation checkpoint exceeds durable event byte cap")
    return checkpoint
  }

  private async assertActiveRecoveryAttempt(state: CommanderInvestigationJournalRunState): Promise<void> {
    const attempt = state.recovery_attempt
    if (!attempt) return
    const source = await this.recoverySource(state.latest_checkpoint?.investigation_id ?? "")
    if (!source?.current_recovery_attempt || source.current_recovery_attempt.recovery_attempt_id !== attempt.recovery_attempt_id || source.current_recovery_attempt.approval_id !== attempt.approval_id) {
      throw new CommanderInvestigationJournalConflictError("active recovery attempt changed before lifecycle append")
    }
  }

  private async appendCapped(
    kind: string,
    payload: Record<string, unknown>,
    cap: number,
    expectedLatestEventId?: string | null,
    beforeWrite?: () => void,
  ): Promise<string> {
    const redacted = redactValue(payload) as Record<string, unknown>
    if (eventBytes({ kind, ...redacted }) > cap) throw new CommanderInvestigationPersistenceError(`${kind} payload exceeds durable event byte cap`)
    await this.assertAppendSafeTail()
    try {
      return await (expectedLatestEventId === undefined
        ? this.options.eventStore.append({ kind, ...redacted } as JsonlEvent)
        : this.options.eventStore.appendIfLatest({ kind, ...redacted } as JsonlEvent, expectedLatestEventId, { before_write: beforeWrite }))
    } catch (error) {
      if (expectedLatestEventId !== undefined && error instanceof Error && error.message === "event log changed before append") {
        throw new CommanderInvestigationJournalConflictError("event log changed before append")
      }
      throw error
    }
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

function isSameRecoveryApprovalAuthority(candidate: CommanderInvestigationRecoveryApprovalSummary, approval: CommanderInvestigationRecoveryApprovalRecord): boolean {
  return candidate.recovery_basis_hash === approval.recovery_basis_hash &&
    candidate.recovery_plan_hash === approval.recovery_plan_hash &&
    candidate.recovery_packet_hash === approval.recovery_packet_hash &&
    candidate.execution_preparation_hash === approval.execution_preparation_hash &&
    candidate.first_model_request_preview_hash === approval.first_model_request_preview_hash &&
    candidate.decision === approval.decision &&
    candidate.approved_by === approval.approved_by &&
    candidate.human_note_hash === approval.human_note_hash &&
    candidate.checkpoint_ref.checkpoint_id === approval.checkpoint_ref.checkpoint_id &&
    candidate.checkpoint_ref.checkpoint_sequence === approval.checkpoint_ref.checkpoint_sequence &&
    candidate.checkpoint_ref.checkpoint_hash === approval.checkpoint_ref.checkpoint_hash &&
    candidate.pending_model_step_ref?.model_request_id === approval.pending_model_step_ref?.model_request_id &&
    candidate.pending_model_step_ref?.turn_index === approval.pending_model_step_ref?.turn_index &&
    candidate.pending_model_step_ref?.base_checkpoint_id === approval.pending_model_step_ref?.base_checkpoint_id &&
    candidate.pending_model_step_ref?.base_checkpoint_sequence === approval.pending_model_step_ref?.base_checkpoint_sequence &&
    candidate.pending_model_step_ref?.base_checkpoint_hash === approval.pending_model_step_ref?.base_checkpoint_hash &&
    candidate.pending_model_step_ref?.working_set_hash === approval.pending_model_step_ref?.working_set_hash &&
    candidate.pending_model_step_ref?.context_hash === approval.pending_model_step_ref?.context_hash &&
    candidate.provider_execution_envelope_hash === approval.provider_execution_envelope_hash &&
    candidate.tool_compatibility_hash === approval.tool_compatibility_hash &&
    candidate.provider_compatibility_hash === approval.provider_compatibility_hash &&
    candidate.budget_compatibility_hash === approval.budget_compatibility_hash &&
    candidate.context_compatibility_hash === approval.context_compatibility_hash &&
    candidate.continuity_compatibility_hash === approval.continuity_compatibility_hash &&
    candidate.human_control_compatibility_hash === approval.human_control_compatibility_hash
}

function assertRecoveryStartMatchesSource(
  attempt: CommanderInvestigationRecoveryAttempt,
  source: CommanderInvestigationRecoverySource,
  approval: CommanderInvestigationRecoveryApprovalSummary,
): void {
  const checkpoint = source.latest_checkpoint!
  const mismatches: string[] = []
  if (attempt.investigation_id !== source.investigation_id) mismatches.push("investigation")
  if (attempt.recovery_attempt_sequence !== 0) mismatches.push("attempt sequence")
  if (attempt.approval_id !== approval.approval_id || attempt.approval_hash !== approval.approval_hash || attempt.approval_sequence !== approval.approval_sequence) mismatches.push("approval")
  const validKind = approval.decision === "approve_resume_from_checkpoint" ? "checkpoint" : "uncertain_provider_outcome"
  if (attempt.recovery_kind !== validKind) mismatches.push("recovery kind")
  if (attempt.recovery_basis_hash !== source.recovery_basis_hash || attempt.recovery_basis_hash !== approval.recovery_basis_hash) mismatches.push("basis")
  if (attempt.recovery_plan_hash !== approval.recovery_plan_hash || attempt.recovery_packet_hash !== approval.recovery_packet_hash) mismatches.push("plan")
  if (!approval.execution_preparation_hash || attempt.execution_preparation_hash !== approval.execution_preparation_hash) mismatches.push("preparation")
  if (!approval.first_model_request_preview_hash || attempt.first_model_request_preview_hash !== approval.first_model_request_preview_hash) mismatches.push("first request")
  if (attempt.checkpoint_ref.checkpoint_id !== checkpoint.checkpoint_id || attempt.checkpoint_ref.checkpoint_sequence !== checkpoint.checkpoint_sequence || attempt.checkpoint_ref.checkpoint_hash !== checkpoint.checkpoint_hash) mismatches.push("checkpoint")
  for (const key of [
    "provider_execution_envelope_hash",
    "tool_compatibility_hash",
    "provider_compatibility_hash",
    "budget_compatibility_hash",
    "context_compatibility_hash",
    "continuity_compatibility_hash",
    "human_control_compatibility_hash",
  ] as const) if (attempt[key] !== approval[key]) mismatches.push(key)
  const pending = source.pending_model_step
  if (attempt.recovery_kind === "checkpoint") {
    if (pending || attempt.pending_model_step_ref || attempt.pending_boundary_disposition !== "not_applicable") mismatches.push("pending disposition")
  } else if (!pending || !attempt.pending_model_step_ref || attempt.pending_boundary_disposition !== "continue_from_checkpoint_with_fresh_request" ||
    attempt.pending_model_step_ref.model_request_id !== pending.model_request_id || attempt.pending_model_step_ref.context_hash !== pending.context_hash ||
    attempt.pending_model_step_ref.working_set_hash !== pending.working_set_hash) mismatches.push("pending boundary")
  if (mismatches.length) throw new CommanderInvestigationJournalConflictError(`Commander recovery authority changed before start append: ${mismatches.join(", ")}`)
}

function loadedToolRefs(tools: CommanderToolDescriptor[]): CommanderInvestigationLoadedToolRef[] {
  return tools.map((tool) => ({
    tool_id: tool.tool_id,
    namespace: tool.namespace,
    descriptor_version: tool.version,
    authority_id: tool.authority_id ?? "",
    description_hash: commanderProviderVisibleDescriptionHash(tool),
    input_schema_hash: tool.schema_metadata.input_schema_hash,
    output_schema_hash: tool.schema_metadata.output_schema_hash,
    input_schema_bytes: tool.schema_metadata.input_schema_bytes,
    output_schema_bytes: tool.schema_metadata.output_schema_bytes,
    estimated_schema_tokens: tool.schema_metadata.estimated_schema_tokens,
    load_policy: tool.load_policy,
    trust_class: tool.trust_class,
    instruction_semantics: "none" as const,
    max_output_bytes: tool.max_output_bytes,
    timeout_ms: tool.timeout_ms,
    risk: tool.risk,
    side_effect_class: tool.side_effect_class,
    execution_backend: tool.execution_backend,
    process_policy: tool.process_policy,
    creates_external_process: tool.creates_external_process,
    calls_provider: tool.calls_provider,
    mutates_events: tool.mutates_events,
    requires_network: tool.requires_network,
    requires_credentials: tool.requires_credentials,
    requires_approval: tool.requires_approval,
    requires_run_lock: tool.requires_run_lock,
  })).sort((a, b) => a.tool_id.localeCompare(b.tool_id))
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
  const evidence = durableCommanderEvidenceCards(result.evidence).slice(0, result.budget.max_evidence_cards)
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

function droppedCommanderEventDiagnostic(event: JsonlEvent): { investigation_id?: string; reason: string } | undefined {
  const kind = typeof event.kind === "string" ? event.kind : ""
  if (!kind.startsWith("runtime_commander_investigation_")) return undefined
  const topLevelInvestigationId = typeof event.investigation_id === "string" && event.investigation_id ? bound(event.investigation_id, 200) : undefined
  const nestedInvestigationId = nestedCommanderInvestigationId(event)
  const investigationId = topLevelInvestigationId ?? nestedInvestigationId
  if (!COMMANDER_INVESTIGATION_EVENT_KIND_SET.has(kind)) {
    return {
      investigation_id: investigationId,
      reason: "unsupported Commander journal event kind prevents authoritative recovery",
    }
  }
  if (!topLevelInvestigationId) {
    return {
      investigation_id: nestedInvestigationId,
      reason: "Commander journal event without top-level investigation_id prevents authoritative recovery",
    }
  }
  return undefined
}

function nestedCommanderInvestigationId(event: JsonlEvent): string | undefined {
  const candidate = (event as {
    normalized_input?: { investigation_id?: unknown }
    initial_checkpoint?: { investigation_id?: unknown }
    checkpoint?: { investigation_id?: unknown }
    terminal?: { investigation_id?: unknown }
    approval?: { investigation_id?: unknown }
    recovery_attempt?: { investigation_id?: unknown }
  }).normalized_input?.investigation_id
    ?? (event as { initial_checkpoint?: { investigation_id?: unknown } }).initial_checkpoint?.investigation_id
    ?? (event as { checkpoint?: { investigation_id?: unknown } }).checkpoint?.investigation_id
    ?? (event as { terminal?: { investigation_id?: unknown } }).terminal?.investigation_id
    ?? (event as { approval?: { investigation_id?: unknown } }).approval?.investigation_id
    ?? (event as { recovery_attempt?: { investigation_id?: unknown } }).recovery_attempt?.investigation_id
  return typeof candidate === "string" && candidate ? bound(candidate, 200) : undefined
}

function recoverInvestigationIdFromMalformedLine(line: string, index: number, isTail: boolean): { investigation_id?: string; unassignable_commander_tail: boolean } {
  const hasCommanderInvestigationKindPrefix = /"kind"\s*:\s*"runtime_commander_investigation_/.test(line)
  const hasCommanderRuntimePrefix = /"kind"\s*:\s*"runtime_commander/.test(line)
  const hasCompleteNonCommanderKind = /"kind"\s*:\s*"(?!runtime_commander_investigation_)[^"\\]+"/.test(line)
  if (!hasCommanderInvestigationKindPrefix) {
    return { unassignable_commander_tail: hasCommanderRuntimePrefix || !hasCompleteNonCommanderKind }
  }
  const match = line.match(/"investigation_id"\s*:\s*"([^"\\]{1,200})"/)
  if (match?.[1]) return { investigation_id: bound(match[1], 200), unassignable_commander_tail: false }
  return { investigation_id: `malformed_commander_journal_line_${index}`, unassignable_commander_tail: true }
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

function recoverySourceBlockedByDroppedCommanderEvent(source: CommanderInvestigationRecoverySource, reason: string): CommanderInvestigationRecoverySource {
  const integrityError = bound(reason, 240)
  if (!source.record) {
    const blocked = {
      ...source,
      projection_status: "corrupt" as const,
      normalized_input: undefined,
      immutable_identity: undefined,
      latest_checkpoint: undefined,
      pending_model_step: undefined,
      terminal: undefined,
      source_hash: "",
    }
    blocked.source_hash = stableHash({
      investigation_id: blocked.investigation_id,
      projection_status: blocked.projection_status,
      source_event_count: blocked.source_event_count,
      dropped_commander_journal_event: true,
    })
    return blocked
  }
  const record = recoveryRecordBlockedByDroppedCommanderEvent(source.record, integrityError)
  const blocked = {
    ...source,
    projection_status: "corrupt" as const,
    record,
    normalized_input: undefined,
    immutable_identity: undefined,
    latest_checkpoint: undefined,
    pending_model_step: undefined,
    terminal: undefined,
    source_hash: "",
  }
  blocked.source_hash = stableHash({
    investigation_id: blocked.investigation_id,
    projection_status: blocked.projection_status,
    record_hash: blocked.record.record_hash,
    source_event_count: blocked.source_event_count,
    dropped_commander_journal_event: true,
  })
  return blocked
}

function recoveryRecordBlockedByDroppedCommanderEvent(record: CommanderInvestigationRecord, reason: string): CommanderInvestigationRecord {
  const blocked: CommanderInvestigationRecord = {
    ...record,
    projection_status: "corrupt",
    checkpoint_available: false,
    uncertain_provider_outcome: false,
    recovery_state: "no_checkpoint_resume_not_implemented",
    integrity_errors: [...record.integrity_errors, bound(reason, 240)].slice(0, 24),
    warnings: [...record.warnings, "Commander recovery preview blocked by a dropped Commander journal event"].slice(0, 12),
    record_hash: "",
  }
  blocked.record_hash = stableHash({ ...blocked, record_hash: "" })
  return blocked
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
    current = withWorkingSetHash({ ...current, turn_summaries: current.turn_summaries.slice(1), working_set: { ...current.working_set, omitted_turn_count: current.working_set.omitted_turn_count + 1 } })
  }
  while (measureBytes(current) > cap && current.working_set.recent_execution_digests.length > 0) {
    current = withWorkingSetHash({ ...current, working_set: { ...current.working_set, recent_execution_digests: current.working_set.recent_execution_digests.slice(1), omitted_digest_count: current.working_set.omitted_digest_count + 1 } })
  }
  while (measureBytes(current) > cap && current.working_set.evidence_cards.length > 0) {
    current = withWorkingSetHash({ ...current, working_set: { ...current.working_set, evidence_cards: current.working_set.evidence_cards.slice(1), omitted_evidence_count: current.working_set.omitted_evidence_count + 1 } })
  }
  if (measureBytes(current) > cap && current.replay_exchange) {
    current = { ...current, replay_exchange: compactReplayExchangeForCheckpointBudget(current.replay_exchange) }
  }
  return current
}

function withWorkingSetHash(checkpoint: CommanderInvestigationCheckpoint): CommanderInvestigationCheckpoint {
  return { ...checkpoint, working_set: durableCommanderInvestigationWorkingSet(checkpoint.working_set as unknown as CommanderInvestigationWorkingSet) }
}

function withReplayExchangeHash(checkpoint: CommanderInvestigationCheckpoint): CommanderInvestigationCheckpoint {
  if (!checkpoint.replay_exchange) return checkpoint
  const replay_exchange = { ...checkpoint.replay_exchange, exchange_hash: "" }
  replay_exchange.exchange_hash = stableHash(replay_exchange)
  return { ...checkpoint, replay_exchange }
}

function withCheckpointNestedHashes(checkpoint: CommanderInvestigationCheckpoint): CommanderInvestigationCheckpoint {
  return withWorkingSetHash(withReplayExchangeHash(checkpoint))
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

function finalizeApprovalHash(approval: CommanderInvestigationRecoveryApprovalRecord): CommanderInvestigationRecoveryApprovalRecord {
  const current = { ...approval, approval_hash: "" }
  current.approval_hash = stableHash({ ...current, approved_at: "", approval_hash: "" })
  return current
}

function assertPersistableRecoveryApproval(approval: CommanderInvestigationRecoveryApprovalRecord): void {
  if (!isCommanderInvestigationRecoveryApprovalRecord(approval)) throw new CommanderInvestigationPersistenceError("recovery approval record failed replay schema validation")
  if (!approval || typeof approval !== "object") throw new CommanderInvestigationPersistenceError("recovery approval record is malformed")
  if (approval.approval_source !== "human" || approval.one_shot !== true || approval.automatic !== false || approval.fresh_context_required !== true || approval.exact_replay_supported !== false || approval.provider_request_replay_allowed !== false || approval.tool_execution_replay_allowed !== false || approval.execution_supported_in_this_branch !== false) {
    throw new CommanderInvestigationPersistenceError("recovery approval record failed no-replay schema validation")
  }
  if (!isCanonicalIsoTimestamp(approval.approved_at)) throw new CommanderInvestigationPersistenceError("recovery approval timestamp is not canonical")
  if (approval.decision !== "approve_resume_from_checkpoint" && approval.decision !== "approve_continue_after_uncertain_provider_outcome") throw new CommanderInvestigationPersistenceError("recovery approval decision is invalid")
  if (approval.recovery_kind !== "checkpoint" && approval.recovery_kind !== "uncertain_provider_outcome") throw new CommanderInvestigationPersistenceError("recovery approval kind is invalid")
  if (approval.decision === "approve_resume_from_checkpoint" && approval.recovery_kind !== "checkpoint") throw new CommanderInvestigationPersistenceError("recovery approval decision/recovery-kind mismatch")
  if (approval.decision === "approve_continue_after_uncertain_provider_outcome" && approval.recovery_kind !== "uncertain_provider_outcome") throw new CommanderInvestigationPersistenceError("recovery approval decision/recovery-kind mismatch")
  const acknowledgementKeys = Object.keys(approval.acknowledgements ?? {}).sort()
  const expectedAcknowledgementKeys = approval.decision === "approve_continue_after_uncertain_provider_outcome"
    ? ["exact_replay_unavailable", "fresh_context_required", "provider_request_replay_forbidden", "tool_execution_replay_forbidden", "uncertain_provider_outcome"].sort()
    : ["exact_replay_unavailable", "fresh_context_required", "provider_request_replay_forbidden", "tool_execution_replay_forbidden"].sort()
  if (stableHash(acknowledgementKeys) !== stableHash(expectedAcknowledgementKeys)) throw new CommanderInvestigationPersistenceError("recovery approval acknowledgements are invalid")
  if (approval.acknowledgements.fresh_context_required !== true || approval.acknowledgements.exact_replay_unavailable !== true || approval.acknowledgements.provider_request_replay_forbidden !== true || approval.acknowledgements.tool_execution_replay_forbidden !== true) {
    throw new CommanderInvestigationPersistenceError("recovery approval acknowledgements are incomplete")
  }
  if (approval.decision === "approve_continue_after_uncertain_provider_outcome" && approval.acknowledgements.uncertain_provider_outcome !== true) throw new CommanderInvestigationPersistenceError("uncertain-provider approval acknowledgement is missing")
  if (approval.decision === "approve_resume_from_checkpoint" && approval.pending_model_step_ref !== undefined) throw new CommanderInvestigationPersistenceError("checkpoint recovery approval must not include a pending model boundary")
  if (approval.decision === "approve_continue_after_uncertain_provider_outcome" && approval.pending_model_step_ref === undefined) throw new CommanderInvestigationPersistenceError("uncertain-provider approval requires a pending model boundary")
  if (approval.approval_hash !== stableHash({ ...approval, approved_at: "", approval_hash: "" })) throw new CommanderInvestigationPersistenceError("recovery approval hash is invalid")
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
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
  for (const [key, limit] of Object.entries(PERSISTED_INPUT_INTEGER_LIMITS)) {
    const value = input[key as keyof CommanderInvestigationInput]
    if (value === undefined) continue
    if (!Number.isInteger(value) || Number(value) <= 0) {
      errors.push(`${key} must be a positive integer`)
      continue
    }
    if (Number(value) > limit) errors.push(`${key} exceeds ${limit}`)
  }
  if (input.include_continuity !== undefined && typeof input.include_continuity !== "boolean") errors.push("include_continuity must be boolean")
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
