import type { ExternalApiRequestService } from "../external-api/api-request-service"
import type { ExternalApiConnector } from "../external-api/api-connector-types"
import { redactText, redactValue } from "../security/redaction"
import type { CommanderCycleProvider, CommanderCycleProviderInput, CommanderCycleProviderResult } from "../commander-cycle/commander-cycle-provider"
import type { ResearchSynthesisProvider, ResearchSynthesisProviderInput, ResearchSynthesisProviderResult } from "../research-synthesis/research-synthesis-provider"
import type { ReasoningProviderConfig } from "./reasoning-provider-config"
import { validateReasoningProviderConfig } from "./reasoning-provider-config"
import type { MiniMaxMessageRequest, MiniMaxMessageResponse } from "./minimax-provider-types"

const MINIMAX_MESSAGES_PATH = "/v1/messages"
const SYSTEM_PROMPT_VERSION = "nxl-reasoning-v1"
const ERROR_PREVIEW_BYTES = 512

export interface MiniMaxReasoningProviderOptions {
  config: ReasoningProviderConfig
  requestService: ExternalApiRequestService
  connector?: ExternalApiConnector
}

export class MiniMaxReasoningProvider implements ResearchSynthesisProvider, CommanderCycleProvider {
  readonly provider_id: string
  private readonly config: ReasoningProviderConfig

  constructor(private readonly options: MiniMaxReasoningProviderOptions) {
    this.config = validateReasoningProviderConfig(options.config)
    if (this.config.kind !== "minimax") throw new Error("MiniMaxReasoningProvider requires minimax config")
    this.provider_id = this.config.provider_id
  }

  async synthesize(input: ResearchSynthesisProviderInput): Promise<ResearchSynthesisProviderResult> {
    const payload = await this.callMiniMax(
      "research_synthesis",
      researchSynthesisPrompt(input),
      input.max_output_bytes,
    )
    return readResearchSynthesisResult(payload)
  }

  async run(input: CommanderCycleProviderInput): Promise<CommanderCycleProviderResult> {
    const payload = await this.callMiniMax(
      "commander_cycle",
      commanderCyclePrompt(input),
      input.max_output_bytes,
    )
    return readCommanderCycleResult(payload)
  }

  private async callMiniMax(surface: "research_synthesis" | "commander_cycle", prompt: Record<string, unknown>, maxOutputBytes: number): Promise<Record<string, unknown>> {
    if (!this.config.enabled_for.includes(surface)) throw new Error(`MiniMax reasoning provider is not enabled for ${surface}`)
    const body = JSON.stringify(messageRequest(this.config, surface, prompt, maxOutputBytes))
    if (byteLength(body) > this.config.max_input_bytes) {
      throw new Error(`MiniMax reasoning request exceeds max_input_bytes: ${this.config.max_input_bytes}`)
    }
    try {
      const result = await this.options.requestService.executeForInternalUse({
        connector_id: this.config.connector_id ?? "",
        method: "POST",
        path: this.messagesPath(),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        requested_by: `reasoning-provider:${this.config.provider_id}`,
      }, {
        timeout_ms: this.config.timeout_ms,
        redact_response_body: false,
        omit_response_preview_from_audit: true,
      })
      if (!result.ok) throw new Error(result.error ?? "MiniMax reasoning request failed")
      const rawText = textFromAnthropicResponse(result.response_body_for_internal_use ?? result.response_preview ?? "")
      const parsed = parseJsonObject(rawText)
      const bounded = JSON.stringify(parsed)
      if (byteLength(bounded) > Math.min(maxOutputBytes, this.config.max_output_bytes)) {
        throw new Error("MiniMax reasoning response exceeds max_output_bytes")
      }
      return redactValue(parsed)
    } catch (error) {
      throw new Error(`MiniMax reasoning provider failed: ${boundedError(error)}`)
    }
  }

  private messagesPath(): string {
    if (!this.options.connector) return MINIMAX_MESSAGES_PATH
    const base = new URL(this.options.connector.base_url)
    const prefix = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "")
    if (prefix.endsWith("/v1")) return `${prefix}/messages`
    return `${prefix}${MINIMAX_MESSAGES_PATH}`
  }
}

function messageRequest(config: ReasoningProviderConfig, surface: string, prompt: Record<string, unknown>, maxOutputBytes: number): MiniMaxMessageRequest {
  return {
    model: config.model ?? "",
    max_tokens: Math.max(1, Math.floor(Math.min(maxOutputBytes, config.max_output_bytes) / 4)),
    system: [
      `NexusLoop reasoning provider ${config.system_prompt_version ?? SYSTEM_PROMPT_VERSION}.`,
      "Return strict JSON only. Do not include markdown prose.",
      "Use only supplied evidence IDs and synthesis IDs. Do not invent IDs.",
      "Do not request review, apply proposals, mutate missions, launch OpenCode, crawl, or call APIs.",
    ].join(" "),
    messages: [{ role: "user", content: JSON.stringify(prompt) }],
  }
}

function researchSynthesisPrompt(input: ResearchSynthesisProviderInput): Record<string, unknown> {
  const evidenceIds = [...input.sources, ...input.notes, ...input.artifacts, ...input.ingestions].map((item) => item.evidence_id)
  return redactValue({
    task: "research_synthesis",
    schema: {
      title: "string",
      summary: "string",
      findings: ["string"],
      risks: ["string"],
      open_questions: ["string"],
      recommended_actions: [{
        title: "string",
        summary: "string",
        action_kind: "operator_checkpoint|other",
        evidence_ids: ["allowed evidence id only"],
      }],
      confidence: "low|medium|high",
    },
    topic_id: input.topic_id,
    topic_title: input.topic_title,
    objective: input.objective,
    allowed_evidence_ids: evidenceIds,
    evidence: {
      sources: input.sources,
      notes: input.notes,
      artifacts: input.artifacts,
      ingestions: input.ingestions,
    },
    max_output_bytes: input.max_output_bytes,
    requested_by: input.requested_by,
  })
}

function commanderCyclePrompt(input: CommanderCycleProviderInput): Record<string, unknown> {
  const evidenceIds = [...input.sources, ...input.notes, ...input.artifacts].map((item) => item.evidence_id)
  const synthesisIds = input.syntheses.map((item) => item.synthesis_id)
  return redactValue({
    task: "commander_cycle",
    schema: {
      title: "string",
      summary: "string",
      findings: ["string"],
      risks: ["string"],
      recommended_actions: [{
        title: "string",
        summary: "string",
        action_kind: "operator_checkpoint|other",
        rationale: "string",
        evidence_ids: ["allowed evidence id only"],
        synthesis_ids: ["allowed synthesis id only"],
        related_target_type: "string optional",
        related_target_id: "string optional",
      }],
      should_create_proposals: false,
      confidence: "low|medium|high",
    },
    cycle_id: input.cycle_id,
    objective: input.objective,
    topic_id: input.topic_id,
    mission_id: input.mission_id,
    topic_title: input.topic_title,
    mission_status: input.mission_status,
    mission_objective: input.mission_objective,
    allowed_evidence_ids: evidenceIds,
    allowed_synthesis_ids: synthesisIds,
    evidence: {
      sources: input.sources,
      notes: input.notes,
      artifacts: input.artifacts,
    },
    syntheses: input.syntheses,
    queue_items: input.queue_items,
    max_output_bytes: input.max_output_bytes,
    requested_by: input.requested_by,
  })
}

function textFromAnthropicResponse(value: string): string {
  let parsed: MiniMaxMessageResponse
  try {
    parsed = JSON.parse(value) as MiniMaxMessageResponse
  } catch {
    return value
  }
  if (!Array.isArray(parsed.content)) throw new Error("MiniMax response content must be an array")
  const text = parsed.content.map((block) => {
    if (typeof block === "string") return block
    if (block && (block.type === undefined || block.type === "text") && typeof block.text === "string") return block.text
    return ""
  }).join("\n").trim()
  if (!text) throw new Error("MiniMax response contained no text content")
  return text
}

function parseJsonObject(value: string): Record<string, unknown> {
  const stripped = stripCodeFence(value.trim())
  try {
    const parsed = JSON.parse(stripped)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MiniMax JSON response must be an object")
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`MiniMax response was not valid JSON: ${boundedText(stripped, ERROR_PREVIEW_BYTES)}`)
  }
}

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim() ?? value
}

function readResearchSynthesisResult(value: Record<string, unknown>): ResearchSynthesisProviderResult {
  return {
    title: requiredString(value.title, "title"),
    summary: requiredString(value.summary, "summary"),
    findings: stringArray(value.findings, "findings"),
    risks: stringArray(value.risks, "risks"),
    open_questions: stringArray(value.open_questions, "open_questions"),
    recommended_actions: arrayOfRecords(value.recommended_actions, "recommended_actions").map((action, index) => ({
      title: requiredString(action.title, `recommended_actions[${index}].title`),
      summary: requiredString(action.summary, `recommended_actions[${index}].summary`),
      action_kind: action.action_kind === "other" ? "other" : "operator_checkpoint",
      evidence_ids: stringArray(action.evidence_ids, `recommended_actions[${index}].evidence_ids`),
    })),
    confidence: readConfidence(value.confidence),
  }
}

function readCommanderCycleResult(value: Record<string, unknown>): CommanderCycleProviderResult {
  return {
    title: requiredString(value.title, "title"),
    summary: requiredString(value.summary, "summary"),
    findings: stringArray(value.findings, "findings"),
    risks: stringArray(value.risks, "risks"),
    recommended_actions: arrayOfRecords(value.recommended_actions, "recommended_actions").map((action, index) => ({
      title: requiredString(action.title, `recommended_actions[${index}].title`),
      summary: requiredString(action.summary, `recommended_actions[${index}].summary`),
      action_kind: action.action_kind === "other" ? "other" : "operator_checkpoint",
      rationale: requiredString(action.rationale, `recommended_actions[${index}].rationale`),
      evidence_ids: stringArray(action.evidence_ids ?? [], `recommended_actions[${index}].evidence_ids`),
      synthesis_ids: stringArray(action.synthesis_ids ?? [], `recommended_actions[${index}].synthesis_ids`),
      related_target_type: optionalString(action.related_target_type, `recommended_actions[${index}].related_target_type`),
      related_target_id: optionalString(action.related_target_id, `recommended_actions[${index}].related_target_id`),
    })),
    should_create_proposals: value.should_create_proposals === true,
    confidence: readConfidence(value.confidence),
  }
}

function arrayOfRecords(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${field}[${index}] must be an object`)
    return item as Record<string, unknown>
  })
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`))
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field)
}

function readConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value
  return "low"
}

function boundedError(error: unknown): string {
  return boundedText(error instanceof Error ? error.message : String(error), ERROR_PREVIEW_BYTES)
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
