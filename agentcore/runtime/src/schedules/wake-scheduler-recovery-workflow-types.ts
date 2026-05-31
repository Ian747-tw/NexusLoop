import type { WakeSchedulerRecoveryCommand, WakeSchedulerRecoveryStatus } from "./wake-scheduler-recovery-types"

export type WakeSchedulerRecoveryWorkflowStatus = "proposed" | "active" | "completed" | "cancelled" | "blocked"

export type WakeSchedulerRecoveryWorkflowStepStatus = "pending" | "manually_done" | "verified" | "skipped" | "blocked"

export type WakeSchedulerRecoveryWorkflowStepKind =
  | "read_command"
  | "dry_run_command"
  | "write_command"
  | "recovery_resolution"
  | "operator_checkpoint"

export type WakeSchedulerRecoveryWorkflowStepPreview = {
  index: number
  label: string
  command: string
  command_type: WakeSchedulerRecoveryCommand["command_type"]
  step_kind: WakeSchedulerRecoveryWorkflowStepKind
  allowed_to_execute_here: false
  requires_active_runtime?: boolean
  verification_hint?: string
  blockers: string[]
}

export type WakeSchedulerRecoveryWorkflowPreview = {
  recovery_id: string
  can_create: boolean
  blockers: string[]
  warnings: string[]
  recovery_status: WakeSchedulerRecoveryStatus
  stale_detected: boolean
  step_count: number
  read_step_count: number
  write_step_count: number
  dry_run_step_count: number
  resolution_step_count: number
  steps: WakeSchedulerRecoveryWorkflowStepPreview[]
  redacted_summary_preview: string
}

export type WakeSchedulerRecoveryWorkflowStep = WakeSchedulerRecoveryWorkflowStepPreview & {
  step_id: string
  status: WakeSchedulerRecoveryWorkflowStepStatus
  note?: string
  verified_at?: string
  marked_at?: string
  marked_by?: string
  verification_summary?: string
}

export type WakeSchedulerRecoveryWorkflow = {
  workflow_id: string
  recovery_id: string
  recovery_hash?: string
  status: WakeSchedulerRecoveryWorkflowStatus
  created_at: string
  created_by: string
  updated_at: string
  workflow_hash: string
  steps: WakeSchedulerRecoveryWorkflowStep[]
  completed_step_count: number
  skipped_step_count: number
  blocked_step_count: number
  warnings: string[]
  blockers: string[]
}

export type WakeSchedulerRecoveryWorkflowRecord = {
  workflow_id: string
  recovery_id: string
  status: WakeSchedulerRecoveryWorkflowStatus
  created_at: string
  updated_at: string
  step_count: number
  completed_step_count: number
  skipped_step_count: number
  blocked_step_count: number
  summary_preview: string
  workflow_hash: string
}

export type WakeSchedulerRecoveryWorkflowObservableEvent = {
  kind: string
  event_id?: string
  created_at?: string
  command_match?: string
  summary_preview: string
}

export type WakeSchedulerRecoveryWorkflowVerification = {
  workflow_id: string
  recovery_id: string
  checked_at: string
  observable_events: WakeSchedulerRecoveryWorkflowObservableEvent[]
  step_updates: Array<{
    step_id: string
    index: number
    suggested_status: WakeSchedulerRecoveryWorkflowStepStatus
    verification_summary: string
  }>
  warnings: string[]
}

export type WakeSchedulerRecoveryWorkflowInput = {
  recovery_id?: string
  recoveryId?: string
  created_by?: string
  createdBy?: string
  requested_by?: string
  requestedBy?: string
  include_write_steps?: boolean
  includeWriteSteps?: boolean
  max_steps?: number
  maxSteps?: number
  max_bytes?: number
  maxBytes?: number
}

export type WakeSchedulerRecoveryWorkflowStepRecordInput = {
  workflow_id?: string
  workflowId?: string
  step_id?: string
  stepId?: string
  index?: number
  status: "manually_done" | "skipped" | "blocked"
  note?: string
  requested_by?: string
  requestedBy?: string
}

export type WakeSchedulerRecoveryWorkflowCancelInput = {
  workflow_id?: string
  workflowId?: string
  reason?: string
  requested_by?: string
  requestedBy?: string
}

