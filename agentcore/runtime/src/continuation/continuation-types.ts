export type ContinuationPlanStatus = "proposed" | "active" | "paused" | "completed" | "cancelled" | "blocked" | "failed"

export type ContinuationStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "blocked"

export type ContinuationStepKind = "read_command" | "write_command" | "operator_checkpoint"

export type ContinuationCommandType = "read" | "write"

export type ContinuationStepPreview = {
  index: number
  label: string
  command: string
  command_type: ContinuationCommandType
  step_kind: ContinuationStepKind
  requires_active_runtime?: boolean
  requires_review?: boolean
  allowed_by_default: boolean
  blockers: string[]
}

export type ContinuationPlanPreview = {
  wake_id: string
  resume_id?: string
  checkpoint_id?: string
  can_create: boolean
  blockers: string[]
  warnings: string[]
  step_count: number
  read_step_count: number
  write_step_count: number
  operator_checkpoint_count: number
  redacted_summary_preview: string
  steps: ContinuationStepPreview[]
}

export type ContinuationStep = ContinuationStepPreview & {
  step_id: string
  status: ContinuationStepStatus
  created_from_suggestion?: boolean
  result_summary?: string
  error?: string
  started_at?: string
  completed_at?: string
}

export type ContinuationPlan = {
  plan_id: string
  wake_id: string
  resume_id?: string
  checkpoint_id?: string
  status: ContinuationPlanStatus
  created_at: string
  created_by: string
  updated_at: string
  plan_hash: string
  steps: ContinuationStep[]
  current_step_index?: number
  completed_step_count: number
  failed_step_count: number
  blockers: string[]
  warnings: string[]
  allowed_write_commands?: string[]
}

export type ContinuationStepResult = {
  plan_id: string
  step_id: string
  index: number
  status: ContinuationStepStatus
  command: string
  result_summary?: string
  error?: string
  dry_run?: boolean
  started_at: string
  completed_at: string
}

export type ContinuationPlanRecord = {
  plan_id: string
  wake_id: string
  status: ContinuationPlanStatus
  created_at: string
  updated_at: string
  step_count: number
  completed_step_count: number
  failed_step_count: number
  summary_preview: string
  plan_hash: string
}

export type ContinuationPlanInput = {
  wake_id?: string
  wakeId?: string
  created_by?: string
  createdBy?: string
  requested_by?: string
  requestedBy?: string
  include_write_steps?: boolean
  includeWriteSteps?: boolean
  allowed_write_commands?: string[]
  allowedWriteCommands?: string[]
  max_steps?: number
  maxSteps?: number
  max_bytes?: number
  maxBytes?: number
}

export type ContinuationStepInput = {
  plan_id?: string
  planId?: string
  step_id?: string
  stepId?: string
  index?: number
  dry_run?: boolean
  dryRun?: boolean
  allow_write?: boolean
  allowWrite?: boolean
  requested_by?: string
  requestedBy?: string
}

export type ContinuationPlanDecisionInput = {
  plan_id?: string
  planId?: string
  reason?: string
  requested_by?: string
  requestedBy?: string
}
