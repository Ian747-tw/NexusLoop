export type CommanderAuditEventKind =
  | "mission"
  | "review"
  | "proposal"
  | "proposal_bundle"
  | "playbook_draft"
  | "apply"
  | "runtime"
  | "other"

export type CommanderAuditTargetType =
  | "mission"
  | "claim"
  | "result"
  | "review"
  | "proposal"
  | "bundle"
  | "draft"
  | "runtime"

export interface CommanderAuditEventSummary {
  event_id?: string
  event_index: number
  kind: string
  category: CommanderAuditEventKind
  target_type?: CommanderAuditTargetType
  target_id?: string
  related_ids: Record<string, string[]>
  created_at?: string
  title: string
  summary: string
}

export interface CommanderAuditTimelineOptions {
  limit?: number
  category?: CommanderAuditEventKind
  target_type?: string
  target_id?: string
  after_event_id?: string
  before_event_id?: string
}

export interface CommanderAuditTimeline {
  events: CommanderAuditEventSummary[]
  total_considered: number
  next_after_event_id?: string
}

export interface CommanderAuthorityChain {
  target_type: string
  target_id: string
  related_ids: Record<string, string[]>
  events: CommanderAuditEventSummary[]
  missing_links: string[]
}
