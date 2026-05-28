export type RuntimeCheckpointScope = "full" | "commander" | "executor" | "research" | "handoff"

export type RuntimeCheckpointSuggestedCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
}

export type RuntimeCheckpointSectionSummary = {
  name: string
  included: boolean
  item_count: number
  bytes: number
  truncated: boolean
}

export type RuntimeCheckpointPreview = {
  checkpoint_id?: string
  scope: RuntimeCheckpointScope
  reason?: string
  event_count: number
  last_event_id?: string
  sections: RuntimeCheckpointSectionSummary[]
  estimated_bytes: number
  max_bytes: number
  blockers: string[]
  redacted_summary_preview: string
}

export type RuntimeCheckpointRecord = {
  checkpoint_id: string
  scope: RuntimeCheckpointScope
  reason?: string
  created_at: string
  created_by: string
  event_count: number
  last_event_id?: string
  checkpoint_hash: string
  section_names: string[]
  summary_preview: string
}

export type RuntimeCheckpointSections = {
  runtime?: Record<string, unknown>
  spec?: Record<string, unknown>
  reasoning?: Record<string, unknown>
  research?: Record<string, unknown>
  commander?: Record<string, unknown>
  executor?: Record<string, unknown>
  opencode?: Record<string, unknown>
  handoff?: Record<string, unknown>
  suggested_commands?: RuntimeCheckpointSuggestedCommand[]
}

export type RuntimeCheckpoint = {
  checkpoint_id: string
  scope: RuntimeCheckpointScope
  reason?: string
  created_at: string
  created_by: string
  event_count: number
  last_event_id?: string
  checkpoint_hash: string
  sections: RuntimeCheckpointSections
  section_summaries: RuntimeCheckpointSectionSummary[]
  restore_supported: false
  warnings: string[]
}

export type RuntimeCheckpointInput = {
  scope?: RuntimeCheckpointScope
  reason?: string
  created_by?: string
  requested_by?: string
  max_bytes?: number
}

