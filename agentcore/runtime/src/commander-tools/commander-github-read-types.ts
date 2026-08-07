import type { CommanderEvidenceCard, CommanderReadStatus } from "./commander-read-types"

export const COMMANDER_GITHUB_READ_TOOL_IDS = [
  "github.repository_get",
  "github.commit_get",
  "github.pull_request_get",
  "github.issue_get",
  "github.commit_checks",
  "github.pull_request_reviews",
] as const

export type CommanderGithubReadToolId = typeof COMMANDER_GITHUB_READ_TOOL_IDS[number]

export type CommanderGithubGatewayConfig = {
  connector_id: string
  allowed_repositories: readonly string[]
  max_requests_per_call?: number
  max_pages_per_call?: number
  max_items_per_call?: number
  max_normalized_bytes?: number
  max_response_bytes?: number
  timeout_ms?: number
}

export type CommanderGithubProvenance = {
  repository: string
  operation: CommanderGithubReadToolId
  requested_ref?: string
  observed_commit_sha?: string
  source_class: "github_content_untrusted"
  retrieved_at: string
  truncated: boolean
  evidence_hash: string
  web_url?: string
}

export type CommanderGithubReadResult = {
  status: CommanderReadStatus | "cancelled"
  tool_id: CommanderGithubReadToolId
  repository?: string
  result: Record<string, unknown> | null
  evidence: CommanderEvidenceCard[]
  provenance?: CommanderGithubProvenance
  request_count: number
  page_count: number
  item_count: number
  normalized_bytes: number
  truncated: boolean
  external_api_audit_request_ids: string[]
  external_api_audit_event_kinds: Array<"external_api_request_executed" | "external_api_request_failed">
  network_called: boolean
  blockers: string[]
  warnings: string[]
  generated_at: string
  result_hash: string
}

export type CommanderGithubGatewayStatus = {
  status: "ready" | "blocked"
  connector_id?: string
  repository_count: number
  repositories: string[]
  transport_policy_hash?: string
  blockers: string[]
  warnings: string[]
  generated_at: string
}
