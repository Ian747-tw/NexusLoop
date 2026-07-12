import { redactText } from "../security/redaction"
import { COMMAND_AUTHORITY_REGISTRY } from "./command-authority-registry"
import type { CommandAuthorityGate, CommandAuthorityOwner, CommandAuthorityQuery, CommandAuthorityRecord, CommandAuthorityRisk, CommandAuthoritySummary, CommandValidationProfile } from "./command-authority-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = Math.max(100, COMMAND_AUTHORITY_REGISTRY.length)

export class CommandAuthorityService {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  summary(): CommandAuthoritySummary {
    const records = COMMAND_AUTHORITY_REGISTRY
    return {
      total_records: records.length,
      risks: countBy(records, "risk"),
      gates: countBy(records, "gate"),
      owners: countBy(records, "owner"),
      mutating_count: records.filter((record) => record.mutates_events).length,
      high_impact_count: records.filter((record) => record.risk === "high_impact_write").length,
      approval_required_count: records.filter((record) => record.requires_approval).length,
      generated_at: this.now(),
    }
  }

  list(input: Record<string, unknown> = {}): CommandAuthorityRecord[] {
    const query = readCommandAuthorityQuery(input)
    const limit = query.limit ?? DEFAULT_LIMIT
    return COMMAND_AUTHORITY_REGISTRY
      .filter((record) => !query.risk || record.risk === query.risk)
      .filter((record) => !query.gate || record.gate === query.gate)
      .filter((record) => !query.owner || record.owner === query.owner)
      .filter((record) => query.mutates_events === undefined || record.mutates_events === query.mutates_events)
      .filter((record) => query.requires_approval === undefined || record.requires_approval === query.requires_approval)
      .filter((record) => !query.command || commandMatches(record, query.command))
      .slice(0, limit)
  }

  get(command: string): CommandAuthorityRecord {
    const normalized = normalizeSlashCommand(command)
    if (!normalized) return unsupportedRecord(command)
    const found = COMMAND_AUTHORITY_REGISTRY.find((record) => commandMatches(record, normalized))
    return found ?? unsupportedRecord(command)
  }

  validationProfile(command: string, changedFiles: string[] = []): CommandValidationProfile {
    const record = this.get(command)
    const profile = record.validation_profile
    const broad = changedFiles.some((file) => /agentcore\/tui\/src\/(keyboard|runtime-effects|snapshot|state|runtime-state-merge)\.ts$/.test(file))
    return broad
      ? { ...profile, full_e2e_required_when: [...profile.full_e2e_required_when, "Changed files touch shared TUI parser/state/snapshot paths; run affected family E2E plus one broad smoke, and consider full E2E before release."] }
      : profile
  }
}

export function readCommandAuthorityQuery(input: Record<string, unknown>): CommandAuthorityQuery {
  return {
    risk: optionalEnum(input.risk, "risk", ["safe_read", "low_risk_write", "medium_risk_write", "high_impact_write", "unsupported", "unknown"]),
    gate: optionalEnum(input.gate, "gate", ["none", "wake_scheduler_runtime", "wake_schedule_tick", "checkpoint_runtime", "recovery_runtime", "recovery_workflow_runtime", "continuation_runtime", "handoff_runtime", "mission_runtime", "proposal_review_runtime", "reasoning_provider_runtime", "research_runtime", "opencode_runtime", "external_api_runtime", "unknown"]),
    owner: optionalEnum(input.owner, "owner", ["runtime_status", "research", "reasoning_provider", "commander_cycle", "commander_tools", "opencode_handoff", "runtime_checkpoint", "runtime_restore", "wake_assessment", "wake_schedule", "wake_scheduler", "scheduler_navigation", "scheduler_navigation_staging", "scheduler_navigation_staged_read", "scheduler_navigation_write_preview", "scheduler_navigation_write_staging", "scheduler_navigation_write_run", "scheduler_navigation_write_approval", "scheduler_navigation_checkpoint_write", "scheduler_navigation_checkpoint_compare", "continuation", "mission", "proposal", "review", "playbook", "commander_apply", "unknown"]),
    mutates_events: optionalBoolean(input.mutatesEvents ?? input.mutates_events, "mutates_events"),
    requires_approval: optionalBoolean(input.requiresApproval ?? input.requires_approval, "requires_approval"),
    command: typeof input.command === "string" ? normalizeSlashCommand(input.command) : undefined,
    limit: optionalLimit(input.limit),
  }
}

export function normalizeSlashCommand(value: string): string | undefined {
  const redacted = redactText(String(value ?? "")).trim()
  const match = /^\/([a-z][a-z-]*)(?:\s|$)/i.exec(redacted)
  if (!match) return undefined
  return `/${match[1].toLowerCase()}`
}

function commandMatches(record: CommandAuthorityRecord, command: string): boolean {
  const normalized = normalizeSlashCommand(command) ?? command
  return record.slash_command === normalized || record.aliases.includes(normalized)
}

function unsupportedRecord(command: string): CommandAuthorityRecord {
  const redacted = redactText(String(command ?? "")).slice(0, 160)
  return {
    authority_id: "command_authority_unsupported",
    slash_command: redacted || "<empty>",
    aliases: [],
    risk: "unsupported",
    gate: "unknown",
    owner: "unknown",
    mutates_events: false,
    creates_external_process: false,
    calls_provider: false,
    requires_active_runtime: false,
    requires_run_lock: false,
    requires_approval: false,
    expected_event_kinds: [],
    blocked_by_default: true,
    current_phase_status: "blocked",
    recommended_reads: ["/authority-list"],
    validation_profile: {
      unit_runtime: true,
      unit_tui: true,
      typecheck_runtime: true,
      typecheck_tui: true,
      integration_cli: true,
      targeted_e2e: ["tests/e2e_user/scenarios/test_command_authority_inventory_tui.py"],
      optional_regression_e2e: [],
      full_e2e_required_when: ["Unsupported command handling changed in a shared parser or dispatch path."],
      live_provider_required: false,
      real_opencode_required: false,
    },
    notes: ["Unsupported, unknown, non-slash, or path-like command text. Authority inventory does not execute inspected commands."],
    out_of_scope: ["command execution", "command staging", "approval mutation"],
  }
}

function countBy(records: CommandAuthorityRecord[], key: "risk" | "gate" | "owner"): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of records) counts[String(record[key])] = (counts[String(record[key])] ?? 0) + 1
  return counts
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`)
  return value
}

function optionalEnum<T extends string>(value: unknown, name: string, allowed: T[]): T | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${name} is unsupported`)
  return value as T
}

export type { CommandAuthorityGate, CommandAuthorityOwner, CommandAuthorityRecord, CommandAuthorityRisk, CommandAuthoritySummary, CommandValidationProfile }
