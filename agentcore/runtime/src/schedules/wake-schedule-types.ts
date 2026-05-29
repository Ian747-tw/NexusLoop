export type WakeScheduleStatus = "active" | "paused" | "cancelled"

export type WakeSchedulePolicy = {
  create_wake_assessment: boolean
  create_continuation_plan: boolean
  include_write_steps: boolean
  max_wake_assessments_per_tick: number
  max_continuation_plans_per_tick: number
}

export type WakeSchedule = {
  schedule_id: string
  resume_id: string
  checkpoint_id?: string
  status: WakeScheduleStatus
  title: string
  interval_ms: number
  next_due_at: string
  last_tick_at?: string
  last_wake_id?: string
  last_plan_id?: string
  created_at: string
  created_by: string
  updated_at: string
  policy: WakeSchedulePolicy
  reason?: string
  schedule_hash: string
  warnings: string[]
}

export type WakeScheduleRecord = {
  schedule_id: string
  resume_id: string
  status: WakeScheduleStatus
  title: string
  next_due_at: string
  last_tick_at?: string
  last_wake_id?: string
  last_plan_id?: string
  summary_preview: string
}

export type WakeSchedulePreview = {
  resume_id: string
  checkpoint_id?: string
  title: string
  interval_ms: number
  next_due_at: string
  policy: WakeSchedulePolicy
  can_create: boolean
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type WakeScheduleDueItem = {
  schedule_id: string
  resume_id: string
  checkpoint_id?: string
  due: boolean
  status: WakeScheduleStatus
  next_due_at: string
  last_tick_at?: string
  blockers: string[]
  warnings: string[]
  would_create_wake: boolean
  would_create_continuation_plan: boolean
}

export type WakeScheduleTickPreview = {
  now: string
  due_count: number
  eligible_count: number
  blocked_count: number
  items: WakeScheduleDueItem[]
  max_items: number
  blockers: string[]
  warnings: string[]
}

export type WakeScheduleTickResult = {
  tick_id: string
  now: string
  processed_count: number
  wake_ids: string[]
  plan_ids: string[]
  skipped: WakeScheduleDueItem[]
  created_at: string
  requested_by: string
  dry_run: boolean
}

export type WakeScheduleInput = {
  resume_id?: string
  resumeId?: string
  title?: string
  interval_ms?: number
  intervalMs?: number
  next_due_at?: string
  nextDueAt?: string
  reason?: string
  policy?: Partial<WakeSchedulePolicy>
  created_by?: string
  createdBy?: string
  requested_by?: string
  requestedBy?: string
}

export type WakeScheduleDecisionInput = {
  schedule_id?: string
  scheduleId?: string
  reason?: string
  requested_by?: string
  requestedBy?: string
}

export type WakeScheduleTickInput = {
  now?: string
  dry_run?: boolean
  dryRun?: boolean
  max_due_items?: number
  maxDueItems?: number
  requested_by?: string
  requestedBy?: string
}
