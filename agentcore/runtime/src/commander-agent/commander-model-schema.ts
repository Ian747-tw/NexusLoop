import { createHash } from "node:crypto"
import { redactText } from "../security/redaction"
import type { CommanderToolDescriptor, CommanderToolJsonSchema, CommanderToolJsonSchemaProperty } from "../commander-tools/commander-tool-types"
import type { CommanderModelToolCallPart, CommanderModelToolSchema } from "./commander-model-types"

const MAX_ARRAY_ITEMS = 100
const MAX_NESTING = 8

export function commanderToolSchemaFromDescriptor(descriptor: CommanderToolDescriptor): CommanderModelToolSchema {
  if (!descriptor.input_schema) throw new Error(`Commander tool ${descriptor.tool_id} has no input schema`)
  const providerName = providerToolNameFor(descriptor.tool_id)
  return {
    tool_id: descriptor.tool_id,
    provider_tool_name: providerName,
    description: descriptor.description.slice(0, 800),
    input_schema: structuredClone(descriptor.input_schema),
    schema_hash: stableHash(descriptor.input_schema),
    strict_requested: isStrictProviderCompatible(descriptor.input_schema),
  }
}

export function providerToolNameFor(toolId: string): string {
  const mapped = toolId.replace(/\./g, "__")
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(mapped)) throw new Error("provider tool name is unsupported")
  return mapped
}

export function buildProviderToolMap(tools: CommanderModelToolSchema[]): Map<string, CommanderModelToolSchema> {
  const map = new Map<string, CommanderModelToolSchema>()
  for (const tool of tools) {
    if (map.has(tool.provider_tool_name)) throw new Error(`provider tool name collision for ${tool.provider_tool_name}`)
    map.set(tool.provider_tool_name, tool)
  }
  return map
}

export function providerJsonSchema(schema: CommanderToolJsonSchema): Omit<CommanderToolJsonSchema, "schema_version"> {
  const clone = structuredClone(schema) as CommanderToolJsonSchema
  const { schema_version: _schemaVersion, ...providerSchema } = clone
  return providerSchema
}

export function validateCommanderToolArguments(schema: CommanderToolJsonSchema, value: unknown): { valid: boolean; errors: string[]; arguments: Record<string, unknown> } {
  const errors: string[] = []
  validateObjectSchema(schema, value, "$", errors, 0)
  return {
    valid: errors.length === 0,
    errors: errors.map((item) => redactText(item)).slice(0, 12),
    arguments: isRecord(value) ? value : {},
  }
}

export function makeCommanderToolCall(tool: CommanderModelToolSchema | undefined, rawProviderName: string, rawArguments: unknown, toolCallId: string, source: "native" | "json_fallback"): CommanderModelToolCallPart {
  const rawString = typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments ?? {})
  let parsed: unknown = {}
  const parseErrors: string[] = []
  try {
    parsed = typeof rawArguments === "string" ? JSON.parse(rawArguments || "{}") : rawArguments ?? {}
  } catch {
    parseErrors.push("tool arguments are not valid JSON")
  }
  const validated = tool ? validateCommanderToolArguments(tool.input_schema, parsed) : { valid: false, errors: ["unknown provider tool name"], arguments: isRecord(parsed) ? parsed : {} }
  const toolId = tool?.tool_id ?? rawProviderName
  return {
    type: "tool_call",
    tool_call_id: toolCallId || `call_${stableHash({ rawProviderName, rawString }).slice(0, 12)}`,
    tool_id: toolId,
    arguments: validated.arguments,
    raw_arguments: rawString.slice(0, 4096),
    arguments_valid: parseErrors.length === 0 && validated.valid,
    validation_errors: [...parseErrors, ...validated.errors].slice(0, 12),
    call_hash: stableHash({ toolCallId, toolId, rawString, source }),
  }
}

export function parseJsonFallback(text: string, tools: CommanderModelToolSchema[]): { status: "final"; summary: string } | { status: "tool_call"; call: CommanderModelToolCallPart } | { status: "malformed"; error: string } {
  const raw = text.trim()
  if (Buffer.byteLength(raw) > 4096) return { status: "malformed", error: "json fallback text exceeds maximum bytes" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: "malformed", error: "json fallback is not valid JSON" }
  }
  if (!isRecord(parsed)) return { status: "malformed", error: "json fallback root must be object" }
  const keys = Object.keys(parsed).sort()
  if (parsed.type === "tool_call") {
    if (keys.some((key) => !["arguments", "tool_id", "type"].includes(key))) return { status: "malformed", error: "json fallback tool_call has unknown keys" }
    if (typeof parsed.tool_id !== "string") return { status: "malformed", error: "json fallback tool_call requires tool_id" }
    if (!isRecord(parsed.arguments)) return { status: "malformed", error: "json fallback tool_call arguments must be object" }
    const tool = tools.find((item) => item.tool_id === parsed.tool_id)
    if (!tool) return { status: "malformed", error: "json fallback references unknown tool_id" }
    const call = makeCommanderToolCall(tool, tool.provider_tool_name, parsed.arguments, `fallback_${stableHash(parsed).slice(0, 12)}`, "json_fallback")
    return call.arguments_valid ? { status: "tool_call", call } : { status: "malformed", error: call.validation_errors.join("; ") }
  }
  if (parsed.type === "final") {
    if (keys.some((key) => !["final", "type"].includes(key))) return { status: "malformed", error: "json fallback final has unknown keys" }
    if (!isRecord(parsed.final) || typeof parsed.final.summary !== "string" || !parsed.final.summary.trim()) return { status: "malformed", error: "json fallback final summary is required" }
    return { status: "final", summary: redactText(parsed.final.summary).slice(0, 2000) }
  }
  return { status: "malformed", error: "json fallback type is unsupported" }
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function isStrictProviderCompatible(schema: CommanderToolJsonSchema): boolean {
  const fields = Object.keys(schema.properties)
  return fields.length > 0 && fields.every((field) => schema.required.includes(field))
}

function validateObjectSchema(schema: CommanderToolJsonSchema, value: unknown, path: string, errors: string[], depth: number): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`)
    return
  }
  if (depth > MAX_NESTING) {
    errors.push(`${path} exceeds maximum nesting`)
    return
  }
  for (const required of schema.required) if (!(required in value)) errors.push(`${path}.${required} is required`)
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!(key in schema.properties)) errors.push(`${path}.${key} is unknown`)
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in value)) continue
    validateProperty(property, (value as Record<string, unknown>)[key], `${path}.${key}`, errors, depth + 1)
  }
}

function validateProperty(schema: CommanderToolJsonSchemaProperty, value: unknown, path: string, errors: string[], depth: number): void {
  if (depth > MAX_NESTING) {
    errors.push(`${path} exceeds maximum nesting`)
    return
  }
  if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${path} must be string`)
    else {
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(",")}`)
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} exceeds maxLength`)
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path} must be boolean`)
  } else if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${path} must be integer`)
    else validateNumberBounds(schema, value, path, errors)
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be number`)
    else validateNumberBounds(schema, value, path, errors)
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) errors.push(`${path} must be array`)
    else {
      if (value.length > MAX_ARRAY_ITEMS) errors.push(`${path} exceeds maximum item count`)
      for (const [index, item] of value.slice(0, MAX_ARRAY_ITEMS).entries()) if (schema.items) validateProperty(schema.items, item, `${path}[${index}]`, errors, depth + 1)
    }
  } else if (schema.type === "object") {
    const objectSchema: CommanderToolJsonSchema = { schema_version: "nxl-commander-tool-v1", type: "object", properties: schema.properties ?? {}, required: schema.required ?? [], additionalProperties: schema.additionalProperties ?? false }
    validateObjectSchema(objectSchema, value, path, errors, depth + 1)
  }
}

function validateNumberBounds(schema: CommanderToolJsonSchemaProperty, value: number, path: string, errors: string[]): void {
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} below minimum`)
  if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} above maximum`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return val
  })
}
