import { redactText } from "../security/redaction"
import { stableHash } from "./commander-model-schema"
import type {
  CommanderDurableAssistantToolCallPart,
  CommanderInvestigationCheckpoint,
  CommanderInvestigationCheckpointKind,
  CommanderInvestigationReplayExchange,
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
  replay_exchange?: CommanderInvestigationReplayExchange
  blockers: string[]
  warnings: string[]
} {
  const checkpoint = input.checkpoint
  if (checkpoint.checkpoint_kind === "initial" || checkpoint.checkpoint_sequence === 0) {
    return { latest_tool_results: [], summary: emptySummary(false), blockers: [], warnings: ["initial checkpoint has no prior assistant/tool replay exchange"] }
  }
  const exchange = checkpoint.replay_exchange
  if (!exchange) return { latest_tool_results: [], summary: emptySummary(false), blockers: ["completed recovery checkpoint is missing summary-only replay exchange"], warnings: [] }
  return reconstructCommanderRecoveryReplayExchangeFromDurable({
    exchange,
    checkpointKind: checkpoint.checkpoint_kind,
    checkpointSequence: checkpoint.checkpoint_sequence,
    checkpointTurnIndex: checkpoint.turn_index,
    loadedTools: input.loadedTools,
    protocol: input.protocol,
  })
}

export function reconstructCommanderRecoveryReplayExchangeFromDurable(input: {
  exchange?: CommanderInvestigationReplayExchange
  checkpointKind: CommanderInvestigationCheckpointKind
  checkpointSequence: number
  checkpointTurnIndex: number
  loadedTools: CommanderToolDescriptor[]
  protocol: CommanderModelToolProtocol
}): {
  latest_assistant?: CommanderModelAssistantMessage
  latest_tool_results: CommanderModelToolResultMessage[]
  summary: CommanderInvestigationRecoveryReplaySummary
  replay_exchange?: CommanderInvestigationReplayExchange
  blockers: string[]
  warnings: string[]
} {
  if (input.checkpointKind === "initial" || input.checkpointSequence === 0) {
    return { latest_tool_results: [], summary: emptySummary(false), blockers: [], warnings: ["initial checkpoint has no prior assistant/tool replay exchange"] }
  }
  const exchange = input.exchange
  if (!exchange) return { latest_tool_results: [], summary: emptySummary(false), blockers: ["completed recovery checkpoint is missing summary-only replay exchange"], warnings: [] }
  const blockers: string[] = []
  if (exchange.exchange_hash !== stableHash({ ...exchange, exchange_hash: "" })) blockers.push("replay exchange hash mismatch")
  if (exchange.turn_index !== input.checkpointTurnIndex) blockers.push("replay exchange turn index does not match checkpoint")
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
    const compactedArguments = safeRecord(call.arguments)
    if (compactedArguments.blocker) blockers.push(compactedArguments.blocker)
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
  if (blockers.length) return { latest_tool_results: [], summary: emptySummary(false, exchange.exchange_hash), replay_exchange: exchange, blockers: blockers.slice(0, 12), warnings: [] }
  const assistant: CommanderModelAssistantMessage = {
    role: "assistant",
    content: calls.map((call) => ({
      type: "tool_call",
      tool_call_id: call.tool_call_id,
      tool_id: call.tool_id,
      arguments: safeRecord(call.arguments).value,
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
    replay_exchange: structuredClone(exchange),
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

function safeRecord(value: unknown): { value: Record<string, unknown>; blocker?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: {} }
  const compacted = compactJsonValue(value, 0)
  if (!compacted || typeof compacted !== "object" || Array.isArray(compacted)) return { value: {}, blocker: "replay tool arguments could not be compacted into a summary-only object" }
  if (Buffer.byteLength(JSON.stringify(compacted)) > 4000) return { value: {}, blocker: "replay tool arguments exceed the summary-only recovery bound" }
  return { value: compacted as Record<string, unknown> }
}

function compactJsonValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[omitted:depth]"
  if (typeof value === "string") return redactText(value).slice(0, 300)
  if (typeof value === "number") return Number.isFinite(value) ? value : "[omitted:number]"
  if (typeof value === "boolean" || value === null) return value
  if (Array.isArray(value)) {
    const items = value.slice(0, 16).map((item) => compactJsonValue(item, depth + 1))
    if (value.length > 16) items.push(`[omitted:${value.length - 16}:items]`)
    return items
  }
  if (typeof value === "object" && value) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 24)
      .map(([key, item]) => [redactText(key).slice(0, 120), compactJsonValue(item, depth + 1)])
    if (Object.keys(value as Record<string, unknown>).length > 24) entries.push(["__omitted_keys", Object.keys(value as Record<string, unknown>).length - 24])
    return Object.fromEntries(entries)
  }
  return "[omitted:unsupported]"
}
