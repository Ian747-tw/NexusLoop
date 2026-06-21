import { CommandAuthorityService } from "../authority/command-authority-service"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeHandoffPreview, OpenCodeHandoffRecord, OpenCodeHandoffResult } from "./opencode-handoff-types"
import type { OpenCodeHandoffFollowupSummary } from "./opencode-handoff-followup-types"
import type { OpenCodeProcessSmokeRecord } from "./opencode-process-smoke-types"
import type {
  OpenCodeHandoffReadinessCommand,
  OpenCodeHandoffReadinessEvidence,
  OpenCodeHandoffReadinessInput,
  OpenCodeHandoffReadinessPreview,
  OpenCodeHandoffReadinessStatus,
  OpenCodeHandoffReadinessSummary,
} from "./opencode-handoff-readiness-types"

const DEFAULT_MAX_SMOKE_AGE_MS = 24 * 60 * 60 * 1000
const MAX_SMOKE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TEXT = 220
const MAX_COMMANDS = 12
const MAX_EVIDENCE = 12

export type OpenCodeHandoffReadinessServiceOptions = {
  adapterKind?: string
  now?: () => Date
  authorityService?: CommandAuthorityService
  listSmokes: (limit: number) => Promise<OpenCodeProcessSmokeRecord[]>
  previewHandoff: (input: { proposal_id: string; requested_by?: string }) => Promise<OpenCodeHandoffPreview>
  listHandoffs: (limit: number) => Promise<OpenCodeHandoffRecord[]>
  getHandoff: (handoffId: string) => Promise<OpenCodeHandoffResult | null>
  followupSummary: () => Promise<OpenCodeHandoffFollowupSummary>
}

export class OpenCodeHandoffReadinessService {
  private readonly adapterKind: string
  private readonly now: () => Date
  private readonly authorityService: CommandAuthorityService
  private readonly listSmokes: OpenCodeHandoffReadinessServiceOptions["listSmokes"]
  private readonly previewHandoff: OpenCodeHandoffReadinessServiceOptions["previewHandoff"]
  private readonly listHandoffs: OpenCodeHandoffReadinessServiceOptions["listHandoffs"]
  private readonly getHandoff: OpenCodeHandoffReadinessServiceOptions["getHandoff"]
  private readonly followupSummary: OpenCodeHandoffReadinessServiceOptions["followupSummary"]

  constructor(options: OpenCodeHandoffReadinessServiceOptions) {
    this.adapterKind = options.adapterKind ?? "fake"
    this.now = options.now ?? (() => new Date())
    this.authorityService = options.authorityService ?? new CommandAuthorityService(() => this.now().toISOString())
    this.listSmokes = options.listSmokes
    this.previewHandoff = options.previewHandoff
    this.listHandoffs = options.listHandoffs
    this.getHandoff = options.getHandoff
    this.followupSummary = options.followupSummary
  }

  async preview(input: OpenCodeHandoffReadinessInput = {}): Promise<OpenCodeHandoffReadinessPreview> {
    const normalized = normalizeInput(input)
    const generatedAt = this.now().toISOString()
    const authorityCommand = normalized.command ?? "/handoff"
    const authorityRecord = this.authorityService.get(authorityCommand)
    const authority = {
      command: authorityRecord.slash_command,
      slash_command: authorityRecord.slash_command,
      risk: authorityRecord.risk,
      gate: authorityRecord.gate,
      owner: authorityRecord.owner,
      blocked_by_default: authorityRecord.blocked_by_default,
    }
    const required: OpenCodeHandoffReadinessEvidence[] = []
    const optional: OpenCodeHandoffReadinessEvidence[] = []
    const blockers: string[] = []
    const warnings: string[] = []
    const maxSmokeAgeMs = normalized.max_smoke_age_ms ?? DEFAULT_MAX_SMOKE_AGE_MS
    const requireRecentSmoke = normalized.require_recent_smoke ?? this.adapterKind === "process"

    const smokeRecords = await this.listSmokes(1)
    const latestSmoke = smokeRecords[0]
    const smokeEvidence = this.smokeEvidence(latestSmoke, maxSmokeAgeMs, requireRecentSmoke)
    required.push(smokeEvidence)
    blockers.push(...smokeEvidence.blockers)
    warnings.push(...smokeEvidence.warnings)

    if (normalized.include_authority !== false) {
      const authorityEvidence = evidence({
        evidence_id: `authority:${authorityRecord.slash_command}`,
        kind: "authority_record",
        related_id: authorityRecord.slash_command,
        status: authorityRecord.risk,
        fresh: true,
        summary_preview: `${authorityRecord.slash_command} is ${authorityRecord.risk} through ${authorityRecord.gate}`,
        warnings: authorityRecord.blocked_by_default ? [`${authorityRecord.slash_command} remains explicit; readiness does not execute it`] : [],
      })
      required.push(authorityEvidence)
      warnings.push(...authorityEvidence.warnings)
    }

    let handoffPreviewSummary: string | undefined
    if (normalized.proposal_id) {
      const previewEvidence = await this.targetProposalEvidence(normalized.proposal_id)
      required.push(previewEvidence.evidence)
      blockers.push(...previewEvidence.evidence.blockers)
      warnings.push(...previewEvidence.evidence.warnings)
      handoffPreviewSummary = previewEvidence.summary
    }
    if (normalized.review_id) optional.push(targetEvidence("review", normalized.review_id, `/review ${normalized.review_id}`))
    if (normalized.mission_id) optional.push(targetEvidence("mission", normalized.mission_id, `/mission ${normalized.mission_id}`))
    if (normalized.handoff_id) optional.push(await this.targetHandoffEvidence(normalized.handoff_id))

    const followupEvidence = await this.followupEvidence()
    optional.push(followupEvidence)
    warnings.push(...followupEvidence.warnings)

    const status = readinessStatus(blockers, required, normalized, requireRecentSmoke)
    const commands = recommendedCommands(normalized, status)
    const summary = summaryPreview(status, blockers, warnings, latestSmoke)
    return redactValue({
      readiness_id: readinessId(normalized, generatedAt),
      status,
      can_execute_now: false,
      proposal_id: normalized.proposal_id,
      review_id: normalized.review_id,
      mission_id: normalized.mission_id,
      handoff_id: normalized.handoff_id,
      authority,
      latest_smoke: latestSmoke,
      handoff_preview_summary: handoffPreviewSummary,
      required_evidence: required.slice(0, MAX_EVIDENCE),
      optional_evidence: optional.slice(0, MAX_EVIDENCE),
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: commands,
      generated_at: generatedAt,
      redacted_summary_preview: summary,
    })
  }

  async summary(input: { max_smoke_age_ms?: number } = {}): Promise<OpenCodeHandoffReadinessSummary> {
    const preview = await this.preview({ max_smoke_age_ms: input.max_smoke_age_ms })
    const latestHandoff = (await this.listHandoffs(1))[0]
    return redactValue({
      total_considered: 1,
      ready_count: preview.status === "ready" ? 1 : 0,
      blocked_count: preview.status === "blocked" || preview.status === "not_configured" ? 1 : 0,
      needs_smoke_count: preview.status === "needs_smoke" ? 1 : 0,
      needs_review_count: preview.status === "needs_review" ? 1 : 0,
      latest_smoke_status: preview.latest_smoke?.status,
      latest_handoff_status: latestHandoff ? (latestHandoff.sent ? "sent" : "not_sent") : undefined,
      generated_at: preview.generated_at,
    })
  }

  private smokeEvidence(latest: OpenCodeProcessSmokeRecord | undefined, maxAgeMs: number, requireRecentSmoke: boolean): OpenCodeHandoffReadinessEvidence {
    const blockers: string[] = []
    const warnings: string[] = []
    if (!latest) {
      const message = "no OpenCode process smoke record found"
      if (requireRecentSmoke) blockers.push(`${message}; run /opencode-smoke-preview and an explicit opt-in smoke before handoff`)
      else warnings.push(`${message}; fake/default adapter does not require real smoke`)
      return evidence({
        evidence_id: "process_smoke:none",
        kind: "process_smoke",
        status: "missing",
        fresh: false,
        summary_preview: message,
        blockers,
        warnings,
      })
    }
    const ageMs = age(this.now(), latest.completed_at)
    const fresh = latest.status === "succeeded" && ageMs !== undefined && ageMs <= maxAgeMs
    if (latest.status !== "succeeded") {
      const message = `latest OpenCode smoke is ${latest.status}`
      if (requireRecentSmoke) blockers.push(message)
      else warnings.push(message)
    } else if (!fresh) {
      const message = "latest OpenCode smoke is stale"
      if (requireRecentSmoke) blockers.push(message)
      else warnings.push(message)
    }
    return evidence({
      evidence_id: `process_smoke:${latest.smoke_id}`,
      kind: "process_smoke",
      related_id: latest.smoke_id,
      status: latest.status,
      fresh,
      completed_at: latest.completed_at,
      age_ms: ageMs,
      summary_preview: latest.summary_preview,
      blockers,
      warnings,
    })
  }

  private async targetProposalEvidence(proposalId: string): Promise<{ evidence: OpenCodeHandoffReadinessEvidence; summary: string }> {
    try {
      const preview = await this.previewHandoff({ proposal_id: proposalId, requested_by: "readiness" })
      const summary = preview.eligible ? `handoff preview eligible for proposal ${preview.proposal_id}` : `handoff preview blocked for proposal ${preview.proposal_id}`
      return {
        summary: bound(summary),
        evidence: evidence({
          evidence_id: `handoff_preview:${preview.proposal_id}`,
          kind: "handoff_preview",
          related_id: preview.proposal_id,
          status: preview.eligible ? "eligible" : "blocked",
          fresh: true,
          summary_preview: preview.objective_preview || summary,
          blockers: preview.eligible ? [] : preview.blockers,
          warnings: preview.would_send_to_adapter ? ["handoff preview would send to adapter if executed; readiness does not execute it"] : [],
        }),
      }
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : String(error))
      return {
        summary: message,
        evidence: evidence({
          evidence_id: `handoff_preview:${proposalId}`,
          kind: "handoff_preview",
          related_id: proposalId,
          status: "blocked",
          fresh: false,
          summary_preview: message,
          blockers: [message],
        }),
      }
    }
  }

  private async targetHandoffEvidence(handoffId: string): Promise<OpenCodeHandoffReadinessEvidence> {
    const handoff = await this.getHandoff(handoffId)
    if (!handoff) {
      return evidence({
        evidence_id: `handoff:${handoffId}`,
        kind: "handoff_followup",
        related_id: handoffId,
        status: "missing",
        fresh: false,
        summary_preview: `handoff not found: ${handoffId}`,
        warnings: ["handoff id was not found in recorded handoff results"],
      })
    }
    return evidence({
      evidence_id: `handoff:${handoff.handoff_id}`,
      kind: "handoff_followup",
      related_id: handoff.handoff_id,
      status: handoff.sent ? "sent" : "not_sent",
      fresh: true,
      completed_at: handoff.created_at,
      summary_preview: `handoff ${handoff.handoff_id} proposal=${handoff.proposal_id} sent=${handoff.sent}`,
    })
  }

  private async followupEvidence(): Promise<OpenCodeHandoffReadinessEvidence> {
    const summary = await this.followupSummary()
    const warnings: string[] = []
    if (summary.failed_count > 0) warnings.push(`recent OpenCode handoff follow-up has failed_count=${summary.failed_count}`)
    if (summary.blocked_count > 0) warnings.push(`recent OpenCode handoff follow-up has blocked_count=${summary.blocked_count}`)
    return evidence({
      evidence_id: "handoff_followup:summary",
      kind: "handoff_followup",
      related_id: summary.last_handoff_id,
      status: summary.failed_count > 0 || summary.blocked_count > 0 ? "attention" : "ok",
      fresh: true,
      summary_preview: `sent=${summary.sent_count} running=${summary.running_count} results=${summary.result_submitted_count} completed=${summary.completed_count} failed=${summary.failed_count} blocked=${summary.blocked_count}`,
      warnings,
    })
  }
}

export function readOpenCodeHandoffReadinessInput(input: Record<string, unknown> = {}): OpenCodeHandoffReadinessInput {
  return normalizeInput(input)
}

function normalizeInput(input: Record<string, unknown> = {}): OpenCodeHandoffReadinessInput {
  return {
    proposal_id: optionalString(input.proposal_id ?? input.proposalId, "proposal_id"),
    review_id: optionalString(input.review_id ?? input.reviewId, "review_id"),
    mission_id: optionalString(input.mission_id ?? input.missionId, "mission_id"),
    handoff_id: optionalString(input.handoff_id ?? input.handoffId, "handoff_id"),
    command: optionalCommand(input.command),
    require_recent_smoke: optionalBoolean(input.require_recent_smoke ?? input.requireRecentSmoke, "require_recent_smoke"),
    max_smoke_age_ms: optionalAge(input.max_smoke_age_ms ?? input.maxSmokeAgeMs),
    include_authority: optionalBoolean(input.include_authority ?? input.includeAuthority, "include_authority"),
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return redactText(value.trim()).slice(0, MAX_TEXT)
}

function optionalCommand(value: unknown): string | undefined {
  const command = optionalString(value, "command")
  if (command === undefined) return undefined
  if (!command.startsWith("/")) throw new Error("command must be a slash command")
  return command
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`)
  return value
}

function optionalAge(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("max_smoke_age_ms must be a positive integer")
  return Math.min(Number(value), MAX_SMOKE_AGE_MS)
}

function evidence(input: Omit<OpenCodeHandoffReadinessEvidence, "blockers" | "warnings" | "summary_preview"> & { summary_preview: string; blockers?: string[]; warnings?: string[] }): OpenCodeHandoffReadinessEvidence {
  return {
    ...input,
    evidence_id: redactText(input.evidence_id).slice(0, MAX_TEXT),
    related_id: input.related_id ? redactText(input.related_id).slice(0, MAX_TEXT) : undefined,
    status: redactText(input.status).slice(0, MAX_TEXT),
    summary_preview: bound(input.summary_preview),
    blockers: boundList(input.blockers ?? []),
    warnings: boundList(input.warnings ?? []),
  }
}

function targetEvidence(kind: "proposal" | "review" | "mission", id: string, command: string): OpenCodeHandoffReadinessEvidence {
  return evidence({
    evidence_id: `${kind}:${id}`,
    kind,
    related_id: id,
    status: "target_supplied",
    fresh: false,
    summary_preview: `${kind} target supplied; use ${command} for detailed inspection`,
    warnings: [`${kind} target was not mutated or verified by readiness preview`],
  })
}

function recommendedCommands(input: OpenCodeHandoffReadinessInput, status: OpenCodeHandoffReadinessStatus): OpenCodeHandoffReadinessCommand[] {
  const commands: OpenCodeHandoffReadinessCommand[] = [
    { label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" },
    { label: "Preview OpenCode smoke", command: "/opencode-smoke-preview", command_type: "read" },
    { label: "Dry-run OpenCode smoke", command: "/opencode-smoke-dry-run", command_type: "read" },
    { label: "List OpenCode smokes", command: "/opencode-smokes", command_type: "read" },
    { label: "Show handoff follow-ups", command: "/handoff-followups", command_type: "read" },
    { label: "Summarize handoff follow-ups", command: "/handoff-followup-summary", command_type: "read" },
  ]
  if (input.proposal_id) commands.push({ label: "Preview handoff", command: `/handoff-preview ${input.proposal_id}`, command_type: "read" })
  if (input.review_id) commands.push({ label: "Show review", command: `/review ${input.review_id}`, command_type: "read" })
  if (input.mission_id) commands.push({ label: "Show mission", command: `/mission ${input.mission_id}`, command_type: "read" })
  if (input.handoff_id) commands.push({ label: "Show handoff", command: `/handoff-show ${input.handoff_id}`, command_type: "read" })
  if (status === "ready" && input.proposal_id) commands.push({ label: "Execute handoff explicitly", command: `/handoff ${input.proposal_id}`, command_type: "write", requires_active_runtime: true, notes: "High-impact handoff remains explicit; readiness does not execute it." })
  return commands.slice(0, MAX_COMMANDS).map((command) => ({
    label: bound(command.label),
    command: bound(command.command),
    command_type: command.command_type,
    requires_active_runtime: command.requires_active_runtime,
    notes: command.notes ? bound(command.notes) : undefined,
  }))
}

function readinessStatus(blockers: string[], required: OpenCodeHandoffReadinessEvidence[], input: OpenCodeHandoffReadinessInput, requireRecentSmoke: boolean): OpenCodeHandoffReadinessStatus {
  if (blockers.length === 0) return "ready"
  const smoke = required.find((item) => item.kind === "process_smoke")
  if (requireRecentSmoke && smoke && smoke.blockers.length > 0) return smoke.status === "missing" ? "needs_smoke" : "blocked"
  if (input.proposal_id && required.some((item) => item.kind === "handoff_preview" && item.blockers.length > 0)) return "needs_review"
  return "blocked"
}

function summaryPreview(status: OpenCodeHandoffReadinessStatus, blockers: string[], warnings: string[], latestSmoke?: OpenCodeProcessSmokeRecord): string {
  if (status === "ready") return bound(`handoff readiness is ready; latest_smoke=${latestSmoke?.status ?? "none"}; execution remains explicit`)
  const issue = blockers[0] ?? warnings[0] ?? "readiness unknown"
  return bound(`handoff readiness ${status}: ${issue}`)
}

function readinessId(input: OpenCodeHandoffReadinessInput, generatedAt: string): string {
  const target = input.proposal_id ?? input.review_id ?? input.mission_id ?? input.handoff_id ?? "general"
  return `handoff_readiness_${redactText(target).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "general"}_${Date.parse(generatedAt).toString(36)}`
}

function age(now: Date, completedAt: string): number | undefined {
  const completedMs = Date.parse(completedAt)
  if (!Number.isFinite(completedMs)) return undefined
  return Math.max(0, now.getTime() - completedMs)
}

function bound(value: string): string {
  const safe = redactText(value)
  return safe.length > MAX_TEXT ? `${safe.slice(0, MAX_TEXT - 3)}...` : safe
}

function boundList(values: string[]): string[] {
  return values.map(bound).slice(0, 10)
}
