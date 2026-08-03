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
import type {
  CommanderInvestigationRecoveryAttemptSummary,
  CommanderInvestigationResolvedPendingBoundary,
} from "./commander-investigation-recovery-transaction-types"

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
  recovery_attempts?: CommanderInvestigationRecoveryAttemptSummary[]
  current_recovery_attempt?: CommanderInvestigationRecoveryAttemptSummary
  latest_recovery_attempt?: CommanderInvestigationRecoveryAttemptSummary
  consumed_recovery_approval?: CommanderInvestigationRecoveryApprovalSummary
  resolved_pending_boundary?: CommanderInvestigationResolvedPendingBoundary
  recovery_execution_in_progress?: boolean
  recovery_execution_interrupted?: boolean
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
