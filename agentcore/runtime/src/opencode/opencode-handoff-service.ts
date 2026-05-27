import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { CommanderProposal } from "../missions/proposal-types"
import type { ReviewRegistry } from "../missions/review-registry"
import type { ReviewRequest } from "../missions/review-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeHandoffInput, OpenCodeHandoffPayload, OpenCodeHandoffPreview, OpenCodeHandoffRecord, OpenCodeHandoffResult } from "./opencode-handoff-types"

const MAX_TEXT = 2000
const MAX_PREVIEW = 160
const MAX_ARRAY_ITEMS = 20
const MAX_ARRAY_TEXT = 300

type HandoffEvent =
  | {
      kind: "opencode_handoff_started"
      handoff_id: string
      proposal_id: string
      review_id?: string
      objective_preview: string
      started_at: string
      requested_by: string
      source_cycle_id?: string
      source_synthesis_id?: string
      evidence_ids: string[]
    }
  | { kind: "opencode_handoff_created"; handoff: OpenCodeHandoffResult }
  | {
      kind: "opencode_handoff_failed"
      handoff_id: string
      proposal_id: string
      review_id?: string
      mission_id?: string
      intent_id?: string
      failure_reason: string
      failed_at: string
      requested_by: string
    }

export interface OpenCodeHandoffServiceOptions {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  reviewRegistry: ReviewRegistry
  sendMission: (objective: string) => Promise<{ mission_id: string; intent_id: string }>
  idFactory?: (prefix: "handoff") => string
  now?: () => Date
}

export class OpenCodeHandoffService {
  private readonly eventStore: EventStore
  private readonly proposalRegistry: ProposalRegistry
  private readonly reviewRegistry: ReviewRegistry
  private readonly sendMission: OpenCodeHandoffServiceOptions["sendMission"]
  private readonly idFactory: (prefix: "handoff") => string
  private readonly now: () => Date
  private generatedIds = 0

  constructor(options: OpenCodeHandoffServiceOptions) {
    this.eventStore = options.eventStore
    this.proposalRegistry = options.proposalRegistry
    this.reviewRegistry = options.reviewRegistry
    this.sendMission = options.sendMission
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: OpenCodeHandoffInput): Promise<OpenCodeHandoffPreview> {
    const normalized = normalizeInput(input)
    const proposal = await this.proposalRegistry.getProposal(normalized.proposal_id)
    if (!proposal) {
      return redactedPreview({
        proposal_id: normalized.proposal_id,
        eligible: false,
        blockers: [`commander proposal not found: ${normalized.proposal_id}`],
        action_kind: "missing",
        proposal_status: "missing",
        objective_preview: "",
        evidence_ids: [],
        would_create_mission: false,
        would_send_to_adapter: false,
      })
    }
    return redactedPreview(await this.previewForProposal(proposal))
  }

  async execute(input: OpenCodeHandoffInput): Promise<OpenCodeHandoffResult> {
    const normalized = normalizeInput(input)
    const proposal = await this.proposalRegistry.getProposal(normalized.proposal_id)
    if (!proposal) throw new Error(`commander proposal not found: ${redactText(normalized.proposal_id)}`)
    const existing = await this.existingResultForProposal(proposal.proposal_id)
    if (existing && normalized.dry_run !== true) {
      const missionId = cleanRequiredString(existing.mission_id, "mission_id")
      await this.proposalRegistry.markProposalApplied(proposal.proposal_id, `opencode_handoff:${existing.handoff_id}:mission:${missionId}`)
      return redactValue(existing)
    }
    const incompleteStarted = normalized.dry_run === true ? null : await this.incompleteStartedForProposal(proposal.proposal_id)
    if (incompleteStarted) {
      throw new Error(`opencode handoff already started without completion record: ${redactText(incompleteStarted.handoff_id)}`)
    }

    const preview = await this.previewForProposal(proposal)
    if (!preview.eligible) throw new Error(`opencode handoff is not eligible: ${preview.blockers.join("; ")}`)
    const payload = readHandoffPayload(proposal)
    const requestedBy = redactText(normalized.requested_by ?? "operator")
    const createdAt = this.now().toISOString()

    if (normalized.dry_run === true) {
      return redactValue({
        handoff_id: "dry-run",
        proposal_id: proposal.proposal_id,
        review_id: proposal.review_id,
        objective_preview: previewText(payload.objective),
        sent: false,
        dry_run: true,
        created_at: createdAt,
        requested_by: requestedBy,
        source_cycle_id: payload.source_cycle_id,
        source_synthesis_id: payload.source_synthesis_id,
        evidence_ids: payload.evidence_ids,
      })
    }

    const handoffId = this.idFactory("handoff")
    await this.appendAndApply({
      kind: "opencode_handoff_started",
      handoff_id: handoffId,
      proposal_id: proposal.proposal_id,
      review_id: proposal.review_id,
      objective_preview: previewText(payload.objective),
      started_at: createdAt,
      requested_by: requestedBy,
      source_cycle_id: payload.source_cycle_id,
      source_synthesis_id: payload.source_synthesis_id,
      evidence_ids: payload.evidence_ids,
    })
    let mission: { mission_id: string; intent_id: string } | null = null
    try {
      mission = await this.sendMission(buildMissionObjective(payload))
    } catch (error) {
      const failureReason = redactText(error instanceof Error ? error.message : String(error))
      await this.appendAndApply({
        kind: "opencode_handoff_failed",
        handoff_id: handoffId,
        proposal_id: proposal.proposal_id,
        review_id: proposal.review_id,
        failure_reason: failureReason,
        failed_at: this.now().toISOString(),
        requested_by: requestedBy,
      })
      throw new Error(`opencode handoff failed: ${failureReason}`)
    }

    const result: OpenCodeHandoffResult = {
      handoff_id: handoffId,
      proposal_id: proposal.proposal_id,
      review_id: proposal.review_id,
      mission_id: mission.mission_id,
      intent_id: mission.intent_id,
      objective_preview: previewText(payload.objective),
      sent: true,
      dry_run: false,
      created_at: createdAt,
      requested_by: requestedBy,
      source_cycle_id: payload.source_cycle_id,
      source_synthesis_id: payload.source_synthesis_id,
      evidence_ids: payload.evidence_ids,
    }
    await this.appendAndApply({ kind: "opencode_handoff_created", handoff: result })
    await this.proposalRegistry.markProposalApplied(proposal.proposal_id, `opencode_handoff:${handoffId}:mission:${mission.mission_id}`)
    return redactValue(result)
  }

  async get(handoffId: string): Promise<OpenCodeHandoffResult | null> {
    const id = cleanRequiredString(handoffId, "handoff_id")
    return redactValue((await this.results()).find((item) => item.handoff_id === id) ?? null)
  }

  async list(limit = 20): Promise<OpenCodeHandoffRecord[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("handoff list limit must be a positive integer")
    return redactValue((await this.results()).slice().reverse().slice(0, Math.min(limit, 100)).map(recordFromResult))
  }

  private async previewForProposal(proposal: CommanderProposal): Promise<OpenCodeHandoffPreview> {
    const blockers: string[] = []
    const review = proposal.review_id ? await this.reviewRegistry.getReviewRequest(proposal.review_id) : null
    let payload: OpenCodeHandoffPayload | null = null
    try {
      payload = readHandoffPayload(proposal)
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error))
    }
    if (proposal.action_kind !== "opencode_handoff") blockers.push("proposal action_kind must be opencode_handoff")
    if (!proposal.review_id) blockers.push("proposal requires linked review")
    if (proposal.review_id && !review) blockers.push("linked review not found")
    if (review && review.status !== "approved") blockers.push("linked review must be approved")
    if (proposal.status !== "approved" && proposal.status !== "applied") blockers.push("proposal must be approved before handoff")
    if (proposal.status === "applied" && !(await this.existingResultForProposal(proposal.proposal_id))) blockers.push("proposal is applied without recorded opencode handoff")
    const incompleteStarted = await this.incompleteStartedForProposal(proposal.proposal_id)
    if (incompleteStarted) blockers.push(`opencode handoff already started without completion record: ${incompleteStarted.handoff_id}`)
    return {
      proposal_id: proposal.proposal_id,
      eligible: blockers.length === 0,
      blockers: blockers.map((item) => redactText(item)),
      action_kind: proposal.action_kind,
      proposal_status: proposal.status,
      review_id: proposal.review_id,
      review_status: review?.status,
      objective_preview: payload ? previewText(payload.objective) : "",
      evidence_ids: payload?.evidence_ids ?? [],
      source_cycle_id: payload?.source_cycle_id,
      source_synthesis_id: payload?.source_synthesis_id,
      would_create_mission: blockers.length === 0 && proposal.status !== "applied",
      would_send_to_adapter: blockers.length === 0 && proposal.status !== "applied",
    }
  }

  private async existingResultForProposal(proposalId: string): Promise<OpenCodeHandoffResult | null> {
    return (await this.results()).find((item) => item.proposal_id === proposalId && item.sent) ?? null
  }

  private async incompleteStartedForProposal(proposalId: string): Promise<{ handoff_id: string } | null> {
    const terminals = new Set<string>()
    const started: Array<{ handoff_id: string; proposal_id: string }> = []
    for (const event of await this.eventStore.readAll()) {
      if (event.kind === "opencode_handoff_started") {
        started.push({
          handoff_id: cleanRequiredString(event.handoff_id, "handoff_id"),
          proposal_id: cleanRequiredString(event.proposal_id, "proposal_id"),
        })
      } else if (event.kind === "opencode_handoff_created" && isRecord(event.handoff)) {
        terminals.add(cleanRequiredString(event.handoff.handoff_id, "handoff_id"))
      } else if (event.kind === "opencode_handoff_failed") {
        terminals.add(cleanRequiredString(event.handoff_id, "handoff_id"))
      }
    }
    return started.find((item) => item.proposal_id === proposalId && !terminals.has(item.handoff_id)) ?? null
  }

  private async results(): Promise<OpenCodeHandoffResult[]> {
    const out: OpenCodeHandoffResult[] = []
    for (const event of await this.eventStore.readAll()) {
      if (event.kind === "opencode_handoff_created" && isRecord(event.handoff)) out.push(readHandoffResult(event.handoff))
    }
    return out
  }

  private async appendAndApply(event: HandoffEvent): Promise<void> {
    await this.eventStore.append(redactValue(event))
  }
}

function normalizeInput(input: OpenCodeHandoffInput): Required<OpenCodeHandoffInput> {
  const raw = input as unknown as Record<string, unknown>
  return {
    proposal_id: cleanRequiredString(raw.proposal_id ?? raw.proposalId, "proposal_id"),
    requested_by: optionalString(raw.requested_by ?? raw.requestedBy, "requested_by") ?? "operator",
    dry_run: raw.dry_run === true || raw.dryRun === true,
  }
}

function readHandoffPayload(proposal: CommanderProposal): OpenCodeHandoffPayload {
  if (!isRecord(proposal.action_payload)) throw new Error("action_payload must be an object")
  const payload = proposal.action_payload
  const requestedExecutor = optionalString(payload.requested_executor, "requested_executor")
  if (requestedExecutor !== undefined && requestedExecutor !== "opencode") throw new Error("requested_executor must be opencode")
  const priority = optionalString(payload.priority, "priority")
  if (priority !== undefined && priority !== "low" && priority !== "normal" && priority !== "high") throw new Error("priority is invalid")
  return {
    objective: boundText(cleanRequiredString(payload.objective, "objective"), MAX_TEXT),
    summary: optionalBoundText(payload.summary, "summary"),
    source_cycle_id: optionalString(payload.source_cycle_id, "source_cycle_id"),
    source_synthesis_id: optionalString(payload.source_synthesis_id, "source_synthesis_id"),
    evidence_ids: stringArray(payload.evidence_ids, "evidence_ids"),
    artifacts: stringArray(payload.artifacts, "artifacts"),
    constraints: stringArray(payload.constraints, "constraints"),
    acceptance_criteria: stringArray(payload.acceptance_criteria, "acceptance_criteria"),
    requested_executor: requestedExecutor,
    priority,
  }
}

function readHandoffResult(value: Record<string, unknown>): OpenCodeHandoffResult {
  return {
    handoff_id: cleanRequiredString(value.handoff_id, "handoff_id"),
    proposal_id: cleanRequiredString(value.proposal_id, "proposal_id"),
    review_id: optionalString(value.review_id, "review_id"),
    mission_id: optionalString(value.mission_id, "mission_id"),
    intent_id: optionalString(value.intent_id, "intent_id"),
    adapter_session_id: optionalString(value.adapter_session_id, "adapter_session_id"),
    objective_preview: optionalString(value.objective_preview, "objective_preview") ?? "",
    sent: value.sent === true,
    dry_run: value.dry_run === true,
    created_at: cleanRequiredString(value.created_at, "created_at"),
    requested_by: cleanRequiredString(value.requested_by, "requested_by"),
    source_cycle_id: optionalString(value.source_cycle_id, "source_cycle_id"),
    source_synthesis_id: optionalString(value.source_synthesis_id, "source_synthesis_id"),
    evidence_ids: stringArray(value.evidence_ids, "evidence_ids"),
  }
}

function recordFromResult(result: OpenCodeHandoffResult): OpenCodeHandoffRecord {
  return {
    handoff_id: result.handoff_id,
    proposal_id: result.proposal_id,
    mission_id: result.mission_id,
    intent_id: result.intent_id,
    sent: result.sent,
    created_at: result.created_at,
    requested_by: result.requested_by,
    source_cycle_id: result.source_cycle_id,
    source_synthesis_id: result.source_synthesis_id,
  }
}

function buildMissionObjective(payload: OpenCodeHandoffPayload): string {
  const lines = [payload.objective]
  if (payload.summary) lines.push("", `Summary: ${payload.summary}`)
  if (payload.constraints.length > 0) lines.push("", "Constraints:", ...payload.constraints.map((item) => `- ${item}`))
  if (payload.acceptance_criteria.length > 0) lines.push("", "Acceptance criteria:", ...payload.acceptance_criteria.map((item) => `- ${item}`))
  if (payload.artifacts.length > 0) lines.push("", `Artifacts: ${payload.artifacts.join(", ")}`)
  if (payload.evidence_ids.length > 0) lines.push("", `Evidence IDs: ${payload.evidence_ids.join(", ")}`)
  if (payload.source_cycle_id) lines.push(`Source cycle: ${payload.source_cycle_id}`)
  if (payload.source_synthesis_id) lines.push(`Source synthesis: ${payload.source_synthesis_id}`)
  return redactText(lines.join("\n"))
}

function redactedPreview(preview: OpenCodeHandoffPreview): OpenCodeHandoffPreview {
  return redactValue(preview)
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return redactText(value.trim())
}

function optionalBoundText(value: unknown, field: string): string | undefined {
  const text = optionalString(value, field)
  return text === undefined ? undefined : boundText(text, MAX_TEXT)
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.slice(0, MAX_ARRAY_ITEMS).map((item, index) => boundText(cleanRequiredString(item, `${field}[${index}]`), MAX_ARRAY_TEXT))
}

function boundText(value: string, maxChars: number): string {
  const safe = redactText(value)
  return safe.length > maxChars ? safe.slice(0, maxChars) : safe
}

function previewText(value: string): string {
  const safe = redactText(value)
  return safe.length > MAX_PREVIEW ? `${safe.slice(0, MAX_PREVIEW - 3)}...` : safe
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
