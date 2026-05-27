export type CommanderCycleConfidence = "low" | "medium" | "high"
export type CommanderCycleActionKind = "operator_checkpoint" | "other"

export interface CommanderCycleRecommendedAction {
  title: string
  summary: string
  action_kind: CommanderCycleActionKind
  rationale: string
  evidence_ids?: string[]
  synthesis_ids?: string[]
  related_target_type?: string
  related_target_id?: string
}

export interface CommanderCycleInput {
  objective?: string
  topic_id?: string
  mission_id?: string
  provider_id?: string
  create_proposals?: boolean
  create_bundle?: boolean
  requested_by: string
  max_context_bytes?: number
  max_output_bytes?: number
}

export interface CommanderCycleContextCounts {
  sources: number
  notes: number
  artifacts: number
  syntheses: number
  proposals: number
  reviews: number
  queues: number
}

export interface CommanderCyclePreview {
  cycle_id?: string
  objective?: string
  topic_id?: string
  mission_id?: string
  context_counts: CommanderCycleContextCounts
  context_bytes: number
  max_context_bytes: number
  included_evidence_ids: string[]
  included_synthesis_ids: string[]
  blockers: string[]
  redacted_context_preview: string
}

export interface CommanderCycleResult {
  cycle_id: string
  provider_id: string
  objective?: string
  topic_id?: string
  mission_id?: string
  title: string
  summary: string
  findings: string[]
  risks: string[]
  recommended_actions: CommanderCycleRecommendedAction[]
  proposal_ids?: string[]
  bundle_id?: string
  context_hash: string
  output_hash: string
  created_at: string
  requested_by: string
}

export interface CommanderCycleRecord {
  cycle_id: string
  provider_id: string
  objective_preview?: string
  topic_id?: string
  mission_id?: string
  title: string
  summary_preview: string
  proposal_ids?: string[]
  bundle_id?: string
  created_at: string
  requested_by: string
}
