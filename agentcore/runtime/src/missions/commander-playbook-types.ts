import type { ProposalActionKind } from "./proposal-types"

export type CommanderPlaybookFieldType =
  | "mission_id"
  | "claim_id"
  | "result_id"
  | "text"
  | "reason"
  | "title"
  | "summary"

export interface CommanderPlaybookField {
  name: string
  label: string
  required: boolean
  field_type: CommanderPlaybookFieldType
}

export interface CommanderPlaybook {
  playbook_id: string
  title: string
  description: string
  required_fields: CommanderPlaybookField[]
  generated_action_kinds: ProposalActionKind[]
  creates_bundle: boolean
}

export interface CommanderPlaybookDraftInput {
  playbook_id: string
  requested_by?: string
  proposed_by?: string
  fields: Record<string, string>
  bundle_title?: string
  bundle_summary?: string
  create_bundle?: boolean
  request_reviews?: boolean
}

export interface CommanderPlaybookDraftResult {
  playbook_id: string
  proposal_ids: string[]
  bundle_id?: string
  review_ids?: string[]
  created_at: string
}
