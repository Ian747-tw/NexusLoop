import { redactText, redactValue } from "../security/redaction"
import { COMMANDER_TOOL_PHASES, COMMANDER_TOOL_REGISTRY } from "../commander-tools/commander-tool-registry"
import { isToolAllowedInPhase } from "../commander-tools/commander-tool-service"
import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolDescriptor, CommanderToolPhase } from "../commander-tools/commander-tool-types"
import { commanderToolSchemaFromDescriptor, stableHash, validateCommanderToolArguments } from "./commander-model-schema"
import type { CommanderModelAssistantMessage, CommanderModelMessage, CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStepResult, CommanderModelToolCallPart, CommanderModelToolProtocol, CommanderModelToolResultMessage } from "./commander-model-types"
import { toCommanderToolResultMessage } from "./commander-tool-executor"
import type { CommanderToolExecutionResult } from "./commander-tool-execution-types"
import {
  type CommanderInvestigationBudget,
  type CommanderInvestigationControllerOptions,
  type CommanderInvestigationControlSnapshot,
  type CommanderInvestigationInput,
  type CommanderInvestigationResult,
  type CommanderInvestigationStopReason,
  type CommanderInvestigationTurnSummary,
  type CommanderInvestigationWorkingSet,
} from "./commander-investigation-types"

const HARD_CAPS = {
  max_model_turns: 24,
  max_tool_calls: 32,
  max_tool_search_calls: 8,
  max_loaded_schemas: 12,
  max_tool_calls_per_turn: 4,
  max_cumulative_tool_result_bytes: 96_000,
  max_wall_time_ms: 120_000,
  max_consecutive_no_progress_turns: 3,
  max_evidence_cards: 24,
  max_turn_summaries: 12,
}

const TOOL_SEARCH_ID = "commander.tool_search"
const TOOL_GET_ID = "commander.tool_get"

export class CommanderInvestigationController {
  private readonly now: () => Date

  constructor(private readonly options: CommanderInvestigationControllerOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async run(input: CommanderInvestigationInput): Promise<CommanderInvestigationResult> {
    const started = this.now()
    const wallStartedMs = performance.now()
    const investigationId = boundedId(input.investigation_id) ?? `commander_investigation_${stableHash({ input, started: started.toISOString() }).slice(0, 16)}`
    const inputBlockers = validateInput(input)
    const blockedBudget = fallbackBudget(input.phase, "input_blocked")
    if (inputBlockers.length) return this.finish(input, investigationId, "blocked", "controller_error", minimalBootstrap(input), blockedBudget, "native", [], emptyWorkingSet(input, []), 0, [], inputBlockers, [], started)
    if (!this.options.modelAdapter) return this.finish(input, investigationId, "blocked", "adapter_not_configured", minimalBootstrap(input), blockedBudget, "native", [], emptyWorkingSet(input, []), 0, [], ["Commander investigation model adapter is not configured"], [], started)

    const budgetResolution = await this.deriveBudget(input)
    const budget = budgetResolution.budget
    if (budgetResolution.blockers.length > 0) return this.finish(input, investigationId, "blocked", "context_budget_exhausted", minimalBootstrap(input), budget, "native", [], emptyWorkingSet(input, []), 0, [], budgetResolution.blockers, budget.warnings, started)
    const protocolResolution = this.resolveProtocol(input)
    if (protocolResolution.blocker) return this.finish(input, investigationId, "blocked", protocolResolution.blocker, minimalBootstrap(input), budget, "native", [], emptyWorkingSet(input, []), 0, [], [protocolResolution.blocker], protocolResolution.warnings, started)
    const toolProtocol = protocolResolution.protocol
    const bootstrap = await this.options.bootstrapService.compile(input)
    if (bootstrap.blockers.length > 0) return this.finish(input, investigationId, "blocked", "bootstrap_blocked", bootstrap, budget, toolProtocol, [], emptyWorkingSet(input, []), 0, [], bootstrap.blockers, bootstrap.warnings, started)

    const initial = await this.initialLoadedTools(input, budget)
    const loaded = new Map(initial.loaded.map((tool) => [tool.tool_id, tool]))
    const workingSet = emptyWorkingSet(input, Array.from(loaded.keys()))
    workingSet.current_warnings.push(...protocolResolution.warnings, ...initial.warnings)
    let latestAssistant: CommanderModelAssistantMessage | undefined
    let latestToolResults: CommanderModelToolResultMessage[] = []
    const turns: CommanderInvestigationTurnSummary[] = []
    let providerRequests = 0
    const recentResults = new Map<string, number>()

    for (let turn = 1; turn <= budget.max_model_turns; turn += 1) {
      if (input.abort_signal?.aborted) return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation"], [], started)
      const humanBeforeModel = await this.checkControl(input, "model_step", turn)
      const humanStop = stopReasonForControl(humanBeforeModel)
      if (humanStop) return this.finish(input, investigationId, "needs_human_review", humanStop, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [humanBeforeModel.summary_preview ?? humanStop], humanBeforeModel.warnings, started)
      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted"], [], started)

      const context = this.options.contextService.build({ bootstrap, workingSet, loadedTools: Array.from(loaded.values()), toolProtocol, budget, latestAssistant, latestToolResults })
      if (context.blocked) return this.finish(input, investigationId, "budget_exhausted", "context_budget_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), context.blockers, context.warnings, started)
      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted before model request"], context.warnings, started)
      const deadline = deadlineSignal(input.abort_signal, budget, wallStartedMs)
      const request: CommanderModelStepRequest = {
        request_id: `${investigationId}_turn_${turn}`,
        provider_id: input.provider_id,
        provider_kind: input.provider_kind,
        model_id: input.model_id,
        messages: context.messages,
        tools: Array.from(loaded.values()).map(commanderToolSchemaFromDescriptor),
        tool_protocol: toolProtocol,
        tool_choice: "auto",
        max_output_tokens: 1024,
        abort_signal: deadline.signal,
        requested_at: this.now().toISOString(),
        metadata: { investigation_id: investigationId, phase: input.phase },
      }
      const modelResult = await this.options.modelAdapter.executeOneStep(request).finally(deadline.cancel)
      providerRequests += modelResult.request_count
      if (deadline.expired()) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during model request"], modelResult.warnings, started)
      if (modelResult.request_count > 1) return this.finish(input, investigationId, "failed", "controller_error", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["model adapter violated one-request contract"], modelResult.warnings, started)
      if (modelResult.status !== "tool_call") {
        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, true, [], modelResult.warnings)
        appendTurnSummary(turns, summary, workingSet, budget)
        if (modelResult.status === "final") return this.finish(input, investigationId, "final", "model_final", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [], modelResult.tool_calls.length === 0 && workingSet.evidence_cards.length === 0 ? ["model finalized without acquired evidence"] : [], started, modelResult.text)
        if (modelResult.status === "refusal") return this.finish(input, investigationId, "refused", "model_refusal", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [], modelResult.warnings, started)
        if (modelResult.status === "cancelled") return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "model request cancelled"], modelResult.warnings, started)
        if (modelResult.status === "malformed") return this.finish(input, investigationId, "failed", "model_malformed", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "model output malformed"], modelResult.warnings, started)
        return this.finish(input, investigationId, "failed", "provider_failed", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "provider request failed"], modelResult.warnings, started)
      }

      const validation = validateToolCalls(modelResult.tool_calls, loaded, budget, workingSet)
      if (validation.blocker) {
        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, false, [validation.blocker], modelResult.warnings)
        appendTurnSummary(turns, summary, workingSet, budget)
        return this.finish(input, investigationId, validation.reason === "max_tool_calls_per_turn" || validation.reason === "max_tool_calls" ? "budget_exhausted" : "blocked", validation.reason, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [validation.blocker], modelResult.warnings, started)
      }

      latestAssistant = modelResult.assistant_message
      latestToolResults = []
      const executions: CommanderToolExecutionResult[] = []
      const newlyLoaded: string[] = []
      const newEvidence: string[] = []
      const noProgressReasons: string[] = []
      let progressMade = false
      for (const call of modelResult.tool_calls) {
        const humanBeforeTool = await this.checkControl(input, "tool_execution", turn, call.tool_id)
        const humanToolStop = stopReasonForControl(humanBeforeTool)
        if (humanToolStop) return this.finish(input, investigationId, "needs_human_review", humanToolStop, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [humanBeforeTool.summary_preview ?? humanToolStop], humanBeforeTool.warnings, started)
        if (workingSet.tool_call_count >= budget.max_tool_calls) return this.finish(input, investigationId, "budget_exhausted", "max_tool_calls", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max tool calls exhausted"], [], started)
        const args = normalizedControllerArgs(call, input.phase)
        if (call.tool_id === TOOL_SEARCH_ID && workingSet.tool_search_call_count + 1 > budget.max_tool_search_calls) return this.finish(input, investigationId, "budget_exhausted", "max_tool_search_calls", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max tool search calls exhausted"], [], started)
        const executionId = `${investigationId}_exec_${turn}_${executions.length + 1}`
        const callId = `${investigationId}_call_${turn}`
        const controllerBlocker = this.controllerPreflightBlocker(call, args, input.phase, loaded, budget)
        if (!controllerBlocker && elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted before tool execution"], [], started)
        let toolDeadlineExpired = false
        let execution: CommanderToolExecutionResult
        if (controllerBlocker) {
          execution = controllerBlockedExecution(executionId, callId, call, input.phase, controllerBlocker, this.now())
        } else {
          const toolDeadline = deadlineSignal(input.abort_signal, budget, wallStartedMs)
          execution = await this.options.toolExecutor.execute({
            execution_id: executionId,
            call_id: callId,
            tool_call_id: call.tool_call_id,
            tool_id: call.tool_id,
            phase: input.phase,
            arguments: args,
            requested_by: input.requested_by,
            abort_signal: toolDeadline.signal,
            source_model_request_id: request.request_id,
            source_model_result_hash: modelResult.result_hash,
          }).finally(toolDeadline.cancel)
          toolDeadlineExpired = toolDeadline.expired()
        }
        if (toolDeadlineExpired) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during tool execution"], execution.warnings, started)
        executions.push(execution)
        workingSet.tool_call_count += 1
        if (call.tool_id === TOOL_SEARCH_ID) workingSet.tool_search_call_count += 1
        const resultBytesCap = perToolResultCap(execution.max_output_bytes, context.input_bytes, budget, modelResult.tool_calls.length - executions.length + 1)
        const toolMessage = toCommanderToolResultMessage(execution, resultBytesCap)
        latestToolResults.push(toolMessage)
        workingSet.cumulative_tool_result_bytes += Buffer.byteLength(toolMessage.content)
        if (workingSet.cumulative_tool_result_bytes > budget.max_cumulative_tool_result_bytes) return this.finish(input, investigationId, "budget_exhausted", "max_cumulative_tool_result_bytes", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["cumulative tool-result byte budget exhausted"], [], started)
        const loadedTool = this.maybeLoadTool(call, execution, loaded, budget)
        if (loadedTool.loaded) {
          loaded.set(loadedTool.tool.tool_id, loadedTool.tool)
          newlyLoaded.push(loadedTool.tool.tool_id)
          workingSet.loaded_tool_ids = Array.from(loaded.keys())
          progressMade = true
        }
        if (loadedTool.warning) workingSet.recent_load_outcomes.push(loadedTool.warning)
        const beforeEvidenceCount = workingSet.evidence_cards.length
        addEvidence(workingSet, execution.evidence, budget.max_evidence_cards)
        const afterEvidence = workingSet.evidence_cards.slice(beforeEvidenceCount).map((item) => item.evidence_id)
        newEvidence.push(...afterEvidence)
        if (afterEvidence.length > 0) progressMade = true
        const callSignature = stableHash({ tool_id: call.tool_id, arguments: args })
        const resultSignature = repeatResultSignature(callSignature, execution)
        const repeatCount = recentResults.get(resultSignature) ?? 0
        recentResults.set(resultSignature, repeatCount + 1)
        if (repeatCount >= 2) return this.finish(input, investigationId, "no_progress", "repeated_identical_call", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["repeated identical tool call/result detected"], [], started)
        if (execution.status === "cancelled") return this.finish(input, investigationId, "cancelled", "tool_execution_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["tool execution cancelled"], execution.warnings, started)
        if (execution.result_hash && repeatCount === 0) progressMade = progressMade || execution.status === "ready" || execution.status === "blocked" || execution.status === "failed"
        workingSet.recent_execution_digests.push({
          turn_index: turn,
          tool_id: call.tool_id,
          call_signature_hash: callSignature,
          execution_status: execution.status,
          result_hash: execution.result_hash,
          evidence_ids: execution.evidence.map((item) => item.evidence_id).slice(0, 8),
          loaded_tool_outcome: loadedTool.loaded ? `loaded ${loadedTool.tool.tool_id}` : loadedTool.warning,
          blocker_warning_summary: [...execution.blockers, ...execution.warnings].join("; ").slice(0, 320),
          order: workingSet.tool_call_count,
        })
        if (workingSet.recent_execution_digests.length > budget.max_turn_summaries) {
          workingSet.recent_execution_digests.shift()
          workingSet.omitted_digest_count += 1
        }
      }
      if (!progressMade) {
        workingSet.consecutive_no_progress_turns += 1
        noProgressReasons.push("no new evidence, schema, source, or result state")
      } else {
        workingSet.consecutive_no_progress_turns = 0
      }
      workingSet.model_turn_count = turn
      workingSet.working_set_hash = stableHash(stableWorkingSet(workingSet))
      const summary = turnSummary(turn, request.request_id, modelResult, context, executions, newlyLoaded, newEvidence, workingSet.tool_call_count, progressMade, noProgressReasons, modelResult.warnings)
      appendTurnSummary(turns, summary, workingSet, budget)
      if (workingSet.consecutive_no_progress_turns >= budget.max_consecutive_no_progress_turns) return this.finish(input, investigationId, "no_progress", "consecutive_no_progress", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["consecutive no-progress turn limit reached"], [], started)
    }
    return this.finish(input, investigationId, "budget_exhausted", "max_model_turns", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max model turns exhausted"], [], started)
  }

  private async deriveBudget(input: CommanderInvestigationInput): Promise<{ budget: CommanderInvestigationBudget; blockers: string[] }> {
    const profile = this.options.toolService.profile({ phase: input.phase })
    const context = await this.options.contextBudgetService.preview({ purpose: "commander_research_decision", role: "commander", provider_kind: input.provider_kind, model_id: input.model_id, max_context_tokens: input.max_context_tokens, max_context_bytes: input.max_context_bytes })
    const allocation = context.budget.allocations.find((item) => item.section === "tool_or_mcp_schema")
    const profileTurns = Math.min(HARD_CAPS.max_model_turns, Math.max(4, Math.ceil(profile.max_tool_calls_future / 2) + profile.max_tool_search_calls_future + 2))
    const budget = {
      budget_id: `commander_investigation_budget_${stableHash({ phase: input.phase, profile: profile.profile_hash, context: context.budget.budget_id, input: strictBudgetInput(input) }).slice(0, 16)}`,
      phase: input.phase,
      max_model_turns: boundedOverride(input.max_model_turns, profileTurns, HARD_CAPS.max_model_turns),
      max_tool_calls: boundedOverride(input.max_tool_calls, profile.max_tool_calls_future, HARD_CAPS.max_tool_calls),
      max_tool_search_calls: boundedOverride(input.max_tool_search_calls, profile.max_tool_search_calls_future, HARD_CAPS.max_tool_search_calls),
      max_loaded_schemas: boundedOverride(input.max_loaded_schemas, profile.max_loaded_schemas, HARD_CAPS.max_loaded_schemas),
      max_tool_calls_per_turn: boundedOverride(input.max_tool_calls_per_turn, HARD_CAPS.max_tool_calls_per_turn, HARD_CAPS.max_tool_calls_per_turn),
      max_cumulative_tool_result_bytes: boundedOverride(input.max_cumulative_tool_result_bytes, profile.max_cumulative_result_bytes_future, HARD_CAPS.max_cumulative_tool_result_bytes),
      max_wall_time_ms: boundedOverride(input.max_wall_time_ms, profile.max_wall_time_ms_future, HARD_CAPS.max_wall_time_ms),
      max_consecutive_no_progress_turns: boundedOverride(input.max_consecutive_no_progress_turns, HARD_CAPS.max_consecutive_no_progress_turns, HARD_CAPS.max_consecutive_no_progress_turns),
      max_evidence_cards: boundedOverride(input.max_evidence_cards, HARD_CAPS.max_evidence_cards, HARD_CAPS.max_evidence_cards),
      max_turn_summaries: boundedOverride(input.max_turn_summaries, HARD_CAPS.max_turn_summaries, HARD_CAPS.max_turn_summaries),
      max_context_tokens: context.budget.max_context_tokens,
      max_context_bytes: context.budget.max_context_bytes,
      target_input_tokens: context.budget.max_context_tokens ? Math.floor(context.budget.max_context_tokens * 0.7) : undefined,
      tool_schema_allocation_tokens: allocation?.max_tokens,
      tool_schema_allocation_bytes: allocation?.max_bytes,
      source_profile_id: profile.profile_id,
      source_context_budget_id: context.budget.budget_id,
      warnings: [...profile.warnings, ...context.warnings, ...context.blockers].slice(0, 16),
      budget_hash: "",
    }
    budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
    return { budget, blockers: context.blockers.map((item) => preview(item, 300)).slice(0, 8) }
  }

  private resolveProtocol(input: CommanderInvestigationInput): { protocol: CommanderModelToolProtocol; warnings: string[]; blocker?: CommanderInvestigationStopReason } {
    const capability = this.options.capabilityRegistry.get({ provider_kind: input.provider_kind, model_id: input.model_id })
    const warnings = capability.warnings.slice(0, 8)
    if (input.tool_protocol === "native") {
      if (capability.supports_tools === false) return { protocol: "native", warnings, blocker: "adapter_not_configured" }
      if (capability.supports_tools === "unknown") warnings.push("model tool support is unknown; explicit native protocol permitted with warning")
      return { protocol: "native", warnings }
    }
    if (input.tool_protocol === "json_fallback") return { protocol: "json_fallback", warnings }
    if (capability.supports_tools === true) return { protocol: "native", warnings }
    warnings.push("model tool support is unknown or unsupported; using json_fallback protocol")
    return { protocol: "json_fallback", warnings }
  }

  private async initialLoadedTools(input: CommanderInvestigationInput, budget: CommanderInvestigationBudget): Promise<{ loaded: CommanderToolDescriptor[]; warnings: string[] }> {
    const preview = await this.options.toolService.bootstrap({ phase: input.phase, provider_kind: input.provider_kind, model_id: input.model_id, max_context_tokens: input.max_context_tokens, max_context_bytes: input.max_context_bytes })
    const loaded: CommanderToolDescriptor[] = []
    const warnings = [...preview.warnings, ...preview.blockers]
    let bytes = 0
    let tokens = 0
    for (const tool of preview.always_loaded_tools) {
      if (!this.isEligibleForLoad(tool, input.phase)) continue
      const nextBytes = tool.schema_metadata.input_schema_bytes + tool.schema_metadata.output_schema_bytes
      const nextTokens = tool.schema_metadata.estimated_schema_tokens
      if (loaded.length >= budget.max_loaded_schemas || budget.tool_schema_allocation_bytes && bytes + nextBytes > budget.tool_schema_allocation_bytes || budget.tool_schema_allocation_tokens && tokens + nextTokens > budget.tool_schema_allocation_tokens) {
        if (tool.tool_id === TOOL_SEARCH_ID && loaded.length === 0) {
          loaded.push(tool)
          bytes += nextBytes
          tokens += nextTokens
          warnings.push("commander.tool_search preserved as the minimum discovery schema despite schema allocation pressure")
          continue
        }
        warnings.push(`initial schema ${tool.tool_id} omitted by schema budget`)
        continue
      }
      loaded.push(tool)
      bytes += nextBytes
      tokens += nextTokens
    }
    return { loaded, warnings }
  }

  private maybeLoadTool(call: CommanderModelToolCallPart, execution: CommanderToolExecutionResult, loaded: Map<string, CommanderToolDescriptor>, budget: CommanderInvestigationBudget): { loaded: false; warning?: string } | { loaded: true; tool: CommanderToolDescriptor; warning?: string } {
    if (call.tool_id !== TOOL_GET_ID || execution.status !== "ready") return { loaded: false }
    const target = typeof call.arguments.tool_id === "string" ? call.arguments.tool_id : extractToolGetTarget(execution)
    if (!target) return { loaded: false, warning: "commander.tool_get did not expose a target tool_id" }
    if (loaded.has(target)) return { loaded: false, warning: `tool ${target} already loaded` }
    const descriptor = this.options.descriptors.find((tool) => tool.tool_id === target)
    if (!descriptor) return { loaded: false, warning: `tool ${target} descriptor missing` }
    if (!this.isEligibleForLoad(descriptor, execution.phase)) return { loaded: false, warning: `tool ${target} is not eligible for loading in phase ${execution.phase}` }
    const currentBytes = Array.from(loaded.values()).reduce((sum, tool) => sum + tool.schema_metadata.input_schema_bytes + tool.schema_metadata.output_schema_bytes, 0)
    const currentTokens = Array.from(loaded.values()).reduce((sum, tool) => sum + tool.schema_metadata.estimated_schema_tokens, 0)
    const nextBytes = descriptor.schema_metadata.input_schema_bytes + descriptor.schema_metadata.output_schema_bytes
    const nextTokens = descriptor.schema_metadata.estimated_schema_tokens
    if (loaded.size + 1 > budget.max_loaded_schemas) return { loaded: false, warning: `tool ${target} blocked by max_loaded_schemas` }
    if (budget.tool_schema_allocation_bytes && currentBytes + nextBytes > budget.tool_schema_allocation_bytes) return { loaded: false, warning: `tool ${target} blocked by schema byte allocation` }
    if (budget.tool_schema_allocation_tokens && currentTokens + nextTokens > budget.tool_schema_allocation_tokens) return { loaded: false, warning: `tool ${target} blocked by schema token allocation` }
    return { loaded: true, tool: this.options.toolService.get({ tool_id: target, include_schema: true }) }
  }

  private controllerPreflightBlocker(call: CommanderModelToolCallPart, args: Record<string, unknown>, phase: CommanderToolPhase, loaded: Map<string, CommanderToolDescriptor>, budget: CommanderInvestigationBudget): string | undefined {
    if (call.tool_id !== TOOL_GET_ID) return undefined
    const target = typeof args.tool_id === "string" ? args.tool_id : undefined
    if (!target) return "commander.tool_get target tool_id is missing"
    if (loaded.has(target)) return `tool ${target} is already loaded`
    const descriptor = this.options.descriptors.find((tool) => tool.tool_id === target)
    if (!descriptor) return `tool ${target} descriptor missing`
    if (!this.isEligibleForLoad(descriptor, phase)) return `tool ${target} is not eligible for loading in phase ${phase}`
    const currentBytes = Array.from(loaded.values()).reduce((sum, tool) => sum + tool.schema_metadata.input_schema_bytes + tool.schema_metadata.output_schema_bytes, 0)
    const currentTokens = Array.from(loaded.values()).reduce((sum, tool) => sum + tool.schema_metadata.estimated_schema_tokens, 0)
    const nextBytes = descriptor.schema_metadata.input_schema_bytes + descriptor.schema_metadata.output_schema_bytes
    const nextTokens = descriptor.schema_metadata.estimated_schema_tokens
    if (loaded.size + 1 > budget.max_loaded_schemas) return `tool ${target} blocked by max_loaded_schemas`
    if (budget.tool_schema_allocation_bytes && currentBytes + nextBytes > budget.tool_schema_allocation_bytes) return `tool ${target} blocked by schema byte allocation`
    if (budget.tool_schema_allocation_tokens && currentTokens + nextTokens > budget.tool_schema_allocation_tokens) return `tool ${target} blocked by schema token allocation`
    return undefined
  }

  private isEligibleForLoad(tool: CommanderToolDescriptor, phase: CommanderToolPhase): boolean {
    return this.options.boundToolIds.includes(tool.tool_id)
      && tool.availability === "implemented_read_surface"
      && tool.load_policy !== "never_exposed"
      && isToolAllowedInPhase(tool, phase)
  }

  private async checkControl(input: CommanderInvestigationInput, before: "model_step" | "tool_execution", turnIndex: number, toolId?: string): Promise<CommanderInvestigationControlSnapshot> {
    if (!this.options.controlGate || (!input.session_id && !input.launch_id)) return { action: "continue", source_kind: "default", checked_at: this.now().toISOString(), warnings: [] }
    return this.options.controlGate.check({ phase: input.phase, session_id: input.session_id, launch_id: input.launch_id, before, turn_index: turnIndex, tool_id: toolId })
  }

  private finish(input: CommanderInvestigationInput, investigationId: string, status: CommanderInvestigationResult["status"], stopReason: CommanderInvestigationStopReason, bootstrap: { bootstrap_id: string; bootstrap_hash: string }, budget: CommanderInvestigationBudget, protocol: CommanderModelToolProtocol, turns: CommanderInvestigationTurnSummary[], workingSet: CommanderInvestigationWorkingSet, providerRequests: number, loadedTools: CommanderToolDescriptor[], blockers: string[], warnings: string[], started: Date, finalSummary?: string): CommanderInvestigationResult {
    const completed = this.now()
    const result: CommanderInvestigationResult = {
      investigation_id: investigationId,
      status,
      stop_reason: stopReason,
      phase: input.phase,
      objective_preview: preview(input.objective, 1000),
      provider_id: preview(input.provider_id, 120),
      provider_kind: preview(input.provider_kind, 80),
      model_id: preview(input.model_id, 160),
      tool_protocol: protocol,
      final_summary: finalSummary ? preview(finalSummary, 4000) : undefined,
      bootstrap_id: bootstrap.bootstrap_id,
      bootstrap_hash: bootstrap.bootstrap_hash,
      context_budget_id: budget.source_context_budget_id,
      budget,
      model_turn_count: Math.max(workingSet.model_turn_count, turns.length),
      provider_request_count: providerRequests,
      tool_call_count: workingSet.tool_call_count,
      tool_search_call_count: workingSet.tool_search_call_count,
      loaded_tool_ids: loadedTools.map((tool) => tool.tool_id),
      loaded_schema_bytes: loadedTools.reduce((sum, tool) => sum + tool.schema_metadata.input_schema_bytes + tool.schema_metadata.output_schema_bytes, 0),
      loaded_schema_tokens: loadedTools.reduce((sum, tool) => sum + tool.schema_metadata.estimated_schema_tokens, 0),
      cumulative_tool_result_bytes: workingSet.cumulative_tool_result_bytes,
      evidence: workingSet.evidence_cards,
      turn_summaries: turns.slice(-budget.max_turn_summaries),
      omitted_evidence_count: workingSet.omitted_evidence_count,
      omitted_turn_count: workingSet.omitted_turn_count,
      blockers: blockers.map((item) => preview(item, 300)).slice(0, 16),
      warnings: [...workingSet.current_warnings, ...warnings].map((item) => preview(item, 300)).slice(0, 24),
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: Math.max(0, completed.getTime() - started.getTime()),
      in_memory_only: true,
      transcript_persisted: false,
      working_set_persisted: false,
      events_appended: false,
      files_written: false,
      research_db_written: false,
      mission_mutated: false,
      proposal_mutated: false,
      opencode_action_performed: false,
      github_action_performed: false,
      mcp_called: false,
      external_research_called: false,
      result_hash: "",
    }
    result.result_hash = stableHash(stableResult(result))
    return redactValue(result)
  }
}

function validateInput(input: CommanderInvestigationInput): string[] {
  const blockers: string[] = []
  if (!preview(input.objective, 1000)) blockers.push("objective is required")
  if (!preview(input.requested_by, 200)) blockers.push("requested_by is required")
  if (!COMMANDER_TOOL_PHASES.includes(input.phase)) blockers.push("Commander tool phase is unsupported")
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith("max_") && value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) blockers.push(`${key} must be a positive integer`)
  }
  return blockers
}

function validateToolCalls(calls: CommanderModelToolCallPart[], loaded: Map<string, CommanderToolDescriptor>, budget: CommanderInvestigationBudget, workingSet: CommanderInvestigationWorkingSet): { blocker?: string; reason: CommanderInvestigationStopReason } {
  if (calls.length === 0) return { blocker: "model returned tool_call status without tool calls", reason: "invalid_tool_call" }
  if (calls.length > budget.max_tool_calls_per_turn) return { blocker: "model returned more tool calls than max_tool_calls_per_turn", reason: "max_tool_calls_per_turn" }
  if (workingSet.tool_call_count + calls.length > budget.max_tool_calls) return { blocker: "model tool calls exceed max_tool_calls", reason: "max_tool_calls" }
  const ids = new Set<string>()
  for (const call of calls) {
    if (!call.tool_call_id || ids.has(call.tool_call_id)) return { blocker: "model tool_call_id is empty or duplicated", reason: "duplicate_tool_call_id" }
    ids.add(call.tool_call_id)
    if (!loaded.has(call.tool_id)) return { blocker: `model called unloaded tool ${call.tool_id}`, reason: "unloaded_tool_call" }
    if (!call.arguments_valid) return { blocker: `model produced invalid arguments for ${call.tool_id}`, reason: "invalid_tool_call" }
    const descriptor = loaded.get(call.tool_id)
    const validated = descriptor?.input_schema ? validateCommanderToolArguments(descriptor.input_schema, call.arguments) : { valid: false, errors: ["missing schema"] }
    if (!validated.valid) return { blocker: `NexusLoop revalidation failed for ${call.tool_id}: ${validated.errors.join("; ")}`, reason: "invalid_tool_call" }
  }
  return { reason: "invalid_tool_call" }
}

function normalizedControllerArgs(call: CommanderModelToolCallPart, phase: CommanderToolPhase): Record<string, unknown> {
  if (call.tool_id === TOOL_SEARCH_ID) return { ...call.arguments, phase, implemented_only: true, allowed_in_phase_only: true, include_schema: false, limit: Math.min(Number(call.arguments.limit ?? 10), 10) }
  return call.arguments
}

function extractToolGetTarget(execution: CommanderToolExecutionResult): string | undefined {
  const result = execution.result as { result?: { tool_id?: string }; tool_id?: string } | undefined
  return result?.tool_id ?? result?.result?.tool_id
}

function addEvidence(workingSet: CommanderInvestigationWorkingSet, evidence: CommanderEvidenceCard[], cap: number): void {
  const keys = new Set(workingSet.evidence_cards.map(evidenceKey))
  for (const card of evidence) {
    const key = evidenceKey(card)
    if (keys.has(key)) continue
    keys.add(key)
    workingSet.evidence_cards.push(card)
  }
  while (workingSet.evidence_cards.length > cap) {
    workingSet.evidence_cards.shift()
    workingSet.omitted_evidence_count += 1
  }
}

function evidenceKey(card: CommanderEvidenceCard): string {
  return card.evidence_hash || `${card.source_kind}:${card.source_id}`
}

function perToolResultCap(descriptorCap: number, contextBytes: number, budget: CommanderInvestigationBudget, remainingResults: number): number {
  const remainingContext = Math.max(0, (budget.max_context_bytes ?? 64_000) - contextBytes)
  return Math.max(256, Math.min(12_000, descriptorCap, Math.floor(remainingContext / Math.max(1, remainingResults))))
}

function elapsedWallMs(startedMs: number): number {
  return Math.max(0, performance.now() - startedMs)
}

function deadlineSignal(parent: AbortSignal | undefined, budget: CommanderInvestigationBudget, wallStartedMs: number): { signal?: AbortSignal; cancel: () => void; expired: () => boolean } {
  const remaining = budget.max_wall_time_ms - elapsedWallMs(wallStartedMs)
  if (parent?.aborted) return { signal: parent, cancel: () => undefined, expired: () => elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms }
  if (remaining <= 0) return { signal: alreadyAbortedSignal("Commander investigation wall-time budget exhausted"), cancel: () => undefined, expired: () => true }
  const controller = new AbortController()
  const parentAbort = () => controller.abort(parent?.reason)
  parent?.addEventListener("abort", parentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error("Commander investigation wall-time budget exhausted")), Math.max(1, Math.floor(remaining)))
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener("abort", parentAbort)
    },
    expired: () => !parent?.aborted && elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms,
  }
}

function alreadyAbortedSignal(reason: string): AbortSignal {
  const controller = new AbortController()
  controller.abort(new Error(reason))
  return controller.signal
}

function controllerBlockedExecution(executionId: string, callId: string, call: CommanderModelToolCallPart, phase: CommanderToolPhase, blocker: string, now: Date): CommanderToolExecutionResult {
  const result = {
    execution_id: executionId,
    call_id: callId,
    tool_call_id: call.tool_call_id,
    tool_id: call.tool_id,
    phase,
    status: "blocked" as const,
    trust_class: "runtime_authoritative" as const,
    instruction_semantics: "none" as const,
    result: { status: "blocked", blocker },
    evidence: [],
    output_bytes: Buffer.byteLength(JSON.stringify({ status: "blocked", blocker })),
    max_output_bytes: 4096,
    truncated: false,
    handler_invoked: false,
    external_process_invoked: false,
    process_policy: "none",
    events_appended: false as const,
    provider_called: false as const,
    mcp_called: false as const,
    network_called: false as const,
    research_db_written: false as const,
    mission_mutated: false as const,
    proposal_mutated: false as const,
    opencode_action_performed: false as const,
    blockers: [blocker],
    warnings: ["descriptor/schema was not replayed because the target is not load-eligible"],
    duration_ms: 0,
    generated_at: now.toISOString(),
    result_hash: "",
  }
  result.result_hash = stableHash({ ...result, generated_at: "", duration_ms: 0, result_hash: "" })
  return result
}

function repeatResultSignature(callSignature: string, execution: CommanderToolExecutionResult): string {
  return stableHash({
    callSignature,
    status: execution.status,
    trust_class: execution.trust_class,
    instruction_semantics: execution.instruction_semantics,
    result: stableForRepeat(execution.result),
    evidence: execution.evidence.map((item) => item.evidence_hash || `${item.source_kind}:${item.source_id}`).sort(),
    blockers: execution.blockers,
    warnings: execution.warnings,
    truncated: execution.truncated,
  })
}

function stableForRepeat(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableForRepeat)
  if (!value || typeof value !== "object") return value
  const omitted = new Set(["execution_id", "call_id", "tool_call_id", "source_execution_id", "generated_at", "duration_ms", "result_hash", "call_hash", "observed_at"])
  const entries: Array<[string, unknown]> = Object.entries(value as Record<string, unknown>).filter(([key]) => !omitted.has(key)).map(([key, item]) => [key, stableForRepeat(item)])
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

function turnSummary(turn: number, requestId: string, modelResult: CommanderModelStepResult, context: { input_bytes: number; estimated_tokens: number }, executions: CommanderToolExecutionResult[], loaded: string[], evidence: string[], cumulativeCalls: number, progress: boolean, noProgressReasons: string[], warnings: string[]): CommanderInvestigationTurnSummary {
  const summary = {
    turn_index: turn,
    model_request_id: requestId,
    model_result_hash: modelResult.result_hash,
    model_status: modelResult.status,
    provider_request_count: modelResult.request_count,
    assistant_text_preview: modelResult.text ? preview(modelResult.text, 300) : undefined,
    tool_call_ids: modelResult.tool_calls.map((call) => call.tool_call_id),
    tool_ids: modelResult.tool_calls.map((call) => call.tool_id),
    tool_execution_ids: executions.map((execution) => execution.execution_id),
    tool_execution_statuses: executions.map((execution) => execution.status),
    newly_loaded_tool_ids: loaded,
    new_evidence_ids: evidence,
    input_estimated_tokens: context.estimated_tokens,
    input_bytes: context.input_bytes,
    output_tokens: modelResult.usage.output_tokens,
    cumulative_tool_calls: cumulativeCalls,
    progress_made: progress,
    no_progress_reasons: noProgressReasons,
    warnings: warnings.slice(0, 8),
    turn_hash: "",
  }
  summary.turn_hash = stableHash({ ...summary, turn_hash: "" })
  return summary
}

function appendTurnSummary(turns: CommanderInvestigationTurnSummary[], summary: CommanderInvestigationTurnSummary, workingSet: CommanderInvestigationWorkingSet, budget: CommanderInvestigationBudget): void {
  turns.push(summary)
  if (turns.length > budget.max_turn_summaries) {
    turns.shift()
    workingSet.omitted_turn_count += 1
  }
}

function emptyWorkingSet(input: CommanderInvestigationInput, loaded: string[]): CommanderInvestigationWorkingSet {
  const workingSet = {
    objective_preview: preview(input.objective, 1000),
    phase: input.phase,
    loaded_tool_ids: loaded,
    evidence_cards: [],
    recent_execution_digests: [],
    recent_load_outcomes: [],
    current_blockers: [],
    current_warnings: [],
    omitted_evidence_count: 0,
    omitted_digest_count: 0,
    omitted_turn_count: 0,
    consecutive_no_progress_turns: 0,
    cumulative_tool_result_bytes: 0,
    model_turn_count: 0,
    tool_call_count: 0,
    tool_search_call_count: 0,
    working_set_hash: "",
  }
  workingSet.working_set_hash = stableHash(stableWorkingSet(workingSet))
  return workingSet
}

function minimalBootstrap(input: CommanderInvestigationInput) {
  return { bootstrap_id: `commander_investigation_bootstrap_${stableHash(input).slice(0, 16)}`, bootstrap_hash: stableHash({ objective: input.objective, phase: input.phase }) }
}

function fallbackBudget(phase: CommanderToolPhase, reason: string): CommanderInvestigationBudget {
  return {
    budget_id: `commander_investigation_budget_${reason}`,
    phase,
    max_model_turns: 1,
    max_tool_calls: 0,
    max_tool_search_calls: 0,
    max_loaded_schemas: 0,
    max_tool_calls_per_turn: 0,
    max_cumulative_tool_result_bytes: 0,
    max_wall_time_ms: 1,
    max_consecutive_no_progress_turns: 1,
    max_evidence_cards: 0,
    max_turn_summaries: 0,
    source_profile_id: "unresolved",
    source_context_budget_id: "unresolved",
    warnings: [],
    budget_hash: stableHash({ phase, reason }),
  }
}

function boundedOverride(value: number | undefined, base: number, hard: number): number {
  if (!value) return Math.min(base, hard)
  return Math.min(value, base, hard)
}

function strictBudgetInput(input: CommanderInvestigationInput): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key.startsWith("max_") || key === "provider_kind" || key === "model_id"))
}

function stopReasonForControl(snapshot: CommanderInvestigationControlSnapshot): CommanderInvestigationStopReason | undefined {
  if (snapshot.action === "pause") return "human_pause"
  if (snapshot.action === "stop") return "human_stop"
  if (snapshot.action === "needs_human_review") {
    if (snapshot.projected_state === "correction_pending") return "human_correction"
    if (snapshot.projected_state === "override_pending") return "human_override"
    if (snapshot.projected_state === "escalated") return "human_escalation"
    return "human_pause"
  }
  return undefined
}

function stableWorkingSet(value: CommanderInvestigationWorkingSet): unknown {
  return {
    ...value,
    evidence_cards: value.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
  }
}

function stableResult(value: CommanderInvestigationResult): unknown {
  return {
    ...value,
    started_at: "",
    completed_at: "",
    duration_ms: 0,
    evidence: value.evidence.map((item) => ({ ...item, observed_at: "" })),
    turn_summaries: value.turn_summaries.map((item) => ({ ...item })),
  }
}

function preview(value: string | undefined, max: number): string {
  return redactText(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : undefined
}
