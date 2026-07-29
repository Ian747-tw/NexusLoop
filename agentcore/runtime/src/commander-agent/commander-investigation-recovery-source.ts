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

export type CommanderInvestigationRecoverySource = {
  investigation_id: string
  projection_status: CommanderInvestigationJournalProjectionStatus
  record?: CommanderInvestigationRecord
  normalized_input?: Omit<CommanderInvestigationInput, "abort_signal">
  immutable_identity?: CommanderInvestigationJournalIdentity
  latest_checkpoint?: CommanderInvestigationCheckpoint
  pending_model_step?: CommanderInvestigationModelStepStartedPayload
  terminal?: CommanderInvestigationFinishedPayload["terminal"]
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
