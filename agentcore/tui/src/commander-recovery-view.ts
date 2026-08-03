import { redactText } from "./redaction"
import type { CommanderRecoveryUiState } from "./state"

function authorityField(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  return typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    ? redactText(String(item)).slice(0, 240)
    : "none"
}

export function commanderRecoveryAuthorityValues(recovery: CommanderRecoveryUiState): {
  recovery_plan_hash: string
  execution_preparation_hash: string
  recovery_packet_hash: string
  approval_id: string
  approval_hash: string
} {
  const preview = recovery.preview ?? {}
  const approvalResult = recovery.approval ?? {}
  const recordedApproval = typeof approvalResult.approval === "object" && approvalResult.approval !== null && !Array.isArray(approvalResult.approval)
    ? approvalResult.approval as Record<string, unknown>
    : {}
  const currentApproval = typeof preview.current_approval === "object" && preview.current_approval !== null && !Array.isArray(preview.current_approval)
    ? preview.current_approval as Record<string, unknown>
    : {}
  const approval = Object.keys(currentApproval).length > 0 ? currentApproval : recordedApproval
  return {
    recovery_plan_hash: authorityField(preview, "recovery_plan_hash"),
    execution_preparation_hash: authorityField(preview, "execution_preparation_hash"),
    recovery_packet_hash: authorityField(preview, "recovery_packet_hash"),
    approval_id: authorityField(approval, "approval_id"),
    approval_hash: authorityField(approval, "approval_hash"),
  }
}

export function commanderRecoveryApprovalDisplay(approval: Record<string, unknown> | null | undefined): {
  status: string
  blockers: string[]
} {
  const value = approval ?? {}
  return {
    status: authorityField(value, "status"),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.slice(0, 6).map((item) => redactText(String(item)).slice(0, 240))
      : [],
  }
}
