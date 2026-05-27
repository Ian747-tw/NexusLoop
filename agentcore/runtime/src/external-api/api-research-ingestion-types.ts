import type { ExternalApiMethod } from "./api-connector-types"

export type ExternalApiResearchResponseSelector = "body_preview" | "json" | "text"

export interface ExternalApiResearchIngestionInput {
  connector_id: string
  method: ExternalApiMethod
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: string
  topic_id: string
  source_title: string
  note_title?: string
  requested_by: string
  response_selector?: ExternalApiResearchResponseSelector
  tags?: string[]
  dry_run?: boolean
}

export interface ExternalApiResearchIngestionPreview {
  connector_id: string
  topic_id: string
  method: ExternalApiMethod
  url: string
  allowed: boolean
  blockers: string[]
  would_create_source: boolean
  would_create_note: boolean
  max_ingested_bytes: number
  credential_refs_used: string[]
  redacted_headers: Record<string, string>
}

export interface ExternalApiResearchIngestionResult {
  ingestion_id: string
  request_id?: string
  connector_id: string
  topic_id: string
  source_id?: string
  note_id?: string
  artifact_id?: string
  audit_request_id?: string
  ok: boolean
  dry_run: boolean
  ingested_bytes: number
  response_preview: string
  error?: string
  created_at: string
}

export interface ExternalApiResearchIngestionRecord {
  ingestion_id: string
  connector_id: string
  topic_id: string
  source_id?: string
  note_id?: string
  artifact_id?: string
  audit_request_id?: string
  ok: boolean
  dry_run: boolean
  requested_by: string
  error?: string
  created_at: string
}
