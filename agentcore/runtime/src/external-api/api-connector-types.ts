export type ExternalApiMethod = "GET" | "POST"

export interface ExternalApiCredentialRef {
  name: string
  source: "env"
  env_name: string
  inject_as: "header" | "query"
  target_name: string
  prefix?: string
}

export interface ExternalApiConnector {
  connector_id: string
  title: string
  description?: string
  base_url: string
  allowed_hosts: string[]
  allowed_methods: ExternalApiMethod[]
  default_headers?: Record<string, string>
  credential_refs?: ExternalApiCredentialRef[]
  timeout_ms: number
  max_response_bytes: number
  created_at: string
  updated_at: string
  allow_local_http?: boolean
}

export type ExternalApiConnectorSummary = Omit<ExternalApiConnector, "credential_refs"> & {
  credential_refs: Array<Omit<ExternalApiCredentialRef, "env_name"> & { env_name: string }>
}

export interface ExternalApiRequestInput {
  connector_id: string
  method: ExternalApiMethod
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: string
  dry_run?: boolean
  requested_by: string
}

export interface ExternalApiRequestPreview {
  connector_id: string
  method: ExternalApiMethod
  url: string
  allowed: boolean
  blockers: string[]
  redacted_headers: Record<string, string>
  has_body: boolean
  body_bytes: number
  credential_refs_used: string[]
}

export interface ExternalApiRequestResult {
  request_id: string
  connector_id: string
  method: ExternalApiMethod
  url: string
  status_code?: number
  ok: boolean
  response_bytes?: number
  response_preview?: string
  error?: string
  dry_run: boolean
  created_at: string
}

export interface ExternalApiInternalRequestResult extends ExternalApiRequestResult {
  response_body_for_internal_use?: string
}

export interface ExternalApiAuditRecord {
  request_id: string
  connector_id: string
  method: ExternalApiMethod
  url: string
  status_code?: number
  ok: boolean
  dry_run: boolean
  requested_by: string
  error?: string
  created_at: string
}
