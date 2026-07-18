import type { CommanderToolJsonSchema } from "../commander-tools/commander-tool-types"

export type CommanderModelTextPart = { type: "text"; text: string }
export type CommanderModelToolCallPart = {
  type: "tool_call"
  tool_call_id: string
  tool_id: string
  arguments: Record<string, unknown>
  raw_arguments?: string
  arguments_valid: boolean
  validation_errors: string[]
  call_hash: string
}
export type CommanderModelAssistantPart = CommanderModelTextPart | CommanderModelToolCallPart
export type CommanderModelSystemMessage = { role: "system"; content: string }
export type CommanderModelUserMessage = { role: "user"; content: string }
export type CommanderModelAssistantMessage = { role: "assistant"; content: CommanderModelAssistantPart[] }
export type CommanderModelToolResultMessage = {
  role: "tool"
  tool_call_id: string
  tool_id: string
  content: string
  content_hash: string
  truncated: boolean
  source_execution_id?: string
}
export type CommanderModelMessage = CommanderModelSystemMessage | CommanderModelUserMessage | CommanderModelAssistantMessage | CommanderModelToolResultMessage

export type CommanderModelToolProtocol = "native" | "json_fallback"
export type CommanderModelToolChoice = "auto" | "none" | "required"

export type CommanderModelToolSchema = {
  tool_id: string
  provider_tool_name: string
  description: string
  input_schema: CommanderToolJsonSchema
  schema_hash: string
  strict_requested: boolean
}

export type CommanderModelStepRequest = {
  request_id: string
  provider_id: string
  provider_kind: string
  model_id: string
  messages: CommanderModelMessage[]
  tools: CommanderModelToolSchema[]
  tool_protocol: CommanderModelToolProtocol
  tool_choice: CommanderModelToolChoice
  max_output_tokens?: number
  temperature?: number
  structured_output_schema?: CommanderToolJsonSchema
  abort_signal?: AbortSignal
  metadata?: Record<string, string>
  requested_at: string
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
  provider_id: string
  adapter_id: string
  status: CommanderModelStepStatus
  assistant_message?: CommanderModelAssistantMessage
  text?: string
  tool_calls: CommanderModelToolCallPart[]
  finish_reason?: string
  usage: CommanderModelUsage
  provider_metadata: Record<string, unknown>
  request_count: number
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
  | { type: "tool_call_complete"; tool_call: CommanderModelToolCallPart }
  | { type: "usage"; usage: CommanderModelUsage }
  | { type: "completed"; result: CommanderModelStepResult }
  | { type: "error"; error: string }
  | { type: "cancelled"; error?: string }

export type CommanderModelStepAdapter = {
  adapter_id: "ai_sdk_core"
  adapter_version: string
  supports_streaming: true
  supports_native_tools: true
  supports_json_fallback: true
  supports_structured_output: true
  supports_abort_signal: true
  supports_usage: true
  supports_openai_compatible: true
  executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult>
  executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent>
}
