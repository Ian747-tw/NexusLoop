import { redactText } from "../security/redaction"
import type { CommanderToolDescriptor } from "../commander-tools/commander-tool-types"
import type { CommanderInvestigationBootstrap, CommanderInvestigationContext, CommanderInvestigationExecutionDigest, CommanderInvestigationWorkingSet } from "./commander-investigation-types"
import type { CommanderModelAssistantMessage, CommanderModelMessage, CommanderModelToolResultMessage } from "./commander-model-types"

export class CommanderInvestigationContextService {
  build(input: {
    bootstrap: CommanderInvestigationBootstrap
    workingSet: CommanderInvestigationWorkingSet
    loadedTools: CommanderToolDescriptor[]
    budget: { max_context_tokens?: number; max_context_bytes?: number }
    latestAssistant?: CommanderModelAssistantMessage
    latestToolResults: CommanderModelToolResultMessage[]
  }): CommanderInvestigationContext {
    const warnings: string[] = []
    const blockers: string[] = []
    let evidence = input.workingSet.evidence_cards
    let digests = input.workingSet.recent_execution_digests
    let bootstrap = input.bootstrap
    let messages = buildMessages(bootstrap, input.workingSet, evidence, digests, input.latestAssistant, input.latestToolResults)
    let bytes = measure(messages, input.loadedTools)
    let tokens = Math.ceil(bytes / 4)
    const byteCap = input.budget.max_context_bytes
    const tokenCap = input.budget.max_context_tokens

    const over = () => (byteCap !== undefined && bytes > byteCap) || (tokenCap !== undefined && tokens > tokenCap)
    while (over() && evidence.length > 0) {
      evidence = evidence.slice(1)
      warnings.push("oldest evidence card omitted during deterministic context compaction")
      messages = buildMessages(bootstrap, input.workingSet, evidence, digests, input.latestAssistant, input.latestToolResults)
      bytes = measure(messages, input.loadedTools)
      tokens = Math.ceil(bytes / 4)
    }
    while (over() && digests.length > 0) {
      digests = digests.slice(1)
      warnings.push("oldest execution digest omitted during deterministic context compaction")
      messages = buildMessages(bootstrap, input.workingSet, evidence, digests, input.latestAssistant, input.latestToolResults)
      bytes = measure(messages, input.loadedTools)
      tokens = Math.ceil(bytes / 4)
    }
    if (over() && bootstrap.source_refs.length > 0) {
      bootstrap = { ...bootstrap, source_refs: [] }
      warnings.push("optional bootstrap source refs omitted during deterministic context compaction")
      messages = buildMessages(bootstrap, input.workingSet, evidence, digests, input.latestAssistant, input.latestToolResults)
      bytes = measure(messages, input.loadedTools)
      tokens = Math.ceil(bytes / 4)
    }
    if (over()) blockers.push("investigation context exceeds byte/token budget")
    return { messages, tools: input.loadedTools, input_bytes: bytes, estimated_tokens: tokens, warnings, blocked: blockers.length > 0, blockers }
  }
}

function buildMessages(bootstrap: CommanderInvestigationBootstrap, workingSet: CommanderInvestigationWorkingSet, evidence: typeof workingSet.evidence_cards, digests: CommanderInvestigationExecutionDigest[], latestAssistant: CommanderModelAssistantMessage | undefined, latestToolResults: CommanderModelToolResultMessage[]): CommanderModelMessage[] {
  const messages: CommanderModelMessage[] = [
    { role: "system", content: bootstrap.authority_kernel },
    { role: "user", content: JSON.stringify({
      kind: "commander_investigation_bootstrap",
      objective: bootstrap.objective_preview,
      continuity_kind: bootstrap.continuity_kind,
      continuity_packet_id: bootstrap.continuity_packet_id,
      continuity_packet_hash: bootstrap.continuity_packet_hash,
      readiness: bootstrap.readiness,
      current_project_summary: bootstrap.current_project_summary,
      current_execution_summary: bootstrap.current_execution_summary,
      human_control_summary: bootstrap.human_control_summary,
      open_loops: bootstrap.open_loops,
      source_refs: bootstrap.source_refs,
      warnings: bootstrap.warnings,
      blockers: bootstrap.blockers,
    }) },
    { role: "user", content: JSON.stringify({
      kind: "commander_investigation_working_set",
      objective: workingSet.objective_preview,
      phase: workingSet.phase,
      loaded_tool_ids: workingSet.loaded_tool_ids,
      evidence: evidence.map((item) => ({
        evidence_id: item.evidence_id,
        tool_id: item.tool_id,
        source_kind: item.source_kind,
        source_id: item.source_id,
        title: item.title,
        summary_preview: item.summary_preview,
        evidence_hash: item.evidence_hash,
      })),
      recent_execution_digests: digests,
      recent_load_outcomes: workingSet.recent_load_outcomes.slice(-8),
      warnings: workingSet.current_warnings.slice(-10),
      blockers: workingSet.current_blockers.slice(-10),
      omitted_evidence_count: workingSet.omitted_evidence_count,
      omitted_digest_count: workingSet.omitted_digest_count,
      cumulative_tool_result_bytes: workingSet.cumulative_tool_result_bytes,
    }) },
  ]
  if (latestAssistant && latestToolResults.length > 0) messages.push(latestAssistant, ...latestToolResults)
  return messages.map((message) => message.role === "system" || message.role === "user" ? { ...message, content: redactText(message.content) } : message)
}

function measure(messages: CommanderModelMessage[], tools: CommanderToolDescriptor[]): number {
  return Buffer.byteLength(JSON.stringify({ messages, tools: tools.map((tool) => ({ tool_id: tool.tool_id, input_schema: tool.input_schema, description: tool.description })) }))
}
