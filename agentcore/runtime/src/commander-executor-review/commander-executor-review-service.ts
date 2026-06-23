import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { CommandAuthorityService } from "../authority/command-authority-service"
import type { OpenCodeResultReviewPacket, OpenCodeResultReviewPacketInput } from "../opencode/opencode-result-review-packet-types"
import type { OpenCodeResultReviewPacketService } from "../opencode/opencode-result-review-packet-service"
import { redactText, redactValue } from "../security/redaction"
import { FakeCommanderExecutorReviewProvider, type CommanderExecutorReviewProvider, type CommanderExecutorReviewProviderResult } from "./commander-executor-review-provider"
import type {
  CommanderExecutorReviewCommand,
  CommanderExecutorReviewFinding,
  CommanderExecutorReviewInput,
  CommanderExecutorReviewPreview,
  CommanderExecutorReviewRecord,
  CommanderExecutorReviewResult,
} from "./commander-executor-review-types"

const MAX_TEXT = 240
const MAX_PROMPT = 1800
const MAX_ROWS = 12
const MAX_OUTPUT_CHARS = 4000
const INSTRUCTION_VERSION = "commander-executor-review.v1"

export type CommanderExecutorReviewServiceOptions = {
  eventStore: EventStore
  packetService: OpenCodeResultReviewPacketService
  authorityService?: CommandAuthorityService
  provider?: CommanderExecutorReviewProvider
  now?: () => Date
  reviewId?: () => string
}

export class CommanderExecutorReviewService {
  private readonly provider: CommanderExecutorReviewProvider
  private readonly now: () => Date
  private readonly reviewId: () => string
  private readonly authorityService: CommandAuthorityService

  constructor(private readonly options: CommanderExecutorReviewServiceOptions) {
    this.provider = options.provider ?? new FakeCommanderExecutorReviewProvider()
    this.now = options.now ?? (() => new Date())
    this.reviewId = options.reviewId ?? (() => `executor_review_${randomUUID()}`)
    this.authorityService = options.authorityService ?? new CommandAuthorityService(() => this.now().toISOString())
  }

  async preview(input: CommanderExecutorReviewInput = {}): Promise<CommanderExecutorReviewPreview> {
    const packet = await this.packet(input)
    const providerReadiness = this.providerReadiness()
    const blockers = [
      ...(packet.status === "ready_for_commander_review" ? [] : [`result review packet is ${packet.status}; Commander review requires ready_for_commander_review`]),
      ...providerReadiness.blockers,
    ]
    const warnings = [
      ...packet.warnings,
      ...providerReadiness.warnings,
      "executor review does not create proposals, apply changes, or launch OpenCode",
    ]
    const generatedAt = this.now().toISOString()
    return redactValue({
      review_id: blockers.length === 0 ? this.reviewId() : undefined,
      packet_id: packet.packet_id,
      packet_status: packet.status,
      can_execute: blockers.length === 0,
      provider_kind: this.provider.provider_id,
      provider_ready: providerReadiness.provider_ready,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      packet_summary_preview: bound(packet.redacted_summary_preview || packet.title),
      prompt_preview: buildPrompt(packet),
      recommended_commands: recommendedCommands(packet),
      generated_at: generatedAt,
    })
  }

  async execute(input: CommanderExecutorReviewInput = {}): Promise<CommanderExecutorReviewResult> {
    const startedAt = this.now().toISOString()
    const packet = await this.packet(input)
    const requestedBy = bound(input.requested_by ?? "operator")
    const providerReadiness = this.providerReadiness()
    if (input.dry_run === true) {
      const readinessBlocker = providerReadiness.provider_ready ? null : (providerReadiness.blockers[0] ?? "Commander executor review provider is not ready")
      return this.result({
        reviewId: "dry-run",
        packet,
        status: "blocked",
        decision: readinessBlocker ? "blocked" : "inconclusive",
        confidence: 0,
        summary: readinessBlocker
          ? `dry-run: provider is not ready: ${readinessBlocker}`
          : packet.status === "ready_for_commander_review"
          ? "dry-run: Commander executor review would call the provider once"
          : `dry-run: packet is ${packet.status} and would block provider review`,
        findings: [],
        recommended: recommendedCommands(packet),
        requestedBy,
        startedAt,
        completedAt: this.now().toISOString(),
      })
    }
    const reviewId = this.reviewId()
    if (!providerReadiness.provider_ready) {
      const blocked = this.result({
        reviewId,
        packet,
        status: "blocked",
        decision: "blocked",
        confidence: 0,
        summary: "Commander executor review blocked because provider is not ready",
        findings: [{
          finding_id: "finding_provider_not_ready",
          severity: "blocker",
          title: "Provider is not ready",
          summary: providerReadiness.blockers[0] ?? "Commander executor review provider is not ready.",
          evidence_ids: packet.evidence.map((item) => item.evidence_id).slice(0, MAX_ROWS),
          recommended_commands: recommendedCommands(packet).slice(0, 3),
        }],
        recommended: recommendedCommands(packet),
        requestedBy,
        startedAt,
        completedAt: this.now().toISOString(),
      })
      await this.write("commander_executor_review_blocked", blocked)
      return blocked
    }
    if (packet.status !== "ready_for_commander_review") {
      const blocked = this.result({
        reviewId,
        packet,
        status: "blocked",
        decision: "blocked",
        confidence: 0,
        summary: `Commander executor review blocked because packet is ${packet.status}`,
        findings: [{
          finding_id: "finding_packet_not_ready",
          severity: "blocker",
          title: "Packet is not ready",
          summary: `Packet status ${packet.status} is not ready_for_commander_review.`,
          evidence_ids: packet.evidence.map((item) => item.evidence_id).slice(0, MAX_ROWS),
          recommended_commands: recommendedCommands(packet).slice(0, 3),
        }],
        recommended: recommendedCommands(packet),
        requestedBy,
        startedAt,
        completedAt: this.now().toISOString(),
      })
      await this.write("commander_executor_review_blocked", blocked)
      return blocked
    }
    await this.options.eventStore.append({
      kind: "commander_executor_review_started",
      review_id: reviewId,
      packet_id: packet.packet_id,
      packet_status: packet.status,
      provider_kind: this.provider.provider_id,
      requested_by: requestedBy,
      started_at: startedAt,
    })
    try {
      const providerResult = cleanProviderResult(await this.provider.reviewExecutorResult({
        packet: boundedPacket(packet),
        authority_summary: this.authorityService.summary(),
        max_output_chars: MAX_OUTPUT_CHARS,
        instruction_version: INSTRUCTION_VERSION,
      }), packet, this.authorityService)
      const result = this.result({
        reviewId,
        packet,
        status: "succeeded",
        decision: providerResult.decision,
        confidence: providerResult.confidence,
        summary: providerResult.summary,
        findings: providerResult.findings,
        recommended: providerResult.recommended_commands ?? recommendedCommands(packet),
        requestedBy,
        startedAt,
        completedAt: this.now().toISOString(),
      })
      await this.write("commander_executor_review_succeeded", result)
      return result
    } catch (error) {
      const result = this.result({
        reviewId,
        packet,
        status: "failed",
        decision: "inconclusive",
        confidence: 0,
        summary: "Commander executor review provider failed",
        findings: [],
        recommended: recommendedCommands(packet),
        requestedBy,
        startedAt,
        completedAt: this.now().toISOString(),
        error: errorMessage(error),
      })
      await this.write("commander_executor_review_failed", result)
      return result
    }
  }

  async list(input: { limit?: number; packet_id?: string; mission_id?: string; handoff_id?: string } = {}): Promise<CommanderExecutorReviewRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    return (await this.terminalEvents())
      .filter((event) => !input.packet_id || event.packet_id === input.packet_id)
      .filter((event) => !input.mission_id || event.mission_id === input.mission_id)
      .filter((event) => !input.handoff_id || event.handoff_id === input.handoff_id)
      .reverse()
      .slice(0, limit)
      .map(recordFromEvent)
  }

  async get(reviewId: string): Promise<CommanderExecutorReviewResult | null> {
    const id = requiredString(reviewId, "review_id")
    const event = (await this.terminalEvents()).reverse().find((item) => item.review_id === id)
    return event ? resultFromEvent(event) : null
  }

  private async packet(input: CommanderExecutorReviewInput): Promise<OpenCodeResultReviewPacket> {
    const packetInput: OpenCodeResultReviewPacketInput = {
      handoff_id: optional(input.handoff_id),
      followup_id: optional(input.followup_id),
      mission_id: optional(input.mission_id),
      result_id: optional(input.result_id),
      proposal_id: optional(input.proposal_id),
      stale_after_ms: input.max_packet_age_ms,
      include_authority: input.include_authority !== false,
      include_readiness: true,
    }
    return this.options.packetService.preview(packetInput)
  }

  private result(input: {
    reviewId: string
    packet: OpenCodeResultReviewPacket
    status: "succeeded" | "failed" | "blocked"
    decision: CommanderExecutorReviewResult["decision"]
    confidence: number
    summary: string
    findings: CommanderExecutorReviewFinding[]
    recommended: CommanderExecutorReviewCommand[]
    requestedBy: string
    startedAt: string
    completedAt: string
    error?: string
  }): CommanderExecutorReviewResult {
    const result = {
      review_id: input.reviewId,
      packet_id: input.packet.packet_id,
      packet_status: input.packet.status,
      status: input.status,
      provider_kind: this.provider.provider_id,
      decision: input.decision,
      confidence: clampConfidence(input.confidence),
      summary: bound(input.summary),
      findings: input.findings.slice(0, MAX_ROWS).map((finding) => cleanFinding(finding)),
      evidence_ids: input.packet.evidence.map((item) => bound(item.evidence_id)).slice(0, MAX_ROWS),
      recommended_commands: input.recommended.slice(0, MAX_ROWS).map(cleanCommand),
      error: input.error ? bound(input.error) : undefined,
      started_at: input.startedAt,
      completed_at: input.completedAt,
      requested_by: input.requestedBy,
      handoff_id: input.packet.handoff_id,
      mission_id: input.packet.mission_id,
      result_id: input.packet.result_id,
      proposal_id: input.packet.proposal_id,
    }
    return redactValue({ ...result, review_hash: sha256(stableJson(result)) })
  }

  private async write(kind: string, result: CommanderExecutorReviewResult): Promise<void> {
    await this.options.eventStore.append({ kind, ...result })
  }

  private async terminalEvents(): Promise<JsonlEvent[]> {
    return (await this.options.eventStore.readAll()).filter((event) =>
      event.kind === "commander_executor_review_succeeded"
      || event.kind === "commander_executor_review_failed"
      || event.kind === "commander_executor_review_blocked",
    )
  }

  private providerReadiness(): { provider_ready: boolean; blockers: string[]; warnings: string[] } {
    return this.provider.previewExecutorReviewReadiness?.() ?? { provider_ready: true, blockers: [], warnings: [] }
  }
}

export function readCommanderExecutorReviewInput(value: unknown): CommanderExecutorReviewInput {
  if (!isRecord(value)) return {}
  if (value.packet_id !== undefined || value.packetId !== undefined) {
    throw new Error("executor review packet_id is not supported; pass handoff_id, followup_id, mission_id, result_id, or proposal_id")
  }
  return {
    handoff_id: optional(value.handoff_id ?? value.handoffId),
    followup_id: optional(value.followup_id ?? value.followupId),
    mission_id: optional(value.mission_id ?? value.missionId),
    result_id: optional(value.result_id ?? value.resultId),
    proposal_id: optional(value.proposal_id ?? value.proposalId),
    requested_by: optional(value.requested_by ?? value.requestedBy),
    dry_run: value.dry_run === true || value.dryRun === true,
    max_packet_age_ms: optionalNumber(value.max_packet_age_ms ?? value.maxPacketAgeMs),
    include_authority: value.include_authority === false || value.includeAuthority === false ? false : undefined,
  }
}

function recommendedCommands(packet: OpenCodeResultReviewPacket): CommanderExecutorReviewCommand[] {
  return [
    { label: "Inspect result review packet", command: packet.result_id ? `/result-review-packet result=${packet.result_id}` : "/result-review-packet", command_type: "read" as const },
    { label: "Inspect handoff readiness", command: packet.handoff_id ? `/handoff-readiness handoff=${packet.handoff_id}` : "/handoff-readiness", command_type: "read" as const },
    { label: "Show executor review records", command: "/executor-reviews", command_type: "read" as const },
    ...packet.recommended_commands.filter((command) => command.command_type === "read").slice(0, 6),
  ].map(cleanCommand).slice(0, MAX_ROWS)
}

function buildPrompt(packet: OpenCodeResultReviewPacket): string {
  return bound([
    `Review packet ${packet.packet_id}`,
    `status=${packet.status}`,
    packet.objective_preview ? `objective=${packet.objective_preview}` : "",
    packet.result_summary_preview ? `result=${packet.result_summary_preview}` : "",
    `evidence=${packet.evidence.map((item) => `${item.kind}:${item.status}:${item.summary_preview}`).join(" | ")}`,
    `blockers=${packet.blockers.join("; ")}`,
    `warnings=${packet.warnings.join("; ")}`,
    "Return only a bounded review decision, findings, risks, and manual inspection commands. Do not create proposals or run commands.",
  ].filter(Boolean).join("\n"), MAX_PROMPT)
}

function boundedPacket(packet: OpenCodeResultReviewPacket): OpenCodeResultReviewPacket {
  return redactValue({
    ...packet,
    title: bound(packet.title),
    objective_preview: packet.objective_preview ? bound(packet.objective_preview) : undefined,
    executor_summary_preview: packet.executor_summary_preview ? bound(packet.executor_summary_preview) : undefined,
    result_summary_preview: packet.result_summary_preview ? bound(packet.result_summary_preview) : undefined,
    artifact_previews: boundList(packet.artifact_previews),
    evidence: packet.evidence.slice(0, MAX_ROWS).map((item) => ({
      ...item,
      summary_preview: bound(item.summary_preview),
      blockers: boundList(item.blockers),
      warnings: boundList(item.warnings),
    })),
    blockers: boundList(packet.blockers),
    warnings: boundList(packet.warnings),
    recommended_commands: packet.recommended_commands.slice(0, MAX_ROWS).map(cleanCommand),
    redacted_summary_preview: bound(packet.redacted_summary_preview),
  })
}

function cleanProviderResult(value: CommanderExecutorReviewProviderResult, packet: OpenCodeResultReviewPacket, authorityService: CommandAuthorityService): CommanderExecutorReviewProviderResult {
  const decisions = new Set(["accept_result", "needs_followup", "needs_human_review", "blocked", "inconclusive"])
  if (!decisions.has(value.decision)) throw new Error("provider returned invalid review decision")
  const allowedEvidenceIds = new Set(packet.evidence.map((item) => item.evidence_id))
  return {
    decision: value.decision,
    confidence: clampConfidence(value.confidence),
    summary: bound(requiredString(value.summary, "summary")),
    findings: Array.isArray(value.findings) ? value.findings.slice(0, MAX_ROWS).map((finding) => cleanFinding(finding, allowedEvidenceIds, authorityService)) : [],
    recommended_commands: Array.isArray(value.recommended_commands) ? value.recommended_commands.slice(0, MAX_ROWS).map((command) => cleanProviderCommand(command, authorityService)) : undefined,
    raw_response_preview: value.raw_response_preview ? bound(value.raw_response_preview) : undefined,
  }
}

function cleanFinding(value: CommanderExecutorReviewFinding, allowedEvidenceIds?: Set<string>, authorityService?: CommandAuthorityService): CommanderExecutorReviewFinding {
  const severities = new Set(["info", "warning", "risk", "blocker"])
  const evidenceIds = boundList(value.evidence_ids)
  if (allowedEvidenceIds) {
    for (const evidenceId of evidenceIds) {
      if (!allowedEvidenceIds.has(evidenceId)) throw new Error("provider cited unknown packet evidence id")
    }
  }
  return {
    finding_id: bound(requiredString(value.finding_id, "finding_id")),
    severity: severities.has(value.severity) ? value.severity : "warning",
    title: bound(requiredString(value.title, "title")),
    summary: bound(requiredString(value.summary, "summary")),
    evidence_ids: evidenceIds,
    recommended_commands: Array.isArray(value.recommended_commands) ? value.recommended_commands.slice(0, MAX_ROWS).map((command) => authorityService ? cleanProviderCommand(command, authorityService) : cleanCommand(command)) : [],
  }
}

function cleanProviderCommand(value: CommanderExecutorReviewCommand, authorityService: CommandAuthorityService): CommanderExecutorReviewCommand {
  if (value.command_type !== "read") throw new Error("provider recommended non-read command")
  const record = authorityService.get(value.command)
  if (record.risk !== "safe_read" || record.mutates_events || record.creates_external_process || record.calls_provider || record.blocked_by_default) {
    throw new Error("provider recommended command without safe read authority")
  }
  return cleanCommand(value)
}

function cleanCommand(value: CommanderExecutorReviewCommand): CommanderExecutorReviewCommand {
  return {
    label: bound(requiredString(value.label, "label")),
    command: bound(requiredString(value.command, "command")),
    command_type: value.command_type === "write" ? "write" : "read",
    requires_active_runtime: value.requires_active_runtime === true,
    notes: value.notes ? bound(value.notes) : undefined,
  }
}

function recordFromEvent(event: JsonlEvent): CommanderExecutorReviewRecord {
  return redactValue({
    review_id: String(event.review_id ?? ""),
    packet_id: String(event.packet_id ?? ""),
    status: event.status === "succeeded" || event.status === "failed" || event.status === "blocked" ? event.status : "blocked",
    decision: readDecision(event.decision),
    confidence: typeof event.confidence === "number" ? event.confidence : 0,
    completed_at: String(event.completed_at ?? event.timestamp ?? ""),
    summary_preview: bound(String(event.summary ?? event.error ?? "")),
    review_hash: String(event.review_hash ?? ""),
    handoff_id: optional(event.handoff_id),
    mission_id: optional(event.mission_id),
    result_id: optional(event.result_id),
  })
}

function resultFromEvent(event: JsonlEvent): CommanderExecutorReviewResult {
  return redactValue({
    review_id: String(event.review_id ?? ""),
    packet_id: String(event.packet_id ?? ""),
    packet_status: String(event.packet_status ?? "unknown"),
    status: event.status === "succeeded" || event.status === "failed" || event.status === "blocked" ? event.status : "blocked",
    provider_kind: String(event.provider_kind ?? ""),
    decision: readDecision(event.decision),
    confidence: typeof event.confidence === "number" ? event.confidence : 0,
    summary: String(event.summary ?? ""),
    findings: Array.isArray(event.findings) ? event.findings : [],
    evidence_ids: Array.isArray(event.evidence_ids) ? event.evidence_ids.map(String).slice(0, MAX_ROWS) : [],
    recommended_commands: Array.isArray(event.recommended_commands) ? event.recommended_commands : [],
    error: optional(event.error),
    started_at: String(event.started_at ?? event.timestamp ?? ""),
    completed_at: String(event.completed_at ?? event.timestamp ?? ""),
    requested_by: String(event.requested_by ?? "operator"),
    review_hash: String(event.review_hash ?? ""),
    handoff_id: optional(event.handoff_id),
    mission_id: optional(event.mission_id),
    result_id: optional(event.result_id),
    proposal_id: optional(event.proposal_id),
  }) as CommanderExecutorReviewResult
}

function readDecision(value: unknown): CommanderExecutorReviewResult["decision"] {
  if (value === "accept_result" || value === "needs_followup" || value === "needs_human_review" || value === "blocked" || value === "inconclusive") return value
  return "inconclusive"
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required`)
  return redactText(value.trim())
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? redactText(trimmed) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function bound(value: string, limit = MAX_TEXT): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, limit)
}

function boundList(value: unknown, limit = MAX_ROWS): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => bound(item)).filter(Boolean).slice(0, limit) : []
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? bound(error.message) : bound(String(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (!isRecord(value)) return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
