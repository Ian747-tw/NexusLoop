export type ResearchSynthesisConfidence = "low" | "medium" | "high"
export type ResearchSynthesisActionKind = "operator_checkpoint" | "other"

export interface ResearchSynthesisRecommendedAction {
  title: string
  summary: string
  action_kind: ResearchSynthesisActionKind
  evidence_ids: string[]
}

export interface ResearchSynthesisInput {
  topic_id: string
  objective?: string
  provider_id?: string
  create_proposals?: boolean
  requested_by: string
  max_context_bytes?: number
  max_output_bytes?: number
}

export interface ResearchSynthesisEvidenceCounts {
  sources: number
  notes: number
  artifacts: number
  ingestions: number
}

export interface ResearchSynthesisPreview {
  topic_id: string
  topic_title: string
  evidence_counts: ResearchSynthesisEvidenceCounts
  context_bytes: number
  max_context_bytes: number
  included_evidence_ids: string[]
  excluded_evidence_count: number
  blockers: string[]
  redacted_context_preview: string
}

export interface ResearchSynthesisResult {
  synthesis_id: string
  topic_id: string
  provider_id: string
  source_note_id?: string
  artifact_id?: string
  proposal_ids?: string[]
  title: string
  summary: string
  findings: string[]
  risks: string[]
  open_questions: string[]
  recommended_actions: ResearchSynthesisRecommendedAction[]
  context_hash: string
  output_hash: string
  created_at: string
  requested_by: string
}

export interface ResearchSynthesisRecord {
  synthesis_id: string
  topic_id: string
  provider_id: string
  source_note_id?: string
  artifact_id?: string
  proposal_ids?: string[]
  title: string
  summary_preview: string
  created_at: string
  requested_by: string
}
