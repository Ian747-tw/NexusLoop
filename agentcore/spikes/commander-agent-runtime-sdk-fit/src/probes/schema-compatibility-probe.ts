import type { CommanderToolDescriptor } from "../../../../runtime/src/commander-tools/commander-tool-types"
import { hashStable, isRecord, selectedCommanderTools, toModelTool, validateArguments } from "../contracts"

export type SchemaProbeResult = {
  status: "pass" | "fail"
  checked_tool_ids: string[]
  errors: string[]
  schema_hashes: Record<string, string>
}

export function runSchemaCompatibilityProbe(tools: CommanderToolDescriptor[] = selectedCommanderTools()): SchemaProbeResult {
  const errors: string[] = []
  const hashes: Record<string, string> = {}
  for (const descriptor of tools) {
    const before = hashStable(descriptor)
    const converted = toModelTool(descriptor)
    hashes[descriptor.tool_id] = converted.schema_hash
    const requiredArgs = validArgsFor(descriptor)
    const valid = validateArguments(converted, requiredArgs)
    if (!valid.valid) errors.push(`${descriptor.tool_id}: valid arguments rejected: ${valid.errors.join(",")}`)
    const missing = validateArguments(converted, {})
    if (descriptor.input_schema?.required.length && missing.valid) errors.push(`${descriptor.tool_id}: missing required fields accepted`)
    const extra = validateArguments(converted, { ...requiredArgs, unexpected: true })
    if (extra.valid) errors.push(`${descriptor.tool_id}: additionalProperties=false was not enforced`)
    if (hashStable(descriptor) !== before) errors.push(`${descriptor.tool_id}: descriptor mutated during conversion`)
  }
  return { status: errors.length ? "fail" : "pass", checked_tool_ids: tools.map((tool) => tool.tool_id), errors, schema_hashes: hashes }
}

function validArgsFor(descriptor: CommanderToolDescriptor): Record<string, unknown> {
  const schema = descriptor.input_schema
  if (!schema) return {}
  const out: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!schema.required.includes(key)) continue
    if (property.enum?.length) out[key] = property.enum[0]
    else if (property.type === "string") out[key] = key === "scope" ? "working_tree" : "fixture"
    else if (property.type === "boolean") out[key] = true
    else if (property.type === "integer" || property.type === "number") out[key] = property.minimum ?? 1
    else if (property.type === "array") out[key] = []
    else if (property.type === "object") out[key] = {}
  }
  if (Object.keys(out).length === 0 && isRecord(schema.properties.query)) out.query = "fixture"
  return out
}
