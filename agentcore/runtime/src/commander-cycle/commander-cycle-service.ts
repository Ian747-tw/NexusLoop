import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { MissionRegistry } from "../missions/mission-registry"
import type { CommanderProposal, CommanderProposalInput } from "../missions/proposal-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { ProposalBundleRegistry } from "../missions/proposal-bundle-registry"
import type { Topic, TopicSnapshot } from "../research-db/research-db"
import { redactText, redactValue } from "../security/redaction"
import { FakeCommanderCycleProvider, type CommanderCycleProvider, type CommanderCycleProviderEvidence, type CommanderCycleProviderQueueItem, type CommanderCycleProviderResult, type CommanderCycleProviderSynthesis } from "./commander-cycle-provider"
import type { CommanderCycleInput, CommanderCyclePreview, CommanderCycleRecommendedAction, CommanderCycleRecord, CommanderCycleResult } from "./commander-cycle-types"

const DEFAULT_MAX_CONTEXT_BYTES = 48 * 1024
const HARD_MAX_CONTEXT_BYTES = 96 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024
const MIN_MAX_OUTPUT_BYTES = 512
const HARD_MAX_OUTPUT_BYTES = 32 * 1024
const CONTEXT_PREVIEW_BYTES = 2048
const SUMMARY_PREVIEW_BYTES = 240
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

export interface CommanderCycleResearchDbReader {
  getTopic(id: string): Topic | null
  getTopicSnapshot(topicId: string): TopicSnapshot | null
}

export interface CommanderCycleServiceOptions {
  eventStore: EventStore
  researchDb: CommanderCycleResearchDbReader
  missionRegistry: MissionRegistry
  proposalRegistry: ProposalRegistry
  proposalBundleRegistry: ProposalBundleRegistry
  provider?: CommanderCycleProvider
  now?: () => Date
  cycleId?: () => string
}

interface NormalizedInput extends CommanderCycleInput {
  requested_by: string
  provider_id: string
  create_proposals: boolean
  create_bundle: boolean
  max_context_bytes: number
  max_output_bytes: number
}

interface BuiltContext {
  preview: CommanderCyclePreview
  context: string
  topicTitle?: string
  sources: CommanderCycleProviderEvidence[]
  notes: CommanderCycleProviderEvidence[]
  artifacts: CommanderCycleProviderEvidence[]
  syntheses: CommanderCycleProviderSynthesis[]
  queueItems: CommanderCycleProviderQueueItem[]
}

export class CommanderCycleService {
  private readonly provider: CommanderCycleProvider
  private readonly now: () => Date
  private readonly cycleId: () => string

  constructor(private readonly options: CommanderCycleServiceOptions) {
    this.provider = options.provider ?? new FakeCommanderCycleProvider()
    this.now = options.now ?? (() => new Date())
    this.cycleId = options.cycleId ?? (() => `cycle_${randomUUID()}`)
  }

  async preview(input: CommanderCycleInput): Promise<CommanderCyclePreview> {
    const normalized = this.normalize(input)
    const built = await this.buildContext(normalized)
    return redactValue(built.preview)
  }

  async execute(input: CommanderCycleInput): Promise<CommanderCycleResult> {
    const normalized = this.normalize(input)
    const built = await this.buildContext(normalized)
    if (built.preview.blockers.length > 0) throw new Error(built.preview.blockers.join("; "))
    const cycleId = this.cycleId()
    const createdAt = this.now().toISOString()
    const contextHash = sha256(built.context)
    let providerResult: CommanderCycleProviderResult
    try {
      providerResult = await this.provider.run({
        cycle_id: cycleId,
        objective: normalized.objective,
        topic_id: normalized.topic_id,
        mission_id: normalized.mission_id,
        topic_title: built.topicTitle,
        sources: built.sources,
        notes: built.notes,
        artifacts: built.artifacts,
        syntheses: built.syntheses,
        queue_items: built.queueItems,
        max_output_bytes: normalized.max_output_bytes,
        requested_by: normalized.requested_by,
      })
    } catch (error) {
      const failure = this.failureResult(cycleId, normalized, createdAt, errorMessage(error), contextHash)
      await this.writeFailure(failure)
      throw new Error(`commander cycle failed: ${failure.error}`)
    }

    let output: CommanderCycleProviderResult
    try {
      output = cleanProviderResult(providerResult, normalized.max_output_bytes, new Set(built.preview.included_evidence_ids), new Set(built.preview.included_synthesis_ids))
    } catch (error) {
      const failure = this.failureResult(cycleId, normalized, createdAt, errorMessage(error), contextHash)
      await this.writeFailure(failure)
      throw new Error(`commander cycle failed: ${failure.error}`)
    }

    const outputPayload = {
      title: output.title,
      summary: output.summary,
      findings: output.findings,
      risks: output.risks,
      recommended_actions: output.recommended_actions,
      should_create_proposals: output.should_create_proposals === true,
      confidence: output.confidence,
    }
    const outputHash = sha256(JSON.stringify(outputPayload))
    const result: CommanderCycleResult = redactValue({
      cycle_id: cycleId,
      provider_id: this.provider.provider_id,
      objective: normalized.objective,
      topic_id: normalized.topic_id,
      mission_id: normalized.mission_id,
      title: output.title,
      summary: output.summary,
      findings: output.findings,
      risks: output.risks,
      recommended_actions: output.recommended_actions,
      proposal_ids: [],
      context_hash: contextHash,
      output_hash: outputHash,
      created_at: createdAt,
      requested_by: redactText(normalized.requested_by),
    })
    await this.writeCompleted(result, built.preview.included_evidence_ids, built.preview.included_synthesis_ids)

    if (!normalized.create_proposals && !normalized.create_bundle) return result
    try {
      const proposalIds = await this.createProposals(cycleId, normalized, output.recommended_actions)
      const withProposals = { ...result, proposal_ids: proposalIds }
      await this.writeProposalLinks(withProposals)
      if (!normalized.create_bundle || proposalIds.length === 0) return withProposals
      const bundle = await this.options.proposalBundleRegistry.createBundle({
        title: `Commander cycle ${cycleId}`,
        summary: `Bundle for commander cycle ${cycleId}`,
        created_by: normalized.requested_by,
      })
      for (const proposalId of proposalIds) await this.options.proposalBundleRegistry.addProposal(bundle.bundle_id, proposalId)
      const withBundle = { ...withProposals, bundle_id: bundle.bundle_id }
      await this.writeBundleLink(withBundle)
      return withBundle
    } catch (error) {
      await this.writeDraftingFailure(result, errorMessage(error))
      throw new Error(`commander cycle proposal drafting failed: ${errorMessage(error)}`)
    }
  }

  async get(cycleId: string): Promise<CommanderCycleResult | null> {
    const id = requiredString(cycleId, "cycle_id")
    const events = await this.options.eventStore.readAll()
    const event = events.find((item) => item.kind === "commander_cycle_completed" && item.cycle_id === id)
    if (!event) return null
    return withDraftedIds(readResultFromEvent(event), draftedIdsFor(events, id))
  }

  async list(limit = DEFAULT_LIST_LIMIT): Promise<CommanderCycleRecord[]> {
    const events = await this.options.eventStore.readAll()
    const draftedByCycle = draftedIdsByCycleId(events)
    return events
      .filter((event) => event.kind === "commander_cycle_completed")
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, MAX_LIST_LIMIT)))
      .map((event) => {
        const cycleId = String(event.cycle_id ?? "")
        const drafted = draftedByCycle.get(cycleId)
        return redactValue({
          cycle_id: cycleId,
          provider_id: String(event.provider_id ?? ""),
          objective_preview: typeof event.objective === "string" ? boundedText(event.objective, SUMMARY_PREVIEW_BYTES) : undefined,
          topic_id: optionalEventString(event.topic_id),
          mission_id: optionalEventString(event.mission_id),
          title: String(event.title ?? ""),
          summary_preview: boundedText(String(event.summary ?? ""), SUMMARY_PREVIEW_BYTES),
          proposal_ids: drafted?.proposal_ids ?? eventStringArray(event.proposal_ids),
          bundle_id: drafted?.bundle_id ?? optionalEventString(event.bundle_id),
          created_at: String(event.created_at ?? event.timestamp ?? ""),
          requested_by: String(event.requested_by ?? "unknown"),
        })
      })
  }

  private normalize(input: CommanderCycleInput): NormalizedInput {
    const providerId = input.provider_id ?? this.provider.provider_id
    if (providerId !== this.provider.provider_id) throw new Error(`unknown commander cycle provider: ${redactText(providerId)}`)
    const objective = input.objective === undefined ? undefined : boundedText(requiredString(input.objective, "objective"), 2048)
    const topicId = input.topic_id === undefined ? undefined : requiredString(input.topic_id, "topic_id")
    const missionId = input.mission_id === undefined ? undefined : requiredString(input.mission_id, "mission_id")
    if (!topicId && !missionId && !objective) throw new Error("topic_id or mission_id is required")
    return {
      ...input,
      objective,
      topic_id: topicId,
      mission_id: missionId,
      provider_id: providerId,
      requested_by: requiredString(input.requested_by, "requested_by"),
      create_proposals: input.create_proposals === true || input.create_bundle === true,
      create_bundle: input.create_bundle === true,
      max_context_bytes: clampBytes(input.max_context_bytes, DEFAULT_MAX_CONTEXT_BYTES, HARD_MAX_CONTEXT_BYTES, "max_context_bytes"),
      max_output_bytes: clampOutputBytes(input.max_output_bytes),
    }
  }

  private async buildContext(input: NormalizedInput): Promise<BuiltContext> {
    const events = await this.options.eventStore.readAll()
    const contextParts: string[] = []
    let topicTitle: string | undefined
    let sources: CommanderCycleProviderEvidence[] = []
    let notes: CommanderCycleProviderEvidence[] = []
    let artifacts: CommanderCycleProviderEvidence[] = []
    if (input.topic_id) {
      const snapshot = this.options.researchDb.getTopicSnapshot(input.topic_id)
      if (!snapshot) throw new Error(`topic not found: ${redactText(input.topic_id)}`)
      topicTitle = snapshot.topic.title
      sources = snapshot.sources.map((source) => evidenceRow("source", source.id, source.title ?? source.locator, source.locator, source.created_at))
      notes = snapshot.notes.map((note) => evidenceRow("note", note.id, note.tags.join(",") || "note", note.content, note.created_at))
      artifacts = snapshot.artifacts.map((artifact) => evidenceRow("artifact", artifact.id, artifact.description ?? artifact.path ?? artifact.kind, artifact.content ?? artifact.path ?? "", artifact.created_at))
      contextParts.push(`# Topic ${snapshot.topic.id}: ${snapshot.topic.title}`)
    }
    if (input.mission_id) {
      const mission = await this.options.missionRegistry.getMission(input.mission_id)
      if (!mission) throw new Error(`mission not found: ${redactText(input.mission_id)}`)
      contextParts.push(`# Mission ${mission.mission_id}: ${mission.status}\nobjective: ${mission.objective}`)
    }
    if (input.objective) contextParts.push(`# Objective\n${input.objective}`)

    const syntheses = synthesesFor(events, input.topic_id)
    const proposals = await this.options.proposalRegistry.listAllProposals()
    const bundles = await this.options.proposalBundleRegistry.listAllBundles()
    const queueItems: CommanderCycleProviderQueueItem[] = [
      ...proposals.slice(0, 20).map((proposal) => ({
        target_type: "proposal",
        target_id: proposal.proposal_id,
        title: proposal.title,
        status: proposal.status,
        created_at: proposal.created_at,
      })),
      ...bundles.slice(0, 10).map((bundle) => ({
        target_type: "bundle",
        target_id: bundle.bundle_id,
        title: bundle.title,
        status: bundle.status,
        created_at: bundle.created_at,
      })),
    ].sort(compareQueueItems)

    const evidenceRows = [...sources, ...notes, ...artifacts].sort(compareEvidence)
    const includedEvidence: CommanderCycleProviderEvidence[] = []
    const includedSyntheses: CommanderCycleProviderSynthesis[] = []
    const includedQueueItems: CommanderCycleProviderQueueItem[] = []
    let context = redactText(`${contextParts.join("\n")}\n`)
    for (const row of evidenceRows) {
      const block = evidenceBlock(row)
      if (byteLength(context + block) > input.max_context_bytes) continue
      context += block
      includedEvidence.push(row)
    }
    for (const synthesis of syntheses) {
      const block = synthesisBlock(synthesis)
      if (byteLength(context + block) > input.max_context_bytes) continue
      context += block
      includedSyntheses.push(synthesis)
    }
    for (const item of queueItems) {
      const block = queueBlock(item)
      if (byteLength(context + block) > input.max_context_bytes) continue
      context += block
      includedQueueItems.push(item)
    }
    const includedEvidenceIds = includedEvidence.map((item) => item.evidence_id)
    const includedSynthesisIds = includedSyntheses.map((item) => item.synthesis_id)
    const blockers: string[] = []
    if (input.topic_id && includedEvidenceIds.length === 0 && includedSynthesisIds.length === 0) blockers.push("topic has no evidence or syntheses for commander cycle")
    if (!input.topic_id && !input.mission_id && !input.objective) blockers.push("topic_id or mission_id is required")
    return {
      preview: {
        objective: input.objective,
        topic_id: input.topic_id,
        mission_id: input.mission_id,
        context_counts: {
          sources: sources.length,
          notes: notes.length,
          artifacts: artifacts.length,
          syntheses: syntheses.length,
          proposals: proposals.length,
          reviews: 0,
          queues: queueItems.length,
        },
        context_bytes: byteLength(context),
        max_context_bytes: input.max_context_bytes,
        included_evidence_ids: includedEvidenceIds,
        included_synthesis_ids: includedSynthesisIds,
        blockers,
        redacted_context_preview: boundedText(context, CONTEXT_PREVIEW_BYTES),
      },
      context,
      topicTitle,
      sources: includedEvidence.filter((row) => row.evidence_type === "source"),
      notes: includedEvidence.filter((row) => row.evidence_type === "note"),
      artifacts: includedEvidence.filter((row) => row.evidence_type === "artifact"),
      syntheses: includedSyntheses,
      queueItems: includedQueueItems,
    }
  }

  private async createProposals(cycleId: string, input: NormalizedInput, actions: CommanderCycleRecommendedAction[]): Promise<string[]> {
    const proposals: CommanderProposal[] = []
    for (const action of actions.slice(0, 10)) {
      const proposalInput: CommanderProposalInput = {
        action_kind: action.action_kind === "other" ? "other" : "operator_checkpoint",
        title: action.title,
        summary: redactText(`${action.summary}\n\ncycle_id: ${cycleId}\nevidence_ids: ${(action.evidence_ids ?? []).join(", ") || "none"}\nsynthesis_ids: ${(action.synthesis_ids ?? []).join(", ") || "none"}`),
        proposed_by: input.requested_by,
        action_payload: {
          cycle_id: cycleId,
          topic_id: input.topic_id,
          mission_id: input.mission_id,
          evidence_ids: action.evidence_ids ?? [],
          synthesis_ids: action.synthesis_ids ?? [],
          rationale: action.rationale,
        },
      }
      proposals.push(await this.options.proposalRegistry.createProposal(proposalInput))
    }
    return proposals.map((proposal) => proposal.proposal_id)
  }

  private async writeCompleted(result: CommanderCycleResult, evidenceIds: string[], synthesisIds: string[]): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "commander_cycle_completed",
      cycle_id: result.cycle_id,
      provider_id: result.provider_id,
      objective: result.objective,
      topic_id: result.topic_id,
      mission_id: result.mission_id,
      title: result.title,
      summary: result.summary,
      findings: result.findings,
      risks: result.risks,
      recommended_actions: result.recommended_actions,
      proposal_ids: [],
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      evidence_ids: evidenceIds,
      synthesis_ids: synthesisIds,
      created_at: result.created_at,
      requested_by: result.requested_by,
    }))
  }

  private async writeFailure(result: CommanderCycleResult & { error: string }): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "commander_cycle_failed",
      cycle_id: result.cycle_id,
      provider_id: result.provider_id,
      objective: result.objective,
      topic_id: result.topic_id,
      mission_id: result.mission_id,
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      error: result.error,
      created_at: result.created_at,
      requested_by: result.requested_by,
    }))
  }

  private async writeProposalLinks(result: CommanderCycleResult): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "commander_cycle_proposals_created",
      cycle_id: result.cycle_id,
      topic_id: result.topic_id,
      mission_id: result.mission_id,
      proposal_ids: result.proposal_ids ?? [],
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      created_at: result.created_at,
      requested_by: result.requested_by,
    }))
  }

  private async writeBundleLink(result: CommanderCycleResult): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "commander_cycle_bundle_created",
      cycle_id: result.cycle_id,
      topic_id: result.topic_id,
      mission_id: result.mission_id,
      proposal_ids: result.proposal_ids ?? [],
      bundle_id: result.bundle_id,
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      created_at: result.created_at,
      requested_by: result.requested_by,
    }))
  }

  private async writeDraftingFailure(result: CommanderCycleResult, error: string): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "commander_cycle_drafting_failed",
      cycle_id: result.cycle_id,
      topic_id: result.topic_id,
      mission_id: result.mission_id,
      proposal_ids: result.proposal_ids ?? [],
      bundle_id: result.bundle_id,
      error,
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      created_at: this.now().toISOString(),
      requested_by: result.requested_by,
    }))
  }

  private failureResult(cycleId: string, input: NormalizedInput, createdAt: string, error: string, contextHash: string): CommanderCycleResult & { error: string } {
    return redactValue({
      cycle_id: cycleId,
      provider_id: this.provider.provider_id,
      objective: input.objective,
      topic_id: input.topic_id,
      mission_id: input.mission_id,
      title: "",
      summary: "",
      findings: [],
      risks: [],
      recommended_actions: [],
      proposal_ids: [],
      context_hash: contextHash,
      output_hash: "",
      created_at: createdAt,
      requested_by: redactText(input.requested_by),
      error: redactText(error),
    })
  }
}

function synthesesFor(events: Record<string, unknown>[], topicId?: string): CommanderCycleProviderSynthesis[] {
  return events
    .filter((event) => event.kind === "research_synthesis_created" && (!topicId || event.topic_id === topicId))
    .map((event) => ({
      synthesis_id: redactText(String(event.synthesis_id ?? "")),
      title: boundedText(String(event.title ?? ""), 512),
      summary: boundedText(String(event.summary ?? ""), 2048),
      created_at: typeof event.created_at === "string" ? redactText(event.created_at) : undefined,
    }))
    .filter((item) => item.synthesis_id)
    .sort(compareSyntheses)
}

function cleanProviderResult(result: CommanderCycleProviderResult, maxBytes: number, allowedEvidenceIds: Set<string>, allowedSynthesisIds: Set<string>): CommanderCycleProviderResult {
  const cleaned: CommanderCycleProviderResult = {
    title: boundedText(requiredString(result.title, "title"), 512),
    summary: boundedText(requiredString(result.summary, "summary"), 4096),
    findings: cleanStringList(result.findings, "findings", 20, 1024),
    risks: cleanStringList(result.risks, "risks", 20, 1024),
    recommended_actions: cleanActions(result.recommended_actions, allowedEvidenceIds, allowedSynthesisIds),
    should_create_proposals: result.should_create_proposals === true,
    confidence: result.confidence === "high" || result.confidence === "medium" || result.confidence === "low" ? result.confidence : "low",
  }
  while (byteLength(JSON.stringify(cleaned)) > maxBytes) {
    if (cleaned.recommended_actions.length > 0) cleaned.recommended_actions.pop()
    else if (cleaned.risks.length > 0) cleaned.risks.pop()
    else if (cleaned.findings.length > 0) cleaned.findings.pop()
    else {
      cleaned.summary = boundedText(cleaned.summary, Math.max(0, maxBytes - 1024))
      break
    }
  }
  if (byteLength(JSON.stringify(cleaned)) > maxBytes) throw new Error("provider output exceeds max_output_bytes")
  return redactValue(cleaned)
}

function cleanActions(value: CommanderCycleRecommendedAction[], allowedEvidenceIds: Set<string>, allowedSynthesisIds: Set<string>): CommanderCycleRecommendedAction[] {
  if (!Array.isArray(value)) throw new Error("recommended_actions must be an array")
  return value.slice(0, 10).map((action, index) => {
    if (!action || typeof action !== "object") throw new Error(`recommended_actions[${index}] must be an object`)
    const evidenceIds = cleanStringList(action.evidence_ids ?? [], `recommended_actions[${index}].evidence_ids`, 20, 256)
    const synthesisIds = cleanStringList(action.synthesis_ids ?? [], `recommended_actions[${index}].synthesis_ids`, 20, 256)
    for (const evidenceId of evidenceIds) {
      if (!allowedEvidenceIds.has(evidenceId)) throw new Error(`recommended_actions[${index}].evidence_ids contains unknown evidence id`)
    }
    for (const synthesisId of synthesisIds) {
      if (!allowedSynthesisIds.has(synthesisId)) throw new Error(`recommended_actions[${index}].synthesis_ids contains unknown synthesis id`)
    }
    return {
      title: boundedText(requiredString(action.title, `recommended_actions[${index}].title`), 512),
      summary: boundedText(requiredString(action.summary, `recommended_actions[${index}].summary`), 2048),
      action_kind: action.action_kind === "other" ? "other" : "operator_checkpoint",
      rationale: boundedText(requiredString(action.rationale, `recommended_actions[${index}].rationale`), 2048),
      evidence_ids: evidenceIds,
      synthesis_ids: synthesisIds,
      related_target_type: action.related_target_type === undefined ? undefined : boundedText(requiredString(action.related_target_type, `recommended_actions[${index}].related_target_type`), 128),
      related_target_id: action.related_target_id === undefined ? undefined : boundedText(requiredString(action.related_target_id, `recommended_actions[${index}].related_target_id`), 256),
    }
  })
}

function evidenceRow(evidenceType: CommanderCycleProviderEvidence["evidence_type"], evidenceId: string, title: string, content: string, createdAt?: string): CommanderCycleProviderEvidence {
  return {
    evidence_id: redactText(requiredString(evidenceId, "evidence_id")),
    evidence_type: evidenceType,
    title: boundedText(title, 512),
    content: boundedText(content, 4096),
    created_at: createdAt ? redactText(createdAt) : undefined,
  }
}

function evidenceBlock(row: CommanderCycleProviderEvidence): string {
  return redactText(`\n[${row.evidence_type}:${row.evidence_id}]\ntitle: ${row.title}\ncreated_at: ${row.created_at ?? "unknown"}\n${row.content}\n`)
}

function synthesisBlock(row: CommanderCycleProviderSynthesis): string {
  return redactText(`\n[synthesis:${row.synthesis_id}]\ntitle: ${row.title}\ncreated_at: ${row.created_at ?? "unknown"}\n${row.summary}\n`)
}

function queueBlock(row: CommanderCycleProviderQueueItem): string {
  return redactText(`\n[${row.target_type}:${row.target_id}]\ntitle: ${row.title}\nstatus: ${row.status}\n`)
}

function compareEvidence(a: CommanderCycleProviderEvidence, b: CommanderCycleProviderEvidence): number {
  const date = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  if (date !== 0) return date
  const type = a.evidence_type.localeCompare(b.evidence_type)
  if (type !== 0) return type
  return a.evidence_id.localeCompare(b.evidence_id)
}

function compareSyntheses(a: CommanderCycleProviderSynthesis, b: CommanderCycleProviderSynthesis): number {
  const date = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  if (date !== 0) return date
  return a.synthesis_id.localeCompare(b.synthesis_id)
}

function compareQueueItems(a: CommanderCycleProviderQueueItem, b: CommanderCycleProviderQueueItem): number {
  const date = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  if (date !== 0) return date
  const type = a.target_type.localeCompare(b.target_type)
  if (type !== 0) return type
  return a.target_id.localeCompare(b.target_id)
}

function readResultFromEvent(event: Record<string, unknown>): CommanderCycleResult {
  return redactValue({
    cycle_id: String(event.cycle_id ?? ""),
    provider_id: String(event.provider_id ?? ""),
    objective: optionalEventString(event.objective),
    topic_id: optionalEventString(event.topic_id),
    mission_id: optionalEventString(event.mission_id),
    title: String(event.title ?? ""),
    summary: String(event.summary ?? ""),
    findings: eventStringArray(event.findings),
    risks: eventStringArray(event.risks),
    recommended_actions: Array.isArray(event.recommended_actions) ? event.recommended_actions : [],
    proposal_ids: eventStringArray(event.proposal_ids),
    bundle_id: optionalEventString(event.bundle_id),
    context_hash: String(event.context_hash ?? ""),
    output_hash: String(event.output_hash ?? ""),
    created_at: String(event.created_at ?? event.timestamp ?? ""),
    requested_by: String(event.requested_by ?? "unknown"),
  }) as CommanderCycleResult
}

function draftedIdsByCycleId(events: Record<string, unknown>[]): Map<string, { proposal_ids: string[]; bundle_id?: string }> {
  const byCycleId = new Map<string, { proposal_ids: string[]; bundle_id?: string }>()
  for (const event of events) {
    if (event.kind !== "commander_cycle_proposals_created" && event.kind !== "commander_cycle_bundle_created") continue
    const cycleId = String(event.cycle_id ?? "")
    if (!cycleId) continue
    const current = byCycleId.get(cycleId) ?? { proposal_ids: [] }
    const proposalIds = eventStringArray(event.proposal_ids)
    byCycleId.set(cycleId, {
      proposal_ids: proposalIds.length > 0 ? proposalIds : current.proposal_ids,
      bundle_id: optionalEventString(event.bundle_id) ?? current.bundle_id,
    })
  }
  return byCycleId
}

function draftedIdsFor(events: Record<string, unknown>[], cycleId: string): { proposal_ids: string[]; bundle_id?: string } {
  return draftedIdsByCycleId(events).get(cycleId) ?? { proposal_ids: [] }
}

function withDraftedIds(result: CommanderCycleResult, drafted: { proposal_ids: string[]; bundle_id?: string }): CommanderCycleResult {
  return drafted.proposal_ids.length > 0 || drafted.bundle_id ? { ...result, proposal_ids: drafted.proposal_ids, bundle_id: drafted.bundle_id } : result
}

function cleanStringList(value: string[], field: string, limit: number, maxBytes: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.slice(0, limit).map((item, index) => boundedText(requiredString(item, `${field}[${index}]`), maxBytes))
}

function clampBytes(value: unknown, fallback: number, max: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), max)
}

function clampOutputBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_OUTPUT_BYTES
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("max_output_bytes must be a positive integer")
  if (Number(value) < MIN_MAX_OUTPUT_BYTES) throw new Error(`max_output_bytes must be at least ${MIN_MAX_OUTPUT_BYTES}`)
  return Math.min(Number(value), HARD_MAX_OUTPUT_BYTES)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function boundedText(value: string, maxBytes: number): string {
  const redacted = redactText(value)
  const bytes = new TextEncoder().encode(redacted)
  if (bytes.byteLength <= maxBytes) return redacted
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = maxBytes; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {}
  }
  return ""
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function errorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error))
}

function optionalEventString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? redactText(value) : undefined
}

function eventStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(redactText) : []
}
