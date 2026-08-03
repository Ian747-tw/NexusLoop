import { redactText, redactValue } from "../security/redaction"
import { stableHash } from "./commander-model-schema"
import type { CommanderInvestigationResult } from "./commander-investigation-types"
import type { CommanderInvestigationRecoveryExecutionService } from "./commander-investigation-recovery-execution-service"
import type { CommanderInvestigationRecoveryContinuationSeed } from "./commander-investigation-recovery-execution-types"
import type { CommanderInvestigationCheckpoint } from "./commander-investigation-journal-types"
import { CommanderInvestigationJournalConflictError, CommanderInvestigationPersistenceError } from "./commander-investigation-journal-service"
import type { CommanderInvestigationJournalRun, CommanderInvestigationJournalService } from "./commander-investigation-journal-service"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import type { CommanderInvestigationRecoveryPreview } from "./commander-investigation-recovery-types"
import type {
  CommanderInvestigationRecoveryAttempt,
  CommanderInvestigationRecoveryContinuationRunner,
  CommanderInvestigationRecoveryExecutionMode,
  CommanderInvestigationRecoveryTransactionInput,
  CommanderInvestigationRecoveryTransactionResult,
} from "./commander-investigation-recovery-transaction-types"

type NormalizedTransactionInput = Readonly<CommanderInvestigationRecoveryTransactionInput>
type RecoveryExecutionFacts = {
  providerRequestCount: number
  externalApiAuditEventsAppended: number
  providerCalled: boolean
  networkCalled: boolean
}

export type CommanderInvestigationRecoveryTransactionServiceOptions = {
  recoveryPreview(input: { investigation_id: string; include_current_continuity?: boolean }): Promise<CommanderInvestigationRecoveryPreview>
  recoveryExecutionService: CommanderInvestigationRecoveryExecutionService
  recoverySource(investigationId: string): Promise<CommanderInvestigationRecoverySource | undefined>
  journalService: CommanderInvestigationJournalService
  continuationRunner: CommanderInvestigationRecoveryContinuationRunner
  executionMode?: CommanderInvestigationRecoveryExecutionMode
  onPersistenceRun?(run: CommanderInvestigationJournalRun): void
  onPersistenceRunReleased?(run: CommanderInvestigationJournalRun): void
  now?: () => Date
}

export class CommanderInvestigationRecoveryTransactionService {
  private readonly now: () => Date
  private readonly executionMode: CommanderInvestigationRecoveryExecutionMode
  private readonly transactions = new Map<string, Promise<void>>()

  constructor(private readonly options: CommanderInvestigationRecoveryTransactionServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.executionMode = options.executionMode ?? {
      kind: "scripted",
      execution_transport: "injected_scripted_adapter",
      provider_audit_required: false,
    }
  }

  async run(input: CommanderInvestigationRecoveryTransactionInput, operational: { abort_signal?: AbortSignal } = {}): Promise<CommanderInvestigationRecoveryTransactionResult> {
    const generatedAt = this.now().toISOString()
    const validated = normalizeTransactionInput(input)
    if (validated.blockers.length) return transactionResult({ status: "blocked", investigationId: validated.input.investigation_id || "invalid", generatedAt, blockers: validated.blockers })
    return this.serialized(validated.input.investigation_id, () => this.runSerialized(validated.input, generatedAt, operational.abort_signal))
  }

  private async serialized(investigationId: string, operation: () => Promise<CommanderInvestigationRecoveryTransactionResult>): Promise<CommanderInvestigationRecoveryTransactionResult> {
    const previous = this.transactions.get(investigationId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const chain = previous.catch(() => undefined).then(() => current)
    this.transactions.set(investigationId, chain)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.transactions.get(investigationId) === chain) this.transactions.delete(investigationId)
    }
  }

  private async runSerialized(input: NormalizedTransactionInput, generatedAt: string, abortSignal?: AbortSignal): Promise<CommanderInvestigationRecoveryTransactionResult> {
    const initialSource = await this.options.recoverySource(input.investigation_id)
    const existing = initialSource?.latest_recovery_attempt
    if (existing) {
      const exact = existing.approval_id === input.approval_id && existing.approval_hash === input.approval_hash && existing.recovery_plan_hash === input.recovery_plan_hash && existing.execution_preparation_hash === input.execution_preparation_hash
      return transactionResult({
        status: exact ? "already_started" : "blocked",
        investigationId: input.investigation_id,
        generatedAt,
        source: initialSource,
        attempt: existing,
        blockers: exact ? [] : ["a different Commander recovery attempt already exists"],
        warnings: exact ? [initialSource?.terminal ? "recovery transaction already completed" : "recovery transaction already started; execution will not be repeated"] : [],
      })
    }
    const recovery = await this.options.recoveryPreview({ investigation_id: input.investigation_id, include_current_continuity: true })
    if (recovery.status !== "approved_waiting_for_execution" || recovery.recommended_action !== "await_recovery_execution" || recovery.approval_state !== "current" || !recovery.current_approval || recovery.recovery_approval_consumed) {
      return transactionResult({ status: "blocked", investigationId: input.investigation_id, generatedAt, blockers: ["current unconsumed recovery approval is required", ...recovery.blockers], warnings: recovery.warnings })
    }
    if (recovery.current_approval.approval_id !== input.approval_id || recovery.current_approval.approval_hash !== input.approval_hash || recovery.recovery_plan_hash !== input.recovery_plan_hash || recovery.execution_preparation_hash !== input.execution_preparation_hash) {
      return transactionResult({ status: "blocked", investigationId: input.investigation_id, generatedAt, blockers: ["transaction input does not match the current approved recovery plan"] })
    }
    const prepared = await this.options.recoveryExecutionService.buildCurrentSeed({
      investigation_id: input.investigation_id,
      approval_id: input.approval_id,
      approval_hash: input.approval_hash,
      recovery_plan_hash: input.recovery_plan_hash,
    })
    const seed = prepared.seed
    if (prepared.preview.status !== "ready" || !seed || seed.execution_preparation_hash !== input.execution_preparation_hash || !prepared.recovery?.recovery_packet || !prepared.recovery.current_approval) {
      return transactionResult({ status: "blocked", investigationId: input.investigation_id, generatedAt, blockers: ["approved recovery execution preparation is no longer current", ...prepared.preview.blockers], warnings: prepared.preview.warnings })
    }
    const authoritativeSource = await this.options.recoverySource(input.investigation_id)
    if (!sameSourceAuthority(authoritativeSource, seed, prepared.recovery)) {
      return transactionResult({ status: "blocked", investigationId: input.investigation_id, generatedAt, blockers: ["recovery journal authority changed before transaction start"] })
    }
    const attempt = buildRecoveryAttempt(seed, prepared.recovery, generatedAt, this.executionMode)
    let recoveryStartEventId: string | undefined
    try {
      const appended = await this.options.journalService.recordRecoveryStartAfterRevalidation(input.investigation_id, async () => {
        const revalidated = await this.options.recoveryExecutionService.buildCurrentSeed({
          investigation_id: input.investigation_id,
          approval_id: input.approval_id,
          approval_hash: input.approval_hash,
          recovery_plan_hash: input.recovery_plan_hash,
        })
        if (revalidated.preview.status !== "ready" || !revalidated.seed || !revalidated.recovery?.recovery_packet || !revalidated.recovery.current_approval) {
          throw new CommanderInvestigationJournalConflictError("recovery execution preparation changed at the transaction append boundary")
        }
        const currentAttempt = buildRecoveryAttempt(revalidated.seed, revalidated.recovery, generatedAt, this.executionMode)
        if (currentAttempt.attempt_hash !== attempt.attempt_hash || currentAttempt.recovery_attempt_id !== attempt.recovery_attempt_id) {
          throw new CommanderInvestigationJournalConflictError("recovery attempt authority changed at the transaction append boundary")
        }
        return { recovery_attempt: currentAttempt }
      })
      recoveryStartEventId = appended.event_id
    } catch (error) {
      const reconciled = await this.options.recoverySource(input.investigation_id).catch(() => undefined)
      const confirmed = reconciled?.current_recovery_attempt
      if (!confirmed || confirmed.recovery_attempt_id !== attempt.recovery_attempt_id || confirmed.attempt_hash !== attempt.attempt_hash) {
        return transactionResult({
          status: error instanceof CommanderInvestigationJournalConflictError ? "blocked" : "failed",
          investigationId: input.investigation_id,
          generatedAt,
          blockers: [boundedError(error)],
          warnings: prepared.preview.warnings,
        })
      }
    }

    let run: CommanderInvestigationJournalRun | undefined
    let controllerResult: CommanderInvestigationResult | undefined
    let executionFacts: RecoveryExecutionFacts | undefined
    let terminalEventId: string | undefined
    let terminalPersisted = false
    try {
      run = await this.options.journalService.createRecoveryObserver({
        investigation_id: input.investigation_id,
        recovery_attempt_id: attempt.recovery_attempt_id,
        consumed_approval_id: attempt.approval_id,
        recovery_start_event_id: recoveryStartEventId ?? "reconciled_recovery_start",
        expected_first_model_request: seed.first_model_request_preview,
        recovery_request_id_prefix: seed.request_id_prefix,
      })
      this.options.onPersistenceRun?.(run)
      try {
        controllerResult = await this.options.continuationRunner.run({ seed, persistence_observer: run.observer, abort_signal: abortSignal })
      } catch (error) {
        if (run.state.pending_model_request_id) {
          return transactionResult({
            status: "failed",
            investigationId: input.investigation_id,
            generatedAt,
            attempt,
            recoveryStartEventId,
            eventCounts: observerEventCounts(run),
            eventsAppended: true,
            blockers: [boundedError(error), "fresh recovery provider outcome is uncertain; terminal persistence is forbidden"],
            warnings: ["recovery attempt remains consumed and requires human review; automatic retry is forbidden"],
          })
        }
        controllerResult = failedControllerResult(seed, error, this.now().toISOString(), run.state.latest_checkpoint)
      }
      executionFacts = recoveryExecutionFacts(seed, controllerResult, run, this.executionMode)
      const executionBlocker = executionModeBlocker(this.executionMode, executionFacts, controllerResult)
      if (executionBlocker) {
        controllerResult = failedControllerResult(seed, new CommanderInvestigationPersistenceError(executionBlocker), this.now().toISOString(), run.state.latest_checkpoint)
      }
      if (run.state.pending_model_request_id && !terminalOutcomeIsKnown(controllerResult)) {
        return transactionResult({
          status: "failed",
          investigationId: input.investigation_id,
          generatedAt,
          attempt,
          controllerResult,
          recoveryStartEventId,
          eventCounts: observerEventCounts(run),
          eventsAppended: true,
          executionFacts,
          blockers: ["fresh recovery provider outcome is uncertain; terminal persistence is forbidden"],
          warnings: ["recovery attempt remains consumed and requires human review; automatic retry is forbidden"],
        })
      }
      const durability = await this.options.journalService.finish(run, controllerResult)
      terminalPersisted = durability.terminal_persisted
      terminalEventId = durability.finished_event_id
    } catch (error) {
      const reconciled = await this.options.recoverySource(input.investigation_id).catch(() => undefined)
      terminalPersisted = Boolean(reconciled?.terminal?.recovery_attempt_id === attempt.recovery_attempt_id && reconciled.terminal.semantic_result_hash === controllerResult?.result_hash)
      if (!terminalPersisted) {
        return transactionResult({ status: "failed", investigationId: input.investigation_id, generatedAt, source: reconciled, attempt, controllerResult, recoveryStartEventId, eventCounts: observerEventCounts(run), eventsAppended: true, executionFacts: executionFacts ?? (controllerResult ? recoveryExecutionFacts(seed, controllerResult, run, this.executionMode) : undefined), blockers: [boundedError(error)], warnings: ["recovery attempt remains consumed and requires human review; automatic retry is forbidden"] })
      }
    } finally {
      if (run) {
        this.options.journalService.release(run)
        this.options.onPersistenceRunReleased?.(run)
      }
    }
    const finalSource = await this.options.recoverySource(input.investigation_id).catch(() => undefined)
    const terminalConfirmed = Boolean(terminalPersisted && finalSource?.projection_status === "ready" && finalSource.terminal?.recovery_attempt_id === attempt.recovery_attempt_id && finalSource.terminal.semantic_result_hash === controllerResult?.result_hash)
    return transactionResult({ status: terminalConfirmed ? "completed" : "failed", investigationId: input.investigation_id, generatedAt, source: finalSource, attempt, controllerResult, recoveryStartEventId, terminalEventId, eventCounts: observerEventCounts(run), eventsAppended: true, executionFacts: executionFacts ?? (controllerResult ? recoveryExecutionFacts(seed, controllerResult, run, this.executionMode) : undefined), blockers: terminalConfirmed ? [] : ["recovery terminal event was not confirmed as authoritative"], warnings: prepared.preview.warnings })
  }
}

export function commanderRecoveryTransactionBlockedResult(
  input: CommanderInvestigationRecoveryTransactionInput,
  blocker: string,
  generatedAt: Date = new Date(),
): CommanderInvestigationRecoveryTransactionResult {
  return transactionResult({
    status: "blocked",
    investigationId: typeof input.investigation_id === "string" ? input.investigation_id : "invalid",
    generatedAt: generatedAt.toISOString(),
    blockers: [blocker],
  })
}

function normalizeTransactionInput(input: CommanderInvestigationRecoveryTransactionInput): { input: NormalizedTransactionInput; blockers: string[] } {
  const source = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const allowed = new Set(["investigation_id", "approval_id", "approval_hash", "recovery_plan_hash", "execution_preparation_hash"])
  const blockers = Object.keys(source).filter((key) => !allowed.has(key)).map((key) => `unknown recovery transaction input key ${key}`)
  const normalized = Object.freeze({
    investigation_id: typeof source.investigation_id === "string" ? source.investigation_id : "",
    approval_id: typeof source.approval_id === "string" ? source.approval_id : "",
    approval_hash: typeof source.approval_hash === "string" ? source.approval_hash : "",
    recovery_plan_hash: typeof source.recovery_plan_hash === "string" ? source.recovery_plan_hash : "",
    execution_preparation_hash: typeof source.execution_preparation_hash === "string" ? source.execution_preparation_hash : "",
  })
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(normalized.investigation_id)) blockers.push("investigation_id is required and must use bounded durable ID characters")
  for (const [key, max] of [["approval_id", 160], ["approval_hash", 240], ["recovery_plan_hash", 240], ["execution_preparation_hash", 240]] as const) {
    const value = normalized[key]
    if (!value || value.length > max) blockers.push(`${key} is required and bounded`)
    if (/https?:\/\/|(?:^|\s)Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}/i.test(value)) blockers.push(`${key} contains forbidden URL or credential material`)
  }
  return { input: normalized, blockers: blockers.slice(0, 16) }
}

function sameSourceAuthority(source: CommanderInvestigationRecoverySource | undefined, seed: CommanderInvestigationRecoveryContinuationSeed, recovery: CommanderInvestigationRecoveryPreview): boolean {
  return Boolean(source?.projection_status === "ready" && source.record?.status === "running" && source.recovery_basis_hash === seed.recovery_basis_hash &&
    source.latest_checkpoint?.checkpoint_id === seed.checkpoint_ref.checkpoint_id && source.latest_checkpoint?.checkpoint_sequence === seed.checkpoint_ref.checkpoint_sequence &&
    source.latest_checkpoint?.checkpoint_hash === seed.checkpoint_ref.checkpoint_hash && recovery.current_approval && !recovery.recovery_approval_consumed)
}

function buildRecoveryAttempt(seed: CommanderInvestigationRecoveryContinuationSeed, recovery: CommanderInvestigationRecoveryPreview, startedAt: string, mode: CommanderInvestigationRecoveryExecutionMode): CommanderInvestigationRecoveryAttempt {
  const approval = recovery.current_approval!
  const packet = recovery.recovery_packet!
  const authority = {
    attempt_version: 1 as const,
    recovery_attempt_sequence: 0,
    investigation_id: seed.investigation_id,
    recovery_kind: seed.recovery_kind,
    execution_transport: mode.execution_transport,
    approval_id: approval.approval_id,
    approval_hash: approval.approval_hash,
    approval_sequence: approval.approval_sequence,
    approval_decision: approval.decision,
    approved_by: approval.approved_by,
    approval_consumed: true as const,
    one_shot: true as const,
    automatic: false as const,
    recovery_basis_hash: seed.recovery_basis_hash,
    recovery_plan_hash: recovery.recovery_plan_hash!,
    recovery_packet_hash: packet.packet_hash,
    execution_preparation_hash: seed.execution_preparation_hash,
    first_model_request_preview_hash: seed.first_model_request_preview.request_preview_hash,
    checkpoint_ref: seed.checkpoint_ref,
    pending_model_step_ref: seed.pending_model_step_ref,
    pending_boundary_disposition: seed.recovery_kind === "checkpoint" ? "not_applicable" as const : "continue_from_checkpoint_with_fresh_request" as const,
    provider_execution_envelope_hash: approval.provider_execution_envelope_hash,
    tool_compatibility_hash: approval.tool_compatibility_hash,
    provider_compatibility_hash: approval.provider_compatibility_hash,
    budget_compatibility_hash: approval.budget_compatibility_hash,
    context_compatibility_hash: approval.context_compatibility_hash,
    continuity_compatibility_hash: approval.continuity_compatibility_hash,
    human_control_compatibility_hash: approval.human_control_compatibility_hash,
    fresh_context_required: true as const,
    exact_replay_supported: false as const,
    provider_request_replay_allowed: false as const,
    tool_execution_replay_allowed: false as const,
    previous_provider_outcome_inferred: false as const,
  }
  const semanticHash = stableHash(authority)
  const attempt = {
    ...authority,
    recovery_attempt_id: `commander_recovery_attempt_0_${semanticHash.slice(0, 20)}`,
    started_at: startedAt,
    attempt_hash: "",
  }
  attempt.attempt_hash = stableHash({ ...attempt, started_at: "", attempt_hash: "" })
  return attempt
}

function failedControllerResult(seed: CommanderInvestigationRecoveryContinuationSeed, error: unknown, completedAt: string, checkpoint?: CommanderInvestigationCheckpoint): CommanderInvestigationResult {
  const budget = checkpoint?.budget ?? seed.effective_budget.effective_budget
  const workingSet = checkpoint?.working_set ?? seed.working_set
  const turnSummaries = checkpoint?.turn_summaries ?? seed.turn_summaries
  const providerRequestCount = checkpoint?.provider_request_count ?? seed.provider_request_count_before
  const elapsedActiveMs = checkpoint?.elapsed_active_ms ?? seed.elapsed_active_ms_before
  const loadedToolRefs = checkpoint?.loaded_tools ?? seed.loaded_tool_refs
  const bootstrapRef = checkpoint?.bootstrap_ref ?? seed.original_bootstrap_ref
  const consumedModelTurns = Math.max(workingSet.model_turn_count, seed.effective_budget.consumed.model_turns)
  const result: CommanderInvestigationResult = {
    investigation_id: seed.investigation_id,
    status: "failed",
    stop_reason: "controller_error",
    phase: seed.immutable_identity.phase,
    objective_preview: seed.working_set.objective_preview,
    provider_id: seed.immutable_identity.provider_id,
    provider_kind: seed.immutable_identity.provider_kind,
    model_id: seed.immutable_identity.model_id,
    tool_protocol: seed.tool_protocol,
    bootstrap_id: bootstrapRef.bootstrap_id,
    bootstrap_hash: bootstrapRef.bootstrap_hash,
    context_budget_id: budget.source_context_budget_id,
    budget,
    model_turn_count: consumedModelTurns,
    provider_request_count: providerRequestCount,
    tool_call_count: workingSet.tool_call_count,
    tool_search_call_count: workingSet.tool_search_call_count,
    loaded_tool_ids: loadedToolRefs.map((tool) => tool.tool_id),
    loaded_schema_bytes: loadedToolRefs.reduce((sum, tool) => sum + (tool.input_schema_bytes ?? 0) + (tool.output_schema_bytes ?? 0), 0),
    loaded_schema_tokens: loadedToolRefs.reduce((sum, tool) => sum + (tool.estimated_schema_tokens ?? 0), 0),
    cumulative_tool_result_bytes: workingSet.cumulative_tool_result_bytes,
    evidence: workingSet.evidence_cards,
    turn_summaries: turnSummaries,
    omitted_evidence_count: workingSet.omitted_evidence_count,
    omitted_turn_count: workingSet.omitted_turn_count,
    provider_audit: workingSet.provider_audit,
    blockers: [boundedError(error)],
    warnings: workingSet.current_warnings,
    started_at: seed.original_started_at,
    completed_at: completedAt,
    duration_ms: Math.max(seed.elapsed_active_ms_before, elapsedActiveMs),
    durability: { mode: "none", started_persisted: false, initial_checkpoint_persisted: false, terminal_persisted: false, investigation_event_count: 0, checkpoint_count: 0, resume_supported: false, full_transcript_persisted: false, raw_tool_results_persisted: false, chain_of_thought_persisted: false, warnings: [], durability_hash: stableHash({ mode: "none" }) },
    investigation_event_count: 0,
    in_memory_only: true,
    transcript_persisted: false,
    working_set_persisted: false,
    investigation_events_appended: false,
    external_api_audit_events_appended: 0,
    events_appended: false,
    files_written: false,
    research_db_written: false,
    mission_mutated: false,
    proposal_mutated: false,
    opencode_action_performed: false,
    github_action_performed: false,
    mcp_called: false,
    external_research_called: false,
    result_hash: "",
  }
  result.result_hash = stableHash({ ...result, completed_at: "", duration_ms: 0, result_hash: "" })
  return redactValue(result) as CommanderInvestigationResult
}

function recoveryExecutionFacts(
  seed: CommanderInvestigationRecoveryContinuationSeed,
  result: CommanderInvestigationResult,
  run?: CommanderInvestigationJournalRun,
  mode: CommanderInvestigationRecoveryExecutionMode = { kind: "scripted", execution_transport: "injected_scripted_adapter", provider_audit_required: false },
): RecoveryExecutionFacts {
  const providerRequests = Math.max(0, result.provider_request_count - seed.provider_request_count_before)
  const externalApiAudits = Math.max(0, result.provider_audit.external_api_audit_event_count - seed.external_api_audit_count_before)
  const persistedModelSteps = run?.state.recovery_model_step_event_count ?? 0
  return {
    providerRequestCount: providerRequests,
    externalApiAuditEventsAppended: externalApiAudits,
    providerCalled: mode.kind === "configured_connector" && providerRequests > 0,
    networkCalled: mode.kind === "configured_connector" && (externalApiAudits > 0 || (providerRequests > 0 && persistedModelSteps > 0)),
  }
}

function executionModeBlocker(
  mode: CommanderInvestigationRecoveryExecutionMode,
  facts: RecoveryExecutionFacts,
  result: CommanderInvestigationResult,
): string | undefined {
  if (mode.kind === "scripted") {
    if (facts.externalApiAuditEventsAppended !== 0 || result.provider_audit.external_api_audit_event_count !== 0) {
      return "scripted recovery transaction must not append external API audits"
    }
    return undefined
  }
  const newProviderRequests = facts.providerRequestCount
  if (facts.providerCalled && facts.externalApiAuditEventsAppended === 0) return "configured recovery provider request is missing an external API audit"
  if (facts.externalApiAuditEventsAppended !== newProviderRequests) return "configured recovery provider request and external API audit counts do not match"
  if (facts.externalApiAuditEventsAppended > 0 && result.provider_audit.transport_kind !== "external_api_connector") return "configured recovery audit transport kind is invalid"
  // The controller validates each fresh transport metadata envelope against the
  // current connector policy. The aggregate may also retain historical IDs.
  if (facts.externalApiAuditEventsAppended > 0 && !result.provider_audit.connector_ids.includes(mode.connector_id)) return "configured recovery audit connector does not match current authority"
  if (result.provider_audit.request_body_persisted || result.provider_audit.response_body_persisted || result.provider_audit.credentials_persisted) return "configured recovery audit metadata claims forbidden provider material was persisted"
  return undefined
}

function terminalOutcomeIsKnown(result: CommanderInvestigationResult): boolean {
  return result.status === "final" || result.status === "refused" || result.stop_reason === "model_malformed"
}

function transactionResult(input: {
  status: CommanderInvestigationRecoveryTransactionResult["status"]
  investigationId: string
  generatedAt: string
  source?: CommanderInvestigationRecoverySource
  attempt?: NonNullable<CommanderInvestigationRecoverySource["latest_recovery_attempt"]> | CommanderInvestigationRecoveryAttempt
  controllerResult?: CommanderInvestigationResult
  recoveryStartEventId?: string
  terminalEventId?: string
  eventCounts?: { investigation: number; modelSteps: number; checkpoints: number; terminals: number }
  eventsAppended?: boolean
  executionFacts?: RecoveryExecutionFacts
  blockers?: string[]
  warnings?: string[]
}): CommanderInvestigationRecoveryTransactionResult {
  const attempt = input.attempt
  const source = input.source
  const checkpointEvents = input.eventCounts?.checkpoints ?? 0
  const modelSteps = input.eventCounts?.modelSteps ?? 0
  const out: CommanderInvestigationRecoveryTransactionResult = {
    result_id: `commander_recovery_transaction_${stableHash({ investigation_id: input.investigationId, generated_at: input.generatedAt }).slice(0, 16)}`,
    status: input.status,
    investigation_id: input.investigationId,
    recovery_attempt_id: attempt?.recovery_attempt_id,
    recovery_attempt_sequence: attempt?.recovery_attempt_sequence,
    approval_id: attempt?.approval_id,
    approval_consumed: Boolean(attempt),
    approval_consumed_at: attempt?.started_at,
    recovery_basis_hash: attempt?.recovery_basis_hash,
    recovery_plan_hash: attempt?.recovery_plan_hash,
    execution_preparation_hash: attempt?.execution_preparation_hash,
    first_model_request_preview_hash: attempt?.first_model_request_preview_hash,
    checkpoint_ref: attempt?.checkpoint_ref,
    pending_model_step_ref: attempt?.pending_model_step_ref,
    pending_boundary_disposition: attempt?.pending_boundary_disposition,
    controller_result: input.controllerResult,
    recovery_start_event_id: input.recoveryStartEventId,
    terminal_event_id: input.terminalEventId,
    investigation_event_count: input.eventCounts?.investigation ?? 0,
    model_step_event_count: modelSteps,
    checkpoint_event_count: checkpointEvents,
    terminal_event_count: input.eventCounts?.terminals ?? 0,
    events_appended: input.eventsAppended ?? false,
    execution_transport: attempt?.execution_transport,
    external_api_audit_events_appended: input.executionFacts?.externalApiAuditEventsAppended ?? 0,
    provider_called: input.executionFacts?.providerCalled ?? false,
    scripted_model_turn_count: attempt?.execution_transport === "configured_connector_provider" ? 0 : modelSteps,
    configured_model_turn_count: attempt?.execution_transport === "configured_connector_provider" ? modelSteps : 0,
    network_called: input.executionFacts?.networkCalled ?? false,
    files_written: false,
    research_db_written: false,
    mission_mutated: false,
    proposal_mutated: false,
    opencode_action_performed: false,
    github_action_performed: false,
    mcp_called: false,
    blockers: (input.blockers ?? []).map((item) => redactText(item).slice(0, 240)).slice(0, 24),
    warnings: (input.warnings ?? []).map((item) => redactText(item).slice(0, 240)).slice(0, 24),
    generated_at: input.generatedAt,
    result_hash: "",
  }
  out.result_hash = stableHash({ ...out, result_id: "", recovery_start_event_id: "", terminal_event_id: "", generated_at: "", controller_result: input.controllerResult?.result_hash, result_hash: "" })
  return redactValue(out) as CommanderInvestigationRecoveryTransactionResult
}

function observerEventCounts(
  run: CommanderInvestigationJournalRun | undefined,
): { investigation: number; modelSteps: number; checkpoints: number; terminals: number } {
  if (!run) return { investigation: 1, modelSteps: 0, checkpoints: 0, terminals: 0 }
  const modelSteps = run.state.recovery_model_step_event_count ?? 0
  const checkpoints = run.state.recovery_checkpoint_event_count ?? 0
  const terminals = run.state.terminal_persisted ? 1 : 0
  return { investigation: 1 + modelSteps + checkpoints + terminals, modelSteps, checkpoints, terminals }
}

function boundedError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 240)
}
