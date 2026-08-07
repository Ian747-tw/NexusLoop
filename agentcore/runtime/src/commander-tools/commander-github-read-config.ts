import { createHash } from "node:crypto"
import type { CommanderGithubGatewayConfig } from "./commander-github-read-types"

const REPOSITORY = /^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/

export function validateCommanderGithubGatewayConfig(value: unknown): CommanderGithubGatewayConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Commander GitHub gateway config must be an object")
  const record = value as Record<string, unknown>
  const allowed = new Set(["connector_id", "allowed_repositories", "max_requests_per_call", "max_pages_per_call", "max_items_per_call", "max_normalized_bytes", "max_response_bytes", "timeout_ms"])
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`unknown Commander GitHub gateway config key: ${key}`)
  const connectorId = required(record.connector_id, "connector_id", 120)
  const repositories = repositoryList(record.allowed_repositories)
  const config: CommanderGithubGatewayConfig = Object.freeze({
    connector_id: connectorId,
    allowed_repositories: repositories,
    max_requests_per_call: optionalPositive(record.max_requests_per_call, "max_requests_per_call", 4) ?? 4,
    max_pages_per_call: optionalPositive(record.max_pages_per_call, "max_pages_per_call", 2) ?? 2,
    max_items_per_call: optionalPositive(record.max_items_per_call, "max_items_per_call", 50) ?? 50,
    max_normalized_bytes: optionalPositive(record.max_normalized_bytes, "max_normalized_bytes", 24_000) ?? 24_000,
    max_response_bytes: optionalPositive(record.max_response_bytes, "max_response_bytes", 128_000),
    timeout_ms: optionalPositive(record.timeout_ms, "timeout_ms", 15_000),
  })
  return config
}

export function readCommanderGithubGatewayConfigFromEnv(env: Record<string, string | undefined>): CommanderGithubGatewayConfig | undefined {
  const connector = env.NXL_COMMANDER_GITHUB_READ_CONNECTOR_ID
  const repositories = env.NXL_COMMANDER_GITHUB_READ_REPOSITORIES
  if (connector === undefined && repositories === undefined) return undefined
  if (!connector || !repositories) throw new Error("NXL_COMMANDER_GITHUB_READ_CONNECTOR_ID and NXL_COMMANDER_GITHUB_READ_REPOSITORIES must be set together")
  return validateCommanderGithubGatewayConfig({ connector_id: connector, allowed_repositories: repositories.split(","), max_requests_per_call: 4, max_pages_per_call: 2, max_items_per_call: 50, max_normalized_bytes: 24_000 })
}

export function commanderGithubGatewayCompatibilityHash(config: CommanderGithubGatewayConfig): string {
  return createHash("sha256").update(JSON.stringify({ connector_id: config.connector_id, allowed_repositories: [...config.allowed_repositories].sort(), max_requests_per_call: config.max_requests_per_call, max_pages_per_call: config.max_pages_per_call, max_items_per_call: config.max_items_per_call, max_normalized_bytes: config.max_normalized_bytes, max_response_bytes: config.max_response_bytes, timeout_ms: config.timeout_ms })).digest("hex")
}

function required(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /https?:\/\//i.test(value)) throw new Error(`${field} is invalid`); return value.trim() }
function repositoryList(value: unknown): string[] { if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error("allowed_repositories must contain 1-32 exact repositories"); const normalized = value.map((item) => { if (typeof item !== "string" || item !== item.trim() || item !== item.toLowerCase() || !REPOSITORY.test(item)) throw new Error("allowed_repositories must contain exact lowercase owner/repository identities"); return item }); if (new Set(normalized).size !== normalized.length) throw new Error("allowed_repositories must not contain duplicates"); return normalized.sort() }
function positive(value: unknown, field: string, max: number): number { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${field} must be a positive integer no greater than ${max}`); return Number(value) }
function optionalPositive(value: unknown, field: string, max: number): number | undefined { return value === undefined ? undefined : positive(value, field, max) }
