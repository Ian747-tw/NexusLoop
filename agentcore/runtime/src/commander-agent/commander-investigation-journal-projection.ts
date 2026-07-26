import type { JsonlEvent } from "../events/event-types"
import { stableHash } from "./commander-model-schema"
import {
  COMMANDER_INVESTIGATION_EVENT_KINDS,
  type CommanderInvestigationCheckpoint,
  type CommanderInvestigationCheckpointedPayload,
  type CommanderInvestigationFinishedPayload,
  type CommanderInvestigationJournalEventKind,
  type CommanderInvestigationJournalLastTransition,
  type CommanderInvestigationJournalProjectionStatus,
  type CommanderInvestigationModelStepStartedPayload,
  type CommanderInvestigationRecord,
  type CommanderInvestigationRecoveryState,
  type CommanderInvestigationStartedPayload,
} from "./commander-investigation-journal-types"

export type CommanderInvestigationJournalProjection = {
  records: CommanderInvestigationRecord[]
  checkpoints: CommanderInvestigationCheckpoint[]
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
  for (const [investigationId, group] of groups) {
    const projected = projectOne(investigationId, group)
    records.push(projected.record)
    checkpoints.push(...projected.checkpoints)
  }
  records.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.investigation_id.localeCompare(b.investigation_id))
  checkpoints.sort((a, b) => a.investigation_id.localeCompare(b.investigation_id) || a.checkpoint_sequence - b.checkpoint_sequence)
  return { records, checkpoints }
}

function projectOne(investigationId: string, events: JsonlEvent[]): { record: CommanderInvestigationRecord; checkpoints: CommanderInvestigationCheckpoint[] } {
  const integrity: string[] = []
  let projectionStatus: CommanderInvestigationJournalProjectionStatus = "ready"
  let unsupportedVersion = false
  let started: CommanderInvestigationStartedPayload | undefined
  let terminal: CommanderInvestigationFinishedPayload | undefined
  let pendingModel: CommanderInvestigationModelStepStartedPayload | undefined
  const checkpoints: CommanderInvestigationCheckpoint[] = []
  let lastTransition: CommanderInvestigationJournalLastTransition = "started"
  const seenRequests = new Set<string>()

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
      const initialErrors = initialCheckpointErrors(investigationId, started.initial_checkpoint)
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
      if (seenRequests.has(model.model_request_id)) integrity.push(`duplicate model request ${model.model_request_id}`)
      seenRequests.add(model.model_request_id)
      const previous = checkpoints.at(-1)
      if (!previous || model.base_checkpoint_id !== previous.checkpoint_id || model.base_checkpoint_sequence !== previous.checkpoint_sequence || model.base_checkpoint_hash !== previous.checkpoint_hash) {
        integrity.push(`model-step base checkpoint mismatch at sequence ${event.journal_sequence}`)
      }
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
      if (!pendingModel) checkpointErrors.push("checkpoint missing model-step boundary")
      if (pendingModel && checkpoint.turn_index !== pendingModel.turn_index) checkpointErrors.push("checkpoint turn_index does not match pending model step")
      if (pendingModel && checkpoint.next_turn_index !== pendingModel.turn_index + 1) checkpointErrors.push("checkpoint next_turn_index does not follow pending model step")
      if (pendingModel && checkpoint.provider_request_count !== pendingModel.provider_request_count_before + 1) checkpointErrors.push("checkpoint provider_request_count does not match pending model step")
      if (pendingModel && checkpoint.external_api_audit_count < pendingModel.external_api_audit_count_before) checkpointErrors.push("checkpoint external_api_audit_count is behind pending model step")
      if (pendingModel && checkpoint.working_set.model_turn_count !== pendingModel.turn_index) checkpointErrors.push("checkpoint working-set turn count does not match pending model step")
      if (checkpoint.investigation_id !== investigationId) checkpointErrors.push("checkpoint investigation_id mismatch")
      if (checkpoint.checkpoint_sequence !== checkpoints.length) checkpointErrors.push(`checkpoint sequence gap at ${checkpoint.checkpoint_sequence}`)
      if (checkpoint.previous_checkpoint_id !== previous?.checkpoint_id || checkpoint.previous_checkpoint_hash !== previous?.checkpoint_hash) checkpointErrors.push("checkpoint previous reference mismatch")
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
      const previous = checkpoints.at(-1)
      if (event.terminal.last_checkpoint_id !== previous?.checkpoint_id || event.terminal.last_checkpoint_sequence !== previous?.checkpoint_sequence || event.terminal.last_checkpoint_hash !== previous?.checkpoint_hash) terminalErrors.push("terminal last-checkpoint reference mismatch")
      if (!verifyTerminal(event.terminal)) terminalErrors.push("terminal hash mismatch")
      integrity.push(...terminalErrors)
      if (terminalErrors.length === 0) {
        terminal = event
        pendingModel = undefined
        lastTransition = "finished"
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
  const evidenceCards = terminalRecord?.evidence_cards ?? latestCheckpoint?.working_set.evidence_cards ?? []
  const omittedEvidenceCount = terminalRecord?.omitted_evidence_count ?? latestCheckpoint?.working_set.omitted_evidence_count ?? 0
  const uncertain = Boolean(pendingModel && !terminalRecord)
  const recoveryState = recovery(latestCheckpoint, uncertain, Boolean(terminalRecord))
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
    updated_at: terminalRecord?.completed_at ?? pendingModel?.started_at ?? latestCheckpoint?.created_at ?? started.started_at,
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
    final_summary_preview: terminalRecord?.final_summary?.slice(0, 500),
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
  }
  record.record_hash = stableHash({ ...record, record_hash: "" })
  return { record, checkpoints }
}

function corruptRecord(investigationId: string, events: JsonlEvent[], errors: string[], status: CommanderInvestigationJournalProjectionStatus): { record: CommanderInvestigationRecord; checkpoints: CommanderInvestigationCheckpoint[] } {
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
  }
  record.record_hash = stableHash({ ...record, record_hash: "" })
  return { record, checkpoints: [] }
}

function recovery(checkpoint: CommanderInvestigationCheckpoint | undefined, uncertain: boolean, terminal: boolean): CommanderInvestigationRecoveryState {
  if (terminal) return "not_required"
  if (uncertain) return "uncertain_provider_outcome_resume_not_implemented"
  if (checkpoint) return "checkpoint_available_resume_not_implemented"
  return "no_checkpoint_resume_not_implemented"
}

function initialCheckpointErrors(investigationId: string, checkpoint: CommanderInvestigationCheckpoint): string[] {
  const errors: string[] = []
  if (checkpoint.investigation_id !== investigationId) errors.push("initial checkpoint investigation_id mismatch")
  if (checkpoint.checkpoint_sequence !== 0) errors.push("initial checkpoint sequence is not zero")
  if (checkpoint.previous_checkpoint_id || checkpoint.previous_checkpoint_hash) errors.push("initial checkpoint has previous checkpoint reference")
  return errors
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

function isCheckpoint(value: unknown): value is CommanderInvestigationCheckpoint {
  if (!isRecord(value)) return false
  return (
    value.schema_version === 1 &&
    hasString(value, "checkpoint_id") &&
    hasString(value, "investigation_id") &&
    hasNumber(value, "checkpoint_sequence") &&
    hasNumber(value, "provider_request_count") &&
    hasNumber(value, "external_api_audit_count") &&
    hasString(value, "checkpoint_hash") &&
    isDurableWorkingSet(value.working_set) &&
    Array.isArray(value.turn_summaries)
  )
}

function isDurableWorkingSet(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    Array.isArray(value.loaded_tool_ids) &&
    Array.isArray(value.evidence_cards) &&
    value.evidence_cards.every(isEvidenceCard) &&
    Array.isArray(value.current_warnings) &&
    hasNumber(value, "model_turn_count") &&
    hasNumber(value, "tool_call_count") &&
    hasNumber(value, "tool_search_call_count")
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
    hasString(event, "objective") &&
    hasString(event, "objective_hash") &&
    hasString(event, "requested_by") &&
    hasString(event, "provider_id") &&
    hasString(event, "provider_kind") &&
    hasString(event, "model_id") &&
    hasString(event, "tool_protocol") &&
    hasString(event, "started_at") &&
    isRecord(event.budget) &&
    hasString(event.budget, "budget_id") &&
    hasString(event, "budget_hash") &&
    isRecord(event.bootstrap_ref) &&
    hasString(event.bootstrap_ref, "bootstrap_id") &&
    hasString(event.bootstrap_ref, "bootstrap_hash") &&
    Array.isArray(event.initial_loaded_tool_refs) &&
    event.initial_loaded_tool_refs.every(isLoadedToolRef)
  )
}

function isLoadedToolRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, "tool_id") &&
    hasString(value, "descriptor_version") &&
    hasString(value, "authority_id") &&
    hasString(value, "input_schema_hash") &&
    hasString(value, "output_schema_hash") &&
    hasString(value, "load_policy") &&
    hasString(value, "trust_class") &&
    value.instruction_semantics === "none"
  )
}

function isModelStepStartedPayload(event: JsonlEvent): event is CommanderInvestigationModelStepStartedPayload {
  return (
    event.schema_version === 1 &&
    hasString(event, "model_request_id") &&
    hasNumber(event, "turn_index") &&
    hasString(event, "started_at") &&
    hasString(event, "base_checkpoint_id") &&
    hasNumber(event, "base_checkpoint_sequence") &&
    hasString(event, "base_checkpoint_hash")
  )
}

function isCheckpointedPayload(event: JsonlEvent): event is CommanderInvestigationCheckpointedPayload {
  return event.schema_version === 1 && isCheckpoint(event.checkpoint)
}

function isFinishedPayload(event: JsonlEvent): event is CommanderInvestigationFinishedPayload {
  if (event.schema_version !== 1 || !isRecord(event.terminal)) return false
  return (
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
    hasString(event.terminal, "semantic_result_hash") &&
    hasString(event.terminal, "last_checkpoint_id") &&
    hasNumber(event.terminal, "last_checkpoint_sequence") &&
    hasString(event.terminal, "last_checkpoint_hash") &&
    hasString(event.terminal, "terminal_hash") &&
    hasString(event.terminal, "completed_at") &&
    hasNumber(event.terminal, "model_turn_count") &&
    hasNumber(event.terminal, "provider_request_count") &&
    hasNumber(event.terminal, "tool_call_count") &&
    hasNumber(event.terminal, "tool_search_call_count") &&
    Array.isArray(event.terminal.loaded_tool_ids) &&
    Array.isArray(event.terminal.evidence_cards) &&
    event.terminal.evidence_cards.every(isEvidenceCard) &&
    isRecord(event.terminal.provider_audit)
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
