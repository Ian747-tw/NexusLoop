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
  unmatched_query_terms: string[]
  matched_fields: string[]
  scoring_explanation_preview: string
  difference_preview?: string
  evidence_kind_preview?: string
  created_at_preview?: string
  updated_at_preview?: string
  warning_flags: string[]
  source_refs: ResearchMemorySourceRef[]
  pointer_only: true
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

export type ResearchMemorySearchProfile = {
  profile_id: string
  status: "ready" | "degraded" | "blocked"
  retrieval_policy: ResearchMemoryRetrievalPolicy
  has_research_db_projection: boolean
  search_engine: "bounded_lexical"
  semantic_search_enabled: false
  vector_index_enabled: false
  fts_index_enabled: false
  scan_limit: number
  default_limit: number
  max_limit: number
  supported_filters: string[]
  unsupported_filters: string[]
  source_counts: Record<string, number>
  label_counts: Record<string, number>
  accepted_result_count?: number
  candidate_count?: number
  trial_count?: number
  training_run_count?: number
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
}

export type ResearchMemoryInspectionPreview = {
  inspection_id: string
  status: "ready" | "blocked"
  memory_id: string
  source_kind: ResearchMemorySourceKind
  label: ResearchMemoryLabel
  title_preview?: string
  summary_preview?: string
  question_preview?: string
  hypothesis_preview?: string
  method_preview?: string
  outcome_preview?: string
  metric_preview?: string
  config_preview?: string
  confidence?: string
  status_preview?: string
  source_mission_id?: string
  source_session_id?: string
  artifact_refs: ResearchMemorySourceRef[]
  citation_refs: ResearchMemorySourceRef[]
  provenance_refs: ResearchMemorySourceRef[]
  related_event_ids: string[]
  warning_flags: string[]
  recommended_commands: ResearchMemoryCommand[]
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  inspection_hash: string
}

export type ResearchMemoryNearDuplicatePreview = {
  preview_id: string
  status: "ready" | "empty" | "blocked"
  query_preview: string
  objective_preview?: string
  labels: string[]
  limit: number
  duplicate_threshold: number
  candidates: ResearchMemoryCandidate[]
  likely_duplicate_count: number
  warning_duplicate_count: number
  strongest_duplicate_score?: number
  novelty_risk: ResearchNoveltyRisk
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchMemoryCommand[]
  generated_at: string
  redacted_summary_preview: string
  near_duplicate_hash: string
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
  result_type?: string
  result_status?: string
  confidence?: string
  evidence_kind?: string
  has_artifacts?: boolean
  has_citations?: boolean
  has_metrics?: boolean
  since?: string
  until?: string
  sort?: "relevance" | "newest" | "oldest" | "confidence" | "similarity" | string
  explain?: boolean
}

export type ResearchMemoryInspectionInput = {
  memory_id?: string
  source_kind?: string
  include_artifacts?: boolean
  include_citations?: boolean
}

export type ResearchMemoryNearDuplicateInput = {
  query?: string
  objective?: string
  labels?: string[]
  limit?: number
  duplicate_threshold?: number
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
