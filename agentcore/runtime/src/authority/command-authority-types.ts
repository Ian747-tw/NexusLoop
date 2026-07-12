export type CommandAuthorityRisk =
  | "safe_read"
  | "low_risk_write"
  | "medium_risk_write"
  | "high_impact_write"
  | "unsupported"
  | "unknown"

export type CommandAuthorityGate =
  | "none"
  | "wake_scheduler_runtime"
  | "wake_schedule_tick"
  | "checkpoint_runtime"
  | "recovery_runtime"
  | "recovery_workflow_runtime"
  | "continuation_runtime"
  | "handoff_runtime"
  | "mission_runtime"
  | "proposal_review_runtime"
  | "reasoning_provider_runtime"
  | "research_runtime"
  | "opencode_runtime"
  | "external_api_runtime"
  | "unknown"

export type CommandAuthorityOwner =
  | "runtime_status"
  | "research"
  | "reasoning_provider"
  | "commander_cycle"
  | "commander_tools"
  | "opencode_handoff"
  | "runtime_checkpoint"
  | "runtime_restore"
  | "wake_assessment"
  | "wake_schedule"
  | "wake_scheduler"
  | "scheduler_navigation"
  | "scheduler_navigation_staging"
  | "scheduler_navigation_staged_read"
  | "scheduler_navigation_write_preview"
  | "scheduler_navigation_write_staging"
  | "scheduler_navigation_write_run"
  | "scheduler_navigation_write_approval"
  | "scheduler_navigation_checkpoint_write"
  | "scheduler_navigation_checkpoint_compare"
  | "continuation"
  | "mission"
  | "proposal"
  | "review"
  | "playbook"
  | "commander_apply"
  | "unknown"

export type CommandPhaseStatus =
  | "implemented"
  | "preview_only"
  | "staged_only"
  | "approved_execution"
  | "blocked"
  | "future"

export type CommandValidationProfile = {
  unit_runtime: boolean
  unit_tui: boolean
  typecheck_runtime: boolean
  typecheck_tui: boolean
  integration_cli: boolean
  targeted_e2e: string[]
  optional_regression_e2e: string[]
  full_e2e_required_when: string[]
  live_provider_required: false
  real_opencode_required: false
}

export type CommandAuthorityRecord = {
  authority_id: string
  slash_command: string
  runtime_command?: string
  aliases: string[]
  risk: CommandAuthorityRisk
  gate: CommandAuthorityGate
  owner: CommandAuthorityOwner
  mutates_events: boolean
  creates_external_process: boolean
  calls_provider: boolean
  requires_active_runtime: boolean
  requires_run_lock: boolean
  requires_approval: boolean
  approval_surface?: string
  execution_surface?: string
  expected_event_kinds: string[]
  blocked_by_default: boolean
  current_phase_status: CommandPhaseStatus
  recommended_reads: string[]
  validation_profile: CommandValidationProfile
  notes: string[]
  out_of_scope: string[]
}

export type CommandAuthorityQuery = {
  risk?: CommandAuthorityRisk
  gate?: CommandAuthorityGate
  owner?: CommandAuthorityOwner
  mutates_events?: boolean
  requires_approval?: boolean
  command?: string
  limit?: number
}

export type CommandAuthoritySummary = {
  total_records: number
  risks: Record<string, number>
  gates: Record<string, number>
  owners: Record<string, number>
  mutating_count: number
  high_impact_count: number
  approval_required_count: number
  generated_at: string
}
