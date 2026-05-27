export interface OpenCodeHandoffInput {
  proposal_id: string
  requested_by?: string
  dry_run?: boolean
}

export interface OpenCodeHandoffPayload {
  objective: string
  summary?: string
  source_cycle_id?: string
  source_synthesis_id?: string
  evidence_ids: string[]
  artifacts: string[]
  constraints: string[]
  acceptance_criteria: string[]
  requested_executor?: "opencode"
  priority?: "low" | "normal" | "high"
}

export interface OpenCodeHandoffPreview {
  proposal_id: string
  eligible: boolean
  blockers: string[]
  action_kind: string
  proposal_status: string
  review_id?: string
  review_status?: string
  objective_preview: string
  evidence_ids: string[]
  source_cycle_id?: string
  source_synthesis_id?: string
  would_create_mission: boolean
  would_send_to_adapter: boolean
}

export interface OpenCodeHandoffResult {
  handoff_id: string
  proposal_id: string
  review_id?: string
  mission_id?: string
  intent_id?: string
  adapter_session_id?: string
  objective_preview: string
  sent: boolean
  dry_run: boolean
  created_at: string
  requested_by: string
  source_cycle_id?: string
  source_synthesis_id?: string
  evidence_ids: string[]
}

export interface OpenCodeHandoffRecord {
  handoff_id: string
  proposal_id: string
  mission_id?: string
  intent_id?: string
  sent: boolean
  created_at: string
  requested_by: string
  source_cycle_id?: string
  source_synthesis_id?: string
}
