export type CommanderGuidanceDeliveryMode = "adapter_send" | "operator_handoff" | "fake" | "disabled"

export type CommanderGuidanceDeliveryStatus =
  | "ready"
  | "blocked"
  | "dry_run"
  | "delivery_requested"
  | "delivered"
  | "delivery_failed"

export type CommanderGuidanceDeliveryProjectionStatus =
  | "not_delivered"
  | "pending_delivery"
  | "delivered"
  | "delivery_failed"

export type CommanderGuidanceDeliveryAdapterCapability =
  | "can_send"
  | "operator_handoff_only"
  | "disabled"
  | "unknown"

export type CommanderGuidanceDeliveryCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderGuidanceDeliveryPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_deliver: boolean
  guidance_id: string
  question_id: string
  session_id: string
  launch_id?: string
  guidance_status?: string
  current_delivery_status?: CommanderGuidanceDeliveryProjectionStatus
  delivery_mode: CommanderGuidanceDeliveryMode
  delivery_payload_preview: string
  answer_preview: string
  constraints_preview: string[]
  rationale_preview?: string
  refs_preview: string[]
  target_summary_preview: string
  adapter_capability: CommanderGuidanceDeliveryAdapterCapability
  blockers: string[]
  warnings: string[]
  recommended_commands: CommanderGuidanceDeliveryCommand[]
  generated_at: string
  redacted_summary_preview: string
  delivery_hash: string
}

export type CommanderGuidanceDeliveryResult = {
  delivery_id: string
  status: CommanderGuidanceDeliveryStatus
  guidance_id: string
  question_id: string
  session_id: string
  launch_id?: string
  delivery_mode: CommanderGuidanceDeliveryMode
  delivery_status_after: CommanderGuidanceDeliveryProjectionStatus
  adapter_capability: CommanderGuidanceDeliveryAdapterCapability
  delivery_payload_preview: string
  target_summary_preview: string
  adapter_ack_preview?: string
  operator_handoff_preview?: string
  created_at: string
  delivered_by: string
  error?: string
  delivery_hash: string
  recommended_commands: CommanderGuidanceDeliveryCommand[]
}

export type CommanderGuidanceDeliveryRecord = {
  delivery_id: string
  status: CommanderGuidanceDeliveryStatus
  guidance_id: string
  question_id: string
  session_id: string
  launch_id?: string
  delivery_mode: CommanderGuidanceDeliveryMode
  delivery_status_after: CommanderGuidanceDeliveryProjectionStatus
  created_at: string
  delivered_by: string
  summary_preview: string
  delivery_hash: string
}

export type CommanderGuidanceDeliverySummary = {
  total_deliveries: number
  requested_count: number
  delivered_count: number
  failed_count: number
  by_mode_counts: Record<string, number>
  latest_deliveries: CommanderGuidanceDeliveryRecord[]
  generated_at: string
}

export type CommanderGuidanceDeliveryPreviewInput = {
  guidance_id?: string
  delivery_mode?: CommanderGuidanceDeliveryMode | string
  allow_real_delivery?: boolean
  operator_note?: string
}

export type CommanderGuidanceDeliveryInput = CommanderGuidanceDeliveryPreviewInput & {
  dry_run?: boolean
  delivered_by?: string
}
