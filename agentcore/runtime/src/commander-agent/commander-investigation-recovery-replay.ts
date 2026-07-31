import { redactText } from "../security/redaction"
import { stableHash } from "./commander-model-schema"
import type {
  CommanderDurableAssistantToolCallPart,
  CommanderInvestigationCheckpoint,
} from "./commander-investigation-journal-types"
import type { CommanderModelAssistantMessage, CommanderModelToolProtocol, CommanderModelToolResultMessage } from "./commander-model-types"
import type { CommanderToolDescriptor } from "../commander-tools/commander-tool-types"
import type { CommanderInvestigationRecoveryReplaySummary } from "./commander-investigation-recovery-execution-types"

export function reconstructCommanderRecoveryReplayExchange(input: {
  checkpoint: CommanderInvestigationCheckpoint
  loadedTools: CommanderToolDescriptor[]
  protocol: CommanderModelToolProtocol
}): {
  latest_assistant?: CommanderModelAssistantMessage
  latest_tool_results: CommanderModelToolResultMessage[]
  summary: CommanderInvestigationRecoveryReplaySummary
  blockers: string[]
  warnings: string[]
} {
  const checkpoint = input.checkpoint
  if (checkpoint.checkpoint_kind === "initial" || checkpoint.checkpoint_sequence === 0) {
    return { latest_tool_results: [], summary: emptySummary(false), blockers: [], warnings: ["initial checkpoint has no prior assistant/tool replay exchange"] }
  }
  const exchange = checkpoint.replay_exchange
  if (!exchange) return { latest_tool_results: [], summary: emptySummary(false), blockers: ["completed recovery checkpoint is missing summary-only replay exchange"], warnings: [] }
  const blockers: string[] = []
  if (exchange.exchange_hash !== stableHash({ ...exchange, exchange_hash: "" })) blockers.push("replay exchange hash mismatch")
  if (exchange.turn_index !== checkpoint.turn_index) blockers.push("replay exchange turn index does not match checkpoint")
  if (!exchange.protocol_relationship_preserved) blockers.push("replay exchange did not preserve protocol relationship")
  if (exchange.assistant_text_persisted !== false || exchange.exact_replay_supported !== false || exchange.full_tool_results_persisted !== false || exchange.summary_only !== true) blockers.push("replay exchange claims unsupported exact/full persistence")
  const loaded = new Set(input.loadedTools.map((tool) => tool.tool_id))
  const calls = exchange.assistant_message.content.filter((part): part is CommanderDurableAssistantToolCallPart => part.type === "tool_call")
  const callIds = new Set<string>()
  const resultIds = new Set<string>()
  for (const call of calls) {
    if (!call.tool_call_id || callIds.has(call.tool_call_id)) blockers.push("replay exchange has duplicate or empty tool_call_id")
    callIds.add(call.tool_call_id)
    if (!loaded.has(call.tool_id)) blockers.push(`replay exchange references unloaded tool ${call.tool_id}`)
    if ("execution_arguments" in call) blockers.push("replay exchange contains execution_arguments")
  }
  for (const result of exchange.tool_result_messages) {
    if (!result.tool_call_id || resultIds.has(result.tool_call_id)) blockers.push("replay exchange has duplicate or empty tool result id")
    resultIds.add(result.tool_call_id)
    const call = calls.find((candidate) => candidate.tool_call_id === result.tool_call_id)
    if (!call) blockers.push(`replay tool result ${result.tool_call_id} has no matching call`)
    if (call && call.tool_id !== result.tool_id) blockers.push(`replay tool result ${result.tool_call_id} tool_id does not match call`)
    if (result.durable_summary_only !== true) blockers.push("replay tool result is not marked summary-only")
    if (result.content.length > 2048) blockers.push("replay tool result summary exceeds durable bound")
  }
  for (const call of calls) {
    if (!resultIds.has(call.tool_call_id)) blockers.push(`replay tool call ${call.tool_call_id} is missing a summary result`)
  }
  if (blockers.length) return { latest_tool_results: [], summary: emptySummary(false, exchange.exchange_hash), blockers: blockers.slice(0, 12), warnings: [] }
  const assistant: CommanderModelAssistantMessage = {
    role: "assistant",
    content: calls.map((call) => ({
      type: "tool_call",
      tool_call_id: call.tool_call_id,
      tool_id: call.tool_id,
      arguments: safeRecord(call.arguments),
      raw_arguments: call.raw_arguments ? redactText(call.raw_arguments).slice(0, 1000) : undefined,
      arguments_valid: call.arguments_valid,
      validation_errors: call.validation_errors.slice(0, 6).map((item) => redactText(item).slice(0, 240)),
      call_hash: call.call_hash,
    })),
  }
  const results: CommanderModelToolResultMessage[] = exchange.tool_result_messages.map((result) => ({
    role: "tool",
    tool_call_id: result.tool_call_id,
    tool_id: result.tool_id,
    content: redactText(result.content).slice(0, 2048),
    content_hash: result.content_hash,
    truncated: result.truncated,
    source_execution_id: result.source_execution_id,
  }))
  return {
    latest_assistant: assistant,
    latest_tool_results: results,
    summary: {
      replay_protocol_available: true,
      tool_call_count: calls.length,
      tool_result_count: results.length,
      replay_exchange_hash: exchange.exchange_hash,
      assistant_text_persisted: false,
      exact_replay_supported: false,
      full_tool_results_persisted: false,
    },
    blockers: [],
    warnings: input.protocol === "json_fallback" ? ["summary-only replay exchange will be rendered as bounded json_fallback text"] : [],
  }
}

function emptySummary(available: boolean, hash?: string): CommanderInvestigationRecoveryReplaySummary {
  return {
    replay_protocol_available: available,
    tool_call_count: 0,
    tool_result_count: 0,
    replay_exchange_hash: hash,
    assistant_text_persisted: false,
    exact_replay_supported: false,
    full_tool_results_persisted: false,
  }
}

function safeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return JSON.parse(redactText(JSON.stringify(value)).slice(0, 4000)) as Record<string, unknown>
}

