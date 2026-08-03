import { redactText } from "../security/redaction"
import type { CommanderInvestigationJournalService } from "./commander-investigation-journal-service"
import type { CommanderInvestigationRecord } from "./commander-investigation-journal-types"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import type {
  CommanderRecoveryOperatorDetail,
  CommanderRecoveryOperatorList,
  CommanderRecoveryOperatorListInput,
  CommanderRecoveryOperatorMissing,
  CommanderRecoveryOperatorSummary,
} from "./commander-investigation-recovery-operator-types"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export class CommanderInvestigationRecoveryOperatorService {
  constructor(
    private readonly journal: CommanderInvestigationJournalService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(input: CommanderRecoveryOperatorListInput = {}): Promise<CommanderRecoveryOperatorList> {
    const limit = boundedLimit(input.limit)
    const records = await this.journal.list({
      limit: MAX_LIMIT,
      status: input.status as never,
      recovery_state: input.recovery_state,
      recovery_approval_state: input.approval_state,
    })
    const items = records
      .map(summaryFromRecord)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.investigation_id.localeCompare(b.investigation_id))
      .slice(0, limit)
    return { items, count: items.length, limit, current_compatibility_checked: false, observed_at: this.now().toISOString() }
  }

  async show(investigationId: string): Promise<CommanderRecoveryOperatorDetail | CommanderRecoveryOperatorMissing> {
    const source = await this.journal.recoverySource(investigationId)
    const observedAt = this.now().toISOString()
    if (!source?.record) {
      return {
        found: false,
        investigation_id: investigationId,
        projection_status: "missing",
        recommended_next_operator_action: "none",
        blockers: [],
        warnings: ["Commander investigation recovery record was not found"],
        observed_at: observedAt,
      }
    }
    return detailFromSource(source, observedAt)
  }
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  return value
}

function summaryFromRecord(record: CommanderInvestigationRecord): CommanderRecoveryOperatorSummary {
  const approvalState = record.recovery_approval_consumed
    ? "consumed"
    : record.recovery_approval_recorded
      ? "current"
      : record.recovery_approval_count > 0 ? "stale" : "none"
  return {
    investigation_id: record.investigation_id,
    projection_status: record.projection_status,
    record_status: record.status,
    recovery_state: record.recovery_state,
    recovery_kind: record.uncertain_provider_outcome ? "uncertain_provider_outcome" : record.checkpoint_available ? "checkpoint" : "none",
    objective_preview: redactText(record.objective_preview).slice(0, 300),
    phase: record.phase,
    updated_at: record.updated_at,
    record_hash: record.record_hash,
    checkpoint_id: record.latest_checkpoint_id,
    pending_model_request_id: record.pending_model_request_id,
    terminal: record.status !== "running",
    approval_state: approvalState,
    recovery_approval_count: record.recovery_approval_count,
    recovery_attempt_count: record.recovery_attempt_count,
    recovery_execution_in_progress: record.recovery_execution_in_progress,
    human_review_required: record.projection_status !== "ready" || record.uncertain_provider_outcome || record.recovery_execution_in_progress || record.recovery_approval_consumed,
    current_compatibility_checked: false,
  }
}

function detailFromSource(source: CommanderInvestigationRecoverySource, observedAt: string): CommanderRecoveryOperatorDetail {
  const record = source.record!
  const summary = summaryFromRecord(record)
  const latestApproval = source.latest_recovery_approval
  const approvalState = source.consumed_recovery_approval
    ? "consumed"
    : latestApproval
      ? latestApproval.recovery_basis_hash === source.recovery_basis_hash ? "current" : "stale"
      : "none"
  return {
    ...summary,
    found: true,
    approval_state: approvalState,
    requested_by: redactText(record.requested_by).slice(0, 200),
    mission_id: record.mission_id,
    session_id: record.session_id,
    launch_id: record.launch_id,
    provider_id: record.provider_id,
    provider_kind: record.provider_kind,
    model_id: record.model_id,
    tool_protocol: record.tool_protocol,
    checkpoint_ref: source.latest_checkpoint ? {
      checkpoint_id: source.latest_checkpoint.checkpoint_id,
      checkpoint_sequence: source.latest_checkpoint.checkpoint_sequence,
      checkpoint_hash: source.latest_checkpoint.checkpoint_hash,
    } : undefined,
    pending_model_step_ref: source.pending_model_step ? {
      model_request_id: source.pending_model_step.model_request_id,
      turn_index: source.pending_model_step.turn_index,
    } : undefined,
    latest_approval: latestApproval,
    latest_recovery_attempt: source.latest_recovery_attempt,
    blockers: record.integrity_errors.slice(0, 20).map((item) => redactText(item).slice(0, 300)),
    warnings: record.warnings.slice(0, 20).map((item) => redactText(item).slice(0, 300)),
    recommended_next_operator_action: recommendedAction(source),
    observed_at: observedAt,
  }
}

function recommendedAction(source: CommanderInvestigationRecoverySource): string {
  if (source.projection_status !== "ready") return "inspect_corrupt_record"
  if (source.terminal) return "none"
  if (source.current_recovery_attempt) return "await_recovery_completion"
  if (source.consumed_recovery_approval) return "human_review_required"
  if (source.pending_model_step) return "preview_uncertain_provider_recovery"
  if (source.latest_checkpoint) return "preview_checkpoint_recovery"
  return "none"
}
