import type {
  CommanderInvestigationJournalIdentity,
  CommanderInvestigationJournalProjectionStatus,
} from "./commander-investigation-journal-types"
import type { CommanderInvestigationRecoveryKind } from "./commander-investigation-recovery-types"

export type CommanderInvestigationRecoveryBasis = {
  basis_version: 1
  investigation_id: string
  projection_status: CommanderInvestigationJournalProjectionStatus
  immutable_identity: CommanderInvestigationJournalIdentity
  normalized_input_hash: string
  latest_checkpoint_id: string
  latest_checkpoint_sequence: number
  latest_checkpoint_hash: string
  pending_model_request_id?: string
  pending_model_boundary_hash?: string
  terminal_hash?: string
  recovery_kind: CommanderInvestigationRecoveryKind
  basis_hash: string
}
