import type { CommanderAuditEventSummary } from "./commander-audit-types"
import type { CommanderQueueKind } from "./commander-queue-types"

export type CommanderTargetType =
  | "mission"
  | "claim"
  | "result"
  | "review"
  | "proposal"
  | "bundle"
  | "draft"
  | "runtime"

export type CommanderSuggestedCommandType = "read" | "write"

export interface CommanderSuggestedCommand {
  label: string
  command: string
  command_type: CommanderSuggestedCommandType
  requires_review?: boolean
  requires_active_runtime?: boolean
}

export interface CommanderTargetContext {
  target_type: CommanderTargetType
  target_id: string
  found: boolean
  title: string
  summary: string
  status?: string
  record_kind?: string
  related_ids: Record<string, string[]>
  queue_membership: CommanderQueueKind[]
  audit_event_count: number
  recent_audit_events: CommanderAuditEventSummary[]
  suggested_commands: CommanderSuggestedCommand[]
  missing_links: string[]
}
