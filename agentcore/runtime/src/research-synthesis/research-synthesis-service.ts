import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { CommanderProposal, CommanderProposalInput } from "../missions/proposal-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { Artifact, Note, Topic, TopicSnapshot } from "../research-db/research-db"
import { redactText, redactValue } from "../security/redaction"
import { FakeResearchSynthesisProvider, type ResearchSynthesisProvider, type ResearchSynthesisProviderEvidence, type ResearchSynthesisProviderResult } from "./research-synthesis-provider"
import type {
  ResearchSynthesisInput,
  ResearchSynthesisPreview,
  ResearchSynthesisRecommendedAction,
  ResearchSynthesisRecord,
  ResearchSynthesisResult,
} from "./research-synthesis-types"

const DEFAULT_MAX_CONTEXT_BYTES = 32 * 1024
const HARD_MAX_CONTEXT_BYTES = 64 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024
const HARD_MAX_OUTPUT_BYTES = 32 * 1024
const CONTEXT_PREVIEW_BYTES = 2048
const SUMMARY_PREVIEW_BYTES = 240
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

export interface ResearchSynthesisDbWriter {
  getTopic(id: string): Topic | null
  getTopicSnapshot(topicId: string): TopicSnapshot | null
  addNote(input: { id?: string; topic_id: string; source_id?: string; content: string; tags?: string[] }): Note
  addArtifact(input: { id?: string; topic_id: string; kind: "snapshot"; content: string; artifact_type?: "snapshot"; sha256?: string; size_bytes?: number; description?: string }): Artifact
}

export interface ResearchSynthesisServiceOptions {
  eventStore: EventStore
  researchDb: ResearchSynthesisDbWriter
  proposalRegistry: ProposalRegistry
  provider?: ResearchSynthesisProvider
  now?: () => Date
  synthesisId?: () => string
}

interface NormalizedInput extends ResearchSynthesisInput {
  topic_id: string
  requested_by: string
  objective?: string
  provider_id: string
  create_proposals: boolean
  max_context_bytes: number
  max_output_bytes: number
}

interface BuiltContext {
  preview: ResearchSynthesisPreview
  context: string
  evidence: {
    sources: ResearchSynthesisProviderEvidence[]
    notes: ResearchSynthesisProviderEvidence[]
    artifacts: ResearchSynthesisProviderEvidence[]
    ingestions: ResearchSynthesisProviderEvidence[]
  }
}

export class ResearchSynthesisService {
  private readonly provider: ResearchSynthesisProvider
  private readonly now: () => Date
  private readonly synthesisId: () => string

  constructor(private readonly options: ResearchSynthesisServiceOptions) {
    this.provider = options.provider ?? new FakeResearchSynthesisProvider()
    this.now = options.now ?? (() => new Date())
    this.synthesisId = options.synthesisId ?? (() => `synthesis_${randomUUID()}`)
  }

  async preview(input: ResearchSynthesisInput): Promise<ResearchSynthesisPreview> {
    const normalized = this.normalize(input)
    const built = await this.buildContext(normalized)
    return redactValue(built.preview)
  }

  async execute(input: ResearchSynthesisInput): Promise<ResearchSynthesisResult> {
    const normalized = this.normalize(input)
    const built = await this.buildContext(normalized)
    if (built.preview.blockers.length > 0) throw new Error(built.preview.blockers.join("; "))
    const createdAt = this.now().toISOString()
    const synthesisId = this.synthesisId()
    const contextHash = sha256(built.context)
    let providerResult: ResearchSynthesisProviderResult
    try {
      providerResult = await this.provider.synthesize({
        topic_id: normalized.topic_id,
        topic_title: built.preview.topic_title,
        objective: normalized.objective,
        ...built.evidence,
        max_output_bytes: normalized.max_output_bytes,
        requested_by: normalized.requested_by,
      })
    } catch (error) {
      const result = this.failureResult(synthesisId, normalized, createdAt, errorMessage(error), contextHash)
      await this.writeFailure(result)
      throw new Error(`research synthesis failed: ${result.error}`)
    }

    let output: ResearchSynthesisProviderResult
    try {
      output = cleanProviderResult(providerResult, normalized.max_output_bytes, new Set(built.preview.included_evidence_ids))
    } catch (error) {
      const result = this.failureResult(synthesisId, normalized, createdAt, errorMessage(error), contextHash)
      await this.writeFailure(result)
      throw new Error(`research synthesis failed: ${result.error}`)
    }
    const outputPayload = {
      title: output.title,
      summary: output.summary,
      findings: output.findings,
      risks: output.risks,
      open_questions: output.open_questions,
      recommended_actions: output.recommended_actions,
      confidence: output.confidence,
    }
    const outputHash = sha256(JSON.stringify(outputPayload))
    try {
      const note = this.options.researchDb.addNote({
        topic_id: normalized.topic_id,
        content: synthesisNoteContent(synthesisId, normalized, built.preview.included_evidence_ids, output, contextHash, outputHash),
        tags: ["research-synthesis"],
      })
      const proposalIds = normalized.create_proposals
        ? await this.createProposals(synthesisId, normalized, output.recommended_actions)
        : []
      const artifactContent = JSON.stringify({
        synthesis_id: synthesisId,
        topic_id: normalized.topic_id,
        provider_id: this.provider.provider_id,
        source_note_id: note.id,
        proposal_ids: proposalIds,
        objective: normalized.objective,
        evidence_ids: built.preview.included_evidence_ids,
        excluded_evidence_count: built.preview.excluded_evidence_count,
        context_hash: contextHash,
        output_hash: outputHash,
        output: outputPayload,
        requested_by: redactText(normalized.requested_by),
        created_at: createdAt,
      })
      const artifact = this.options.researchDb.addArtifact({
        topic_id: normalized.topic_id,
        kind: "snapshot",
        artifact_type: "snapshot",
        content: artifactContent,
        sha256: sha256(artifactContent),
        size_bytes: byteLength(artifactContent),
        description: `Research synthesis ${synthesisId}`,
      })
      const result: ResearchSynthesisResult = redactValue({
        synthesis_id: synthesisId,
        topic_id: normalized.topic_id,
        provider_id: this.provider.provider_id,
        source_note_id: note.id,
        artifact_id: artifact.id,
        proposal_ids: proposalIds,
        title: output.title,
        summary: output.summary,
        findings: output.findings,
        risks: output.risks,
        open_questions: output.open_questions,
        recommended_actions: output.recommended_actions,
        context_hash: contextHash,
        output_hash: outputHash,
        created_at: createdAt,
        requested_by: redactText(normalized.requested_by),
      })
      await this.writeSuccess(result)
      return result
    } catch (error) {
      const result = this.failureResult(synthesisId, normalized, createdAt, errorMessage(error), contextHash)
      await this.writeFailure(result)
      throw new Error(`research synthesis write failed: ${result.error}`)
    }
  }

  async get(synthesisId: string): Promise<ResearchSynthesisResult | null> {
    const id = requiredString(synthesisId, "synthesis_id")
    const events = await this.options.eventStore.readAll()
    const event = events.find((item) => item.kind === "research_synthesis_created" && item.synthesis_id === id)
    return event ? readResultFromEvent(event) : null
  }

  async list(limit = DEFAULT_LIST_LIMIT): Promise<ResearchSynthesisRecord[]> {
    const events = await this.options.eventStore.readAll()
    return events
      .filter((event) => event.kind === "research_synthesis_created")
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, MAX_LIST_LIMIT)))
      .map((event) => redactValue({
        synthesis_id: String(event.synthesis_id ?? ""),
        topic_id: String(event.topic_id ?? ""),
        provider_id: String(event.provider_id ?? ""),
        source_note_id: optionalEventString(event.source_note_id),
        artifact_id: optionalEventString(event.artifact_id),
        proposal_ids: eventStringArray(event.proposal_ids),
        title: String(event.title ?? ""),
        summary_preview: boundedText(String(event.summary ?? ""), SUMMARY_PREVIEW_BYTES),
        created_at: String(event.created_at ?? event.timestamp ?? ""),
        requested_by: String(event.requested_by ?? "unknown"),
      }))
  }

  private normalize(input: ResearchSynthesisInput): NormalizedInput {
    const providerId = input.provider_id ?? this.provider.provider_id
    if (providerId !== this.provider.provider_id) throw new Error(`unknown research synthesis provider: ${redactText(providerId)}`)
    const maxContextBytes = clampBytes(input.max_context_bytes, DEFAULT_MAX_CONTEXT_BYTES, HARD_MAX_CONTEXT_BYTES, "max_context_bytes")
    const maxOutputBytes = clampBytes(input.max_output_bytes, DEFAULT_MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES, "max_output_bytes")
    return {
      ...input,
      topic_id: requiredString(input.topic_id, "topic_id"),
      objective: input.objective === undefined ? undefined : boundedText(requiredString(input.objective, "objective"), 2048),
      provider_id: providerId,
      requested_by: requiredString(input.requested_by, "requested_by"),
      create_proposals: input.create_proposals === true,
      max_context_bytes: maxContextBytes,
      max_output_bytes: maxOutputBytes,
    }
  }

  private async buildContext(input: NormalizedInput): Promise<BuiltContext> {
    const snapshot = this.options.researchDb.getTopicSnapshot(input.topic_id)
    if (!snapshot) throw new Error(`topic not found: ${redactText(input.topic_id)}`)
    const ingestionEvidence = await this.ingestionEvidence(input.topic_id)
    const rows = [
      ...snapshot.sources.map((source) => evidenceRow("source", source.id, source.title ?? source.locator, source.locator, source.created_at)),
      ...snapshot.notes.map((note) => evidenceRow("note", note.id, note.tags.join(",") || "note", note.content, note.created_at)),
      ...snapshot.artifacts.map((artifact) => evidenceRow("artifact", artifact.id, artifact.description ?? artifact.path ?? artifact.kind, artifact.content ?? artifact.path ?? "", artifact.created_at)),
      ...ingestionEvidence,
    ].sort(compareEvidence)

    const selected: ResearchSynthesisProviderEvidence[] = []
    let context = redactText(`# Topic ${snapshot.topic.id}: ${snapshot.topic.title}\n`)
    for (const row of rows) {
      const block = evidenceBlock(row)
      if (byteLength(context + block) > input.max_context_bytes) continue
      context += block
      selected.push(row)
    }
    const blockers = selected.length === 0 ? ["topic has no evidence to synthesize"] : []
    const byType = groupEvidence(selected)
    return {
      context,
      evidence: byType,
      preview: {
        topic_id: snapshot.topic.id,
        topic_title: snapshot.topic.title,
        evidence_counts: {
          sources: snapshot.sources.length,
          notes: snapshot.notes.length,
          artifacts: snapshot.artifacts.length,
          ingestions: ingestionEvidence.length,
        },
        context_bytes: byteLength(context),
        max_context_bytes: input.max_context_bytes,
        included_evidence_ids: selected.map((item) => item.evidence_id),
        excluded_evidence_count: Math.max(0, rows.length - selected.length),
        blockers,
        redacted_context_preview: boundedText(context, CONTEXT_PREVIEW_BYTES),
      },
    }
  }

  private async ingestionEvidence(topicId: string): Promise<ResearchSynthesisProviderEvidence[]> {
    const events = await this.options.eventStore.readAll()
    return events
      .filter((event) => event.kind === "external_api_research_ingestion_succeeded" && event.topic_id === topicId)
      .map((event) => evidenceRow("ingestion", String(event.ingestion_id ?? ""), `external-api:${String(event.connector_id ?? "")}`, String(event.response_preview ?? ""), String(event.created_at ?? event.timestamp ?? "")))
  }

  private async createProposals(synthesisId: string, input: NormalizedInput, actions: ResearchSynthesisRecommendedAction[]): Promise<string[]> {
    const proposals: CommanderProposal[] = []
    for (const action of actions.slice(0, 10)) {
      const proposalInput: CommanderProposalInput = {
        action_kind: action.action_kind === "other" ? "other" : "operator_checkpoint",
        title: action.title,
        summary: redactText(`${action.summary}\n\nsynthesis_id: ${synthesisId}\nevidence_ids: ${action.evidence_ids.join(", ") || "none"}`),
        proposed_by: input.requested_by,
        action_payload: {
          synthesis_id: synthesisId,
          topic_id: input.topic_id,
          evidence_ids: action.evidence_ids,
          action_summary: action.summary,
        },
      }
      proposals.push(await this.options.proposalRegistry.createProposal(proposalInput))
    }
    return proposals.map((proposal) => proposal.proposal_id)
  }

  private async writeSuccess(result: ResearchSynthesisResult): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "research_synthesis_created",
      synthesis_id: result.synthesis_id,
      topic_id: result.topic_id,
      provider_id: result.provider_id,
      source_note_id: result.source_note_id,
      artifact_id: result.artifact_id,
      proposal_ids: result.proposal_ids ?? [],
      title: result.title,
      summary: result.summary,
      findings: result.findings,
      risks: result.risks,
      open_questions: result.open_questions,
      recommended_actions: result.recommended_actions,
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      created_at: result.created_at,
      requested_by: result.requested_by,
    }))
  }

  private async writeFailure(result: ResearchSynthesisResult & { error: string }): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind: "research_synthesis_failed",
      synthesis_id: result.synthesis_id,
      topic_id: result.topic_id,
      provider_id: result.provider_id,
      context_hash: result.context_hash,
      output_hash: result.output_hash,
      error: result.error,
      created_at: result.created_at,
      requested_by: result.requested_by,
    }))
  }

  private failureResult(synthesisId: string, input: NormalizedInput, createdAt: string, error: string, contextHash: string): ResearchSynthesisResult & { error: string } {
    return redactValue({
      synthesis_id: synthesisId,
      topic_id: input.topic_id,
      provider_id: this.provider.provider_id,
      title: "",
      summary: "",
      findings: [],
      risks: [],
      open_questions: [],
      recommended_actions: [],
      context_hash: contextHash,
      output_hash: "",
      created_at: createdAt,
      requested_by: redactText(input.requested_by),
      error: redactText(error),
    })
  }
}

function evidenceRow(evidenceType: ResearchSynthesisProviderEvidence["evidence_type"], evidenceId: string, title: string, content: string, createdAt?: string): ResearchSynthesisProviderEvidence {
  return {
    evidence_id: redactText(requiredString(evidenceId, "evidence_id")),
    evidence_type: evidenceType,
    title: boundedText(title, 512),
    content: boundedText(content, 4096),
    created_at: createdAt ? redactText(createdAt) : undefined,
  }
}

function compareEvidence(a: ResearchSynthesisProviderEvidence, b: ResearchSynthesisProviderEvidence): number {
  const date = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  if (date !== 0) return date
  const type = a.evidence_type.localeCompare(b.evidence_type)
  if (type !== 0) return type
  return a.evidence_id.localeCompare(b.evidence_id)
}

function evidenceBlock(row: ResearchSynthesisProviderEvidence): string {
  return redactText(`\n[${row.evidence_type}:${row.evidence_id}]\ntitle: ${row.title}\ncreated_at: ${row.created_at ?? "unknown"}\n${row.content}\n`)
}

function groupEvidence(rows: ResearchSynthesisProviderEvidence[]): BuiltContext["evidence"] {
  return {
    sources: rows.filter((row) => row.evidence_type === "source"),
    notes: rows.filter((row) => row.evidence_type === "note"),
    artifacts: rows.filter((row) => row.evidence_type === "artifact"),
    ingestions: rows.filter((row) => row.evidence_type === "ingestion"),
  }
}

function cleanProviderResult(result: ResearchSynthesisProviderResult, maxBytes: number, allowedEvidenceIds: Set<string>): ResearchSynthesisProviderResult {
  const cleaned: ResearchSynthesisProviderResult = {
    title: boundedText(requiredString(result.title, "title"), 512),
    summary: boundedText(requiredString(result.summary, "summary"), 4096),
    findings: cleanStringList(result.findings, "findings", 20, 1024),
    risks: cleanStringList(result.risks, "risks", 20, 1024),
    open_questions: cleanStringList(result.open_questions, "open_questions", 20, 1024),
    recommended_actions: cleanActions(result.recommended_actions, allowedEvidenceIds),
    confidence: result.confidence === "high" || result.confidence === "medium" || result.confidence === "low" ? result.confidence : "low",
  }
  while (byteLength(JSON.stringify(cleaned)) > maxBytes) {
    if (cleaned.recommended_actions.length > 0) cleaned.recommended_actions.pop()
    else if (cleaned.open_questions.length > 0) cleaned.open_questions.pop()
    else if (cleaned.risks.length > 0) cleaned.risks.pop()
    else if (cleaned.findings.length > 0) cleaned.findings.pop()
    else {
      cleaned.summary = boundedText(cleaned.summary, Math.max(0, maxBytes - 1024))
      break
    }
  }
  return redactValue(cleaned)
}

function cleanActions(value: ResearchSynthesisRecommendedAction[], allowedEvidenceIds: Set<string>): ResearchSynthesisRecommendedAction[] {
  if (!Array.isArray(value)) throw new Error("recommended_actions must be an array")
  return value.slice(0, 10).map((action, index) => {
    if (!action || typeof action !== "object") throw new Error(`recommended_actions[${index}] must be an object`)
    const evidenceIds = cleanStringList(action.evidence_ids, `recommended_actions[${index}].evidence_ids`, 20, 256)
    for (const evidenceId of evidenceIds) {
      if (!allowedEvidenceIds.has(evidenceId)) throw new Error(`recommended_actions[${index}].evidence_ids contains unknown evidence id`)
    }
    return {
      title: boundedText(requiredString(action.title, `recommended_actions[${index}].title`), 512),
      summary: boundedText(requiredString(action.summary, `recommended_actions[${index}].summary`), 2048),
      action_kind: action.action_kind === "other" ? "other" : "operator_checkpoint",
      evidence_ids: evidenceIds,
    }
  })
}

function cleanStringList(value: string[], field: string, limit: number, maxBytes: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.slice(0, limit).map((item, index) => boundedText(requiredString(item, `${field}[${index}]`), maxBytes))
}

function synthesisNoteContent(synthesisId: string, input: NormalizedInput, evidenceIds: string[], output: ResearchSynthesisProviderResult, contextHash: string, outputHash: string): string {
  return redactText([
    `# ${output.title}`,
    "",
    `synthesis_id: ${synthesisId}`,
    `topic_id: ${input.topic_id}`,
    `provider_id: ${input.provider_id}`,
    `requested_by: ${input.requested_by}`,
    `context_hash: ${contextHash}`,
    `output_hash: ${outputHash}`,
    `evidence_ids: ${evidenceIds.join(", ") || "none"}`,
    "",
    "## Summary",
    output.summary,
    "",
    "## Findings",
    ...output.findings.map((item) => `- ${item}`),
    "",
    "## Risks",
    ...output.risks.map((item) => `- ${item}`),
    "",
    "## Open Questions",
    ...output.open_questions.map((item) => `- ${item}`),
    "",
    "## Recommended Actions",
    ...output.recommended_actions.map((item) => `- ${item.action_kind}: ${item.title} (${item.evidence_ids.join(", ") || "none"}) ${item.summary}`),
  ].join("\n"))
}

function readResultFromEvent(event: Record<string, unknown>): ResearchSynthesisResult {
  return redactValue({
    synthesis_id: String(event.synthesis_id ?? ""),
    topic_id: String(event.topic_id ?? ""),
    provider_id: String(event.provider_id ?? ""),
    source_note_id: optionalEventString(event.source_note_id),
    artifact_id: optionalEventString(event.artifact_id),
    proposal_ids: eventStringArray(event.proposal_ids),
    title: String(event.title ?? ""),
    summary: String(event.summary ?? ""),
    findings: eventStringArray(event.findings),
    risks: eventStringArray(event.risks),
    open_questions: eventStringArray(event.open_questions),
    recommended_actions: Array.isArray(event.recommended_actions) ? event.recommended_actions : [],
    context_hash: String(event.context_hash ?? ""),
    output_hash: String(event.output_hash ?? ""),
    created_at: String(event.created_at ?? event.timestamp ?? ""),
    requested_by: String(event.requested_by ?? "unknown"),
  }) as ResearchSynthesisResult
}

function clampBytes(value: unknown, fallback: number, max: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), max)
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
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function eventStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(redactText) : []
}
