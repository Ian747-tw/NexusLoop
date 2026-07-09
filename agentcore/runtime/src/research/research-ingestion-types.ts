export type ResearchIngestionSourceKind = "opencode_result_review" | "manual" | "unknown"

export type ResearchEvidenceKind =
  | "positive_finding"
  | "negative_result"
  | "inconclusive_result"
  | "partial_result"
  | "blocked_result"
  | "status_note"
  | "artifact_index"
  | "metric_observation"
  | "unknown"

export type ResearchIngestionStatus = "ready" | "blocked" | "dry_run" | "recorded" | "failed"
export type ResearchIngestionDecision = "ingest" | "block" | "defer" | "unknown"
export type ResearchMemoryWriteStatus = "not_written" | "written" | "write_failed" | "dry_run"

export type ResearchIngestionProvenanceRef = {
  source_kind: string
  source_id: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type ResearchIngestionCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ResearchIngestionPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_ingest: boolean
  review_id: string
  report_id: string
  session_id: string
  mission_id?: string
  launch_id?: string
  source_kind: "opencode_result_review"
  evidence_kind: ResearchEvidenceKind
  ingestion_decision: ResearchIngestionDecision
  review_decision?: string
  review_disposition?: string
  review_projection_state?: string
  report_kind?: string
  report_disposition?: string
  research_title_preview: string
  research_question_preview?: string
  hypothesis_preview?: string
  method_preview?: string
  outcome_preview?: string
  evidence_summary_preview: string
  claims_preview: string[]
  metrics_preview: string[]
  artifacts_preview: string[]
  tests_preview: string[]
  failures_preview: string[]
  followups_preview: string[]
  tags_preview: string[]
  confidence?: string | number
  novelty_key_preview?: string
  provenance_refs: ResearchIngestionProvenanceRef[]
  research_db_write_status: "not_written"
  research_db_written: false
  mission_mutated: false
  checkpoint_created: false
  followup_mission_created: false
  provider_called: false
  mcp_called: false
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchIngestionCommand[]
  generated_at: string
  redacted_summary_preview: string
  ingestion_hash: string
}

export type ResearchIngestionResult = Omit<ResearchIngestionPreview, "preview_id" | "status" | "can_ingest" | "generated_at" | "blockers" | "warnings" | "redacted_summary_preview" | "research_db_write_status" | "research_db_written"> & {
  ingestion_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  research_memory_id?: string
  research_db_row_id?: string
  research_db_write_status: ResearchMemoryWriteStatus
  research_db_written: boolean
  recorded_at: string
  recorded_by: string
  error?: string
}

export type ResearchIngestionRecord = {
  ingestion_id: string
  research_memory_id?: string
  review_id: string
  report_id: string
  session_id: string
  mission_id?: string
  launch_id?: string
  evidence_kind: ResearchEvidenceKind
  ingestion_decision: ResearchIngestionDecision
  research_title_preview: string
  evidence_summary_preview: string
  research_db_written: boolean
  recorded_at: string
  recorded_by: string
  confidence?: string | number
  ingestion_hash: string
}

export type ResearchIngestionSummary = {
  total_ingestions: number
  research_memory_count: number
  session_count: number
  positive_finding_count: number
  negative_result_count: number
  inconclusive_result_count: number
  partial_result_count: number
  blocked_result_count: number
  db_written_count: number
  failed_count: number
  latest_ingestions: ResearchIngestionRecord[]
  generated_at: string
}

export type ResearchIngestionPreviewInput = {
  review_id?: string
  evidence_kind?: string
  tags?: string[]
  research_title?: string
  research_question?: string
  hypothesis?: string
  method?: string
  novelty_key?: string
  recorded_by?: string
}

export type ResearchIngestionRecordInput = ResearchIngestionPreviewInput & {
  dry_run?: boolean
  recorded_by?: string
}
