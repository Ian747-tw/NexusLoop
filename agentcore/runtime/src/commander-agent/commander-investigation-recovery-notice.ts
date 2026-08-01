import { redactText } from "../security/redaction"
import { stableHash } from "./commander-model-schema"
import type { CommanderInvestigationRecoveryNotice } from "./commander-investigation-recovery-execution-types"
import type { CommanderInvestigationCheckpoint } from "./commander-investigation-journal-types"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"

export function buildCommanderInvestigationRecoveryNotice(input: {
  source: CommanderInvestigationRecoverySource
  checkpoint: CommanderInvestigationCheckpoint
  current_bootstrap_hash: string
  continuity_drift_detected: boolean
  next_turn_index: number
}): CommanderInvestigationRecoveryNotice {
  const pending = input.source.pending_model_step
  const notice: CommanderInvestigationRecoveryNotice = {
    notice_version: 1,
    kind: pending ? "uncertain_provider_continuation" : "checkpoint_continuation",
    investigation_id: input.checkpoint.investigation_id,
    checkpoint_id: input.checkpoint.checkpoint_id,
    checkpoint_sequence: input.checkpoint.checkpoint_sequence,
    checkpoint_hash: input.checkpoint.checkpoint_hash,
    original_bootstrap_hash: input.checkpoint.bootstrap_ref.bootstrap_hash,
    current_bootstrap_hash: input.current_bootstrap_hash,
    continuity_drift_detected: input.continuity_drift_detected,
    previous_provider_outcome: pending ? "uncertain" : "not_pending",
    previous_model_request_id: pending?.model_request_id,
    previous_provider_request_may_have_been_sent: Boolean(pending),
    previous_provider_response_available: false,
    previous_tool_execution_known: false,
    previous_request_replay_forbidden: true,
    previous_tool_execution_replay_forbidden: true,
    exact_replay_supported: false,
    original_assistant_text_available: false,
    durable_tool_results_are_summary_only: true,
    counters_preserved: true,
    fresh_request_required: true,
    next_turn_index: input.next_turn_index,
    warning: pending
      ? "Previous provider outcome is uncertain; do not infer success or failure, do not replay the old request, and continue only from the accepted checkpoint with a fresh request."
      : "Recovery uses a fresh current context from the accepted checkpoint; exact assistant prose and raw tool results are unavailable.",
    notice_hash: "",
  }
  notice.notice_hash = stableHash({ ...notice, warning: redactText(notice.warning), notice_hash: "" })
  return notice
}
