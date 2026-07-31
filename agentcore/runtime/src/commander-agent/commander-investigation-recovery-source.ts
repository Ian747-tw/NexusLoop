import type {
  CommanderInvestigationCheckpoint,
  CommanderInvestigationFinishedPayload,
  CommanderInvestigationJournalIdentity,
  CommanderInvestigationJournalProjectionStatus,
  CommanderInvestigationModelStepStartedPayload,
  CommanderInvestigationRecord,
  CommanderInvestigationStartedPayload,
} from "./commander-investigation-journal-types"
import type { CommanderInvestigationInput } from "./commander-investigation-types"
import type { CommanderInvestigationRecoveryBasis } from "./commander-investigation-recovery-basis"
import type { CommanderInvestigationRecoveryApprovalSummary } from "./commander-investigation-recovery-approval-types"

export type CommanderInvestigationRecoverySource = {
  investigation_id: string
  projection_status: CommanderInvestigationJournalProjectionStatus
  record?: CommanderInvestigationRecord
  normalized_input?: Omit<CommanderInvestigationInput, "abort_signal">
  immutable_identity?: CommanderInvestigationJournalIdentity
  latest_checkpoint?: CommanderInvestigationCheckpoint
  pending_model_step?: CommanderInvestigationModelStepStartedPayload
  terminal?: CommanderInvestigationFinishedPayload["terminal"]
  recovery_basis?: CommanderInvestigationRecoveryBasis
  recovery_basis_hash?: string
  recovery_approvals?: CommanderInvestigationRecoveryApprovalSummary[]
  latest_recovery_approval?: CommanderInvestigationRecoveryApprovalSummary
  source_event_count: number
  source_hash: string
}

export type CommanderInvestigationProjectedRecoveryParts = {
  started?: CommanderInvestigationStartedPayload
  identity?: CommanderInvestigationJournalIdentity
  latest_checkpoint?: CommanderInvestigationCheckpoint
  pending_model_step?: CommanderInvestigationModelStepStartedPayload
  terminal?: CommanderInvestigationFinishedPayload
}
