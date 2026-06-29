export type ResearchMemoryLabel =
  | "probe"
  | "trial"
  | "full_training"
  | "finding"
  | "failure"
  | "artifact"
  | "unknown"
  | (string & {})

export type ResearchMemorySourceKind =
  | "research_db"
  | "event_projection"
  | "external_api_record"
  | "research_synthesis"
  | "opencode_session"
  | "artifact"
  | "unknown"
  | (string & {})

export type ResearchMemorySourceRef = {
  source_kind: ResearchMemorySourceKind
  source_id: string
  label?: string
  summary_preview?: string
  pointer_only: true
}

export type ResearchMemoryCandidate = {
  result_id: string
  label: ResearchMemoryLabel
  source_kind: ResearchMemorySourceKind
  question_preview: string
  hypothesis_preview?: string
  method_preview?: string
  config_preview?: string
  outcome_preview?: string
  metric_preview?: string
  confidence?: string
  status?: string
  source_session_id?: string
  source_mission_id?: string
  artifact_ids: string[]
  citation_ids: string[]
  related_event_ids: string[]
  relevance_score: number
  duplicate_similarity_score: number
  matched_terms: string[]
  difference_preview?: string
  warning_flags: string[]
  source_refs: ResearchMemorySourceRef[]
}

export type ResearchMemoryRetrievalStatus = "ready" | "empty" | "partial" | "blocked"
export type ResearchMemoryRetrievalPolicy = "lexical_preview" | "projection_read" | "empty_projection" | "fake"

export type ResearchMemoryCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ResearchMemoryRetrievalPreview = {
  preview_id: string
  status: ResearchMemoryRetrievalStatus
  query_preview: string
  labels: string[]
  limit: number
  candidates: ResearchMemoryCandidate[]
  omitted_count: number
  retrieval_policy: ResearchMemoryRetrievalPolicy
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchMemoryCommand[]
  generated_at: string
  redacted_summary_preview: string
  retrieval_hash: string
}

export type ResearchNoveltyRisk = "low" | "medium" | "high" | "unknown"

export type ResearchNoveltyPreview = {
  preview_id: string
  status: "ready" | "partial" | "blocked"
  proposed_question_preview: string
  proposed_method_preview?: string
  proposed_config_preview?: string
  nearest_prior_results: ResearchMemoryCandidate[]
  duplicate_risk: ResearchNoveltyRisk
  novelty_score: number
  difference_summary_preview: string
  repetition_requires_justification: boolean
  acceptable_repetition_reasons: string[]
  suggested_reason_not_duplicate?: string
  missing_memory_warning: boolean
  external_research_recommended: boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchMemoryCommand[]
  generated_at: string
  novelty_hash: string
}

export type ResearchMemorySummary = {
  total_candidates_available: number
  label_counts: Record<string, number>
  source_counts: Record<string, number>
  has_research_db_projection: boolean
  retrieval_policy: ResearchMemoryRetrievalPolicy
  generated_at: string
}

export type ResearchMemoryRetrievalInput = {
  query?: string
  labels?: string[]
  limit?: number
  source_kind?: string
  mission_id?: string
  session_id?: string
  include_failures?: boolean
  include_artifacts?: boolean
}

export type ResearchNoveltyInput = {
  question?: string
  method?: string
  config?: string
  labels?: string[]
  limit?: number
  mission_id?: string
  session_id?: string
  repetition_reason?: string
  include_failures?: boolean
}
