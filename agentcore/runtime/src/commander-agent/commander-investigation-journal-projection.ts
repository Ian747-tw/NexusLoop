import type { JsonlEvent } from "../events/event-types"
import { stableHash } from "./commander-model-schema"
import {
  COMMANDER_INVESTIGATION_EVENT_KINDS,
  type CommanderInvestigationCheckpoint,
  type CommanderInvestigationCheckpointedPayload,
  type CommanderInvestigationFinishedPayload,
  type CommanderInvestigationJournalIdentity,
  type CommanderInvestigationJournalEventKind,
  type CommanderInvestigationJournalLastTransition,
  type CommanderInvestigationJournalProjectionStatus,
  type CommanderInvestigationModelStepStartedPayload,
  type CommanderInvestigationRecord,
  type CommanderInvestigationRecoveryState,
  type CommanderInvestigationStartedPayload,
} from "./commander-investigation-journal-types"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import type {
  CommanderInvestigationRecoveryApprovalRecord,
  CommanderInvestigationRecoveryApprovalSummary,
  CommanderInvestigationRecoveryApprovedPayload,
} from "./commander-investigation-recovery-approval-types"
import type { CommanderInvestigationRecoveryBasis } from "./commander-investigation-recovery-basis"

export type CommanderInvestigationJournalProjection = {
  records: CommanderInvestigationRecord[]
  checkpoints: CommanderInvestigationCheckpoint[]
  recovery_sources: CommanderInvestigationRecoverySource[]
}

export function projectCommanderInvestigationJournal(events: JsonlEvent[]): CommanderInvestigationJournalProjection {
  const groups = new Map<string, JsonlEvent[]>()
  for (const event of events) {
    if (!isCommanderInvestigationKind(event.kind)) continue
    const investigationId = typeof event.investigation_id === "string" ? event.investigation_id : ""
    if (!investigationId) continue
    const current = groups.get(investigationId) ?? []
    current.push(event)
    groups.set(investigationId, current)
  }
  const records: CommanderInvestigationRecord[] = []
  const checkpoints: CommanderInvestigationCheckpoint[] = []
  const recoverySources: CommanderInvestigationRecoverySource[] = []
  for (const [investigationId, group] of groups) {
    const projected = projectOne(investigationId, group)
    records.push(projected.record)
    checkpoints.push(...projected.checkpoints)
    recoverySources.push(projected.recovery_source)
  }
  records.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.investigation_id.localeCompare(b.investigation_id))
  checkpoints.sort((a, b) => a.investigation_id.localeCompare(b.investigation_id) || a.checkpoint_sequence - b.checkpoint_sequence)
  recoverySources.sort((a, b) => a.investigation_id.localeCompare(b.investigation_id))
  return { records, checkpoints, recovery_sources: recoverySources }
}

function projectOne(investigationId: string, events: JsonlEvent[]): { record: CommanderInvestigationRecord; checkpoints: CommanderInvestigationCheckpoint[]; recovery_source: CommanderInvestigationRecoverySource } {
  const integrity: string[] = []
  let projectionStatus: CommanderInvestigationJournalProjectionStatus = "ready"
  let unsupportedVersion = false
  let started: CommanderInvestigationStartedPayload | undefined
  let terminal: CommanderInvestigationFinishedPayload | undefined
  let pendingModel: CommanderInvestigationModelStepStartedPayload | undefined
  const checkpoints: CommanderInvestigationCheckpoint[] = []
  const approvals: CommanderInvestigationRecoveryApprovalRecord[] = []
  let lastTransition: CommanderInvestigationJournalLastTransition = "started"
  const seenRequests = new Set<string>()
  const seenApprovalIds = new Set<string>()
  let identity: CommanderInvestigationJournalIdentity | undefined
  let startedInputHash: string | undefined

  events.forEach((event, index) => {
    if (event.schema_version !== 1) unsupportedVersion = true
    if (event.journal_sequence !== index) integrity.push(`journal sequence gap at ${index}`)
    if (!verifyPayloadHash(event)) integrity.push(`payload hash mismatch at sequence ${event.journal_sequence}`)
    const afterTerminal = Boolean(terminal)
    if (afterTerminal) integrity.push("investigation event appears after terminal event")
    if (event.kind === "runtime_commander_investigation_started") {
      if (!isStartedPayload(event)) {
        integrity.push(`malformed started payload at sequence ${event.journal_sequence}`)
        return
      }
      if (afterTerminal) return
      if (index !== 0) integrity.push("started event is not first")
      if (started) integrity.push("duplicate started event")
      started = event
      startedInputHash = started.input_hash
      identity = identityFromStarted(started)
      const initialErrors = initialCheckpointErrors(investigationId, started, identity)
      initialErrors.push(...startedInputErrors(started))
      integrity.push(...initialErrors)
      if (initialErrors.length === 0 && verifyCheckpoint(started.initial_checkpoint)) {
        checkpoints.push(started.initial_checkpoint)
      } else {
        integrity.push("initial checkpoint hash mismatch")
      }
      lastTransition = "started"
    } else if (event.kind === "runtime_commander_investigation_model_step_started") {
      if (!isModelStepStartedPayload(event)) {
        integrity.push(`malformed model-step payload at sequence ${event.journal_sequence}`)
        return
      }
      if (afterTerminal) return
      const model = event
      if (identity) integrity.push(...modelStepIdentityErrors(model, identity))
      if (seenRequests.has(model.model_request_id)) integrity.push(`duplicate model request ${model.model_request_id}`)
      seenRequests.add(model.model_request_id)
      const previous = checkpoints.at(-1)
      if (!previous || model.base_checkpoint_id !== previous.checkpoint_id || model.base_checkpoint_sequence !== previous.checkpoint_sequence || model.base_checkpoint_hash !== previous.checkpoint_hash) {
        integrity.push(`model-step base checkpoint mismatch at sequence ${event.journal_sequence}`)
      }
      integrity.push(...modelStepLoadedToolErrors(model, previous))
      if (previous && model.working_set_hash !== previous.working_set.working_set_hash) {
        integrity.push(`model-step working-set hash mismatch at sequence ${event.journal_sequence}`)
      }
      if (pendingModel) {
        integrity.push(`model-step started while previous model step pending at sequence ${event.journal_sequence}`)
        lastTransition = "model_step_started"
        return
      }
      pendingModel = model
      lastTransition = "model_step_started"
    } else if (event.kind === "runtime_commander_investigation_checkpointed") {
      if (!isCheckpointedPayload(event)) {
        integrity.push(`malformed checkpoint payload at sequence ${event.journal_sequence}`)
        return
      }
      if (afterTerminal) return
      const checkpoint = event.checkpoint
      const previous = checkpoints.at(-1)
      const checkpointErrors: string[] = []
      if (identity) checkpointErrors.push(...checkpointIdentityErrors(checkpoint, identity))
      if (!pendingModel) checkpointErrors.push("checkpoint missing model-step boundary")
      if (pendingModel && checkpoint.turn_index !== pendingModel.turn_index) checkpointErrors.push("checkpoint turn_index does not match pending model step")
      if (pendingModel && checkpoint.next_turn_index !== pendingModel.turn_index + 1) checkpointErrors.push("checkpoint next_turn_index does not follow pending model step")
      if (pendingModel && (checkpoint.provider_request_count < pendingModel.provider_request_count_before || checkpoint.provider_request_count > pendingModel.provider_request_count_before + 1)) checkpointErrors.push("checkpoint provider_request_count does not match pending model step")
      if (pendingModel && checkpoint.external_api_audit_count < pendingModel.external_api_audit_count_before) checkpointErrors.push("checkpoint external_api_audit_count is behind pending model step")
      if (pendingModel && checkpoint.working_set.model_turn_count !== pendingModel.turn_index) checkpointErrors.push("checkpoint working-set turn count does not match pending model step")
      if (checkpoint.investigation_id !== investigationId) checkpointErrors.push("checkpoint investigation_id mismatch")
      if (checkpoint.checkpoint_sequence !== checkpoints.length) checkpointErrors.push(`checkpoint sequence gap at ${checkpoint.checkpoint_sequence}`)
      if (checkpoint.previous_checkpoint_id !== previous?.checkpoint_id || checkpoint.previous_checkpoint_hash !== previous?.checkpoint_hash) checkpointErrors.push("checkpoint previous reference mismatch")
      checkpointErrors.push(...checkpointLoadedToolErrors(checkpoint))
      if (!verifyCheckpoint(checkpoint)) checkpointErrors.push(`checkpoint hash mismatch at ${checkpoint.checkpoint_sequence}`)
      integrity.push(...checkpointErrors)
      if (checkpointErrors.length === 0) {
        checkpoints.push(checkpoint)
        pendingModel = undefined
      }
      lastTransition = "checkpointed"
    } else if (event.kind === "runtime_commander_investigation_finished") {
      if (!isFinishedPayload(event)) {
        integrity.push(`malformed terminal payload at sequence ${event.journal_sequence}`)
        return
      }
      if (afterTerminal) return
      const terminalErrors: string[] = []
      if (terminal) terminalErrors.push("duplicate terminal event")
      if (event.terminal.investigation_id !== investigationId) terminalErrors.push("terminal investigation_id mismatch")
      if (identity) terminalErrors.push(...terminalIdentityErrors(event.terminal, identity))
      const previous = checkpoints.at(-1)
      if (event.terminal.last_checkpoint_id !== previous?.checkpoint_id || event.terminal.last_checkpoint_sequence !== previous?.checkpoint_sequence || event.terminal.last_checkpoint_hash !== previous?.checkpoint_hash) terminalErrors.push("terminal last-checkpoint reference mismatch")
      if (previous) terminalErrors.push(...terminalCounterErrors(event.terminal, previous))
      terminalErrors.push(...terminalLoadedToolErrors(event.terminal, previous))
      terminalErrors.push(...terminalConclusionErrors(event.terminal))
      if (!verifyTerminal(event.terminal)) terminalErrors.push("terminal hash mismatch")
      integrity.push(...terminalErrors)
      if (terminalErrors.length === 0) {
        terminal = event
        pendingModel = undefined
        lastTransition = "finished"
      }
    } else if (event.kind === "runtime_commander_investigation_recovery_approved") {
      if (!isRecoveryApprovedPayload(event)) {
        integrity.push(`malformed recovery approval payload at sequence ${event.journal_sequence}`)
        return
      }
      if (afterTerminal) return
      const approvalErrors: string[] = []
      if (!started || !identity || !startedInputHash) approvalErrors.push("recovery approval missing started basis")
      if (!latestAcceptedCheckpoint(checkpoints)) approvalErrors.push("recovery approval without accepted checkpoint")
      if (approvals.length >= 16) approvalErrors.push("recovery approval history exceeds cap")
      if (event.approval.approval_sequence !== approvals.length) approvalErrors.push(`recovery approval sequence gap at ${event.approval.approval_sequence}`)
      if (seenApprovalIds.has(event.approval.approval_id)) approvalErrors.push("duplicate recovery approval_id")
      seenApprovalIds.add(event.approval.approval_id)
      const checkpoint = latestAcceptedCheckpoint(checkpoints)
      if (checkpoint) approvalErrors.push(...approvalReferenceErrors(event.approval, checkpoint, pendingModel))
      if (identity && startedInputHash && checkpoint) {
        const basis = recoveryBasis(investigationId, projectionStatus, identity, startedInputHash, checkpoint, pendingModel, terminal)
        if (event.approval.recovery_basis_hash !== basis?.basis_hash) approvalErrors.push("recovery approval basis hash mismatch")
      }
      if (!verifyApproval(event.approval)) approvalErrors.push("recovery approval hash mismatch")
      integrity.push(...approvalErrors)
      if (approvalErrors.length === 0) {
        approvals.push(event.approval)
        lastTransition = "recovery_approved"
      }
    }
  })

  if (!started) {
    projectionStatus = unsupportedVersion ? "unsupported_version" : "corrupt"
    return corruptRecord(investigationId, events, ["missing started event", ...integrity], projectionStatus)
  }
  if (unsupportedVersion) projectionStatus = "unsupported_version"
  if (integrity.length && projectionStatus === "ready") projectionStatus = "corrupt"
  const latestCheckpoint = checkpoints.at(-1)
  const terminalRecord = terminal?.terminal
  const recoveryBasisValue = identity && startedInputHash && latestCheckpoint && projectionStatus === "ready"
    ? recoveryBasisForReady(investigationId, identity, startedInputHash, latestCheckpoint, pendingModel, terminal)
    : undefined
  const latestHistoricalApproval = approvals.at(-1)
  const currentApproval = currentApprovalForProjectedState(approvals, recoveryBasisValue, latestCheckpoint, pendingModel, Boolean(terminalRecord))
  const updatedAt = [started.started_at, latestCheckpoint?.created_at, pendingModel?.started_at, terminalRecord?.completed_at, latestHistoricalApproval?.approved_at]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? started.started_at
  const evidenceCards = terminalRecord?.evidence_cards ?? latestCheckpoint?.working_set.evidence_cards ?? []
  const omittedEvidenceCount = terminalRecord?.omitted_evidence_count ?? latestCheckpoint?.working_set.omitted_evidence_count ?? 0
  const uncertain = Boolean(pendingModel && !terminalRecord)
  const recoveryState = recovery(latestCheckpoint, uncertain, Boolean(terminalRecord), currentApproval)
  const record: CommanderInvestigationRecord = {
    investigation_id: investigationId,
    status: terminalRecord?.status ?? "running",
    stop_reason: terminalRecord?.stop_reason,
    phase: started.phase,
    objective_preview: started.objective,
    objective_hash: started.objective_hash,
    requested_by: started.requested_by,
    mission_id: started.mission_id,
    session_id: started.session_id,
    launch_id: started.launch_id,
    provider_id: started.provider_id,
    provider_kind: started.provider_kind,
    model_id: started.model_id,
    tool_protocol: started.tool_protocol,
    started_at: started.started_at,
    updated_at: updatedAt,
    completed_at: terminalRecord?.completed_at,
    budget_id: started.budget.budget_id,
    budget_hash: started.budget_hash,
    bootstrap_id: started.bootstrap_ref.bootstrap_id,
    bootstrap_hash: started.bootstrap_ref.bootstrap_hash,
    model_turn_count: terminalRecord?.model_turn_count ?? latestCheckpoint?.working_set.model_turn_count ?? 0,
    provider_request_count: terminalRecord?.provider_request_count ?? latestCheckpoint?.provider_request_count ?? 0,
    tool_call_count: terminalRecord?.tool_call_count ?? latestCheckpoint?.working_set.tool_call_count ?? 0,
    tool_search_call_count: terminalRecord?.tool_search_call_count ?? latestCheckpoint?.working_set.tool_search_call_count ?? 0,
    loaded_tool_ids: terminalRecord?.loaded_tool_ids ?? latestCheckpoint?.working_set.loaded_tool_ids ?? started.initial_loaded_tool_refs.map((tool) => tool.tool_id),
    evidence_ids: evidenceCards.map((card) => card.evidence_id),
    evidence_count: evidenceCards.length + omittedEvidenceCount,
    final_summary_preview: undefined,
    evidence_previews: evidenceCards.map((card) => `${card.title}: ${card.summary_preview}`.slice(0, 500)).slice(0, 8),
    latest_checkpoint_id: latestCheckpoint?.checkpoint_id,
    latest_checkpoint_sequence: latestCheckpoint?.checkpoint_sequence,
    latest_checkpoint_hash: latestCheckpoint?.checkpoint_hash,
    pending_model_request_id: pendingModel?.model_request_id,
    pending_turn_index: pendingModel?.turn_index,
    last_transition: lastTransition,
    checkpoint_available: Boolean(latestCheckpoint),
    uncertain_provider_outcome: uncertain,
    resume_supported: false,
    recovery_state: recoveryState,
    investigation_event_count: events.length,
    external_api_audit_event_count: terminalRecord?.provider_audit.external_api_audit_event_count ?? latestCheckpoint?.external_api_audit_count ?? 0,
    semantic_result_hash: terminalRecord?.semantic_result_hash,
    projection_status: projectionStatus,
    integrity_errors: integrity,
    warnings: terminalRecord?.warnings ?? latestCheckpoint?.working_set.current_warnings ?? [],
    record_hash: "",
    recovery_approval_count: approvals.length,
    latest_recovery_approval_id: currentApproval?.approval_id,
    latest_recovery_approval_sequence: currentApproval?.approval_sequence,
    latest_recovery_approval_decision: currentApproval?.decision,
    latest_recovery_approval_plan_hash: currentApproval?.recovery_plan_hash,
    latest_recovery_approval_basis_hash: currentApproval?.recovery_basis_hash,
    latest_recovery_approved_by: currentApproval?.approved_by,
    latest_recovery_approved_at: currentApproval?.approved_at,
    recovery_approval_recorded: Boolean(currentApproval),
    recovery_approval_consumed: false as const,
  }
  record.record_hash = stableHash({ ...record, record_hash: "" })
  return { record, checkpoints, recovery_source: recoverySource(investigationId, record, events, projectionStatus, started, identity, latestCheckpoint, pendingModel, terminal, recoveryBasisValue, approvals) }
}

function corruptRecord(investigationId: string, events: JsonlEvent[], errors: string[], status: CommanderInvestigationJournalProjectionStatus): { record: CommanderInvestigationRecord; checkpoints: CommanderInvestigationCheckpoint[]; recovery_source: CommanderInvestigationRecoverySource } {
  const record = {
    investigation_id: investigationId,
    status: "running" as const,
    phase: "general_read" as const,
    objective_preview: "",
    objective_hash: "",
    requested_by: "",
    provider_id: "",
    provider_kind: "",
    model_id: "",
    tool_protocol: "native" as const,
    started_at: "",
    updated_at: String(events.at(-1)?.timestamp ?? ""),
    budget_id: "",
    budget_hash: "",
    bootstrap_id: "",
    bootstrap_hash: "",
    model_turn_count: 0,
    provider_request_count: 0,
    tool_call_count: 0,
    tool_search_call_count: 0,
    loaded_tool_ids: [],
    evidence_ids: [],
    evidence_count: 0,
    evidence_previews: [],
    last_transition: "started" as const,
    checkpoint_available: false,
    uncertain_provider_outcome: false,
    resume_supported: false as const,
    recovery_state: "no_checkpoint_resume_not_implemented" as const,
    investigation_event_count: events.length,
    external_api_audit_event_count: 0,
    projection_status: status,
    integrity_errors: errors,
    warnings: [],
    record_hash: "",
    recovery_approval_count: 0,
    recovery_approval_recorded: false,
    recovery_approval_consumed: false as const,
  }
  record.record_hash = stableHash({ ...record, record_hash: "" })
  return { record, checkpoints: [], recovery_source: recoverySource(investigationId, record, events, status) }
}

function recoverySource(
  investigationId: string,
  record: CommanderInvestigationRecord,
  events: JsonlEvent[],
  projectionStatus: CommanderInvestigationJournalProjectionStatus,
  started?: CommanderInvestigationStartedPayload,
  identity?: CommanderInvestigationJournalIdentity,
  latestCheckpoint?: CommanderInvestigationCheckpoint,
  pendingModel?: CommanderInvestigationModelStepStartedPayload,
  terminal?: CommanderInvestigationFinishedPayload,
  recoveryBasis?: CommanderInvestigationRecoveryBasis,
  approvals: CommanderInvestigationRecoveryApprovalRecord[] = [],
): CommanderInvestigationRecoverySource {
  const authoritative = projectionStatus === "ready"
  const approvalSummaries = authoritative ? approvals.map(approvalSummary).slice(-16) : []
  const source: CommanderInvestigationRecoverySource = {
    investigation_id: investigationId,
    projection_status: projectionStatus,
    record,
    normalized_input: authoritative ? started?.normalized_input : undefined,
    immutable_identity: authoritative ? identity : undefined,
    latest_checkpoint: authoritative ? latestCheckpoint : undefined,
    pending_model_step: authoritative && !terminal ? pendingModel : undefined,
    terminal: authoritative ? terminal?.terminal : undefined,
    recovery_basis: authoritative ? recoveryBasis : undefined,
    recovery_basis_hash: authoritative ? recoveryBasis?.basis_hash : undefined,
    recovery_approvals: approvalSummaries,
    latest_recovery_approval: approvalSummaries.at(-1),
    source_event_count: events.length,
    source_hash: "",
  }
  source.source_hash = stableHash({
    investigation_id: source.investigation_id,
    projection_status: source.projection_status,
    record_hash: source.record?.record_hash,
    input_hash: started?.input_hash,
    immutable_identity: source.immutable_identity,
    latest_checkpoint_hash: source.latest_checkpoint?.checkpoint_hash,
    pending_model_request_id: source.pending_model_step?.model_request_id,
    terminal_hash: source.terminal?.terminal_hash,
    recovery_basis_hash: source.recovery_basis_hash,
    recovery_approval_count: approvalSummaries.length,
    latest_recovery_approval_hash: approvalSummaries.at(-1)?.approval_hash,
    source_event_count: source.source_event_count,
  })
  return source
}

function recovery(checkpoint: CommanderInvestigationCheckpoint | undefined, uncertain: boolean, terminal: boolean, latestApproval?: CommanderInvestigationRecoveryApprovalRecord): CommanderInvestigationRecoveryState {
  if (terminal) return "not_required"
  if (latestApproval?.decision === "approve_continue_after_uncertain_provider_outcome") return "uncertain_outcome_approval_recorded_execution_not_implemented"
  if (latestApproval?.decision === "approve_resume_from_checkpoint") return "checkpoint_approval_recorded_execution_not_implemented"
  if (uncertain) return "uncertain_provider_outcome_resume_not_implemented"
  if (checkpoint) return "checkpoint_available_resume_not_implemented"
  return "no_checkpoint_resume_not_implemented"
}

function currentApprovalForProjectedState(
  approvals: CommanderInvestigationRecoveryApprovalRecord[],
  basis: CommanderInvestigationRecoveryBasis | undefined,
  checkpoint: CommanderInvestigationCheckpoint | undefined,
  pendingModel: CommanderInvestigationModelStepStartedPayload | undefined,
  terminal: boolean,
): CommanderInvestigationRecoveryApprovalRecord | undefined {
  if (terminal || !basis || !checkpoint) return undefined
  for (let index = approvals.length - 1; index >= 0; index -= 1) {
    const approval = approvals[index]
    if (!approval) continue
    if (approval.recovery_basis_hash !== basis.basis_hash) continue
    if (approval.checkpoint_ref.checkpoint_id !== checkpoint.checkpoint_id) continue
    if (approval.checkpoint_ref.checkpoint_sequence !== checkpoint.checkpoint_sequence) continue
    if (approval.checkpoint_ref.checkpoint_hash !== checkpoint.checkpoint_hash) continue
    if (basis.recovery_kind === "checkpoint") {
      if (approval.decision === "approve_resume_from_checkpoint" && !pendingModel && !approval.pending_model_step_ref) return approval
      continue
    }
    if (basis.recovery_kind === "uncertain_provider_outcome" && pendingModel && approval.pending_model_step_ref) {
      if (
        approval.decision === "approve_continue_after_uncertain_provider_outcome" &&
        approval.pending_model_step_ref.model_request_id === pendingModel.model_request_id &&
        approval.pending_model_step_ref.turn_index === pendingModel.turn_index &&
        approval.pending_model_step_ref.base_checkpoint_id === pendingModel.base_checkpoint_id &&
        approval.pending_model_step_ref.base_checkpoint_sequence === pendingModel.base_checkpoint_sequence &&
        approval.pending_model_step_ref.base_checkpoint_hash === pendingModel.base_checkpoint_hash &&
        approval.pending_model_step_ref.working_set_hash === pendingModel.working_set_hash &&
        approval.pending_model_step_ref.context_hash === pendingModel.context_hash
      ) return approval
    }
  }
  return undefined
}

function latestAcceptedCheckpoint(checkpoints: CommanderInvestigationCheckpoint[]): CommanderInvestigationCheckpoint | undefined {
  return checkpoints.at(-1)
}

function recoveryBasisForReady(
  investigationId: string,
  identity: CommanderInvestigationJournalIdentity,
  normalizedInputHash: string,
  checkpoint: CommanderInvestigationCheckpoint,
  pendingModel?: CommanderInvestigationModelStepStartedPayload,
  terminal?: CommanderInvestigationFinishedPayload,
): CommanderInvestigationRecoveryBasis {
  const recoveryKind: CommanderInvestigationRecoveryBasis["recovery_kind"] = terminal ? "none" : pendingModel ? "uncertain_provider_outcome" : "checkpoint"
  const basis = {
    basis_version: 1 as const,
    investigation_id: investigationId,
    projection_status: "ready" as const,
    immutable_identity: identity,
    normalized_input_hash: normalizedInputHash,
    latest_checkpoint_id: checkpoint.checkpoint_id,
    latest_checkpoint_sequence: checkpoint.checkpoint_sequence,
    latest_checkpoint_hash: checkpoint.checkpoint_hash,
    pending_model_request_id: pendingModel?.model_request_id,
    pending_model_boundary_hash: pendingModel ? stableHash(pendingBoundaryForHash(pendingModel)) : undefined,
    terminal_hash: terminal?.terminal.terminal_hash,
    recovery_kind: recoveryKind,
    basis_hash: "",
  }
  basis.basis_hash = stableHash({ ...basis, basis_hash: "" })
  return basis
}

function recoveryBasis(
  investigationId: string,
  projectionStatus: CommanderInvestigationJournalProjectionStatus,
  identity: CommanderInvestigationJournalIdentity,
  normalizedInputHash: string,
  checkpoint: CommanderInvestigationCheckpoint,
  pendingModel?: CommanderInvestigationModelStepStartedPayload,
  terminal?: CommanderInvestigationFinishedPayload,
): CommanderInvestigationRecoveryBasis | undefined {
  return projectionStatus === "ready" ? recoveryBasisForReady(investigationId, identity, normalizedInputHash, checkpoint, pendingModel, terminal) : undefined
}

function pendingBoundaryForHash(pending: CommanderInvestigationModelStepStartedPayload): unknown {
  return {
    investigation_id: pending.investigation_id,
    turn_index: pending.turn_index,
    model_request_id: pending.model_request_id,
    provider_id: pending.provider_id,
    provider_kind: pending.provider_kind,
    model_id: pending.model_id,
    tool_protocol: pending.tool_protocol,
    base_checkpoint_id: pending.base_checkpoint_id,
    base_checkpoint_sequence: pending.base_checkpoint_sequence,
    base_checkpoint_hash: pending.base_checkpoint_hash,
    working_set_hash: pending.working_set_hash,
    context_hash: pending.context_hash,
    input_bytes: pending.input_bytes,
    estimated_input_tokens: pending.estimated_input_tokens,
    loaded_tool_refs: pending.loaded_tool_refs,
    provider_request_count_before: pending.provider_request_count_before,
    external_api_audit_count_before: pending.external_api_audit_count_before,
  }
}

function approvalSummary(approval: CommanderInvestigationRecoveryApprovalRecord): CommanderInvestigationRecoveryApprovalSummary {
  return {
    approval_id: approval.approval_id,
    approval_sequence: approval.approval_sequence,
    decision: approval.decision,
    approved_by: approval.approved_by,
    approved_at: approval.approved_at,
    human_note_hash: approval.human_note_hash,
    recovery_basis_hash: approval.recovery_basis_hash,
    recovery_plan_hash: approval.recovery_plan_hash,
    recovery_packet_hash: approval.recovery_packet_hash,
    checkpoint_ref: approval.checkpoint_ref,
    pending_model_step_ref: approval.pending_model_step_ref,
    pending_model_request_id: approval.pending_model_step_ref?.model_request_id,
    provider_execution_envelope_hash: approval.provider_execution_envelope_hash,
    tool_compatibility_hash: approval.tool_compatibility_hash,
    provider_compatibility_hash: approval.provider_compatibility_hash,
    budget_compatibility_hash: approval.budget_compatibility_hash,
    context_compatibility_hash: approval.context_compatibility_hash,
    continuity_compatibility_hash: approval.continuity_compatibility_hash,
    human_control_compatibility_hash: approval.human_control_compatibility_hash,
    approval_hash: approval.approval_hash,
  }
}

function identityFromStarted(started: CommanderInvestigationStartedPayload): CommanderInvestigationJournalIdentity {
  return {
    investigation_id: started.investigation_id,
    phase: started.phase,
    objective_hash: started.objective_hash,
    provider_id: started.provider_id,
    provider_kind: started.provider_kind,
    model_id: started.model_id,
    tool_protocol: started.tool_protocol,
    bootstrap_id: started.bootstrap_ref.bootstrap_id,
    bootstrap_hash: started.bootstrap_ref.bootstrap_hash,
    budget_id: started.budget.budget_id,
    budget_hash: started.budget_hash,
  }
}

function initialCheckpointErrors(investigationId: string, started: CommanderInvestigationStartedPayload, identity: CommanderInvestigationJournalIdentity): string[] {
  const errors: string[] = []
  const checkpoint = started.initial_checkpoint
  if (checkpoint.investigation_id !== investigationId) errors.push("initial checkpoint investigation_id mismatch")
  if (checkpoint.checkpoint_sequence !== 0) errors.push("initial checkpoint sequence is not zero")
  if (checkpoint.previous_checkpoint_id || checkpoint.previous_checkpoint_hash) errors.push("initial checkpoint has previous checkpoint reference")
  errors.push(...checkpointIdentityErrors(checkpoint, identity, "initial checkpoint"))
  if (stableHash(started.initial_loaded_tool_refs) !== stableHash(checkpoint.loaded_tools)) errors.push("initial checkpoint loaded-tool references mismatch started event")
  return errors
}

function modelStepIdentityErrors(model: CommanderInvestigationModelStepStartedPayload, identity: CommanderInvestigationJournalIdentity): string[] {
  const errors: string[] = []
  if (model.investigation_id !== identity.investigation_id) errors.push("model-step investigation_id mismatch")
  if (model.provider_id !== identity.provider_id) errors.push("model-step provider_id identity mismatch")
  if (model.provider_kind !== identity.provider_kind) errors.push("model-step provider_kind identity mismatch")
  if (model.model_id !== identity.model_id) errors.push("model-step model_id identity mismatch")
  if (model.tool_protocol !== identity.tool_protocol) errors.push("model-step tool_protocol identity mismatch")
  return errors
}

function startedInputErrors(started: CommanderInvestigationStartedPayload): string[] {
  const errors: string[] = []
  const input = started.normalized_input
  if (!isNormalizedInput(input)) {
    errors.push("started normalized_input is malformed")
    return errors
  }
  if (stableHash(input) !== started.input_hash) errors.push("started input_hash mismatch")
  const optionalKeys = ["mission_id", "session_id", "launch_id"] as const
  if (input.investigation_id !== started.investigation_id) errors.push("started normalized_input investigation_id mismatch")
  if (input.phase !== started.phase) errors.push("started normalized_input phase mismatch")
  if (input.objective !== started.objective) errors.push("started normalized_input objective mismatch")
  if (input.requested_by !== started.requested_by) errors.push("started normalized_input requested_by mismatch")
  for (const key of optionalKeys) {
    if (input[key] !== started[key]) errors.push(`started normalized_input ${key} mismatch`)
  }
  if (input.provider_id !== started.provider_id) errors.push("started normalized_input provider_id mismatch")
  if (input.provider_kind !== started.provider_kind) errors.push("started normalized_input provider_kind mismatch")
  if (input.model_id !== started.model_id) errors.push("started normalized_input model_id mismatch")
  if (input.tool_protocol !== undefined && input.tool_protocol !== "auto" && input.tool_protocol !== started.tool_protocol) errors.push("started normalized_input tool_protocol mismatch")
  return errors
}

function modelStepLoadedToolErrors(model: CommanderInvestigationModelStepStartedPayload, checkpoint: CommanderInvestigationCheckpoint | undefined): string[] {
  if (!checkpoint) return []
  return sameLoadedToolRefs(model.loaded_tool_refs, checkpoint.loaded_tools)
    ? []
    : [`model-step loaded_tool_refs mismatch base checkpoint at sequence ${model.journal_sequence}`]
}

function checkpointIdentityErrors(checkpoint: CommanderInvestigationCheckpoint, identity: CommanderInvestigationJournalIdentity, label = "checkpoint"): string[] {
  const errors: string[] = []
  if (checkpoint.investigation_id !== identity.investigation_id) errors.push(`${label} investigation_id mismatch`)
  if (checkpoint.phase !== identity.phase) errors.push(`${label} phase identity mismatch`)
  if (checkpoint.objective_hash !== identity.objective_hash) errors.push(`${label} objective_hash identity mismatch`)
  if (checkpoint.provider_id !== identity.provider_id) errors.push(`${label} provider_id identity mismatch`)
  if (checkpoint.provider_kind !== identity.provider_kind) errors.push(`${label} provider_kind identity mismatch`)
  if (checkpoint.model_id !== identity.model_id) errors.push(`${label} model_id identity mismatch`)
  if (checkpoint.tool_protocol !== identity.tool_protocol) errors.push(`${label} tool_protocol identity mismatch`)
  if (checkpoint.bootstrap_ref.bootstrap_id !== identity.bootstrap_id) errors.push(`${label} bootstrap_id identity mismatch`)
  if (checkpoint.bootstrap_ref.bootstrap_hash !== identity.bootstrap_hash) errors.push(`${label} bootstrap_hash identity mismatch`)
  if (checkpoint.budget.budget_id !== identity.budget_id) errors.push(`${label} budget_id identity mismatch`)
  if (checkpoint.budget.budget_hash !== identity.budget_hash) errors.push(`${label} budget_hash identity mismatch`)
  return errors
}

function checkpointLoadedToolErrors(checkpoint: CommanderInvestigationCheckpoint, label = "checkpoint"): string[] {
  const loadedIds = checkpoint.loaded_tools.map((tool) => tool.tool_id).sort()
  const workingSetIds = checkpoint.working_set.loaded_tool_ids.slice().sort()
  return stableHash(loadedIds) === stableHash(workingSetIds)
    ? []
    : [`${label} loaded_tools mismatch working_set.loaded_tool_ids`]
}

function terminalIdentityErrors(terminal: CommanderInvestigationFinishedPayload["terminal"], identity: CommanderInvestigationJournalIdentity): string[] {
  const errors: string[] = []
  if (terminal.investigation_id !== identity.investigation_id) errors.push("terminal investigation_id mismatch")
  if (terminal.phase !== identity.phase) errors.push("terminal phase identity mismatch")
  if (terminal.objective_hash !== identity.objective_hash) errors.push("terminal objective_hash identity mismatch")
  if (terminal.provider_id !== identity.provider_id) errors.push("terminal provider_id identity mismatch")
  if (terminal.provider_kind !== identity.provider_kind) errors.push("terminal provider_kind identity mismatch")
  if (terminal.model_id !== identity.model_id) errors.push("terminal model_id identity mismatch")
  if (terminal.tool_protocol !== identity.tool_protocol) errors.push("terminal tool_protocol identity mismatch")
  if (terminal.bootstrap_id !== identity.bootstrap_id) errors.push("terminal bootstrap_id identity mismatch")
  if (terminal.bootstrap_hash !== identity.bootstrap_hash) errors.push("terminal bootstrap_hash identity mismatch")
  if (terminal.budget_id !== identity.budget_id) errors.push("terminal budget_id identity mismatch")
  if (terminal.budget_hash !== identity.budget_hash) errors.push("terminal budget_hash identity mismatch")
  return errors
}

function terminalCounterErrors(terminal: CommanderInvestigationFinishedPayload["terminal"], checkpoint: CommanderInvestigationCheckpoint): string[] {
  const errors: string[] = []
  if (terminal.model_turn_count < checkpoint.working_set.model_turn_count) errors.push("terminal model_turn_count moves backward from latest checkpoint")
  if (terminal.provider_request_count < checkpoint.provider_request_count) errors.push("terminal provider_request_count moves backward from latest checkpoint")
  if (terminal.tool_call_count < checkpoint.working_set.tool_call_count) errors.push("terminal tool_call_count moves backward from latest checkpoint")
  if (terminal.tool_search_call_count < checkpoint.working_set.tool_search_call_count) errors.push("terminal tool_search_call_count moves backward from latest checkpoint")
  return errors
}

function terminalLoadedToolErrors(terminal: CommanderInvestigationFinishedPayload["terminal"], checkpoint: CommanderInvestigationCheckpoint | undefined): string[] {
  if (!checkpoint) return []
  const terminalIds = terminal.loaded_tool_ids.slice().sort()
  const checkpointIds = checkpoint.loaded_tools.map((tool) => tool.tool_id).sort()
  return stableHash(terminalIds) === stableHash(checkpointIds)
    ? []
    : ["terminal loaded_tool_ids mismatch latest checkpoint"]
}

function terminalConclusionErrors(terminal: CommanderInvestigationFinishedPayload["terminal"]): string[] {
  const errors: string[] = []
  const conclusion = terminal.conclusion
  if (conclusion.status !== terminal.status) errors.push("terminal conclusion status mismatch")
  if (conclusion.stop_reason !== terminal.stop_reason) errors.push("terminal conclusion stop_reason mismatch")
  if (conclusion.final_output_text_hash !== terminal.final_output?.text_hash) errors.push("terminal conclusion final_output_text_hash mismatch")
  for (const card of terminal.evidence_cards) {
    if (!conclusion.evidence_ids.includes(card.evidence_id)) errors.push("terminal conclusion evidence_ids mismatch")
    if (!conclusion.evidence_titles.includes(card.title)) errors.push("terminal conclusion evidence_titles mismatch")
    if (!conclusion.safe_evidence_summaries.includes(card.summary_preview)) errors.push("terminal conclusion safe_evidence_summaries mismatch")
  }
  return errors
}

function approvalReferenceErrors(approval: CommanderInvestigationRecoveryApprovalRecord, checkpoint: CommanderInvestigationCheckpoint, pendingModel: CommanderInvestigationModelStepStartedPayload | undefined): string[] {
  const errors: string[] = []
  if (approval.investigation_id !== checkpoint.investigation_id) errors.push("recovery approval investigation_id mismatch")
  if (approval.checkpoint_ref.checkpoint_id !== checkpoint.checkpoint_id || approval.checkpoint_ref.checkpoint_sequence !== checkpoint.checkpoint_sequence || approval.checkpoint_ref.checkpoint_hash !== checkpoint.checkpoint_hash) {
    errors.push("recovery approval checkpoint reference mismatch")
  }
  if (approval.decision === "approve_resume_from_checkpoint") {
    if (approval.recovery_kind !== "checkpoint") errors.push("recovery approval decision/recovery-kind mismatch")
    if (pendingModel || approval.pending_model_step_ref) errors.push("checkpoint recovery approval must not reference a pending model step")
  }
  if (approval.decision === "approve_continue_after_uncertain_provider_outcome") {
    if (approval.recovery_kind !== "uncertain_provider_outcome") errors.push("recovery approval decision/recovery-kind mismatch")
    if (!pendingModel || !approval.pending_model_step_ref) {
      errors.push("uncertain provider recovery approval missing pending boundary")
    } else if (
      approval.pending_model_step_ref.model_request_id !== pendingModel.model_request_id ||
      approval.pending_model_step_ref.turn_index !== pendingModel.turn_index ||
      approval.pending_model_step_ref.base_checkpoint_id !== pendingModel.base_checkpoint_id ||
      approval.pending_model_step_ref.base_checkpoint_sequence !== pendingModel.base_checkpoint_sequence ||
      approval.pending_model_step_ref.base_checkpoint_hash !== pendingModel.base_checkpoint_hash ||
      approval.pending_model_step_ref.working_set_hash !== pendingModel.working_set_hash ||
      approval.pending_model_step_ref.context_hash !== pendingModel.context_hash
    ) {
      errors.push("recovery approval pending boundary reference mismatch")
    }
  }
  return errors
}

function verifyApproval(approval: CommanderInvestigationRecoveryApprovalRecord): boolean {
  return stableHash({ ...approval, approved_at: "", approval_hash: "" }) === approval.approval_hash
}

function sameLoadedToolRefs(left: unknown[], right: unknown[]): boolean {
  return stableHash(left.slice().sort(compareLoadedToolRefs)) === stableHash(right.slice().sort(compareLoadedToolRefs))
}

function compareLoadedToolRefs(left: unknown, right: unknown): number {
  const a = isRecord(left) && typeof left.tool_id === "string" ? left.tool_id : ""
  const b = isRecord(right) && typeof right.tool_id === "string" ? right.tool_id : ""
  return a.localeCompare(b) || stableHash(left).localeCompare(stableHash(right))
}

function isCommanderInvestigationKind(kind: unknown): kind is CommanderInvestigationJournalEventKind {
  return typeof kind === "string" && (COMMANDER_INVESTIGATION_EVENT_KINDS as readonly string[]).includes(kind)
}

const INVESTIGATION_STATUSES = ["final", "refused", "blocked", "failed", "cancelled", "budget_exhausted", "no_progress", "needs_human_review"] as const
const INVESTIGATION_STOP_REASONS = [
  "model_final",
  "model_refusal",
  "model_malformed",
  "provider_failed",
  "caller_cancelled",
  "human_pause",
  "human_stop",
  "human_correction",
  "human_override",
  "human_escalation",
  "max_model_turns",
  "max_tool_calls",
  "max_tool_search_calls",
  "max_tool_calls_per_turn",
  "max_loaded_schemas",
  "max_cumulative_tool_result_bytes",
  "context_budget_exhausted",
  "wall_time_exhausted",
  "repeated_identical_call",
  "consecutive_no_progress",
  "invalid_tool_call",
  "unloaded_tool_call",
  "duplicate_tool_call_id",
  "tool_execution_cancelled",
  "controller_error",
  "adapter_not_configured",
  "bootstrap_blocked",
  "provider_preflight_blocked",
  "provider_audit_incomplete",
  "persistence_failed",
  "durable_state_conflict",
] as const
const TOOL_PROTOCOLS = ["auto", "native", "json_fallback"] as const
const TOOL_PHASES = ["general_read", "proposal_investigation", "mid_mission_supervision", "result_review", "governance_review", "emergency_inspection"] as const
const NORMALIZED_INPUT_KEYS = new Set([
  "investigation_id",
  "phase",
  "objective",
  "requested_by",
  "mission_id",
  "session_id",
  "launch_id",
  "provider_id",
  "provider_kind",
  "model_id",
  "tool_protocol",
  "max_model_turns",
  "max_tool_calls",
  "max_tool_search_calls",
  "max_loaded_schemas",
  "max_tool_calls_per_turn",
  "max_cumulative_tool_result_bytes",
  "max_wall_time_ms",
  "max_consecutive_no_progress_turns",
  "max_evidence_cards",
  "max_turn_summaries",
  "max_context_tokens",
  "max_context_bytes",
  "include_continuity",
])
const NORMALIZED_INPUT_INTEGER_KEYS = [
  "max_model_turns",
  "max_tool_calls",
  "max_tool_search_calls",
  "max_loaded_schemas",
  "max_tool_calls_per_turn",
  "max_cumulative_tool_result_bytes",
  "max_wall_time_ms",
  "max_consecutive_no_progress_turns",
  "max_evidence_cards",
  "max_turn_summaries",
  "max_context_tokens",
  "max_context_bytes",
] as const
const NORMALIZED_INPUT_INTEGER_LIMITS: Record<(typeof NORMALIZED_INPUT_INTEGER_KEYS)[number], number> = {
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
}
const BUDGET_NUMBER_LIMITS = {
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
  max_context_tokens: 128_000,
  max_context_bytes: 512_000,
  target_input_tokens: 128_000,
  tool_schema_allocation_tokens: 128_000,
  tool_schema_allocation_bytes: 512_000,
} as const

function verifyPayloadHash(event: JsonlEvent): boolean {
  if (typeof event.event_payload_hash !== "string") return false
  const { event_id: _eventId, timestamp: _timestamp, kind: _kind, ...payload } = event
  return stableHash({ ...payload, event_payload_hash: "" }) === event.event_payload_hash
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string"
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "number" && Number.isFinite(value[key])
}

function boundedJournalString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function containsConcreteCredentialPayload(value: string): boolean {
  return /https?:\/\/|(?:^|\s)Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|authorization\s*[:=]\s*\S+/i.test(value)
}

function isNormalizedInput(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  if ("abort_signal" in value) return false
  if (Object.keys(value).some((key) => !NORMALIZED_INPUT_KEYS.has(key))) return false
  if (typeof value.investigation_id !== "string" || value.investigation_id.length === 0 || value.investigation_id.length > 200) return false
  if (typeof value.phase !== "string" || !(TOOL_PHASES as readonly string[]).includes(value.phase)) return false
  if (typeof value.objective !== "string" || value.objective.length === 0 || value.objective.length > 1000) return false
  if (typeof value.requested_by !== "string" || value.requested_by.length === 0 || value.requested_by.length > 200) return false
  if (typeof value.provider_id !== "string" || value.provider_id.length === 0 || value.provider_id.length > 120) return false
  if (typeof value.provider_kind !== "string" || value.provider_kind.length === 0 || value.provider_kind.length > 80) return false
  if (typeof value.model_id !== "string" || value.model_id.length === 0 || value.model_id.length > 200) return false
  if (value.tool_protocol !== undefined && (typeof value.tool_protocol !== "string" || !(TOOL_PROTOCOLS as readonly string[]).includes(value.tool_protocol))) return false
  for (const key of ["mission_id", "session_id", "launch_id"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 200)) return false
  }
  for (const key of NORMALIZED_INPUT_INTEGER_KEYS) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) <= 0 || Number(value[key]) > NORMALIZED_INPUT_INTEGER_LIMITS[key])) return false
  }
  if (value.include_continuity !== undefined && typeof value.include_continuity !== "boolean") return false
  return true
}

function isRecoveryApprovedPayload(value: unknown): value is CommanderInvestigationRecoveryApprovedPayload {
  if (!isRecord(value)) return false
  const allowedKeys = new Set(["kind", "event_id", "timestamp", "schema_version", "investigation_id", "journal_sequence", "requested_by", "occurred_at", "approval", "event_payload_hash"])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false
  if (value.kind !== undefined && value.kind !== "runtime_commander_investigation_recovery_approved") return false
  if (value.schema_version !== 1) return false
  if (!hasString(value, "investigation_id") || !boundedJournalString(value.investigation_id, 200)) return false
  if (!hasNumber(value, "journal_sequence")) return false
  if (!hasString(value, "requested_by") || !boundedJournalString(value.requested_by, 200)) return false
  if (containsConcreteCredentialPayload(value.requested_by)) return false
  if (!isCanonicalIsoTimestamp(value.occurred_at)) return false
  if (!hasString(value, "event_payload_hash") || !boundedJournalString(value.event_payload_hash, 240)) return false
  if (!isApprovalRecord(value.approval)) return false
  if (value.investigation_id !== value.approval.investigation_id) return false
  if (value.requested_by !== value.approval.approved_by) return false
  if (value.occurred_at !== value.approval.approved_at) return false
  return true
}

function isApprovalRecord(value: unknown): value is CommanderInvestigationRecoveryApprovalRecord {
  if (!isRecord(value)) return false
  const allowedKeys = new Set([
    "schema_version",
    "approval_version",
    "approval_id",
    "approval_sequence",
    "investigation_id",
    "recovery_kind",
    "decision",
    "approved_by",
    "approval_source",
    "human_note_preview",
    "human_note_hash",
    "acknowledgements",
    "recovery_basis_hash",
    "recovery_plan_hash",
    "recovery_packet_hash",
    "preview_hash",
    "checkpoint_ref",
    "pending_model_step_ref",
    "provider_execution_envelope_hash",
    "tool_compatibility_hash",
    "provider_compatibility_hash",
    "budget_compatibility_hash",
    "context_compatibility_hash",
    "continuity_compatibility_hash",
    "human_control_compatibility_hash",
    "one_shot",
    "automatic",
    "fresh_context_required",
    "exact_replay_supported",
    "provider_request_replay_allowed",
    "tool_execution_replay_allowed",
    "execution_supported_in_this_branch",
    "approved_at",
    "approval_hash",
  ])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false
  const decision = value.decision
  const recoveryKind = value.recovery_kind
  if (value.schema_version !== 1 || value.approval_version !== 1) return false
  for (const key of [
    "approval_id",
    "investigation_id",
    "approved_by",
    "approval_source",
    "recovery_basis_hash",
    "recovery_plan_hash",
    "recovery_packet_hash",
    "preview_hash",
    "provider_execution_envelope_hash",
    "tool_compatibility_hash",
    "provider_compatibility_hash",
    "budget_compatibility_hash",
    "context_compatibility_hash",
    "continuity_compatibility_hash",
    "human_control_compatibility_hash",
    "approval_hash",
  ]) {
    if (!hasString(value, key)) return false
    if (!boundedJournalString(value[key], 240)) return false
  }
  if (!isCanonicalIsoTimestamp(value.approved_at)) return false
  if (!boundedJournalString(value.approval_id, 120) || !boundedJournalString(value.investigation_id, 200) || !boundedJournalString(value.approved_by, 200)) return false
  if (containsConcreteCredentialPayload(value.approved_by)) return false
  if (value.human_note_preview !== undefined && (!boundedJournalString(value.human_note_preview, 500) || containsConcreteCredentialPayload(value.human_note_preview))) return false
  if (value.human_note_hash !== undefined && !boundedJournalString(value.human_note_hash, 240)) return false
  if (!Number.isInteger(value.approval_sequence) || Number(value.approval_sequence) < 0) return false
  if (decision !== "approve_resume_from_checkpoint" && decision !== "approve_continue_after_uncertain_provider_outcome") return false
  if (recoveryKind !== "checkpoint" && recoveryKind !== "uncertain_provider_outcome") return false
  if (decision === "approve_resume_from_checkpoint" && recoveryKind !== "checkpoint") return false
  if (decision === "approve_continue_after_uncertain_provider_outcome" && recoveryKind !== "uncertain_provider_outcome") return false
  if (value.approval_source !== "human") return false
  if (value.one_shot !== true || value.automatic !== false || value.fresh_context_required !== true || value.exact_replay_supported !== false || value.provider_request_replay_allowed !== false || value.tool_execution_replay_allowed !== false || value.execution_supported_in_this_branch !== false) return false
  if (!isRecord(value.acknowledgements) || value.acknowledgements.fresh_context_required !== true || value.acknowledgements.exact_replay_unavailable !== true || value.acknowledgements.provider_request_replay_forbidden !== true || value.acknowledgements.tool_execution_replay_forbidden !== true) return false
  const acknowledgementKeys = Object.keys(value.acknowledgements).sort()
  const expectedAcknowledgementKeys = decision === "approve_continue_after_uncertain_provider_outcome"
    ? ["exact_replay_unavailable", "fresh_context_required", "provider_request_replay_forbidden", "tool_execution_replay_forbidden", "uncertain_provider_outcome"].sort()
    : ["exact_replay_unavailable", "fresh_context_required", "provider_request_replay_forbidden", "tool_execution_replay_forbidden"].sort()
  if (stableHash(acknowledgementKeys) !== stableHash(expectedAcknowledgementKeys)) return false
  if (decision === "approve_continue_after_uncertain_provider_outcome" && value.acknowledgements.uncertain_provider_outcome !== true) return false
  if (!isRecord(value.checkpoint_ref) || stableHash(Object.keys(value.checkpoint_ref).sort()) !== stableHash(["checkpoint_hash", "checkpoint_id", "checkpoint_sequence"].sort()) || !hasString(value.checkpoint_ref, "checkpoint_id") || !hasString(value.checkpoint_ref, "checkpoint_hash") || !hasNumber(value.checkpoint_ref, "checkpoint_sequence")) return false
  if (!boundedJournalString(value.checkpoint_ref.checkpoint_id, 160) || !boundedJournalString(value.checkpoint_ref.checkpoint_hash, 240)) return false
  if (decision === "approve_continue_after_uncertain_provider_outcome" && value.pending_model_step_ref === undefined) return false
  if (decision === "approve_resume_from_checkpoint" && value.pending_model_step_ref !== undefined) return false
  if (value.pending_model_step_ref !== undefined) {
    const pending = value.pending_model_step_ref
    if (!isRecord(pending)) return false
    const expectedPendingKeys = ["base_checkpoint_hash", "base_checkpoint_id", "base_checkpoint_sequence", "context_hash", "fresh_request_required_later", "model_request_id", "provider_outcome_remains_unknown", "provider_request_may_have_been_sent", "provider_request_replay_forbidden", "provider_response_available", "tool_execution_known_to_have_occurred", "tool_execution_replay_forbidden", "turn_index", "working_set_hash"].sort()
    if (stableHash(Object.keys(pending).sort()) !== stableHash(expectedPendingKeys)) return false
    for (const key of ["model_request_id", "base_checkpoint_id", "base_checkpoint_hash", "working_set_hash", "context_hash"]) {
      if (!hasString(pending, key)) return false
      if (!boundedJournalString(pending[key], 240)) return false
    }
    if (!hasNumber(pending, "turn_index") || !hasNumber(pending, "base_checkpoint_sequence")) return false
    if (pending.provider_request_may_have_been_sent !== true || pending.provider_response_available !== false || pending.provider_outcome_remains_unknown !== true || pending.tool_execution_known_to_have_occurred !== false || pending.provider_request_replay_forbidden !== true || pending.tool_execution_replay_forbidden !== true || pending.fresh_request_required_later !== true) return false
  }
  return true
}

function isBudget(value: unknown): value is { budget_hash: string } {
  if (!isRecord(value)) return false
  const requiredNumberKeys = [
    "max_model_turns",
    "max_tool_calls",
    "max_tool_search_calls",
    "max_loaded_schemas",
    "max_tool_calls_per_turn",
    "max_cumulative_tool_result_bytes",
    "max_wall_time_ms",
    "max_consecutive_no_progress_turns",
    "max_evidence_cards",
    "max_turn_summaries",
  ] as const
  const optionalNumberKeys = [
    "max_context_tokens",
    "max_context_bytes",
    "target_input_tokens",
    "tool_schema_allocation_tokens",
    "tool_schema_allocation_bytes",
  ] as const
  if (!hasString(value, "budget_id")) return false
  if (typeof value.phase !== "string" || !(TOOL_PHASES as readonly string[]).includes(value.phase)) return false
  if (!hasString(value, "source_profile_id") || !hasString(value, "source_context_budget_id") || !hasString(value, "budget_hash")) return false
  if (!Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string")) return false
  for (const key of requiredNumberKeys) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0 || Number(value[key]) > BUDGET_NUMBER_LIMITS[key]) return false
  }
  for (const key of optionalNumberKeys) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0 || Number(value[key]) > BUDGET_NUMBER_LIMITS[key])) return false
  }
  return value.budget_hash === stableHash({ ...value, budget_hash: "" })
}

function isCheckpoint(value: unknown): value is CommanderInvestigationCheckpoint {
  if (!isRecord(value)) return false
  return (
    value.schema_version === 1 &&
    hasString(value, "checkpoint_id") &&
    hasString(value, "investigation_id") &&
    hasNumber(value, "checkpoint_sequence") &&
    (value.checkpoint_kind === "initial" || value.checkpoint_kind === "turn_complete") &&
    hasNumber(value, "turn_index") &&
    hasNumber(value, "next_turn_index") &&
    hasString(value, "phase") &&
    hasString(value, "objective_hash") &&
    hasString(value, "provider_id") &&
    hasString(value, "provider_kind") &&
    hasString(value, "model_id") &&
    hasString(value, "tool_protocol") &&
    isBootstrapRef(value.bootstrap_ref) &&
    isBudget(value.budget) &&
    Array.isArray(value.loaded_tools) &&
    value.loaded_tools.every(isLoadedToolRef) &&
    isDurableWorkingSet(value.working_set) &&
    Array.isArray(value.turn_summaries) &&
    value.turn_summaries.every(isTurnSummary) &&
    (value.replay_exchange === undefined || isReplayExchange(value.replay_exchange)) &&
    hasNumber(value, "provider_request_count") &&
    hasNumber(value, "external_api_audit_count") &&
    hasNumber(value, "elapsed_active_ms") &&
    (value.previous_checkpoint_id === undefined || hasString(value, "previous_checkpoint_id")) &&
    (value.previous_checkpoint_hash === undefined || hasString(value, "previous_checkpoint_hash")) &&
    hasString(value, "created_at") &&
    hasString(value, "created_by") &&
    hasString(value, "semantic_state_hash") &&
    hasString(value, "checkpoint_hash") &&
    value.resume_supported === false &&
    value.full_transcript_persisted === false &&
    value.raw_tool_results_persisted === false &&
    value.chain_of_thought_persisted === false
  )
}

function isBootstrapRef(value: unknown): boolean {
  return isRecord(value) && hasString(value, "bootstrap_id") && hasString(value, "bootstrap_hash")
}

function isDurableWorkingSet(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    hasString(value, "objective_preview") &&
    hasString(value, "phase") &&
    Array.isArray(value.loaded_tool_ids) &&
    Array.isArray(value.evidence_cards) &&
    value.evidence_cards.every(isEvidenceCard) &&
    Array.isArray(value.recent_execution_digests) &&
    Array.isArray(value.recent_load_outcomes) &&
    Array.isArray(value.current_blockers) &&
    Array.isArray(value.current_warnings) &&
    isProviderAuditSummary(value.provider_audit) &&
    hasNumber(value, "omitted_evidence_count") &&
    hasNumber(value, "omitted_digest_count") &&
    hasNumber(value, "omitted_turn_count") &&
    hasNumber(value, "consecutive_no_progress_turns") &&
    hasNumber(value, "cumulative_tool_result_bytes") &&
    hasNumber(value, "model_turn_count") &&
    hasNumber(value, "tool_call_count") &&
    hasNumber(value, "tool_search_call_count") &&
    Array.isArray(value.recent_result_signatures) &&
    value.recent_result_signatures.every(isRecentResultSignature) &&
    hasString(value, "working_set_hash")
  )
}

function isProviderAuditSummary(value: unknown): boolean {
  if (!isRecord(value)) return false
  const transport = value.transport_kind
  const auditRequired = value.audit_required
  const providerRequestCount = value.provider_request_count
  const auditEventCount = value.external_api_audit_event_count
  const successfulAuditCount = value.successful_audit_count
  const failedAuditCount = value.failed_audit_count
  const omittedRequestIdCount = value.omitted_request_id_count
  const auditRequestIds = value.audit_request_ids
  const auditEventKinds = value.audit_event_kinds
  const connectorIds = value.connector_ids
  if (
    typeof auditRequired !== "boolean" ||
    (transport !== "none" && transport !== "external_api_connector") ||
    (auditRequired === true && transport !== "external_api_connector") ||
    !isNonnegativeInteger(providerRequestCount) ||
    !isNonnegativeInteger(auditEventCount) ||
    !isNonnegativeInteger(successfulAuditCount) ||
    !isNonnegativeInteger(failedAuditCount) ||
    !isNonnegativeInteger(omittedRequestIdCount) ||
    !Array.isArray(connectorIds) ||
    !connectorIds.every((item) => typeof item === "string") ||
    !Array.isArray(auditRequestIds) ||
    !auditRequestIds.every((item) => typeof item === "string") ||
    !Array.isArray(auditEventKinds) ||
    !auditEventKinds.every((item) => item === "external_api_request_executed" || item === "external_api_request_failed")
  ) {
    return false
  }
  if (transport === "none") {
    return (
      auditRequired === false &&
      connectorIds.length === 0 &&
      auditEventCount === 0 &&
      successfulAuditCount === 0 &&
      failedAuditCount === 0 &&
      auditRequestIds.length === 0 &&
      auditEventKinds.length === 0 &&
      omittedRequestIdCount === 0 &&
      value.all_provider_requests_audited === true &&
      value.request_body_persisted === false &&
      value.response_body_persisted === false &&
      value.credentials_persisted === false &&
      Array.isArray(value.warnings) &&
      value.warnings.every((item) => typeof item === "string")
    )
  }
  const requestIdsComplete = auditEventCount <= 24
    ? auditRequestIds.length === auditEventCount && omittedRequestIdCount === 0
    : auditRequestIds.length === 24 && omittedRequestIdCount === auditEventCount - 24
  const eventKindsComplete = auditEventCount <= 24
    ? auditEventKinds.length === auditEventCount
    : auditEventKinds.length === 24
  const expectedAllProviderRequestsAudited = providerRequestCount === 0 ? auditRequired === false : auditEventCount === providerRequestCount
  return (
    connectorIds.length > 0 &&
    auditEventCount <= providerRequestCount &&
    successfulAuditCount + failedAuditCount === auditEventCount &&
    requestIdsComplete &&
    eventKindsComplete &&
    typeof value.all_provider_requests_audited === "boolean" &&
    value.all_provider_requests_audited === expectedAllProviderRequestsAudited &&
    value.request_body_persisted === false &&
    value.response_body_persisted === false &&
    value.credentials_persisted === false &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string")
  )
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isTurnSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasNumber(value, "turn_index") &&
    hasString(value, "model_request_id") &&
    (value.model_result_hash === undefined || typeof value.model_result_hash === "string") &&
    hasString(value, "model_status") &&
    hasNumber(value, "provider_request_count") &&
    (value.assistant_text_preview === undefined || isDurableModelTextOmission(value.assistant_text_preview)) &&
    Array.isArray(value.tool_call_ids) &&
    value.tool_call_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.tool_ids) &&
    value.tool_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.tool_execution_ids) &&
    value.tool_execution_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.tool_execution_statuses) &&
    value.tool_execution_statuses.every((item) => typeof item === "string") &&
    Array.isArray(value.newly_loaded_tool_ids) &&
    value.newly_loaded_tool_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.new_evidence_ids) &&
    value.new_evidence_ids.every((item) => typeof item === "string") &&
    hasNumber(value, "input_estimated_tokens") &&
    hasNumber(value, "input_bytes") &&
    (value.output_tokens === undefined || typeof value.output_tokens === "number") &&
    hasNumber(value, "cumulative_tool_calls") &&
    typeof value.progress_made === "boolean" &&
    Array.isArray(value.no_progress_reasons) &&
    value.no_progress_reasons.every((item) => typeof item === "string") &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string") &&
    (value.provider_transport_kind === undefined || value.provider_transport_kind === "external_api_connector") &&
    (value.provider_connector_id === undefined || typeof value.provider_connector_id === "string") &&
    Array.isArray(value.provider_audit_request_ids) &&
    value.provider_audit_request_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.provider_audit_event_kinds) &&
    value.provider_audit_event_kinds.every((item) => typeof item === "string") &&
    hasNumber(value, "provider_audit_event_count") &&
    typeof value.provider_audit_complete === "boolean" &&
    hasString(value, "turn_hash")
  )
}

function isDurableModelTextOmission(value: unknown): boolean {
  return typeof value === "string" && /^model-visible text omitted from durable journal; text_hash=[a-f0-9]{64} text_chars=\d+$/.test(value)
}

function isRecentResultSignature(value: unknown): boolean {
  return isRecord(value) && hasString(value, "signature_hash") && hasNumber(value, "count") && hasNumber(value, "last_turn_index")
}

function isReplayExchange(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasNumber(value, "turn_index") &&
    isDurableAssistantMessage(value.assistant_message) &&
    Array.isArray(value.tool_result_messages) &&
    value.tool_result_messages.every(isDurableToolResultMessage) &&
    hasString(value, "exchange_hash") &&
    value.summary_only === true &&
    value.assistant_text_persisted === false &&
    value.exact_replay_supported === false &&
    value.protocol_relationship_preserved === true &&
    value.full_tool_results_persisted === false
  )
}

function isDurableAssistantMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.role === "assistant" &&
    Array.isArray(value.content) &&
    value.content.every(isDurableAssistantPart)
  )
}

function isDurableAssistantPart(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.type === "text_fingerprint") return isModelTextFingerprint(value)
  return (
    value.type === "tool_call" &&
    hasString(value, "tool_call_id") &&
    hasString(value, "tool_id") &&
    isRecord(value.arguments) &&
    (value.raw_arguments === undefined || hasString(value, "raw_arguments")) &&
    typeof value.arguments_valid === "boolean" &&
    Array.isArray(value.validation_errors) &&
    value.validation_errors.every((item) => typeof item === "string") &&
    hasString(value, "call_hash")
  )
}

function isModelTextFingerprint(value: unknown): boolean {
  return isRecord(value) && value.text_persisted === false && hasString(value, "text_hash") && hasNumber(value, "text_chars")
}

function isConclusion(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    (INVESTIGATION_STATUSES as readonly string[]).includes(value.status) &&
    typeof value.stop_reason === "string" &&
    (INVESTIGATION_STOP_REASONS as readonly string[]).includes(value.stop_reason) &&
    Array.isArray(value.evidence_ids) &&
    value.evidence_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.evidence_titles) &&
    value.evidence_titles.every((item) => typeof item === "string") &&
    Array.isArray(value.safe_evidence_summaries) &&
    value.safe_evidence_summaries.every((item) => typeof item === "string") &&
    Array.isArray(value.blockers) &&
    value.blockers.every((item) => typeof item === "string") &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string") &&
    (value.final_output_text_hash === undefined || typeof value.final_output_text_hash === "string")
  )
}

function isDurableToolResultMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.role === "tool" &&
    hasString(value, "tool_call_id") &&
    hasString(value, "tool_id") &&
    hasString(value, "content") &&
    hasString(value, "content_hash") &&
    typeof value.truncated === "boolean" &&
    value.durable_summary_only === true &&
    (value.source_execution_id === undefined || hasString(value, "source_execution_id"))
  )
}

function isEvidenceCard(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    hasString(value, "evidence_id") &&
    hasString(value, "tool_id") &&
    hasString(value, "source_kind") &&
    hasString(value, "source_id") &&
    hasString(value, "title") &&
    hasString(value, "summary_preview") &&
    Array.isArray(value.source_refs) &&
    Array.isArray(value.warnings) &&
    hasString(value, "evidence_hash")
  )
}

function isStartedPayload(event: JsonlEvent): event is CommanderInvestigationStartedPayload {
  if (event.schema_version !== 1 || !isCheckpoint(event.initial_checkpoint)) return false
  return (
    isNormalizedInput(event.normalized_input) &&
    hasString(event, "input_hash") &&
    hasString(event, "objective") &&
    hasString(event, "objective_hash") &&
    hasString(event, "phase") &&
    hasString(event, "requested_by") &&
    hasString(event, "provider_id") &&
    hasString(event, "provider_kind") &&
    hasString(event, "model_id") &&
    hasString(event, "tool_protocol") &&
    hasString(event, "started_at") &&
    isBudget(event.budget) &&
    hasString(event, "budget_hash") &&
    event.budget_hash === event.budget.budget_hash &&
    isRecord(event.bootstrap_ref) &&
    hasString(event.bootstrap_ref, "bootstrap_id") &&
    hasString(event.bootstrap_ref, "bootstrap_hash") &&
    Array.isArray(event.initial_loaded_tool_refs) &&
    event.initial_loaded_tool_refs.every(isLoadedToolRef) &&
    hasString(event, "summary_preview")
  )
}

function isLoadedToolRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "tool_id") &&
    hasString(value, "descriptor_version") &&
    hasString(value, "authority_id") &&
    (!("description_hash" in value) || hasString(value, "description_hash")) &&
    hasString(value, "input_schema_hash") &&
    hasString(value, "output_schema_hash") &&
    hasString(value, "load_policy") &&
    hasString(value, "trust_class") &&
    (!("max_output_bytes" in value) || hasNumber(value, "max_output_bytes")) &&
    (!("timeout_ms" in value) || hasNumber(value, "timeout_ms")) &&
    value.instruction_semantics === "none"
  )
}

function isModelStepStartedPayload(event: JsonlEvent): event is CommanderInvestigationModelStepStartedPayload {
  return (
    event.schema_version === 1 &&
    hasString(event, "investigation_id") &&
    hasNumber(event, "journal_sequence") &&
    hasNumber(event, "turn_index") &&
    hasString(event, "model_request_id") &&
    hasString(event, "provider_id") &&
    hasString(event, "provider_kind") &&
    hasString(event, "model_id") &&
    hasString(event, "tool_protocol") &&
    hasString(event, "base_checkpoint_id") &&
    hasNumber(event, "base_checkpoint_sequence") &&
    hasString(event, "base_checkpoint_hash") &&
    hasString(event, "working_set_hash") &&
    hasString(event, "context_hash") &&
    hasNumber(event, "input_bytes") &&
    hasNumber(event, "estimated_input_tokens") &&
    Array.isArray(event.loaded_tool_refs) &&
    event.loaded_tool_refs.every(isLoadedToolRef) &&
    hasNumber(event, "provider_request_count_before") &&
    hasNumber(event, "external_api_audit_count_before") &&
    hasString(event, "started_at") &&
    hasString(event, "requested_by") &&
    hasString(event, "occurred_at") &&
    hasString(event, "event_payload_hash")
  )
}

function isCheckpointedPayload(event: JsonlEvent): event is CommanderInvestigationCheckpointedPayload {
  return event.schema_version === 1 && isCheckpoint(event.checkpoint)
}

function isFinishedPayload(event: JsonlEvent): event is CommanderInvestigationFinishedPayload {
  if (event.schema_version !== 1 || !isRecord(event.terminal)) return false
  return (
    hasString(event, "requested_by") &&
    hasString(event, "occurred_at") &&
    hasString(event, "event_payload_hash") &&
    typeof event.terminal.status === "string" &&
    (INVESTIGATION_STATUSES as readonly string[]).includes(event.terminal.status) &&
    typeof event.terminal.stop_reason === "string" &&
    (INVESTIGATION_STOP_REASONS as readonly string[]).includes(event.terminal.stop_reason) &&
    hasString(event.terminal, "phase") &&
    hasString(event.terminal, "objective_hash") &&
    hasString(event.terminal, "provider_id") &&
    hasString(event.terminal, "provider_kind") &&
    hasString(event.terminal, "model_id") &&
    hasString(event.terminal, "tool_protocol") &&
    (event.terminal.final_output === undefined || isModelTextFingerprint(event.terminal.final_output)) &&
    isConclusion(event.terminal.conclusion) &&
    hasString(event.terminal, "bootstrap_id") &&
    hasString(event.terminal, "bootstrap_hash") &&
    hasString(event.terminal, "budget_id") &&
    hasString(event.terminal, "budget_hash") &&
    hasString(event.terminal, "semantic_result_hash") &&
    hasString(event.terminal, "last_checkpoint_id") &&
    hasNumber(event.terminal, "last_checkpoint_sequence") &&
    hasString(event.terminal, "last_checkpoint_hash") &&
    (event.terminal.pending_model_request_id === undefined || typeof event.terminal.pending_model_request_id === "string") &&
    hasString(event.terminal, "terminal_hash") &&
    hasString(event.terminal, "started_at") &&
    hasString(event.terminal, "completed_at") &&
    hasNumber(event.terminal, "model_turn_count") &&
    hasNumber(event.terminal, "provider_request_count") &&
    hasNumber(event.terminal, "tool_call_count") &&
    hasNumber(event.terminal, "tool_search_call_count") &&
    Array.isArray(event.terminal.loaded_tool_ids) &&
    event.terminal.loaded_tool_ids.every((item) => typeof item === "string") &&
    Array.isArray(event.terminal.evidence_cards) &&
    event.terminal.evidence_cards.every(isEvidenceCard) &&
    Array.isArray(event.terminal.turn_summaries) &&
    event.terminal.turn_summaries.every(isTurnSummary) &&
    hasNumber(event.terminal, "omitted_evidence_count") &&
    hasNumber(event.terminal, "omitted_turn_count") &&
    isProviderAuditSummary(event.terminal.provider_audit) &&
    Array.isArray(event.terminal.blockers) &&
    event.terminal.blockers.every((item) => typeof item === "string") &&
    Array.isArray(event.terminal.warnings) &&
    event.terminal.warnings.every((item) => typeof item === "string") &&
    event.terminal.transcript_persisted === false &&
    event.terminal.raw_tool_results_persisted === false &&
    event.terminal.chain_of_thought_persisted === false
  )
}

function verifyCheckpoint(checkpoint: CommanderInvestigationCheckpoint): boolean {
  const semanticStateHash = stableHash(stableCheckpointState(checkpoint))
  const checkpointId = `commander_inv_checkpoint_${checkpoint.checkpoint_sequence}_${semanticStateHash.slice(0, 16)}`
  return (
    checkpoint.semantic_state_hash === semanticStateHash &&
    checkpoint.checkpoint_id === checkpointId &&
    checkpoint.checkpoint_hash === stableHash({ ...checkpoint, checkpoint_hash: "" })
  )
}

function verifyTerminal(terminal: { terminal_hash: string }): boolean {
  return terminal.terminal_hash === stableHash({ ...terminal, terminal_hash: "" })
}

function stableCheckpointState(checkpoint: CommanderInvestigationCheckpoint): unknown {
  return {
    ...checkpoint,
    checkpoint_id: "",
    checkpoint_hash: "",
    semantic_state_hash: "",
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
