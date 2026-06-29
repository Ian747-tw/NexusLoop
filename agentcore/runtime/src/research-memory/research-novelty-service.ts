import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { ResearchMemoryService } from "./research-memory-service"
import type {
  ResearchMemoryCandidate,
  ResearchNoveltyInput,
  ResearchNoveltyPreview,
  ResearchNoveltyRisk,
} from "./research-memory-types"

const ACCEPTABLE_REPETITION_REASONS = [
  "changed_model",
  "changed_dataset",
  "changed_method",
  "changed_hyperparameter_or_config",
  "bug_fix",
  "replication",
  "previous_result_inconclusive",
  "new_external_evidence",
  "human_directed_repeat",
]

export type ResearchNoveltyServiceOptions = {
  memoryService: ResearchMemoryService
  now?: () => Date
}

export class ResearchNoveltyService {
  private readonly now: () => Date

  constructor(private readonly options: ResearchNoveltyServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  preview(input: ResearchNoveltyInput = {}): ResearchNoveltyPreview {
    const generatedAt = this.now().toISOString()
    const question = bound(input.question ?? "")
    const method = optionalBound(input.method)
    const config = optionalBound(input.config)
    const repetitionReason = optionalBound(input.repetition_reason, 160)
    const blockers: string[] = []
    if (!question) blockers.push("research novelty preview requires question=<question>")
    const query = [question, method, config].filter(Boolean).join(" ")
    const retrieval = this.options.memoryService.preview({
      query,
      labels: input.labels,
      limit: input.limit,
      mission_id: input.mission_id,
      session_id: input.session_id,
      include_failures: input.include_failures !== false,
      include_artifacts: true,
    })
    const warnings = new Set<string>([
      "novelty preview is advisory only; it does not decide research direction or block Commander by topic",
      ...retrieval.warnings,
    ])
    const nearest = blockers.length === 0 ? retrieval.candidates.slice(0, Math.max(1, Math.min(input.limit ?? 5, 8))) : []
    const top = nearest[0]
    const duplicateRisk = blockers.length > 0 ? "unknown" : riskFor(top, method, config, retrieval.status, retrieval.retrieval_policy)
    const hasReason = !!repetitionReason
    const repetitionRequiresJustification = (duplicateRisk === "high" || duplicateRisk === "medium") && !hasReason
    if (repetitionRequiresJustification) warnings.add("similar prior work was found; repetition needs an explicit justification")
    if (hasReason) warnings.add("repetition reason supplied; Commander/human may justify repeated work")
    const missingMemoryWarning = retrieval.status === "blocked" || retrieval.retrieval_policy === "empty_projection"
    if (missingMemoryWarning) warnings.add("internal research memory is empty or unavailable; this does not block Commander")
    const noveltyScore = noveltyScoreFor(duplicateRisk, hasReason, missingMemoryWarning)
    const noveltyHash = hash(stableJson({
      question,
      method,
      config,
      repetitionReason,
      nearest: nearest.map((candidate) => [candidate.result_id, candidate.duplicate_similarity_score]),
      duplicateRisk,
    }))
    const status = blockers.length > 0 ? "blocked" : retrieval.status === "ready" ? "ready" : "partial"
    return redactValue({
      preview_id: `research_novelty_${noveltyHash.slice(0, 16)}`,
      status,
      proposed_question_preview: question,
      proposed_method_preview: method,
      proposed_config_preview: config,
      nearest_prior_results: nearest,
      duplicate_risk: duplicateRisk,
      novelty_score: noveltyScore,
      difference_summary_preview: differenceSummary(duplicateRisk, top, method, config, repetitionReason),
      repetition_requires_justification: repetitionRequiresJustification,
      acceptable_repetition_reasons: ACCEPTABLE_REPETITION_REASONS,
      suggested_reason_not_duplicate: repetitionReason,
      missing_memory_warning: missingMemoryWarning,
      external_research_recommended: shouldRecommendExternalResearch(query, missingMemoryWarning, duplicateRisk),
      blockers: blockers.map((item) => bound(item)),
      warnings: Array.from(warnings).map((item) => bound(item)).slice(0, 14),
      recommended_commands: [
        { label: "Research memory search", command: `/research-memory-search query=${bound(query, 80)}`, command_type: "read" as const },
        { label: "Commander context packet preview", command: "/context-packet-preview purpose=commander_research_decision", command_type: "read" as const },
        { label: "Show authority", command: "/authority-show /research-novelty-preview", command_type: "read" as const },
      ],
      generated_at: generatedAt,
      novelty_hash: noveltyHash,
    })
  }
}

export function readResearchNoveltyInput(value: unknown): ResearchNoveltyInput {
  const input = isRecord(value) ? value : {}
  return {
    question: optional(input.question),
    method: optional(input.method),
    config: optional(input.config),
    labels: arrayOfStrings(input.labels),
    limit: optionalNumber(input.limit),
    mission_id: optional(input.missionId ?? input.mission_id ?? input.mission),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    repetition_reason: optional(input.repetitionReason ?? input.repetition_reason ?? input.reason),
    include_failures: optionalBoolean(input.includeFailures ?? input.include_failures),
  }
}

export { ACCEPTABLE_REPETITION_REASONS }

function riskFor(top: ResearchMemoryCandidate | undefined, method: string | undefined, config: string | undefined, retrievalStatus: string, retrievalPolicy: string): ResearchNoveltyRisk {
  if (retrievalStatus === "blocked") return "unknown"
  if (retrievalStatus === "empty") return retrievalPolicy === "empty_projection" ? "unknown" : "low"
  if (!top) return "low"
  const methodOverlap = method ? tokenOverlap(method, [top.method_preview, top.config_preview].join(" ")) : 0
  const configOverlap = config ? tokenOverlap(config, top.config_preview ?? "") : 0
  const score = top.duplicate_similarity_score
  if (score >= 0.75) return "high"
  if (score >= 0.35) return "medium"
  return "low"
}

function noveltyScoreFor(risk: ResearchNoveltyRisk, hasReason: boolean, missingMemory: boolean): number {
  if (missingMemory) return 0.5
  if (risk === "high") return hasReason ? 0.45 : 0.2
  if (risk === "medium") return hasReason ? 0.65 : 0.5
  if (risk === "low") return 0.85
  return 0.5
}

function differenceSummary(risk: ResearchNoveltyRisk, top: ResearchMemoryCandidate | undefined, method: string | undefined, config: string | undefined, reason: string | undefined): string {
  if (!top && risk === "low") return "No matching internal prior result was found in the bounded memory preview; duplicate risk is low without blocking Commander."
  if (!top) return "No bounded internal prior result was available; Commander should treat novelty as unknown until memory or external research is checked."
  if (reason) return bound(`Repetition is justified by: ${reason}. Nearest prior result is ${top.result_id} with risk=${risk}.`)
  if (risk === "high") return bound(`Nearest prior result ${top.result_id} strongly overlaps; repeat only with changed model/dataset/method/config, bug fix, replication, inconclusive prior result, new evidence, or human direction.`)
  if (risk === "medium") return bound(`Nearest prior result ${top.result_id} shares the research question but may differ in method/config; Commander should state why this is not a duplicate.`)
  return bound(`Nearest prior result ${top.result_id} has weak overlap; no topic block is applied.`)
}

function shouldRecommendExternalResearch(query: string, missingMemory: boolean, risk: ResearchNoveltyRisk): boolean {
  if (missingMemory) return true
  if (risk === "low" && /\b(latest|paper|arxiv|github|sota|literature|external|new)\b/i.test(query)) return true
  return false
}

function tokenOverlap(left: string, right: string): number {
  const rightTokens = new Set(tokens(right))
  return tokens(left).filter((token) => rightTokens.has(token)).length
}

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalBound(value: unknown, max = 240): string | undefined {
  const text = optional(value)
  return text ? bound(text, max) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string").map((item) => bound(item, 80)).filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function bound(value: string, max = 240): string {
  const redacted = redactText(String(value))
  return redacted.length <= max ? redacted : `${redacted.slice(0, Math.max(0, max - 1))}…`
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]))
}
