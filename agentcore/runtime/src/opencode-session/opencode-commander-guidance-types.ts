export type CommanderGuidanceStatus = "draft" | "created" | "superseded" | "delivered" | "cancelled"

export type CommanderGuidanceDeliveryStatus = "not_delivered" | "pending_delivery" | "delivered" | "delivery_failed"

export type CommanderGuidanceAuthorKind = "human" | "commander_manual" | "system" | "unknown"

export type CommanderGuidanceScope =
  | "answer_question"
  | "clarification"
  | "constraint"
  | "design_direction"
  | "permission_decision"
  | "status_report_response"
  | "timeout_report_response"
  | "blocker_resolution"
  | "unknown"

export type CommanderGuidanceCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderGuidancePreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_create: boolean
  question_id: string
  question_status?: string
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  guidance_scope: CommanderGuidanceScope
  author_kind: CommanderGuidanceAuthorKind
  answer_preview: string
  rationale_preview?: string
  constraints_preview: string[]
  spec_refs_preview: string[]
  research_refs_preview: string[]
  artifact_refs_preview: string[]
  delivery_status: "not_delivered"
  delivery_note_preview: string
  duplicate_guidance_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: CommanderGuidanceCommand[]
  generated_at: string
  redacted_summary_preview: string
  guidance_hash: string
}

export type CommanderGuidanceRecord = {
  guidance_id: string
  status: CommanderGuidanceStatus
  delivery_status: CommanderGuidanceDeliveryStatus
  question_id: string
  session_id: string
  launch_id?: string
  guidance_scope: CommanderGuidanceScope
  author_kind: CommanderGuidanceAuthorKind
  answer_preview: string
  created_at: string
  created_by: string
  has_constraints: boolean
  has_refs: boolean
  guidance_hash: string
}

export type CommanderGuidanceResult = {
  guidance_id: string
  status: "created" | "blocked" | "dry_run" | "failed"
  guidance_status: CommanderGuidanceStatus
  delivery_status: CommanderGuidanceDeliveryStatus
  question_id: string
  question_status_after?: "answered"
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  guidance_scope: CommanderGuidanceScope
  author_kind: CommanderGuidanceAuthorKind
  answer_preview: string
  rationale_preview?: string
  constraints_preview: string[]
  spec_refs_preview: string[]
  research_refs_preview: string[]
  artifact_refs_preview: string[]
  delivery_note_preview: string
  created_at: string
  created_by: string
  error?: string
  guidance_hash: string
  recommended_commands: CommanderGuidanceCommand[]
}

export type CommanderGuidanceSummary = {
  total_guidance: number
  created_count: number
  not_delivered_count: number
  pending_delivery_count: number
  delivered_count: number
  cancelled_count: number
  by_scope_counts: Record<string, number>
  latest_guidance: CommanderGuidanceRecord[]
  generated_at: string
}

export type CommanderGuidancePreviewInput = {
  question_id?: string
  answer?: string
  guidance_scope?: CommanderGuidanceScope | string
  author_kind?: CommanderGuidanceAuthorKind | string
  rationale?: string
  constraints?: string[]
  spec_refs?: string[]
  research_refs?: string[]
  artifact_refs?: string[]
  delivery_note?: string
}

export type CommanderGuidanceCreateInput = CommanderGuidancePreviewInput & {
  dry_run?: boolean
  created_by?: string
}
