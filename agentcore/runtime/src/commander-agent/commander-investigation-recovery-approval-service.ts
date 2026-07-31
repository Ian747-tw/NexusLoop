import { redactText, redactValue } from "../security/redaction"
import { stableHash } from "./commander-model-schema"
import type {
  CommanderInvestigationRecoveryApprovalAcknowledgements,
  CommanderInvestigationRecoveryApprovalInput,
  CommanderInvestigationRecoveryApprovalPreview,
  CommanderInvestigationRecoveryApprovalRecord,
  CommanderInvestigationRecoveryApprovalResult,
  CommanderInvestigationRecoveryApprovalServiceOptions,
  CommanderInvestigationRecoveryCheckpointApprovalRef,
  CommanderInvestigationRecoveryPendingApprovalRef,
} from "./commander-investigation-recovery-approval-types"
import { CommanderInvestigationJournalConflictError, CommanderInvestigationPersistenceError } from "./commander-investigation-journal-service"
import type { CommanderInvestigationRecoveryPreview } from "./commander-investigation-recovery-types"

type NormalizedRecoveryApprovalInput = Readonly<{
  investigation_id: string
  recovery_plan_hash: string
  decision: CommanderInvestigationRecoveryApprovalInput["decision"]
  approved_by: string
  human_note?: string
  acknowledgements: Readonly<CommanderInvestigationRecoveryApprovalAcknowledgements>
}>

export class CommanderInvestigationRecoveryApprovalService {
  private readonly now: () => Date

  constructor(private readonly options: CommanderInvestigationRecoveryApprovalServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: CommanderInvestigationRecoveryApprovalInput): Promise<CommanderInvestigationRecoveryApprovalPreview> {
    const generatedAt = this.now().toISOString()
    const validated = validateApprovalInput(input)
    const normalized = validated.input
    if (validated.blockers.length) return this.previewResult(normalized.investigation_id, normalized, undefined, validated.blockers, validated.warnings, generatedAt, false)
    const recovery = await this.options.recoveryPreview({ investigation_id: normalized.investigation_id, include_current_continuity: true })
    const blockers = [
      ...validated.blockers,
      ...approvalPreviewBlockers(normalized, recovery),
    ].slice(0, 24)
    const existing = recovery.current_approval &&
      recovery.current_approval.recovery_plan_hash === normalized.recovery_plan_hash &&
      recovery.current_approval.decision === normalized.decision &&
      recovery.current_approval.approved_by === normalized.approved_by &&
      recovery.current_approval.human_note_hash === humanNoteHash(normalized.human_note)
      ? recovery.current_approval
      : undefined
    const ready = blockers.length === 0
    return this.previewResult(normalized.investigation_id, normalized, recovery, blockers, validated.warnings, generatedAt, ready && !existing, existing)
  }

  async record(input: CommanderInvestigationRecoveryApprovalInput): Promise<CommanderInvestigationRecoveryApprovalResult> {
    const generatedAt = this.now().toISOString()
    const validated = validateApprovalInput(input)
    const normalized = validated.input
    const preview = validated.blockers.length
      ? this.previewResult(normalized.investigation_id, normalized, undefined, validated.blockers, validated.warnings, generatedAt, false)
      : await this.preview(normalized as CommanderInvestigationRecoveryApprovalInput)
    if (preview.status === "already_recorded" && preview.existing_current_approval) {
      return result({
        status: "already_recorded",
        investigationId: preview.investigation_id,
        decision: preview.decision,
        approvalState: "current",
        recoveryBasisHash: preview.recovery_basis_hash,
        recoveryPlanHash: preview.current_recovery_plan_hash,
        checkpointRef: preview.checkpoint_ref,
        pendingRef: preview.pending_model_step_ref,
        blockers: [],
        warnings: preview.warnings,
        generatedAt,
        eventsAppended: false,
      })
    }
    if (preview.status !== "ready") {
      return result({
        status: "blocked",
        investigationId: preview.investigation_id,
        decision: preview.decision,
        approvalState: "none",
        recoveryBasisHash: preview.recovery_basis_hash,
        recoveryPlanHash: preview.current_recovery_plan_hash,
        checkpointRef: preview.checkpoint_ref,
        pendingRef: preview.pending_model_step_ref,
        blockers: preview.blockers,
        warnings: preview.warnings,
        generatedAt,
        eventsAppended: false,
      })
    }
    let appendPreview: CommanderInvestigationRecoveryApprovalPreview = preview
    try {
      const appended = await this.options.journalService.recordRecoveryApprovalAfterRevalidation(preview.investigation_id, async () => {
        appendPreview = await this.preview(normalized as CommanderInvestigationRecoveryApprovalInput)
        if (appendPreview.status === "already_recorded" && appendPreview.existing_current_approval) {
          throw new CommanderInvestigationJournalConflictError("Commander recovery approval is already recorded")
        }
        if (appendPreview.status !== "ready" || appendPreview.recovery_plan_hash_match !== true || appendPreview.current_recovery_plan_hash !== preview.current_recovery_plan_hash || appendPreview.recovery_basis_hash !== preview.recovery_basis_hash) {
          throw new CommanderInvestigationJournalConflictError([...appendPreview.blockers, "Commander recovery approval plan changed before append"].join("; "))
        }
        const source = await this.options.recoverySource(appendPreview.investigation_id)
        if (!source?.recovery_basis) {
          throw new CommanderInvestigationJournalConflictError("Commander recovery basis was not authoritative at approval append")
        }
        if (source.recovery_basis.basis_hash !== appendPreview.recovery_basis_hash) {
          throw new CommanderInvestigationJournalConflictError("Commander recovery basis changed before approval append")
        }
        return { expected_basis: source.recovery_basis, approval: buildApprovalRecord(normalized, appendPreview, generatedAt) }
      })
      return result({
        status: appended.status,
        investigationId: appendPreview.investigation_id,
        decision: appendPreview.decision,
        approval: appended.approval,
        approvalState: "current",
        recoveryBasisHash: appendPreview.recovery_basis_hash,
        recoveryPlanHash: appendPreview.current_recovery_plan_hash,
        checkpointRef: appendPreview.checkpoint_ref,
        pendingRef: appendPreview.pending_model_step_ref,
        eventId: appended.event_id,
        blockers: [],
        warnings: appendPreview.warnings,
        generatedAt,
        eventsAppended: appended.events_appended,
      })
    } catch (error) {
      if (error instanceof CommanderInvestigationJournalConflictError && error.message === "Commander recovery approval is already recorded" && appendPreview.existing_current_approval) {
        return result({
          status: "already_recorded",
          investigationId: appendPreview.investigation_id,
          decision: appendPreview.decision,
          approvalState: "current",
          recoveryBasisHash: appendPreview.recovery_basis_hash,
          recoveryPlanHash: appendPreview.current_recovery_plan_hash,
          checkpointRef: appendPreview.checkpoint_ref,
          pendingRef: appendPreview.pending_model_step_ref,
          blockers: [],
          warnings: appendPreview.warnings,
          generatedAt,
          eventsAppended: false,
        })
      }
      const failed = error instanceof CommanderInvestigationJournalConflictError ? "blocked" : "failed"
      return result({
        status: failed,
        investigationId: appendPreview.investigation_id,
        decision: appendPreview.decision,
        approvalState: "none",
        recoveryBasisHash: appendPreview.recovery_basis_hash,
        recoveryPlanHash: appendPreview.current_recovery_plan_hash,
        checkpointRef: appendPreview.checkpoint_ref,
        pendingRef: appendPreview.pending_model_step_ref,
        blockers: [redactText(error instanceof Error ? error.message : String(error)).slice(0, 240)],
        warnings: appendPreview.warnings,
        generatedAt,
        eventsAppended: false,
      })
    }
  }

  private previewResult(
    investigationId: string,
    input: NormalizedRecoveryApprovalInput,
    recovery: CommanderInvestigationRecoveryPreview | undefined,
    blockers: string[],
    warnings: string[],
    generatedAt: string,
    wouldAppend: boolean,
    existing?: CommanderInvestigationRecoveryPreview["current_approval"],
  ): CommanderInvestigationRecoveryApprovalPreview {
    const checkpointRef = recovery?.checkpoint ? checkpointRefFrom(recovery) : undefined
    const pendingRef = recovery?.pending_model_step ? pendingRefFrom(recovery) : undefined
    const status = existing ? "already_recorded" as const : blockers.length ? "blocked" as const : "ready" as const
    const preview = {
      preview_id: `commander_recovery_approval_preview_${stableHash({ investigation_id: investigationId, generated_at: generatedAt }).slice(0, 16)}`,
      preview_version: 1 as const,
      status,
      investigation_id: investigationId,
      decision: input.decision,
      approved_by_preview: bound(input.approved_by, 200),
      human_note_preview: humanNotePreview(input.human_note),
      supplied_recovery_plan_hash: typeof input.recovery_plan_hash === "string" ? bound(input.recovery_plan_hash, 160) : undefined,
      current_recovery_plan_hash: recovery?.recovery_plan_hash,
      recovery_plan_hash_match: Boolean(recovery?.recovery_plan_hash && recovery.recovery_plan_hash === input.recovery_plan_hash),
      recovery_basis_hash: recovery?.recovery_packet && recovery.recovery_plan_hash ? recovery.recovery_basis_hash : undefined,
      recovery_kind: recovery?.recovery_kind,
      checkpoint_ref: checkpointRef,
      pending_model_step_ref: pendingRef,
      provider_execution_envelope_hash: recovery?.provider_compatibility.execution_envelope?.execution_envelope_hash,
      recovery_packet_hash: recovery?.recovery_packet?.packet_hash,
      tool_compatibility_hash: recovery?.tool_compatibility.compatibility_hash,
      provider_compatibility_hash: recovery?.provider_compatibility.compatibility_hash,
      budget_compatibility_hash: recovery?.budget_compatibility.compatibility_hash,
      context_compatibility_hash: recovery?.context_compatibility.compatibility_hash,
      continuity_compatibility_hash: recovery?.continuity_compatibility.compatibility_hash,
      human_control_compatibility_hash: recovery?.human_control.compatibility_hash,
      acknowledgement_complete: acknowledgementsComplete(input.acknowledgements, input.decision),
      existing_current_approval: existing,
      would_append_event: wouldAppend,
      blockers: blockers.map((item) => bound(item, 240)).slice(0, 24),
      warnings: warnings.map((item) => bound(item, 240)).slice(0, 24),
      generated_at: generatedAt,
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
    return redactValue(preview) as CommanderInvestigationRecoveryApprovalPreview
  }
}

type ValidatedApprovalInput = CommanderInvestigationRecoveryApprovalInput & { blockers: string[]; warnings: string[] }

function validateApprovalInput(input: CommanderInvestigationRecoveryApprovalInput): { input: NormalizedRecoveryApprovalInput; blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  const warnings: string[] = []
  const record: Record<string, unknown> = isRecord(input) ? input : {}
  const keys = new Set(Object.keys(record))
  for (const key of keys) {
    if (!["investigation_id", "recovery_plan_hash", "decision", "approved_by", "human_note", "acknowledgements"].includes(key)) blockers.push(`unknown recovery approval input key ${key}`)
  }
  const decision = record.decision === "approve_resume_from_checkpoint" || record.decision === "approve_continue_after_uncertain_provider_outcome"
    ? record.decision
    : "approve_resume_from_checkpoint"
  const acknowledgements = normalizeAcknowledgements(record.acknowledgements)
  const normalized: NormalizedRecoveryApprovalInput = Object.freeze({
    investigation_id: typeof record.investigation_id === "string" ? record.investigation_id : "",
    recovery_plan_hash: typeof record.recovery_plan_hash === "string" ? record.recovery_plan_hash : "",
    decision,
    approved_by: typeof record.approved_by === "string" ? bound(record.approved_by, 200) : "",
    human_note: typeof record.human_note === "string" ? redactText(record.human_note) : undefined,
    acknowledgements,
  })
  if (typeof record.investigation_id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(record.investigation_id)) blockers.push("investigation_id is required and must use bounded durable ID characters")
  if (typeof record.recovery_plan_hash !== "string" || record.recovery_plan_hash.length < 8 || record.recovery_plan_hash.length > 160) blockers.push("recovery_plan_hash is required and bounded")
  if (record.decision !== "approve_resume_from_checkpoint" && record.decision !== "approve_continue_after_uncertain_provider_outcome") blockers.push("unknown recovery approval decision")
  if (typeof record.approved_by !== "string" || record.approved_by.trim().length === 0 || record.approved_by.length > 200) blockers.push("approved_by is required and bounded")
  if (typeof record.approved_by === "string" && containsConcreteCredentialPayload(record.approved_by)) blockers.push("approved_by must not contain URLs or credential payloads")
  if (record.human_note !== undefined && (typeof record.human_note !== "string" || record.human_note.length > 1000)) blockers.push("human_note must be a bounded string")
  if (typeof record.human_note === "string" && containsConcreteCredentialPayload(record.human_note)) blockers.push("human_note must not contain URLs or credential payloads")
  if (!acknowledgementsComplete(acknowledgements, decision)) blockers.push("required recovery approval acknowledgements are incomplete")
  return { input: normalized, blockers, warnings }
}

function approvalPreviewBlockers(input: NormalizedRecoveryApprovalInput, recovery: CommanderInvestigationRecoveryPreview): string[] {
  const blockers: string[] = []
  if (!recovery.recovery_plan_hash || recovery.recovery_plan_hash !== input.recovery_plan_hash) blockers.push("supplied recovery_plan_hash does not match the current recovery preview")
  if (recovery.continuity_compatibility.current_bootstrap_ready !== true) blockers.push("current continuity assessment must be ready before approval")
  if (recovery.human_control.action !== "continue") blockers.push("current human controls prevent recovery approval")
  if (recovery.provider_compatibility.provider_source !== "configured_connector" || !recovery.provider_compatibility.compatible) blockers.push("configured connector-backed provider compatibility is required before approval")
  if (recovery.blockers.length) blockers.push(...recovery.blockers)
  if (input.decision === "approve_resume_from_checkpoint") {
    if (recovery.status !== "ready_for_approval" && recovery.status !== "approved_waiting_for_execution") blockers.push("checkpoint approval requires a recovery preview ready for approval")
    if (recovery.recovery_kind !== "checkpoint") blockers.push("checkpoint approval requires checkpoint recovery kind")
    if (recovery.pending_model_step) blockers.push("checkpoint approval cannot target a pending model-step boundary")
    if (recovery.recommended_action !== "approve_resume_from_checkpoint") blockers.push("checkpoint approval requires approve_resume_from_checkpoint recommendation")
  }
  if (input.decision === "approve_continue_after_uncertain_provider_outcome") {
    if (recovery.status !== "human_review_required" && recovery.status !== "approved_waiting_for_execution") blockers.push("uncertain-provider approval requires human-review recovery preview")
    if (recovery.recovery_kind !== "uncertain_provider_outcome") blockers.push("uncertain-provider approval requires pending-provider recovery kind")
    if (!recovery.pending_model_step) blockers.push("uncertain-provider approval requires a pending model-step boundary")
    if (recovery.recommended_action !== "review_uncertain_provider_outcome") blockers.push("uncertain-provider approval requires uncertainty-review recommendation")
    if (input.acknowledgements?.uncertain_provider_outcome !== true) blockers.push("uncertain-provider approval requires uncertainty acknowledgement")
  }
  return blockers.slice(0, 24)
}

function buildApprovalRecord(input: NormalizedRecoveryApprovalInput, preview: CommanderInvestigationRecoveryApprovalPreview, approvedAt: string): CommanderInvestigationRecoveryApprovalRecord {
  if (!preview.checkpoint_ref || !preview.recovery_basis_hash || !preview.current_recovery_plan_hash || !preview.recovery_packet_hash || !preview.provider_execution_envelope_hash || !preview.tool_compatibility_hash || !preview.provider_compatibility_hash || !preview.budget_compatibility_hash || !preview.context_compatibility_hash || !preview.continuity_compatibility_hash || !preview.human_control_compatibility_hash) {
    throw new CommanderInvestigationPersistenceError("cannot build recovery approval without bounded plan references")
  }
  if (preview.recovery_kind !== "checkpoint" && preview.recovery_kind !== "uncertain_provider_outcome") {
    throw new CommanderInvestigationPersistenceError("cannot approve a non-recovery preview")
  }
  const approval = {
    schema_version: 1 as const,
    approval_version: 1 as const,
    approval_id: `commander_recovery_approval_${stableHash({ investigation_id: preview.investigation_id, plan: preview.current_recovery_plan_hash, packet: preview.recovery_packet_hash, decision: input.decision, approved_by: bound(input.approved_by, 200), note: humanNoteHash(input.human_note) }).slice(0, 20)}`,
    approval_sequence: 0,
    investigation_id: preview.investigation_id,
    recovery_kind: preview.recovery_kind,
    decision: input.decision,
    approved_by: bound(input.approved_by, 200),
    approval_source: "human" as const,
    human_note_preview: humanNotePreview(input.human_note),
    human_note_hash: humanNoteHash(input.human_note),
    acknowledgements: { ...input.acknowledgements },
    recovery_basis_hash: preview.recovery_basis_hash,
    recovery_plan_hash: preview.current_recovery_plan_hash,
    recovery_packet_hash: preview.recovery_packet_hash,
    preview_hash: preview.preview_hash,
    checkpoint_ref: preview.checkpoint_ref,
    pending_model_step_ref: preview.pending_model_step_ref,
    provider_execution_envelope_hash: preview.provider_execution_envelope_hash,
    tool_compatibility_hash: preview.tool_compatibility_hash,
    provider_compatibility_hash: preview.provider_compatibility_hash,
    budget_compatibility_hash: preview.budget_compatibility_hash,
    context_compatibility_hash: preview.context_compatibility_hash,
    continuity_compatibility_hash: preview.continuity_compatibility_hash,
    human_control_compatibility_hash: preview.human_control_compatibility_hash,
    one_shot: true as const,
    automatic: false as const,
    fresh_context_required: true as const,
    exact_replay_supported: false as const,
    provider_request_replay_allowed: false as const,
    tool_execution_replay_allowed: false as const,
    execution_supported_in_this_branch: false as const,
    approved_at: approvedAt,
    approval_hash: "",
  }
  const hashed = approvalHash(approval)
  assertBuiltApprovalRecord(hashed)
  return hashed
}

function checkpointRefFrom(preview: CommanderInvestigationRecoveryPreview): CommanderInvestigationRecoveryCheckpointApprovalRef {
  return {
    checkpoint_id: preview.checkpoint!.checkpoint_id,
    checkpoint_sequence: preview.checkpoint!.checkpoint_sequence,
    checkpoint_hash: preview.checkpoint!.checkpoint_hash,
  }
}

function pendingRefFrom(preview: CommanderInvestigationRecoveryPreview): CommanderInvestigationRecoveryPendingApprovalRef {
  const pending = preview.pending_model_step!
  return {
    model_request_id: pending.model_request_id,
    turn_index: pending.turn_index,
    base_checkpoint_id: pending.base_checkpoint_id,
    base_checkpoint_sequence: pending.base_checkpoint_sequence,
    base_checkpoint_hash: pending.base_checkpoint_hash,
    working_set_hash: pending.working_set_hash,
    context_hash: pending.context_hash,
    provider_request_may_have_been_sent: true,
    provider_response_available: false,
    provider_outcome_remains_unknown: true,
    tool_execution_known_to_have_occurred: false,
    provider_request_replay_forbidden: true,
    tool_execution_replay_forbidden: true,
    fresh_request_required_later: true,
  }
}

function approvalHash(approval: CommanderInvestigationRecoveryApprovalRecord): CommanderInvestigationRecoveryApprovalRecord {
  approval.approval_hash = stableHash({ ...approval, approved_at: "", approval_hash: "" })
  return approval
}

function humanNoteHash(note: string | undefined): string | undefined {
  return note === undefined ? undefined : stableHash(redactText(note))
}

function humanNotePreview(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const preview = bound(redactText(note), 500)
  return preview.length > 0 ? preview : undefined
}

function acknowledgementsComplete(ack: CommanderInvestigationRecoveryApprovalAcknowledgements | undefined, decision: CommanderInvestigationRecoveryApprovalInput["decision"]): boolean {
  if (!ack || typeof ack !== "object" || Array.isArray(ack)) return false
  const allowed = new Set(["fresh_context_required", "exact_replay_unavailable", "provider_request_replay_forbidden", "tool_execution_replay_forbidden", "uncertain_provider_outcome"])
  if (Object.keys(ack).some((key) => !allowed.has(key))) return false
  if (ack.fresh_context_required !== true || ack.exact_replay_unavailable !== true || ack.provider_request_replay_forbidden !== true || ack.tool_execution_replay_forbidden !== true) return false
  if (decision === "approve_continue_after_uncertain_provider_outcome" && ack.uncertain_provider_outcome !== true) return false
  if (decision === "approve_resume_from_checkpoint" && "uncertain_provider_outcome" in ack) return false
  return true
}

function normalizeAcknowledgements(value: unknown): Readonly<CommanderInvestigationRecoveryApprovalAcknowledgements> {
  const source = isRecord(value) ? value : {}
  const normalized: Partial<CommanderInvestigationRecoveryApprovalAcknowledgements> = {
    fresh_context_required: source.fresh_context_required === true ? true : undefined as never,
    exact_replay_unavailable: source.exact_replay_unavailable === true ? true : undefined as never,
    provider_request_replay_forbidden: source.provider_request_replay_forbidden === true ? true : undefined as never,
    tool_execution_replay_forbidden: source.tool_execution_replay_forbidden === true ? true : undefined as never,
  }
  if (source.uncertain_provider_outcome === true) normalized.uncertain_provider_outcome = true
  return Object.freeze(normalized as CommanderInvestigationRecoveryApprovalAcknowledgements)
}

function result(input: {
  status: CommanderInvestigationRecoveryApprovalResult["status"]
  investigationId: string
  decision?: CommanderInvestigationRecoveryApprovalInput["decision"]
  approvalState: CommanderInvestigationRecoveryApprovalResult["approval_state"]
  approval?: CommanderInvestigationRecoveryApprovalRecord
  recoveryBasisHash?: string
  recoveryPlanHash?: string
  checkpointRef?: CommanderInvestigationRecoveryCheckpointApprovalRef
  pendingRef?: CommanderInvestigationRecoveryPendingApprovalRef
  eventId?: string
  blockers: string[]
  warnings: string[]
  generatedAt: string
  eventsAppended: boolean
}): CommanderInvestigationRecoveryApprovalResult {
  const out = {
    result_id: `commander_recovery_approval_result_${stableHash({ investigation_id: input.investigationId, generated_at: input.generatedAt }).slice(0, 16)}`,
    status: input.status,
    investigation_id: input.investigationId,
    decision: input.decision,
    approval: input.approval,
    approval_state: input.approvalState,
    recovery_basis_hash: input.recoveryBasisHash,
    recovery_plan_hash: input.recoveryPlanHash,
    checkpoint_ref: input.checkpointRef,
    pending_model_step_ref: input.pendingRef,
    event_id: input.eventId,
    events_appended: input.eventsAppended,
    provider_called: false as const,
    tool_executed: false as const,
    network_called: false as const,
    files_written: false as const,
    research_db_written: false as const,
    mission_mutated: false as const,
    proposal_mutated: false as const,
    opencode_action_performed: false as const,
    github_action_performed: false as const,
    mcp_called: false as const,
    blockers: input.blockers.map((item) => bound(item, 240)).slice(0, 24),
    warnings: input.warnings.map((item) => bound(item, 240)).slice(0, 24),
    generated_at: input.generatedAt,
    result_hash: "",
  }
  out.result_hash = stableHash({ ...out, result_id: "", event_id: "", generated_at: "", result_hash: "" })
  return redactValue(out) as CommanderInvestigationRecoveryApprovalResult
}

function containsConcreteCredentialPayload(value: string): boolean {
  return /https?:\/\/|(?:^|\s)Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|authorization\s*[:=]\s*\S+/i.test(value)
}

function bound(value: unknown, max: number): string {
  return redactText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertBuiltApprovalRecord(approval: CommanderInvestigationRecoveryApprovalRecord): void {
  if (approval.approval_source !== "human" || approval.one_shot !== true || approval.automatic !== false || approval.fresh_context_required !== true || approval.exact_replay_supported !== false || approval.provider_request_replay_allowed !== false || approval.tool_execution_replay_allowed !== false || approval.execution_supported_in_this_branch !== false) {
    throw new CommanderInvestigationPersistenceError("recovery approval record failed no-replay schema validation")
  }
  if (!acknowledgementsComplete(approval.acknowledgements, approval.decision)) {
    throw new CommanderInvestigationPersistenceError("recovery approval record failed acknowledgement schema validation")
  }
  if (approval.approval_hash !== stableHash({ ...approval, approved_at: "", approval_hash: "" })) {
    throw new CommanderInvestigationPersistenceError("recovery approval record hash is invalid")
  }
}
