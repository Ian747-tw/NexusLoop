import { createHash } from "node:crypto"
import type { CommanderToolDescriptor, CommanderToolJsonSchema } from "../../../runtime/src/commander-tools/commander-tool-types"

export type { CommanderToolJsonSchema }
import { COMMANDER_TOOL_REGISTRY } from "../../../runtime/src/commander-tools/commander-tool-registry"

export type CandidateId = "minimal_custom_adapter" | "vercel_ai_sdk_core" | "openai_agents_core"
export type CommanderModelRole = "system" | "user" | "assistant" | "tool"

export type CommanderModelMessage = {
  role: CommanderModelRole
  content: string
  tool_call_id?: string
  tool_name?: string
}

export type CommanderModelToolSchema = {
  tool_id: string
  name: string
  description: string
  input_schema: CommanderToolJsonSchema
  strict_requested: boolean
  schema_hash: string
}

export type CommanderModelStepRequest = {
  request_id: string
  provider_kind: string
  model_id: string
  messages: CommanderModelMessage[]
  tools: CommanderModelToolSchema[]
  tool_choice: "auto" | "none" | "required"
  max_output_tokens?: number
  temperature?: number
  structured_output_schema?: CommanderToolJsonSchema
  abort_signal?: AbortSignal
  metadata: Record<string, string>
  requested_at: string
}

export type CommanderModelToolCall = {
  tool_call_id: string
  tool_id: string
  arguments: Record<string, unknown>
  raw_arguments?: string
  arguments_valid: boolean
  validation_errors: string[]
  source: "native" | "json_fallback"
  call_hash: string
}

export type CommanderModelUsage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cached_input_tokens?: number
  provider_reported: boolean
  raw_usage_summary?: Record<string, number | string | boolean>
}

export type CommanderModelStepStatus = "final" | "tool_call" | "refusal" | "malformed" | "cancelled" | "failed"

export type CommanderModelStepResult = {
  request_id: string
  candidate_id: CandidateId
  status: CommanderModelStepStatus
  text?: string
  tool_calls: CommanderModelToolCall[]
  finish_reason?: string
  usage: CommanderModelUsage
  provider_metadata: Record<string, unknown>
  raw_provider_payload_included: false
  duration_ms: number
  warnings: string[]
  error?: string
  result_hash: string
}

export type CommanderModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; tool_call_id: string; tool_id: string }
  | { type: "tool_call_arguments_delta"; tool_call_id: string; delta: string }
  | { type: "tool_call_complete"; tool_call: CommanderModelToolCall }
  | { type: "usage"; usage: CommanderModelUsage }
  | { type: "completed"; result: CommanderModelStepResult }
  | { type: "error"; error: string }

export type CommanderModelStepAdapter = {
  candidate_id: CandidateId
  candidate_version: string
  supports_streaming: boolean
  supports_native_tools: boolean
  supports_json_fallback: boolean
  supports_structured_output: boolean
  supports_abort_signal: boolean
  supports_usage: boolean
  supports_openai_compatible: boolean
  executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult>
  executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent>
}

export type CandidateOwnershipReport = {
  candidate_id: CandidateId
  nexusloop_owns_messages: boolean
  nexusloop_owns_tool_execution: boolean
  nexusloop_owns_loop: boolean
  nexusloop_owns_persistence: boolean
  nexusloop_owns_approval: boolean
  nexusloop_owns_tracing: boolean
  nexusloop_owns_cancellation: boolean
  hidden_second_request_detected: boolean
  hidden_tool_execution_detected: boolean
  hidden_persistence_detected: boolean
  hidden_network_detected: boolean
  blockers: string[]
  warnings: string[]
}

export type CandidateMatrixRow = {
  candidate_id: CandidateId
  decision_label: string
  package_versions: Record<string, string>
  licenses: Record<string, string>
  direct_dependency_count: number
  transitive_package_count: number
  installed_size_bytes: number
  cold_import_result: "pass" | "fail"
  typecheck_result: "pass" | "fail"
  deterministic_unit_result: "pass" | "fail"
  local_openai_compatible_result: "pass" | "fail" | "not_applicable"
  native_tool_call_result: "pass" | "fail" | "partial"
  json_fallback_result: "pass" | "fail"
  streaming_result: "pass" | "fail" | "partial"
  cancellation_result: "pass" | "fail" | "partial"
  usage_result: "pass" | "fail" | "partial"
  schema_compatibility_result: "pass" | "fail"
  authority_ownership_result: "pass" | "fail" | "partial"
  network_isolation_result: "pass" | "fail"
  scores: Record<string, number>
  weighted_score: number
  limitations: string[]
  disqualified: boolean
  disqualification_reasons: string[]
}

export type SpikeResults = {
  final_decision: "adopt_ai_sdk_core" | "adopt_openai_agents_core" | "retain_minimal_custom_adapter" | "hybrid_ai_sdk_core_with_nexusloop_loop"
  weights: Record<string, number>
  candidates: CandidateMatrixRow[]
  hard_disqualifications: Record<CandidateId, string[]>
  package_versions: Record<string, string>
  sdk_session_is_not_nexusloop_memory: true
  sdk_trace_is_not_nexusloop_event_ledger: true
  sdk_approval_is_not_nexusloop_authority: true
  sdk_tool_execution_is_not_nexusloop_tool_execution: true
  sdk_agent_loop_is_not_nexusloop_commander_controller: true
  recommendation_9w1: string
}

export const SPIKE_TOOL_IDS = [
  "commander.tool_search",
  "memory.search",
  "continuity.search",
  "repo.search_text",
  "repo.read_lines",
  "repo.git_status",
  "repo.git_diff",
] as const

export function selectedCommanderTools(): CommanderToolDescriptor[] {
  return SPIKE_TOOL_IDS.map((toolId) => {
    const found = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === toolId)
    if (!found) throw new Error(`missing Commander descriptor ${toolId}`)
    return found
  })
}

export function toModelTool(tool: CommanderToolDescriptor): CommanderModelToolSchema {
  if (!tool.input_schema) throw new Error(`missing input schema for ${tool.tool_id}`)
  const propertyNames = Object.keys(tool.input_schema.properties)
  return {
    tool_id: tool.tool_id,
    name: toolNameFor(tool.tool_id),
    description: tool.description,
    input_schema: structuredClone(tool.input_schema),
    strict_requested: propertyNames.length > 0 && propertyNames.every((property) => tool.input_schema!.required.includes(property)),
    schema_hash: hashStable(tool.input_schema),
  }
}

export function toolNameFor(toolId: string): string {
  return toolId.replace(/\./g, "__")
}

export function toolForSdkName(tools: CommanderModelToolSchema[], name: string): CommanderModelToolSchema | undefined {
  return tools.find((tool) => toolNameFor(tool.tool_id) === name)
    ?? tools.find((tool) => tool.tool_id.replace(".", "_") === name)
}

export function validateArguments(tool: CommanderModelToolSchema, value: unknown): { valid: boolean; errors: string[]; arguments: Record<string, unknown> } {
  if (!isRecord(value)) return { valid: false, errors: ["arguments must be an object"], arguments: {} }
  const errors: string[] = []
  for (const required of tool.input_schema.required) {
    if (!(required in value)) errors.push(`missing required field ${required}`)
  }
  if (tool.input_schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!(key in tool.input_schema.properties)) errors.push(`unknown field ${key}`)
  }
  for (const [key, schema] of Object.entries(tool.input_schema.properties)) {
    if (!(key in value)) continue
    const field = value[key]
    if (schema.type === "string" && typeof field !== "string") errors.push(`${key} must be string`)
    if (schema.type === "boolean" && typeof field !== "boolean") errors.push(`${key} must be boolean`)
    if (schema.type === "integer" && (!Number.isInteger(field) || typeof field !== "number")) errors.push(`${key} must be integer`)
    if (schema.type === "number" && typeof field !== "number") errors.push(`${key} must be number`)
    if (schema.type === "array" && !Array.isArray(field)) errors.push(`${key} must be array`)
    if (schema.type === "object" && !isRecord(field)) errors.push(`${key} must be object`)
    if (schema.enum && typeof field === "string" && !schema.enum.includes(field)) errors.push(`${key} must be one of ${schema.enum.join(",")}`)
    if (schema.maxLength && typeof field === "string" && field.length > schema.maxLength) errors.push(`${key} exceeds maxLength`)
    if (schema.minimum !== undefined && typeof field === "number" && field < schema.minimum) errors.push(`${key} below minimum`)
    if (schema.maximum !== undefined && typeof field === "number" && field > schema.maximum) errors.push(`${key} above maximum`)
  }
  return { valid: errors.length === 0, errors, arguments: value }
}

export function makeToolCall(tool: CommanderModelToolSchema | undefined, rawName: string, rawArguments: string, source: "native" | "json_fallback", id = `call_${hashStable({ rawName, rawArguments }).slice(0, 12)}`): CommanderModelToolCall {
  let parsed: unknown = {}
  const errors: string[] = []
  try {
    parsed = rawArguments ? JSON.parse(rawArguments) : {}
  } catch {
    errors.push("tool arguments are not valid JSON")
  }
  const normalizedId = tool?.tool_id ?? rawName
  const validated = tool ? validateArguments(tool, parsed) : { valid: false, errors: ["unknown tool_id"], arguments: isRecord(parsed) ? parsed : {} }
  return {
    tool_call_id: id,
    tool_id: normalizedId,
    arguments: validated.arguments,
    raw_arguments: rawArguments.slice(0, 4096),
    arguments_valid: errors.length === 0 && validated.valid,
    validation_errors: [...errors, ...validated.errors].slice(0, 8),
    source,
    call_hash: hashStable({ id, normalizedId, rawArguments, source }),
  }
}

export function finalizeResult(input: Omit<CommanderModelStepResult, "raw_provider_payload_included" | "result_hash">): CommanderModelStepResult {
  const result = { ...input, raw_provider_payload_included: false as const, result_hash: "" }
  result.result_hash = hashStable({ ...result, duration_ms: 0 })
  return result
}

export function baseRequest(overrides: Partial<CommanderModelStepRequest> = {}): CommanderModelStepRequest {
  const tools = selectedCommanderTools().map(toModelTool)
  return {
    request_id: "req_fixture",
    provider_kind: "openai_compatible",
    model_id: "fixture-model",
    messages: [{ role: "user", content: "Return the fixture response." }],
    tools,
    tool_choice: "auto",
    max_output_tokens: 256,
    temperature: 0,
    metadata: { fixture: "true" },
    requested_at: "2026-07-16T00:00:00.000Z",
    ...overrides,
  }
}

export function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
