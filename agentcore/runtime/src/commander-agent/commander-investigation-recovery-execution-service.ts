import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import { commanderToolSchemaFromDescriptor, stableHash } from "./commander-model-schema"
import type { CommanderInvestigationInput, CommanderInvestigationWorkingSet } from "./commander-investigation-types"
import type { CommanderInvestigationCheckpoint, CommanderInvestigationLoadedToolRef } from "./commander-investigation-journal-types"
import type {
  CommanderInvestigationRecoveryContinuationBuilderInput,
  CommanderInvestigationRecoveryContinuationBuilderOptions,
  CommanderInvestigationRecoveryContinuationSeed,
  CommanderInvestigationRecoveryExecutionPreparationInput,
  CommanderInvestigationRecoveryExecutionPreparationPreview,
  CommanderInvestigationRecoveryExecutionPreparationSummary,
} from "./commander-investigation-recovery-execution-types"
import type { CommanderInvestigationRecoveryPreview } from "./commander-investigation-recovery-types"
import { buildCommanderInvestigationRecoveryNotice } from "./commander-investigation-recovery-notice"
import { reconstructCommanderRecoveryReplayExchange } from "./commander-investigation-recovery-replay"
import { durableCommanderInvestigationWorkingSet } from "./commander-investigation-working-set"

export class CommanderInvestigationRecoveryContinuationBuilder {
  constructor(private readonly options: CommanderInvestigationRecoveryContinuationBuilderOptions) {}

  async build(input: CommanderInvestigationRecoveryContinuationBuilderInput): Promise<{ seed?: CommanderInvestigationRecoveryContinuationSeed; blockers: string[]; warnings: string[] }> {
    const { source, preview, checkpoint } = input
    const blockers: string[] = []
    const warnings: string[] = []
    if (!source.normalized_input || !source.immutable_identity || !source.recovery_basis_hash) blockers.push("recovery source is missing authoritative input, identity, or basis")
    if (!preview.recovery_packet) blockers.push("recovery preview is missing bounded recovery packet")
    if (preview.recovery_kind !== "checkpoint" && preview.recovery_kind !== "uncertain_provider_outcome") blockers.push("recovery kind cannot be prepared for execution")
    if (blockers.length) return { blockers, warnings }

    const restored = restoreCommanderInvestigationWorkingSet(checkpoint)
    if (restored.blocker) return { blockers: [restored.blocker], warnings }
    const loaded = checkpoint.loaded_tools
      .map((ref) => {
        const tool = this.options.descriptors.find((candidate) => candidate.tool_id === ref.tool_id)
        return tool && actualSchemaMatchesRef(tool, ref) ? deepFreeze(structuredClone(tool)) : undefined
      })
      .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
      .sort((a, b) => a.tool_id.localeCompare(b.tool_id))
    const missing = checkpoint.loaded_tools.filter((ref) => !loaded.some((tool) => tool.tool_id === ref.tool_id)).map((ref) => ref.tool_id)
    if (missing.length) return { blockers: missing.map((toolId) => `current descriptor for loaded recovery tool ${toolId} is unavailable or schema-mismatched`), warnings }
    const replay = reconstructCommanderRecoveryReplayExchange({ checkpoint, loadedTools: loaded, protocol: checkpoint.tool_protocol })
    if (replay.blockers.length) return { blockers: replay.blockers, warnings: replay.warnings }
    warnings.push(...replay.warnings)
    let currentBootstrap
    try {
      currentBootstrap = await this.options.currentBootstrap({ ...(source.normalized_input as Omit<CommanderInvestigationInput, "abort_signal">), include_continuity: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { blockers: [bound(`current bootstrap compilation failed for recovery preparation: ${message}`, 240)], warnings }
    }
    if (currentBootstrap.blockers.length || currentBootstrap.continuity_assessment_status === "degraded") {
      return { blockers: ["current bootstrap is not ready for recovery preparation", ...currentBootstrap.blockers].slice(0, 12), warnings: currentBootstrap.warnings.slice(0, 12) }
    }
    const pending = source.pending_model_step
    const uncertainCharge = pending ? 1 : 0
    const unresolvedAttempts = pending ? 1 : 0
    if (pending && pending.turn_index !== checkpoint.next_turn_index) blockers.push("pending model-step turn does not match checkpoint next turn")
    const modelTurnsConsumed = checkpoint.working_set.model_turn_count + uncertainCharge
    const nextTurn = pending ? Math.max(checkpoint.next_turn_index, pending.turn_index + 1) : checkpoint.next_turn_index
    if (!pending && checkpoint.next_turn_index !== checkpoint.working_set.model_turn_count + 1) blockers.push("checkpoint next_turn_index does not follow model_turn_count")
    const budget = continuationBudget(checkpoint, modelTurnsConsumed, uncertainCharge, unresolvedAttempts, preview.budget_compatibility)
    if (budget.exhausted_dimensions.length) blockers.push(...budget.exhausted_dimensions.map((dimension) => `recovery continuation budget exhausted for ${dimension}`))
    const notice = buildCommanderInvestigationRecoveryNotice({
      source,
      checkpoint,
      current_bootstrap_hash: currentBootstrap.bootstrap_hash,
      continuity_drift_detected: currentBootstrap.bootstrap_hash !== checkpoint.bootstrap_ref.bootstrap_hash,
      next_turn_index: nextTurn,
    })
    const gate = await this.preModelGateSnapshot(source.normalized_input!, nextTurn)
    if (gate.blockers.length) blockers.push(...gate.blockers)
    const budgetForContext = { ...budget.effective_budget, max_model_turns: Math.max(nextTurn, budget.effective_budget.max_model_turns) }
    const contextWorkingSet = gate.snapshot
      ? { ...restored.workingSet!, current_warnings: [...restored.workingSet!.current_warnings, ...gate.snapshot.human_control_warnings, ...gate.snapshot.provider_preflight_warnings] }
      : restored.workingSet!
    const context = this.options.contextService.build({
      bootstrap: currentBootstrap,
      workingSet: contextWorkingSet,
      loadedTools: loaded,
      toolProtocol: checkpoint.tool_protocol,
      budget: budgetForContext,
      latestAssistant: replay.latest_assistant,
      latestToolResults: replay.latest_tool_results,
      recoveryNotice: notice,
    })
    if (context.blocked) blockers.push(...context.blockers)
    warnings.push(...context.warnings)
    const replayMessageHash = stableHash({
      latest_assistant: replay.latest_assistant,
      latest_tool_results: replay.latest_tool_results,
    })
    const requestPrefix = `${checkpoint.investigation_id}_recovery_${checkpoint.checkpoint_sequence}_${stableHash({
      basis: source.recovery_basis_hash,
      checkpoint: checkpoint.checkpoint_hash,
      pending: pending?.model_request_id,
      bootstrap: currentBootstrap.bootstrap_hash,
      notice: notice.notice_hash,
    }).slice(0, 12)}`
    const requestId = `${requestPrefix}_turn_${nextTurn}`
    if (pending?.model_request_id === requestId || checkpoint.turn_summaries.some((turn) => turn.model_request_id === requestId)) blockers.push("recovery request id collides with historical model request id")
    const loadedToolSchemaHash = stableHash(loaded.map(commanderToolSchemaFromDescriptor))
    const requestPreview = {
      request_id: requestId,
      provider_id: checkpoint.provider_id,
      provider_kind: checkpoint.provider_kind,
      model_id: checkpoint.model_id,
      turn_index: nextTurn,
      tool_protocol: checkpoint.tool_protocol,
      tool_choice: "auto" as const,
      max_output_tokens: this.options.modelOutputTokens({ provider_kind: checkpoint.provider_kind, model_id: checkpoint.model_id }),
      input_bytes: context.input_bytes,
      estimated_input_tokens: context.estimated_tokens,
      message_count: context.messages.length,
      message_roles: context.messages.map((message) => message.role),
      loaded_tool_ids: loaded.map((tool) => tool.tool_id),
      loaded_tool_schema_hash: loadedToolSchemaHash,
      context_hash: stableHash({ messages: context.messages, input_bytes: context.input_bytes, estimated_tokens: context.estimated_tokens }),
      recovery_notice_hash: notice.notice_hash,
      old_pending_request_id: pending?.model_request_id,
      old_request_replayed: false as const,
      tool_execution_replayed: false as const,
      provider_called: false as const,
      request_preview_hash: "",
    }
    requestPreview.request_preview_hash = stableHash({ ...requestPreview, request_preview_hash: "" })
    const checkpointRef = {
      checkpoint_id: checkpoint.checkpoint_id,
      checkpoint_sequence: checkpoint.checkpoint_sequence,
      checkpoint_hash: checkpoint.checkpoint_hash,
    }
    const pendingRef = pending ? {
      model_request_id: pending.model_request_id,
      turn_index: pending.turn_index,
      base_checkpoint_id: pending.base_checkpoint_id,
      base_checkpoint_sequence: pending.base_checkpoint_sequence,
      base_checkpoint_hash: pending.base_checkpoint_hash,
      working_set_hash: pending.working_set_hash,
      context_hash: pending.context_hash,
      provider_request_may_have_been_sent: true as const,
      provider_response_available: false as const,
      provider_outcome_remains_unknown: true as const,
      tool_execution_known_to_have_occurred: false as const,
      provider_request_replay_forbidden: true as const,
      tool_execution_replay_forbidden: true as const,
      fresh_request_required_later: true as const,
    } : undefined
    const stableSeed = {
      seed_version: 1,
      investigation_id: checkpoint.investigation_id,
      recovery_kind: pending ? "uncertain_provider_outcome" : "checkpoint",
      immutable_identity: source.immutable_identity!,
      normalized_input_hash: source.recovery_basis!.normalized_input_hash,
      original_started_at: source.record?.started_at ?? checkpoint.created_at,
      recovery_basis_hash: source.recovery_basis_hash!,
      checkpoint_ref: checkpointRef,
      pending_model_step_ref: pendingRef,
      original_bootstrap_ref: checkpoint.bootstrap_ref,
      current_bootstrap_hash: currentBootstrap.bootstrap_hash,
      continuity_drift_detected: currentBootstrap.bootstrap_hash !== checkpoint.bootstrap_ref.bootstrap_hash,
      tool_protocol: checkpoint.tool_protocol,
      loaded_tool_refs: checkpoint.loaded_tools,
      effective_budget_hash: budget.effective_budget_hash,
      working_set_hash: restored.workingSet!.working_set_hash,
      turn_summary_hash: stableHash(checkpoint.turn_summaries),
      replay_exchange_hash: replay.summary.replay_exchange_hash,
      replay_message_hash: replayMessageHash,
      recovery_notice_hash: notice.notice_hash,
      pre_model_gate_snapshot_hash: gate.snapshot?.gate_snapshot_hash,
      next_turn_index: nextTurn,
      elapsed_active_ms_before: checkpoint.elapsed_active_ms,
      provider_request_count_before: checkpoint.provider_request_count,
      external_api_audit_count_before: checkpoint.external_api_audit_count,
      unresolved_provider_attempt_count: unresolvedAttempts,
      uncertain_model_turn_charge: uncertainCharge,
      first_model_request_preview_hash: requestPreview.request_preview_hash,
    }
    const executionPreparationHash = stableHash(stableSeed)
    const seed: CommanderInvestigationRecoveryContinuationSeed = {
      seed_version: 1,
      investigation_id: checkpoint.investigation_id,
      recovery_kind: pending ? "uncertain_provider_outcome" : "checkpoint",
      immutable_identity: source.immutable_identity!,
      normalized_input: source.normalized_input!,
      normalized_input_hash: source.recovery_basis!.normalized_input_hash,
      original_started_at: source.record?.started_at ?? checkpoint.created_at,
      recovery_basis_hash: source.recovery_basis_hash!,
      checkpoint_ref: checkpointRef,
      pending_model_step_ref: pendingRef,
      original_bootstrap_ref: checkpoint.bootstrap_ref,
      current_bootstrap: currentBootstrap,
      current_bootstrap_hash: currentBootstrap.bootstrap_hash,
      continuity_drift_detected: currentBootstrap.bootstrap_hash !== checkpoint.bootstrap_ref.bootstrap_hash,
      tool_protocol: checkpoint.tool_protocol,
      loaded_tools: loaded,
      loaded_tool_refs: checkpoint.loaded_tools,
      effective_budget: budget,
      effective_budget_hash: budget.effective_budget_hash,
      consumed: budget.consumed,
      working_set: restored.workingSet!,
      working_set_hash: restored.workingSet!.working_set_hash,
      turn_summaries: checkpoint.turn_summaries,
      latest_assistant: replay.latest_assistant,
      latest_tool_results: replay.latest_tool_results,
      replay_summary: replay.summary,
      replay_exchange_hash: replay.summary.replay_exchange_hash,
      replay_message_hash: replayMessageHash,
      recovery_notice: notice,
      recovery_notice_hash: notice.notice_hash,
      pre_model_gate_snapshot: gate.snapshot!,
      pre_model_gate_snapshot_hash: gate.snapshot!.gate_snapshot_hash,
      next_turn_index: nextTurn,
      elapsed_active_ms_before: checkpoint.elapsed_active_ms,
      provider_request_count_before: checkpoint.provider_request_count,
      external_api_audit_count_before: checkpoint.external_api_audit_count,
      unresolved_provider_attempt_count: unresolvedAttempts,
      uncertain_model_turn_charge: uncertainCharge,
      request_id_prefix: requestPrefix,
      first_model_request_preview: requestPreview,
      execution_preparation_hash: executionPreparationHash,
      exact_replay_supported: false,
      original_assistant_text_available: false,
      provider_request_replay_allowed: false,
      tool_execution_replay_allowed: false,
      fresh_context_required: true,
      full_transcript_available: false,
      raw_tool_results_available: false,
    }
    return { seed: blockers.length ? undefined : seed, blockers: blockers.slice(0, 16), warnings: warnings.slice(0, 16) }
  }

  private async preModelGateSnapshot(input: Omit<CommanderInvestigationInput, "abort_signal">, turnIndex: number) {
    const blockers: string[] = []
    const human = this.options.currentHumanControl
      ? await this.options.currentHumanControl({ phase: input.phase, session_id: input.session_id, launch_id: input.launch_id, turn_index: turnIndex })
      : { action: "continue" as const, source_kind: "default" as const, checked_at: "1970-01-01T00:00:00.000Z", warnings: [] }
    if (human.action !== "continue") blockers.push("current human control no longer permits recovery preparation")
    const provider = this.options.providerPreflight
      ? await this.options.providerPreflight({ phase: input.phase, provider_id: input.provider_id, provider_kind: input.provider_kind, model_id: input.model_id, turn_index: turnIndex })
      : undefined
    const snapshot = {
      snapshot_version: 1 as const,
      turn_index: turnIndex,
      human_control_action: "continue" as const,
      human_control_warnings: human.warnings.map((item) => bound(item, 240)).slice(0, 12),
      provider_preflight_ready: true as const,
      provider_preflight_warnings: (provider?.warnings ?? []).map((item) => bound(item, 240)).slice(0, 12),
      gate_snapshot_hash: "",
    }
    snapshot.gate_snapshot_hash = stableHash({ ...snapshot, gate_snapshot_hash: "" })
    return { snapshot, blockers: blockers.slice(0, 12) }
  }
}

export class CommanderInvestigationRecoveryExecutionService {
  constructor(private readonly options: {
    recoveryPreview(input: { investigation_id: string; include_current_continuity?: boolean }): Promise<CommanderInvestigationRecoveryPreview>
    recoverySource(investigationId: string): Promise<import("./commander-investigation-recovery-source").CommanderInvestigationRecoverySource | undefined>
    continuationBuilder: CommanderInvestigationRecoveryContinuationBuilder
    now?: () => Date
  }) {}

  async preview(input: CommanderInvestigationRecoveryExecutionPreparationInput): Promise<CommanderInvestigationRecoveryExecutionPreparationPreview> {
    const generatedAt = (this.options.now ?? (() => new Date()))().toISOString()
    const validated = validatePreparationInput(input)
    if (validated.blocker) return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: validated.investigation_id === "invalid" ? "not_found" : "blocked", blockers: [validated.blocker] })
    const recovery = await this.options.recoveryPreview({ investigation_id: validated.investigation_id, include_current_continuity: true })
    if (recovery.status !== "approved_waiting_for_execution" || recovery.recommended_action !== "await_recovery_execution" || recovery.approval_state !== "current" || !recovery.current_approval) {
      return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: recovery.status === "not_found" ? "not_found" : "blocked", recovery, blockers: ["current recovery approval is required before execution preparation preview"] })
    }
    if (recovery.current_approval.approval_id !== validated.approval_id || recovery.current_approval.approval_hash !== validated.approval_hash || recovery.recovery_plan_hash !== validated.recovery_plan_hash) {
      return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: "blocked", recovery, blockers: ["selected approval id/hash/plan does not match the current recovery approval"] })
    }
    if (!recovery.execution_preparation) {
      return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: "blocked", recovery, blockers: ["current recovery preview has no execution preparation"] })
    }
    const source = await this.options.recoverySource(validated.investigation_id)
    if (!source?.latest_checkpoint || source.recovery_basis_hash !== recovery.recovery_basis_hash) {
      return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: "blocked", recovery, blockers: ["recovery journal source changed before execution preparation preview"] })
    }
    const built = await this.options.continuationBuilder.build({ source, preview: recovery, checkpoint: source.latest_checkpoint })
    if (!built.seed || built.seed.execution_preparation_hash !== recovery.execution_preparation_hash) {
      return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: "blocked", recovery, blockers: ["current continuation preparation no longer matches the approved recovery plan", ...built.blockers], warnings: built.warnings })
    }
    return preparationPreview({ generatedAt, investigationId: validated.investigation_id, status: "ready", recovery, seed: built.seed, warnings: built.warnings })
  }
}

export function restoreCommanderInvestigationWorkingSet(checkpoint: CommanderInvestigationCheckpoint): { workingSet?: CommanderInvestigationWorkingSet; blocker?: string } {
  const workingSet = durableCommanderInvestigationWorkingSet(checkpoint.working_set as unknown as CommanderInvestigationWorkingSet)
  const checkpointToolIds = checkpoint.loaded_tools.map((tool) => tool.tool_id).sort()
  if (JSON.stringify(workingSet.loaded_tool_ids) !== JSON.stringify(checkpointToolIds)) return { blocker: "checkpoint loaded tool references do not match working-set loaded_tool_ids" }
  if (workingSet.working_set_hash !== checkpoint.working_set.working_set_hash) return { blocker: "checkpoint durable working-set hash could not be revalidated" }
  return { workingSet }
}

function continuationBudget(checkpoint: CommanderInvestigationCheckpoint, modelTurnsConsumed: number, uncertainCharge: number, unresolvedAttempts: number, compatibility: CommanderInvestigationRecoveryPreview["budget_compatibility"]) {
  const stored = checkpoint.budget
  const limits = compatibility.current_policy_limits ?? {}
  const budget = {
    ...stored,
    max_model_turns: boundedCurrentLimit(limits.max_model_turns, stored.max_model_turns),
    max_tool_calls: boundedCurrentLimit(limits.max_tool_calls, stored.max_tool_calls),
    max_tool_search_calls: boundedCurrentLimit(limits.max_tool_search_calls, stored.max_tool_search_calls),
    max_loaded_schemas: boundedCurrentLimit(limits.max_loaded_schemas, stored.max_loaded_schemas),
    max_cumulative_tool_result_bytes: boundedCurrentLimit(limits.max_cumulative_tool_result_bytes, stored.max_cumulative_tool_result_bytes),
    max_wall_time_ms: boundedCurrentLimit(limits.max_wall_time_ms, stored.max_wall_time_ms),
    max_consecutive_no_progress_turns: boundedCurrentLimit(limits.max_consecutive_no_progress_turns, stored.max_consecutive_no_progress_turns),
    max_evidence_cards: boundedCurrentLimit(limits.max_evidence_cards, stored.max_evidence_cards),
    max_turn_summaries: boundedCurrentLimit(limits.max_turn_summaries, stored.max_turn_summaries),
    max_context_bytes: boundedOptionalCurrentLimit(limits.max_context_bytes, stored.max_context_bytes),
    max_context_tokens: boundedOptionalCurrentLimit(limits.max_context_tokens, stored.max_context_tokens),
    tool_schema_allocation_bytes: boundedOptionalCurrentLimit(limits.tool_schema_allocation_bytes, stored.tool_schema_allocation_bytes),
    tool_schema_allocation_tokens: boundedOptionalCurrentLimit(limits.tool_schema_allocation_tokens, stored.tool_schema_allocation_tokens),
    budget_hash: "",
  }
  budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
  const consumed = {
    model_turns: modelTurnsConsumed,
    provider_requests: checkpoint.provider_request_count,
    tool_calls: checkpoint.working_set.tool_call_count,
    tool_search_calls: checkpoint.working_set.tool_search_call_count,
    cumulative_tool_result_bytes: checkpoint.working_set.cumulative_tool_result_bytes,
    elapsed_active_ms: checkpoint.elapsed_active_ms,
    evidence_cards: checkpoint.working_set.evidence_cards.length + checkpoint.working_set.omitted_evidence_count,
    turn_summaries: checkpoint.turn_summaries.length + checkpoint.working_set.omitted_turn_count,
    consecutive_no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns,
    loaded_schemas: checkpoint.loaded_tools.length,
  }
  const remaining = {
    model_turns: budget.max_model_turns - consumed.model_turns,
    tool_calls: budget.max_tool_calls - consumed.tool_calls,
    tool_search_calls: budget.max_tool_search_calls - consumed.tool_search_calls,
    cumulative_tool_result_bytes: budget.max_cumulative_tool_result_bytes - consumed.cumulative_tool_result_bytes,
    wall_time_ms: budget.max_wall_time_ms - consumed.elapsed_active_ms,
    evidence_cards: budget.max_evidence_cards - checkpoint.working_set.evidence_cards.length,
    turn_summaries: budget.max_turn_summaries - checkpoint.turn_summaries.length,
    loaded_schemas: budget.max_loaded_schemas - consumed.loaded_schemas,
  }
  const exhausted = Object.entries(remaining)
    .filter(([key, value]) => key === "model_turns" || key === "wall_time_ms" ? value <= 0 : value < 0)
    .map(([key]) => key)
  const result = {
    original_budget_id: budget.budget_id,
    original_budget_hash: stored.budget_hash,
    effective_budget: budget,
    effective_budget_hash: budget.budget_hash,
    consumed,
    remaining,
    uncertain_model_turn_charge: uncertainCharge,
    unresolved_provider_attempt_count: unresolvedAttempts,
    stricter_current_policy_dimensions: [],
    exhausted_dimensions: exhausted,
    budget_hash: "",
  }
  result.budget_hash = stableHash({ ...result, budget_hash: "" })
  return result
}

function boundedCurrentLimit(current: number | undefined, stored: number): number {
  return typeof current === "number" && Number.isFinite(current) ? Math.min(stored, Math.max(0, Math.floor(current))) : stored
}

function boundedOptionalCurrentLimit(current: number | undefined, stored: number | undefined): number | undefined {
  if (typeof current !== "number" || !Number.isFinite(current)) return stored
  return stored === undefined ? Math.max(0, Math.floor(current)) : Math.min(stored, Math.max(0, Math.floor(current)))
}

export function commanderRecoveryExecutionPreparationSummaryFromSeed(seed: CommanderInvestigationRecoveryContinuationSeed): CommanderInvestigationRecoveryExecutionPreparationSummary {
  return {
    recovery_kind: seed.recovery_kind,
    next_turn_index: seed.next_turn_index,
    original_started_at: seed.original_started_at,
    checkpoint_id: seed.checkpoint_ref.checkpoint_id,
    checkpoint_sequence: seed.checkpoint_ref.checkpoint_sequence,
    checkpoint_hash: seed.checkpoint_ref.checkpoint_hash,
    pending_model_request_id: seed.pending_model_step_ref?.model_request_id,
    unresolved_provider_attempt_count: seed.unresolved_provider_attempt_count,
    uncertain_model_turn_charge: seed.uncertain_model_turn_charge,
    model_turns_consumed: seed.consumed.model_turns,
    tool_calls_consumed: seed.consumed.tool_calls,
    tool_search_calls_consumed: seed.consumed.tool_search_calls,
    cumulative_tool_result_bytes: seed.consumed.cumulative_tool_result_bytes,
    elapsed_active_ms_before: seed.elapsed_active_ms_before,
    loaded_tool_ids: seed.loaded_tools.map((tool) => tool.tool_id),
    evidence_count: seed.working_set.evidence_cards.length + seed.working_set.omitted_evidence_count,
    repeat_signature_count: seed.working_set.recent_result_signatures.length,
    no_progress_count: seed.working_set.consecutive_no_progress_turns,
    replay_protocol_available: seed.replay_summary.replay_protocol_available,
    recovery_notice_hash: seed.recovery_notice_hash,
    first_model_request_preview_hash: seed.first_model_request_preview.request_preview_hash,
    execution_preparation_hash: seed.execution_preparation_hash,
    exact_replay_supported: false,
    original_assistant_text_available: false,
    fresh_context_required: true,
  }
}

function preparationPreview(input: {
  generatedAt: string
  investigationId: string
  status: "not_found" | "blocked" | "ready"
  recovery?: CommanderInvestigationRecoveryPreview
  seed?: CommanderInvestigationRecoveryContinuationSeed
  blockers?: string[]
  warnings?: string[]
}): CommanderInvestigationRecoveryExecutionPreparationPreview {
  const approval = input.recovery?.current_approval
  const preview = {
    preview_id: `commander_recovery_execution_preparation_${stableHash({ investigation_id: input.investigationId, generated_at: input.generatedAt }).slice(0, 16)}`,
    preview_version: 1 as const,
    status: input.status,
    investigation_id: input.investigationId,
    recovery_kind: input.recovery?.recovery_kind,
    recovery_basis_hash: input.recovery?.recovery_basis_hash,
    recovery_plan_hash: input.recovery?.recovery_plan_hash,
    recovery_packet_hash: input.recovery?.recovery_packet?.packet_hash,
    approval_id: approval?.approval_id,
    approval_hash: approval?.approval_hash,
    approval_sequence: approval?.approval_sequence,
    approval_decision: approval?.decision,
    approval_current: input.recovery?.approval_state === "current",
    approval_consumed: false as const,
    checkpoint_ref: input.seed?.checkpoint_ref,
    pending_model_step_ref: input.seed?.pending_model_step_ref,
    continuation_summary: input.seed ? commanderRecoveryExecutionPreparationSummaryFromSeed(input.seed) : undefined,
    first_model_request: input.seed?.first_model_request_preview,
    execution_preparation_hash: input.seed?.execution_preparation_hash,
    blockers: (input.blockers ?? []).map((item) => bound(item, 240)).slice(0, 24),
    warnings: (input.warnings ?? input.recovery?.warnings ?? []).map((item) => bound(item, 240)).slice(0, 24),
    generated_at: input.generatedAt,
    execution_supported_in_this_branch: false as const,
    provider_called: false as const,
    tool_executed: false as const,
    network_called: false as const,
    events_appended: false as const,
    files_written: false as const,
    research_db_written: false as const,
    mission_mutated: false as const,
    proposal_mutated: false as const,
    opencode_action_performed: false as const,
    github_action_performed: false as const,
    mcp_called: false as const,
    preview_hash: "",
  }
  preview.preview_hash = stableHash({ ...preview, preview_id: "", generated_at: "", preview_hash: "" })
  return redactValue(preview) as CommanderInvestigationRecoveryExecutionPreparationPreview
}

function validatePreparationInput(input: CommanderInvestigationRecoveryExecutionPreparationInput): { investigation_id: string; approval_id?: string; approval_hash?: string; recovery_plan_hash?: string; blocker?: string } {
  const allowed = new Set(["investigation_id", "approval_id", "approval_hash", "recovery_plan_hash"])
  const unknown = Object.keys(input).find((key) => !allowed.has(key))
  const investigationId = typeof input.investigation_id === "string" ? input.investigation_id.trim() : ""
  if (unknown) return { investigation_id: investigationId || "invalid", blocker: `unknown recovery execution preparation input key ${unknown}` }
  if (!investigationId || investigationId.length > 200 || !/^[A-Za-z0-9_.:-]+$/.test(investigationId)) return { investigation_id: "invalid", blocker: "investigation_id is required and must use bounded durable ID characters" }
  for (const key of ["approval_id", "approval_hash", "recovery_plan_hash"] as const) {
    const value = input[key]
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) return { investigation_id: investigationId, blocker: `${key} is required and bounded` }
    if (/https?:\/\//i.test(value) || /Bearer\s+\S+/i.test(value) || /sk-[A-Za-z0-9_-]{12,}/.test(value)) return { investigation_id: investigationId, blocker: `${key} contains forbidden credential or URL material` }
  }
  if (input.approval_id.length > 160) return { investigation_id: investigationId, blocker: "approval_id is required and bounded" }
  return { investigation_id: investigationId, approval_id: input.approval_id, approval_hash: input.approval_hash, recovery_plan_hash: input.recovery_plan_hash }
}

function bound(value: string, max: number): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, max)
}

function actualSchemaMatchesRef(tool: import("../commander-tools/commander-tool-types").CommanderToolDescriptor, ref: CommanderInvestigationLoadedToolRef): boolean {
  if (!tool.input_schema || !tool.output_schema) return false
  const inputBytes = Buffer.byteLength(JSON.stringify(tool.input_schema))
  const outputBytes = Buffer.byteLength(JSON.stringify(tool.output_schema))
  const inputHash = createHash("sha256").update(JSON.stringify(tool.input_schema)).digest("hex")
  const outputHash = createHash("sha256").update(JSON.stringify(tool.output_schema)).digest("hex")
  const tokens = Math.ceil((inputBytes + outputBytes) / 4)
  return tool.schema_metadata.input_schema_hash === inputHash
    && tool.schema_metadata.output_schema_hash === outputHash
    && tool.schema_metadata.input_schema_bytes === inputBytes
    && tool.schema_metadata.output_schema_bytes === outputBytes
    && tool.schema_metadata.estimated_schema_tokens === tokens
    && ref.input_schema_hash === inputHash
    && ref.output_schema_hash === outputHash
    && (!("input_schema_bytes" in ref) || ref.input_schema_bytes === inputBytes)
    && (!("output_schema_bytes" in ref) || ref.output_schema_bytes === outputBytes)
    && (!("estimated_schema_tokens" in ref) || ref.estimated_schema_tokens === tokens)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  }
  return value
}
