import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import { COMMANDER_TOOL_PHASES, COMMANDER_TOOL_REGISTRY } from "../commander-tools/commander-tool-registry"
import { isToolAllowedInPhase } from "../commander-tools/commander-tool-service"
import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolDescriptor, CommanderToolPhase } from "../commander-tools/commander-tool-types"
import { commanderProviderVisibleDescriptionHash, commanderToolSchemaFromDescriptor, stableHash, validateCommanderToolArguments } from "./commander-model-schema"
import type { CommanderModelAssistantMessage, CommanderModelMessage, CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStepResult, CommanderModelToolCallPart, CommanderModelToolProtocol, CommanderModelToolResultMessage } from "./commander-model-types"
import type { CommanderConnectorModelTransportMetadata } from "./commander-connector-transport-types"
import { toCommanderToolResultMessage } from "./commander-tool-executor"
import type { CommanderToolExecutionResult } from "./commander-tool-execution-types"
import {
  type CommanderInvestigationBudget,
  type CommanderInvestigationBootstrap,
  type CommanderInvestigationContext,
  type CommanderInvestigationControllerOptions,
  type CommanderInvestigationControlSnapshot,
  type CommanderInvestigationInput,
  type CommanderInvestigationResult,
  type CommanderInvestigationStopReason,
  type CommanderInvestigationTurnSummary,
  type CommanderInvestigationWorkingSet,
} from "./commander-investigation-types"
import type { CommanderInvestigationProviderAuditPolicy, CommanderInvestigationProviderAuditSummary, CommanderInvestigationProviderPreflightSnapshot } from "./commander-investigation-provider-types"
import type { CommanderInvestigationLoadedToolRef } from "./commander-investigation-journal-types"
import { CommanderInvestigationJournalConflictError } from "./commander-investigation-journal-service"
import type { CommanderInvestigationRecoveryContinuationSeed, CommanderInvestigationRecoveryFirstModelRequestPreview } from "./commander-investigation-recovery-execution-types"
import { durableCommanderInvestigationWorkingSet, stableCommanderInvestigationProviderAudit, stableCommanderInvestigationWorkingSet } from "./commander-investigation-working-set"

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
    if (inputBlockers.length) return this.finish(input, investigationId, "blocked", "controller_error", minimalBootstrap(input), blockedBudget, "native", [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], inputBlockers, [], started)
    const identityBlocker = midMissionIdentityBlocker(input)
    if (identityBlocker) return this.finish(input, investigationId, "blocked", "bootstrap_blocked", minimalBootstrap(input), blockedBudget, "native", [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], [identityBlocker], [], started)
    if (!this.options.modelAdapter) return this.finish(input, investigationId, "blocked", "adapter_not_configured", minimalBootstrap(input), blockedBudget, "native", [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], ["Commander investigation model adapter is not configured"], [], started)
    const initialProviderGate = await this.checkProvider(input, "investigation")
    if (initialProviderGate && !initialProviderGate.ready) return this.finish(input, investigationId, "blocked", "provider_preflight_blocked", minimalBootstrap(input), blockedBudget, "native", [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], initialProviderGate.blockers, initialProviderGate.warnings, started)

    const budgetResolution = await this.deriveBudget(input)
    const budget = budgetResolution.budget
    if (budgetResolution.blockers.length > 0) return this.finish(input, investigationId, "blocked", "context_budget_exhausted", minimalBootstrap(input), budget, "native", [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], budgetResolution.blockers, budget.warnings, started)
    const protocolResolution = this.resolveProtocol(input)
    if (protocolResolution.blocker) return this.finish(input, investigationId, "blocked", protocolResolution.blocker, minimalBootstrap(input), budget, "native", [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], [protocolResolution.blocker], protocolResolution.warnings, started)
    const toolProtocol = protocolResolution.protocol
    const bootstrap = await this.options.bootstrapService.compile(input)
    if (bootstrap.blockers.length > 0) return this.finish(input, investigationId, "blocked", "bootstrap_blocked", bootstrap, budget, toolProtocol, [], emptyWorkingSet(input, [], this.options.providerAuditPolicy), 0, [], bootstrap.blockers, bootstrap.warnings, started)

    const initial = await this.initialLoadedTools(input, budget)
    const loaded = new Map(initial.loaded.map((tool) => [tool.tool_id, tool]))
    const workingSet = emptyWorkingSet(input, Array.from(loaded.keys()), this.options.providerAuditPolicy)
    workingSet.current_warnings.push(...protocolResolution.warnings, ...initial.warnings)
	    workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
    let latestAssistant: CommanderModelAssistantMessage | undefined
    let latestToolResults: CommanderModelToolResultMessage[] = []
    const turns: CommanderInvestigationTurnSummary[] = []
    let providerRequests = 0
    const recentResults = new Map<string, { count: number; last_turn_index: number }>()
    const startedObserved = await this.observeStarted(input, investigationId, bootstrap, budget, toolProtocol, Array.from(loaded.values()), workingSet, started.toISOString())
    if (startedObserved.blocker) return this.finish(input, investigationId, startedObserved.status!, startedObserved.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [startedObserved.blocker], [], started)

    for (let turn = 1; turn <= budget.max_model_turns; turn += 1) {
      const preModelWarnings: string[] = []
      if (input.abort_signal?.aborted) return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation"], [], started)
      const humanBeforeModel = await this.checkControl(input, "model_step", turn)
      const humanStop = stopReasonForControl(humanBeforeModel)
      if (humanStop) return this.finish(input, investigationId, "needs_human_review", humanStop, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [humanBeforeModel.summary_preview ?? humanStop], humanBeforeModel.warnings, started)
      if (humanBeforeModel.warnings.length) preModelWarnings.push(...humanBeforeModel.warnings)
      const providerBeforeModel = await this.checkProvider(input, "model_step", turn)
      if (providerBeforeModel && !providerBeforeModel.ready) return this.finish(input, investigationId, "blocked", "provider_preflight_blocked", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), providerBeforeModel.blockers, [...preModelWarnings, ...providerBeforeModel.warnings], started)
      if (providerBeforeModel?.warnings.length) preModelWarnings.push(...providerBeforeModel.warnings)
      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted"], preModelWarnings, started)

      const contextWorkingSet = workingSetWithAdditionalWarnings(workingSet, preModelWarnings)
      const context = this.options.contextService.build({ bootstrap, workingSet: contextWorkingSet, loadedTools: Array.from(loaded.values()), toolProtocol, budget, latestAssistant, latestToolResults })
      const deferredPreModelWarnings = [...preModelWarnings]
      if (context.blocked) return this.finish(input, investigationId, "budget_exhausted", "context_budget_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), context.blockers, [...preModelWarnings, ...context.warnings], started)
      if (context.warnings.length) deferredPreModelWarnings.push(...context.warnings)
      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted before model request"], [...preModelWarnings, ...context.warnings], started)
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
        max_output_tokens: this.modelOutputTokens(input),
        abort_signal: deadline.signal,
        requested_at: this.now().toISOString(),
        metadata: { investigation_id: investigationId, phase: input.phase, requested_by: input.requested_by },
      }
      const observedModelStep = await this.observeModelStepStarted(input, investigationId, turn, request.request_id, toolProtocol, context, workingSet, Array.from(loaded.values()), providerRequests)
      if (observedModelStep.blocker) return this.finish(input, investigationId, observedModelStep.status!, observedModelStep.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [observedModelStep.blocker], [], started)
      const modelResult = await this.options.modelAdapter.executeOneStep(request).finally(deadline.cancel)
      if (deferredPreModelWarnings.length) {
        workingSet.current_warnings.push(...deferredPreModelWarnings)
	        workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
      }
      const requestCountBlocker = modelRequestCountBlocker(modelResult)
      if (!Number.isInteger(modelResult.request_count) || modelResult.request_count < 0) {
        return this.finish(input, investigationId, "failed", "controller_error", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [requestCountBlocker ?? "model adapter returned an invalid request_count"], modelResult.warnings, started)
      }
      providerRequests += modelResult.request_count
      workingSet.model_turn_count = turn
      const transportInterrupted = modelResult.status === "cancelled" || modelResult.status === "failed"
      const audit = observeProviderAudit(workingSet.provider_audit, this.options.providerAuditPolicy, modelResult)
      if (requestCountBlocker) return this.finish(input, investigationId, "failed", "controller_error", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [requestCountBlocker], [...modelResult.warnings, ...audit.warnings], started)
      if (input.abort_signal?.aborted && transportInterrupted) return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation during model request"], [...modelResult.warnings, ...audit.warnings], started)
      if (deadline.expired() && transportInterrupted) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during model request"], [...modelResult.warnings, ...audit.warnings], started)
      if (audit.blocker) return this.finish(input, investigationId, "failed", "provider_audit_incomplete", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [audit.blocker], [...modelResult.warnings, ...audit.warnings], started)
      if (input.abort_signal?.aborted) return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation during model request"], modelResult.warnings, started)
      if (deadline.expired()) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during model request"], modelResult.warnings, started)
      if (modelResult.status !== "tool_call") {
        latestAssistant = modelResult.assistant_message
        latestToolResults = []
        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, true, [], modelResult.warnings, audit.metadata)
        appendTurnSummary(turns, summary, workingSet, budget)
        const checkpointObserved = await this.observeCheckpoint(input, investigationId, bootstrap, budget, toolProtocol, turn, loaded, workingSet, turns, latestAssistant, latestToolResults, providerRequests, wallStartedMs)
        if (checkpointObserved.blocker) return this.finish(input, investigationId, checkpointObserved.status!, checkpointObserved.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [checkpointObserved.blocker], [], started)
        if (modelResult.status === "final") return this.finish(input, investigationId, "final", "model_final", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [], [...modelResult.warnings, ...(modelResult.tool_calls.length === 0 && workingSet.evidence_cards.length === 0 ? ["model finalized without acquired evidence"] : [])], started, modelResult.text)
        if (modelResult.status === "refusal") return this.finish(input, investigationId, "refused", "model_refusal", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [], modelResult.warnings, started)
        if (modelResult.status === "cancelled") return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "model request cancelled"], modelResult.warnings, started)
        if (modelResult.status === "malformed") return this.finish(input, investigationId, "failed", "model_malformed", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "model output malformed"], modelResult.warnings, started)
        return this.finish(input, investigationId, "failed", "provider_failed", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "provider request failed"], modelResult.warnings, started)
      }

      const validation = validateToolCalls(modelResult.tool_calls, loaded, budget, workingSet)
      if (validation.blocker) {
        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, false, [validation.blocker], modelResult.warnings, audit.metadata)
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
      let currentTurnToolResultBytes = 0
      for (const call of modelResult.tool_calls) {
        const humanBeforeTool = await this.checkControl(input, "tool_execution", turn, call.tool_id)
        const humanToolStop = stopReasonForControl(humanBeforeTool)
        if (humanToolStop) return this.finish(input, investigationId, "needs_human_review", humanToolStop, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [humanBeforeTool.summary_preview ?? humanToolStop], humanBeforeTool.warnings, started)
        if (humanBeforeTool.warnings.length) workingSet.current_warnings.push(...humanBeforeTool.warnings)
        if (workingSet.tool_call_count >= budget.max_tool_calls) return this.finish(input, investigationId, "budget_exhausted", "max_tool_calls", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max tool calls exhausted"], [], started)
        const args = normalizedControllerArgs(call, input.phase)
        if (call.tool_id === TOOL_SEARCH_ID && workingSet.tool_search_call_count + 1 > budget.max_tool_search_calls) return this.finish(input, investigationId, "budget_exhausted", "max_tool_search_calls", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max tool search calls exhausted"], [], started)
        const callIndex = executions.length + 1
        const executionId = `${investigationId}_exec_${turn}_${callIndex}`
        const callId = controllerCallId(investigationId, turn, callIndex, call.tool_call_id)
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
        if (input.abort_signal?.aborted) return this.finish(input, investigationId, "cancelled", "caller_cancelled", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation during tool execution"], execution.warnings, started)
        if (toolDeadlineExpired) return this.finish(input, investigationId, "budget_exhausted", "wall_time_exhausted", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during tool execution"], execution.warnings, started)
        executions.push(execution)
        workingSet.tool_call_count += 1
        if (call.tool_id === TOOL_SEARCH_ID) workingSet.tool_search_call_count += 1
        const resultBytesCap = perToolResultCap(execution.max_output_bytes, context.input_bytes + currentTurnToolResultBytes, budget, modelResult.tool_calls.length - executions.length + 1)
        const toolMessage = toCommanderToolResultMessage(execution, resultBytesCap)
        latestToolResults.push(toolMessage)
        const toolMessageBytes = Buffer.byteLength(toolMessage.content)
        currentTurnToolResultBytes += toolMessageBytes
        workingSet.cumulative_tool_result_bytes += toolMessageBytes
        if (workingSet.cumulative_tool_result_bytes > budget.max_cumulative_tool_result_bytes) return this.finish(input, investigationId, "budget_exhausted", "max_cumulative_tool_result_bytes", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["cumulative tool-result byte budget exhausted"], [], started)
        const loadedTool = this.maybeLoadTool(call, args, execution, loaded, budget)
        if (loadedTool.loaded) {
          loaded.set(loadedTool.tool.tool_id, loadedTool.tool)
          newlyLoaded.push(loadedTool.tool.tool_id)
          workingSet.loaded_tool_ids = Array.from(loaded.keys())
          progressMade = true
        }
        if (loadedTool.warning) workingSet.recent_load_outcomes.push(loadedTool.warning)
        const beforeEvidenceKeys = new Set(workingSet.evidence_cards.map(evidenceKey))
        addEvidence(workingSet, execution.evidence, budget.max_evidence_cards)
        const afterEvidence = workingSet.evidence_cards.filter((item) => !beforeEvidenceKeys.has(evidenceKey(item))).map((item) => item.evidence_id)
        newEvidence.push(...afterEvidence)
        if (afterEvidence.length > 0) progressMade = true
        const callSignature = stableHash({ tool_id: call.tool_id, arguments: args })
        const resultSignature = repeatResultSignature(callSignature, execution)
        const repeat = recentResults.get(resultSignature) ?? { count: 0, last_turn_index: turn }
        const repeatCount = repeat.count
        recentResults.set(resultSignature, { count: repeatCount + 1, last_turn_index: turn })
        updateRecentResultSignatures(workingSet, recentResults)
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
	      workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
      const summary = turnSummary(turn, request.request_id, modelResult, context, executions, newlyLoaded, newEvidence, workingSet.tool_call_count, progressMade, noProgressReasons, modelResult.warnings, audit.metadata)
      appendTurnSummary(turns, summary, workingSet, budget)
      const checkpointObserved = await this.observeCheckpoint(input, investigationId, bootstrap, budget, toolProtocol, turn, loaded, workingSet, turns, latestAssistant, latestToolResults, providerRequests, wallStartedMs)
      if (checkpointObserved.blocker) return this.finish(input, investigationId, checkpointObserved.status!, checkpointObserved.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [checkpointObserved.blocker], [], started)
      if (workingSet.consecutive_no_progress_turns >= budget.max_consecutive_no_progress_turns) return this.finish(input, investigationId, "no_progress", "consecutive_no_progress", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["consecutive no-progress turn limit reached"], [], started)
    }
    return this.finish(input, investigationId, "budget_exhausted", "max_model_turns", bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max model turns exhausted"], [], started)
  }

  async runFromRecoverySeed(seed: CommanderInvestigationRecoveryContinuationSeed, options: { abort_signal?: AbortSignal } = {}): Promise<CommanderInvestigationResult> {
    const started = this.now()
    const wallStartedMs = performance.now() - Math.max(0, seed.elapsed_active_ms_before)
    const input: CommanderInvestigationInput = { ...seed.normalized_input, investigation_id: seed.investigation_id, abort_signal: options.abort_signal }
    const expectedHash = stableHash({
      seed_version: 1,
      investigation_id: seed.investigation_id,
      recovery_kind: seed.recovery_kind,
      immutable_identity: seed.immutable_identity,
      normalized_input_hash: seed.normalized_input_hash,
      recovery_basis_hash: seed.recovery_basis_hash,
      checkpoint_ref: seed.checkpoint_ref,
      pending_model_step_ref: seed.pending_model_step_ref,
      original_bootstrap_ref: seed.original_bootstrap_ref,
      current_bootstrap_hash: seed.current_bootstrap_hash,
      continuity_drift_detected: seed.continuity_drift_detected,
      tool_protocol: seed.tool_protocol,
      loaded_tool_refs: seed.loaded_tool_refs,
      effective_budget_hash: seed.effective_budget_hash,
      working_set_hash: seed.working_set_hash,
      turn_summary_hash: stableHash(seed.turn_summaries),
      replay_exchange_hash: seed.replay_exchange_hash,
      replay_message_hash: seed.replay_message_hash,
      recovery_notice_hash: seed.recovery_notice_hash,
      next_turn_index: seed.next_turn_index,
      elapsed_active_ms_before: seed.elapsed_active_ms_before,
      provider_request_count_before: seed.provider_request_count_before,
      external_api_audit_count_before: seed.external_api_audit_count_before,
      unresolved_provider_attempt_count: seed.unresolved_provider_attempt_count,
      uncertain_model_turn_charge: seed.uncertain_model_turn_charge,
      first_model_request_preview_hash: seed.first_model_request_preview.request_preview_hash,
    })
    if (expectedHash !== seed.execution_preparation_hash) return this.finish(input, seed.investigation_id, "blocked", "controller_error", seed.current_bootstrap, seed.effective_budget.effective_budget, seed.tool_protocol, seed.turn_summaries, seed.working_set, seed.provider_request_count_before, seed.loaded_tools, ["recovery continuation seed hash did not verify"], [], started)
    const seedIntegrityBlocker = validateRecoverySeedIntegrity(seed, this.options.descriptors)
    if (seedIntegrityBlocker) return this.finish(input, seed.investigation_id, "blocked", "controller_error", seed.current_bootstrap, seed.effective_budget.effective_budget, seed.tool_protocol, seed.turn_summaries, seed.working_set, seed.provider_request_count_before, seed.loaded_tools, [seedIntegrityBlocker], [], started)
    const budget = seed.effective_budget.effective_budget
    const loaded = new Map(seed.loaded_tools.map((tool) => [tool.tool_id, tool]))
    const workingSet = redactValue(seed.working_set) as CommanderInvestigationWorkingSet
    if (workingSet.model_turn_count < seed.effective_budget.consumed.model_turns) {
      workingSet.model_turn_count = seed.effective_budget.consumed.model_turns
      workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
    }
    const turns = seed.turn_summaries.slice()
    let latestAssistant = seed.latest_assistant
    let latestToolResults = seed.latest_tool_results.slice()
    let providerRequests = seed.provider_request_count_before
    const recentResults = new Map(seed.working_set.recent_result_signatures.map((item) => [item.signature_hash, { count: item.count, last_turn_index: item.last_turn_index }]))
    if (!this.options.modelAdapter) return this.finish(input, seed.investigation_id, "blocked", "adapter_not_configured", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation model adapter is not configured"], [], started)
    if (options.abort_signal?.aborted) return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted recovered investigation"], [], started)
    if (seed.effective_budget.remaining.wall_time_ms <= 0) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["recovery continuation wall-time budget exhausted"], [], started)
    if (seed.effective_budget.remaining.model_turns <= 0) return this.finish(input, seed.investigation_id, "budget_exhausted", "max_model_turns", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["recovery continuation model-turn budget exhausted"], [], started)
    for (let turn = seed.next_turn_index; turn <= budget.max_model_turns; turn += 1) {
	      const preModelWarnings: string[] = []
	      if (options.abort_signal?.aborted) return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted recovered investigation"], [], started)
	      const humanBeforeModel = await this.checkControl(input, "model_step", turn)
	      const humanStop = stopReasonForControl(humanBeforeModel)
	      if (humanStop) return this.finish(input, seed.investigation_id, "needs_human_review", humanStop, seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [humanBeforeModel.summary_preview ?? humanStop], humanBeforeModel.warnings, started)
	      if (humanBeforeModel.warnings.length) preModelWarnings.push(...humanBeforeModel.warnings)
	      const providerBeforeModel = await this.checkProvider(input, "model_step", turn)
	      if (providerBeforeModel && !providerBeforeModel.ready) return this.finish(input, seed.investigation_id, "blocked", "provider_preflight_blocked", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), providerBeforeModel.blockers, [...preModelWarnings, ...providerBeforeModel.warnings], started)
	      if (providerBeforeModel?.warnings.length) preModelWarnings.push(...providerBeforeModel.warnings)
	      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted"], preModelWarnings, started)
	      const contextWorkingSet = workingSetWithAdditionalWarnings(workingSet, preModelWarnings)
	      const context = this.options.contextService.build({
	        bootstrap: seed.current_bootstrap,
	        workingSet: contextWorkingSet,
	        loadedTools: Array.from(loaded.values()),
	        toolProtocol: seed.tool_protocol,
	        budget,
	        latestAssistant,
	        latestToolResults,
	        recoveryNotice: seed.recovery_notice,
	      })
	      const deferredPreModelWarnings = [...preModelWarnings]
	      if (context.blocked) return this.finish(input, seed.investigation_id, "budget_exhausted", "context_budget_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), context.blockers, [...preModelWarnings, ...context.warnings], started)
	      if (context.warnings.length) deferredPreModelWarnings.push(...context.warnings)
	      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted before model request"], [...preModelWarnings, ...context.warnings], started)
	      const deadline = deadlineSignal(options.abort_signal, budget, wallStartedMs)
	      const request: CommanderModelStepRequest = {
	        request_id: `${seed.request_id_prefix}_turn_${turn}`,
	        provider_id: seed.immutable_identity.provider_id,
	        provider_kind: seed.immutable_identity.provider_kind,
	        model_id: seed.immutable_identity.model_id,
	        messages: context.messages,
	        tools: Array.from(loaded.values()).map(commanderToolSchemaFromDescriptor),
	        tool_protocol: seed.tool_protocol,
	        tool_choice: "auto",
	        max_output_tokens: this.modelOutputTokens(input),
	        abort_signal: deadline.signal,
		        requested_at: this.now().toISOString(),
		        metadata: { investigation_id: seed.investigation_id, phase: input.phase, requested_by: input.requested_by },
		      }
      if (turn === seed.next_turn_index) {
        const firstRequestBlocker = recoveryFirstRequestPreviewBlocker(seed, request, context, Array.from(loaded.values()))
        if (firstRequestBlocker) {
          deadline.cancel()
          return this.finish(input, seed.investigation_id, "blocked", "controller_error", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [firstRequestBlocker], [...preModelWarnings, ...context.warnings], started)
        }
      }
		      const modelResult = await this.options.modelAdapter.executeOneStep(request).finally(deadline.cancel)
	      if (deferredPreModelWarnings.length) {
	        workingSet.current_warnings.push(...deferredPreModelWarnings)
	        workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
	      }
	      const requestCountBlocker = modelRequestCountBlocker(modelResult)
	      if (!Number.isInteger(modelResult.request_count) || modelResult.request_count < 0) {
	        return this.finish(input, seed.investigation_id, "failed", "controller_error", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [requestCountBlocker ?? "model adapter returned an invalid request_count"], modelResult.warnings, started)
	      }
	      providerRequests += modelResult.request_count
	      workingSet.model_turn_count = turn
	      const transportInterrupted = modelResult.status === "cancelled" || modelResult.status === "failed"
	      const audit = observeProviderAudit(workingSet.provider_audit, this.options.providerAuditPolicy, modelResult)
	      if (requestCountBlocker) return this.finish(input, seed.investigation_id, "failed", "controller_error", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [requestCountBlocker], [...modelResult.warnings, ...audit.warnings], started)
	      if (options.abort_signal?.aborted && transportInterrupted) return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation during model request"], [...modelResult.warnings, ...audit.warnings], started)
	      if (deadline.expired() && transportInterrupted) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during model request"], [...modelResult.warnings, ...audit.warnings], started)
	      if (audit.blocker) return this.finish(input, seed.investigation_id, "failed", "provider_audit_incomplete", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [audit.blocker], [...modelResult.warnings, ...audit.warnings], started)
	      if (options.abort_signal?.aborted) return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation during model request"], modelResult.warnings, started)
	      if (deadline.expired()) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during model request"], modelResult.warnings, started)
	      if (modelResult.status !== "tool_call") {
	        latestAssistant = modelResult.assistant_message
	        latestToolResults = []
	        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, true, [], modelResult.warnings, audit.metadata)
	        appendTurnSummary(turns, summary, workingSet, budget)
	        if (modelResult.status === "final") return this.finish(input, seed.investigation_id, "final", "model_final", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [], [...modelResult.warnings, ...(modelResult.tool_calls.length === 0 && workingSet.evidence_cards.length === 0 ? ["model finalized without acquired evidence"] : [])], started, modelResult.text)
	        if (modelResult.status === "refusal") return this.finish(input, seed.investigation_id, "refused", "model_refusal", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [], modelResult.warnings, started)
	        if (modelResult.status === "cancelled") return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "model request cancelled"], modelResult.warnings, started)
	        if (modelResult.status === "malformed") return this.finish(input, seed.investigation_id, "failed", "model_malformed", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "model output malformed"], modelResult.warnings, started)
	        return this.finish(input, seed.investigation_id, "failed", "provider_failed", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [modelResult.error ?? "provider request failed"], modelResult.warnings, started)
	      }
	      const validation = validateToolCalls(modelResult.tool_calls, loaded, budget, workingSet)
	      if (validation.blocker) {
	        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, false, [validation.blocker], modelResult.warnings, audit.metadata)
	        appendTurnSummary(turns, summary, workingSet, budget)
	        return this.finish(input, seed.investigation_id, validation.reason === "max_tool_calls_per_turn" || validation.reason === "max_tool_calls" ? "budget_exhausted" : "blocked", validation.reason, seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [validation.blocker], modelResult.warnings, started)
	      }
	      latestAssistant = modelResult.assistant_message
	      latestToolResults = []
	      const executions: CommanderToolExecutionResult[] = []
	      const newlyLoaded: string[] = []
	      const newEvidence: string[] = []
	      const noProgressReasons: string[] = []
	      let progressMade = false
	      let currentTurnToolResultBytes = 0
	      for (const call of modelResult.tool_calls) {
	        const humanBeforeTool = await this.checkControl(input, "tool_execution", turn, call.tool_id)
	        const humanToolStop = stopReasonForControl(humanBeforeTool)
	        if (humanToolStop) return this.finish(input, seed.investigation_id, "needs_human_review", humanToolStop, seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [humanBeforeTool.summary_preview ?? humanToolStop], humanBeforeTool.warnings, started)
	        if (humanBeforeTool.warnings.length) workingSet.current_warnings.push(...humanBeforeTool.warnings)
	        if (workingSet.tool_call_count >= budget.max_tool_calls) return this.finish(input, seed.investigation_id, "budget_exhausted", "max_tool_calls", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max tool calls exhausted"], [], started)
	        const args = normalizedControllerArgs(call, input.phase)
	        if (call.tool_id === TOOL_SEARCH_ID && workingSet.tool_search_call_count + 1 > budget.max_tool_search_calls) return this.finish(input, seed.investigation_id, "budget_exhausted", "max_tool_search_calls", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max tool search calls exhausted"], [], started)
	        const callIndex = executions.length + 1
	        const executionId = `${seed.investigation_id}_exec_${turn}_${callIndex}`
	        const callId = controllerCallId(seed.investigation_id, turn, callIndex, call.tool_call_id)
	        const controllerBlocker = this.controllerPreflightBlocker(call, args, input.phase, loaded, budget)
	        if (!controllerBlocker && elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted before tool execution"], [], started)
	        let toolDeadlineExpired = false
	        let execution: CommanderToolExecutionResult
	        if (controllerBlocker) {
	          execution = controllerBlockedExecution(executionId, callId, call, input.phase, controllerBlocker, this.now())
	        } else {
	          const toolDeadline = deadlineSignal(options.abort_signal, budget, wallStartedMs)
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
	        if (options.abort_signal?.aborted) return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted investigation during tool execution"], execution.warnings, started)
	        if (toolDeadlineExpired) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation wall-time budget exhausted during tool execution"], execution.warnings, started)
	        executions.push(execution)
	        workingSet.tool_call_count += 1
	        if (call.tool_id === TOOL_SEARCH_ID) workingSet.tool_search_call_count += 1
	        const resultBytesCap = perToolResultCap(execution.max_output_bytes, context.input_bytes + currentTurnToolResultBytes, budget, modelResult.tool_calls.length - executions.length + 1)
	        const toolMessage = toCommanderToolResultMessage(execution, resultBytesCap)
	        latestToolResults.push(toolMessage)
	        const toolMessageBytes = Buffer.byteLength(toolMessage.content)
	        currentTurnToolResultBytes += toolMessageBytes
	        workingSet.cumulative_tool_result_bytes += toolMessageBytes
	        if (workingSet.cumulative_tool_result_bytes > budget.max_cumulative_tool_result_bytes) return this.finish(input, seed.investigation_id, "budget_exhausted", "max_cumulative_tool_result_bytes", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["cumulative tool-result byte budget exhausted"], [], started)
	        const loadedTool = this.maybeLoadTool(call, args, execution, loaded, budget)
	        if (loadedTool.loaded) {
	          loaded.set(loadedTool.tool.tool_id, loadedTool.tool)
	          newlyLoaded.push(loadedTool.tool.tool_id)
	          workingSet.loaded_tool_ids = Array.from(loaded.keys())
	          progressMade = true
	        }
	        if (loadedTool.warning) workingSet.recent_load_outcomes.push(loadedTool.warning)
	        const beforeEvidenceKeys = new Set(workingSet.evidence_cards.map(evidenceKey))
	        addEvidence(workingSet, execution.evidence, budget.max_evidence_cards)
	        const afterEvidence = workingSet.evidence_cards.filter((item) => !beforeEvidenceKeys.has(evidenceKey(item))).map((item) => item.evidence_id)
	        newEvidence.push(...afterEvidence)
	        if (afterEvidence.length > 0) progressMade = true
	        const callSignature = stableHash({ tool_id: call.tool_id, arguments: args })
	        const resultSignature = repeatResultSignature(callSignature, execution)
	        const repeat = recentResults.get(resultSignature) ?? { count: 0, last_turn_index: turn }
	        const repeatCount = repeat.count
	        recentResults.set(resultSignature, { count: repeatCount + 1, last_turn_index: turn })
	        updateRecentResultSignatures(workingSet, recentResults)
	        if (repeatCount >= 2) return this.finish(input, seed.investigation_id, "no_progress", "repeated_identical_call", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["repeated identical tool call/result detected"], [], started)
	        if (execution.status === "cancelled") return this.finish(input, seed.investigation_id, "cancelled", "tool_execution_cancelled", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["tool execution cancelled"], execution.warnings, started)
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
	      workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
	      const summary = turnSummary(turn, request.request_id, modelResult, context, executions, newlyLoaded, newEvidence, workingSet.tool_call_count, progressMade, noProgressReasons, modelResult.warnings, audit.metadata)
	      appendTurnSummary(turns, summary, workingSet, budget)
	      if (workingSet.consecutive_no_progress_turns >= budget.max_consecutive_no_progress_turns) return this.finish(input, seed.investigation_id, "no_progress", "consecutive_no_progress", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["consecutive no-progress turn limit reached"], [], started)
	    }
	    return this.finish(input, seed.investigation_id, "budget_exhausted", "max_model_turns", seed.current_bootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["max model turns exhausted"], [], started)
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
    const capability = this.options.capabilityRegistry.get({ provider_kind: input.provider_kind, model_id: input.model_id, role: "commander" })
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

  private modelOutputTokens(input: CommanderInvestigationInput): number {
    const capability = this.options.capabilityRegistry.get({ provider_kind: input.provider_kind, model_id: input.model_id, role: "commander" })
    // 9W2B2 treats the configured capability value as an upper bound; the
    // controller keeps the lightweight 1024-token default until a later branch
    // adds an explicit investigation output override.
    return Math.min(1024, capability.max_output_tokens ?? 1024)
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

  private maybeLoadTool(call: CommanderModelToolCallPart, args: Record<string, unknown>, execution: CommanderToolExecutionResult, loaded: Map<string, CommanderToolDescriptor>, budget: CommanderInvestigationBudget): { loaded: false; warning?: string } | { loaded: true; tool: CommanderToolDescriptor; warning?: string } {
    if (call.tool_id !== TOOL_GET_ID || execution.status !== "ready") return { loaded: false }
    const target = typeof args.tool_id === "string" ? args.tool_id : extractToolGetTarget(execution)
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

  private async checkProvider(input: CommanderInvestigationInput, before: "investigation" | "model_step", turnIndex?: number): Promise<CommanderInvestigationProviderPreflightSnapshot | undefined> {
    if (!this.options.providerGate) return undefined
    return this.options.providerGate.check({ phase: input.phase, provider_id: input.provider_id, provider_kind: input.provider_kind, model_id: input.model_id, before, turn_index: turnIndex })
  }

  private async observeStarted(input: CommanderInvestigationInput, investigationId: string, bootstrap: CommanderInvestigationBootstrap, budget: CommanderInvestigationBudget, toolProtocol: CommanderModelToolProtocol, loadedTools: CommanderToolDescriptor[], workingSet: CommanderInvestigationWorkingSet, startedAt: string): Promise<ObserverOutcome> {
    if (!this.options.persistenceObserver) return {}
    try {
      await this.options.persistenceObserver.onStarted({ investigation_id: investigationId, input, bootstrap, budget, tool_protocol: toolProtocol, loaded_tools: loadedTools, working_set: workingSet, started_at: startedAt })
      return {}
    } catch (error) {
      return observerOutcome(error)
    }
  }

  private async observeModelStepStarted(input: CommanderInvestigationInput, investigationId: string, turn: number, requestId: string, toolProtocol: CommanderModelToolProtocol, context: { input_bytes: number; estimated_tokens: number; messages: CommanderModelMessage[] }, workingSet: CommanderInvestigationWorkingSet, loadedTools: CommanderToolDescriptor[], providerRequests: number): Promise<ObserverOutcome> {
    if (!this.options.persistenceObserver) return {}
    try {
      await this.options.persistenceObserver.onModelStepStarted({
        investigation_id: investigationId,
        input,
        turn_index: turn,
        model_request_id: requestId,
        tool_protocol: toolProtocol,
        working_set_hash: durableCommanderInvestigationWorkingSet(workingSet).working_set_hash,
        context_hash: stableHash({ messages: context.messages, input_bytes: context.input_bytes, estimated_tokens: context.estimated_tokens }),
        input_bytes: context.input_bytes,
        estimated_input_tokens: context.estimated_tokens,
        loaded_tools: loadedTools,
        provider_request_count_before: providerRequests,
        external_api_audit_count_before: workingSet.provider_audit.external_api_audit_event_count,
        started_at: this.now().toISOString(),
      })
      return {}
    } catch (error) {
      return observerOutcome(error)
    }
  }

  private async observeCheckpoint(input: CommanderInvestigationInput, investigationId: string, bootstrap: CommanderInvestigationBootstrap, budget: CommanderInvestigationBudget, toolProtocol: CommanderModelToolProtocol, turn: number, loaded: Map<string, CommanderToolDescriptor>, workingSet: CommanderInvestigationWorkingSet, turns: CommanderInvestigationTurnSummary[], latestAssistant: CommanderModelAssistantMessage | undefined, latestToolResults: CommanderModelToolResultMessage[], providerRequests: number, wallStartedMs: number): Promise<ObserverOutcome> {
    if (!this.options.persistenceObserver) return {}
    try {
      await this.options.persistenceObserver.onCheckpoint({
        investigation_id: investigationId,
        input,
        bootstrap,
        budget,
        tool_protocol: toolProtocol,
        turn_index: turn,
        next_turn_index: turn + 1,
        loaded_tools: Array.from(loaded.values()),
        working_set: workingSet,
        turn_summaries: turns,
        latest_assistant: latestAssistant,
        latest_tool_results: latestToolResults,
        provider_request_count: providerRequests,
        elapsed_active_ms: elapsedWallMs(wallStartedMs),
        created_at: this.now().toISOString(),
      })
      return {}
    } catch (error) {
      return observerOutcome(error)
    }
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
      provider_audit: workingSet.provider_audit,
      blockers: blockers.map((item) => preview(item, 300)).slice(0, 16),
      warnings: [...workingSet.current_warnings, ...warnings].map((item) => preview(item, 300)).slice(0, 24),
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      duration_ms: Math.max(0, completed.getTime() - started.getTime()),
      durability: {
        mode: "none",
        started_persisted: false,
        initial_checkpoint_persisted: false,
        terminal_persisted: false,
        investigation_event_count: 0,
        checkpoint_count: 0,
        resume_supported: false,
        full_transcript_persisted: false,
        raw_tool_results_persisted: false,
        chain_of_thought_persisted: false,
        warnings: [],
        durability_hash: stableHash({ mode: "none" }),
      },
      investigation_event_count: 0,
      in_memory_only: true,
      transcript_persisted: false,
      working_set_persisted: false,
      investigation_events_appended: false,
      external_api_audit_events_appended: workingSet.provider_audit.external_api_audit_event_count,
      events_appended: workingSet.provider_audit.external_api_audit_event_count > 0,
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

type ObserverOutcome = { blocker?: string; status?: "blocked" | "failed"; reason?: CommanderInvestigationStopReason }

function observerOutcome(error: unknown): ObserverOutcome {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof CommanderInvestigationJournalConflictError) return { blocker: preview(message, 300), status: "blocked", reason: "durable_state_conflict" }
  return { blocker: preview(message, 300), status: "failed", reason: "persistence_failed" }
}

function validateInput(input: CommanderInvestigationInput): string[] {
  const blockers: string[] = []
  if (!preview(input.objective, 1000)) blockers.push("objective is required")
  if (!preview(input.requested_by, 200)) blockers.push("requested_by is required")
  if (!preview(input.provider_kind, 80)) blockers.push("provider_kind is required")
  if (!COMMANDER_TOOL_PHASES.includes(input.phase)) blockers.push("Commander tool phase is unsupported")
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith("max_") && value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) blockers.push(`${key} must be a positive integer`)
  }
  return blockers
}

function midMissionIdentityBlocker(input: CommanderInvestigationInput): string | undefined {
  return input.phase === "mid_mission_supervision" && !input.session_id && !input.launch_id
    ? "mid_mission_supervision requires session_id or launch_id"
    : undefined
}

function modelRequestCountBlocker(modelResult: CommanderModelStepResult): string | undefined {
  if (!Number.isInteger(modelResult.request_count) || modelResult.request_count < 0) return "model adapter returned an invalid request_count"
  if (modelResult.request_count > 1) return "model adapter violated one-request contract"
  if (modelResult.request_count === 0 && modelResult.status !== "cancelled") return "model adapter returned a zero-request non-cancelled result"
  return undefined
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
    const validated = descriptor?.input_schema ? validateCommanderToolArguments(descriptor.input_schema, executionArguments(call)) : { valid: false, errors: ["missing schema"] }
    if (!validated.valid) return { blocker: `NexusLoop revalidation failed for ${call.tool_id}: ${validated.errors.join("; ")}`, reason: "invalid_tool_call" }
  }
  return { reason: "invalid_tool_call" }
}

function normalizedControllerArgs(call: CommanderModelToolCallPart, phase: CommanderToolPhase): Record<string, unknown> {
  const args = executionArguments(call)
  if (call.tool_id === TOOL_SEARCH_ID) return { ...args, phase, implemented_only: true, allowed_in_phase_only: true, include_schema: false, limit: Math.min(Number(args.limit ?? 10), 10) }
  return args
}

function executionArguments(call: CommanderModelToolCallPart): Record<string, unknown> {
  return call.execution_arguments ?? call.arguments
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
  let timerExpired = false
  const timer = setTimeout(() => {
    timerExpired = true
    controller.abort(new Error("Commander investigation wall-time budget exhausted"))
  }, Math.max(1, Math.floor(remaining)))
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener("abort", parentAbort)
    },
    expired: () => timerExpired || !parent?.aborted && elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms,
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

function turnSummary(turn: number, requestId: string, modelResult: CommanderModelStepResult, context: { input_bytes: number; estimated_tokens: number }, executions: CommanderToolExecutionResult[], loaded: string[], evidence: string[], cumulativeCalls: number, progress: boolean, noProgressReasons: string[], warnings: string[], transport?: CommanderConnectorModelTransportMetadata): CommanderInvestigationTurnSummary {
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
    provider_transport_kind: transport?.transport_kind,
    provider_connector_id: transport?.connector_id,
    provider_audit_request_ids: (transport?.request_ids ?? []).slice(0, 24),
    provider_audit_event_kinds: (transport?.audit_event_kinds ?? []).slice(0, 24),
    provider_audit_event_count: transport?.audit_event_count ?? 0,
    provider_audit_complete: transport ? transport.audit_event_count === modelResult.request_count && transport.request_ids.length === modelResult.request_count : modelResult.request_count === 0,
    turn_hash: "",
  }
  summary.turn_hash = stableHash({ ...summary, provider_audit_request_ids: [], turn_hash: "" })
  return summary
}

function appendTurnSummary(turns: CommanderInvestigationTurnSummary[], summary: CommanderInvestigationTurnSummary, workingSet: CommanderInvestigationWorkingSet, budget: CommanderInvestigationBudget): void {
  turns.push(summary)
  if (turns.length > budget.max_turn_summaries) {
    turns.shift()
    workingSet.omitted_turn_count += 1
  }
  workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
}

function emptyWorkingSet(input: CommanderInvestigationInput, loaded: string[], auditPolicy?: CommanderInvestigationProviderAuditPolicy): CommanderInvestigationWorkingSet {
  const workingSet = {
    objective_preview: preview(input.objective, 1000),
    phase: input.phase,
    loaded_tool_ids: loaded,
    evidence_cards: [],
    recent_execution_digests: [],
    recent_load_outcomes: [],
    current_blockers: [],
    current_warnings: [],
    provider_audit: emptyProviderAudit(auditPolicy),
    omitted_evidence_count: 0,
    omitted_digest_count: 0,
    omitted_turn_count: 0,
    consecutive_no_progress_turns: 0,
    cumulative_tool_result_bytes: 0,
    model_turn_count: 0,
    tool_call_count: 0,
    tool_search_call_count: 0,
    recent_result_signatures: [],
    working_set_hash: "",
  }
  workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
  return workingSet
}

function workingSetWithAdditionalWarnings(workingSet: CommanderInvestigationWorkingSet, warnings: string[]): CommanderInvestigationWorkingSet {
  if (warnings.length === 0) return workingSet
  return {
    ...workingSet,
    current_warnings: [...workingSet.current_warnings, ...warnings],
  }
}

function updateRecentResultSignatures(workingSet: CommanderInvestigationWorkingSet, recentResults: Map<string, { count: number; last_turn_index: number }>): void {
  workingSet.recent_result_signatures = Array.from(recentResults.entries())
    .map(([signature_hash, value]) => ({ signature_hash, count: value.count, last_turn_index: value.last_turn_index }))
    .sort((a, b) => a.last_turn_index - b.last_turn_index || a.signature_hash.localeCompare(b.signature_hash))
    .slice(-64)
}

function emptyProviderAudit(policy?: CommanderInvestigationProviderAuditPolicy): CommanderInvestigationProviderAuditSummary {
  return {
    audit_required: policy?.required === true,
    transport_kind: policy?.required === true ? policy.transport_kind : "none",
    connector_ids: policy?.required === true ? [policy.connector_id] : [],
    provider_request_count: 0,
    external_api_audit_event_count: 0,
    successful_audit_count: 0,
    failed_audit_count: 0,
    audit_request_ids: [],
    audit_event_kinds: [],
    omitted_request_id_count: 0,
    all_provider_requests_audited: policy?.required !== true,
    request_body_persisted: false,
    response_body_persisted: false,
    credentials_persisted: false,
    warnings: [],
  }
}

function observeProviderAudit(summary: CommanderInvestigationProviderAuditSummary, policy: CommanderInvestigationProviderAuditPolicy | undefined, modelResult: CommanderModelStepResult): { metadata?: CommanderConnectorModelTransportMetadata; blocker?: string; warnings: string[] } {
  summary.provider_request_count += modelResult.request_count
  const metadata = transportMetadata(modelResult.provider_metadata?.nexusloop_transport)
  if (metadata) {
    summary.transport_kind = "external_api_connector"
    addUniqueCapped(summary.connector_ids, metadata.connector_id, 4)
    for (const requestId of metadata.request_ids) {
      if (summary.audit_request_ids.length < 24) summary.audit_request_ids.push(preview(requestId, 120))
      else summary.omitted_request_id_count += 1
    }
    for (const kind of metadata.audit_event_kinds) if (summary.audit_event_kinds.length < 24) summary.audit_event_kinds.push(kind)
    summary.external_api_audit_event_count += metadata.audit_event_count
    summary.successful_audit_count += metadata.successful_audit_count
    summary.failed_audit_count += metadata.failed_audit_count
    if (metadata.request_body_persisted || metadata.response_body_persisted || metadata.credentials_persisted) summary.warnings.push("provider transport metadata reported persisted sensitive content")
  }
  if (policy?.required !== true) {
    summary.all_provider_requests_audited = metadata ? summary.external_api_audit_event_count === summary.provider_request_count : true
    return { metadata, warnings: [] }
  }
  const requiredPolicy = policy as { required: true; transport_kind: "external_api_connector"; connector_id: string }
  const validation = validateTransportMetadata(metadata, requiredPolicy, modelResult.request_count)
  summary.all_provider_requests_audited = summary.external_api_audit_event_count === summary.provider_request_count
  summary.warnings = [...summary.warnings, ...validation.warnings].slice(0, 12)
  return { metadata, blocker: validation.blocker, warnings: validation.warnings }
}

function validateTransportMetadata(metadata: CommanderConnectorModelTransportMetadata | undefined, policy: { required: true; transport_kind: "external_api_connector"; connector_id: string }, requestCount: number): { blocker?: string; warnings: string[] } {
  if (requestCount === 0) return { warnings: [] }
  if (requestCount !== 1) return { blocker: "configured provider request_count must be one before audit validation", warnings: [] }
  if (!metadata) return { blocker: "configured provider result is missing nexusloop transport audit metadata", warnings: [] }
  if (metadata.transport_kind !== "external_api_connector") return { blocker: "configured provider transport kind is invalid", warnings: [] }
  if (metadata.connector_id !== policy.connector_id) return { blocker: "configured provider audit connector_id does not match policy", warnings: [] }
  if (metadata.audit_event_count !== 1) return { blocker: "configured provider request did not produce exactly one external API audit", warnings: [] }
  if (metadata.request_ids.length !== 1) return { blocker: "configured provider audit request_id is missing", warnings: [] }
  if (metadata.audit_event_kinds.length !== 1) return { blocker: "configured provider audit event kind is missing", warnings: [] }
  if (metadata.successful_audit_count + metadata.failed_audit_count !== 1) return { blocker: "configured provider audit success/failure counts are inconsistent", warnings: [] }
  if (metadata.request_body_persisted || metadata.response_body_persisted || metadata.credentials_persisted) return { blocker: "configured provider audit metadata claims persisted body or credentials", warnings: [] }
  return { warnings: [] }
}

function transportMetadata(value: unknown): CommanderConnectorModelTransportMetadata | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Partial<CommanderConnectorModelTransportMetadata>
  if (raw.transport_kind !== "external_api_connector") return undefined
  if (typeof raw.connector_id !== "string") return undefined
  const requestIds = Array.isArray(raw.request_ids) ? raw.request_ids.filter((item): item is string => typeof item === "string").slice(0, 24) : []
  const kinds = Array.isArray(raw.audit_event_kinds) ? raw.audit_event_kinds.filter((item): item is "external_api_request_executed" | "external_api_request_failed" => item === "external_api_request_executed" || item === "external_api_request_failed").slice(0, 24) : []
  return {
    transport_kind: "external_api_connector",
    connector_id: preview(raw.connector_id, 120),
    request_ids: requestIds.map((item) => preview(item, 120)),
    audit_event_kinds: kinds,
    audit_event_count: integerOrZero(raw.audit_event_count),
    successful_audit_count: integerOrZero(raw.successful_audit_count),
    failed_audit_count: integerOrZero(raw.failed_audit_count),
    dropped_header_names: Array.isArray(raw.dropped_header_names) ? raw.dropped_header_names.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => preview(item, 80)) : [],
    request_body_persisted: raw.request_body_persisted === false ? false : true as never,
    response_body_persisted: raw.response_body_persisted === false ? false : true as never,
    credentials_persisted: raw.credentials_persisted === false ? false : true as never,
  }
}

function integerOrZero(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function addUniqueCapped(items: string[], value: string, cap: number): void {
  if (items.includes(value)) return
  if (items.length < cap) items.push(value)
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

function validateRecoverySeedIntegrity(seed: CommanderInvestigationRecoveryContinuationSeed, currentDescriptors: CommanderToolDescriptor[]): string | undefined {
  if (stableHash(seed.normalized_input) !== seed.normalized_input_hash) return "recovery continuation normalized input hash did not verify"
  const currentBootstrapHash = sha256JsonHash({ ...seed.current_bootstrap, estimated_bytes: 0, estimated_tokens: 0, bootstrap_hash: "" })
  if (seed.current_bootstrap.bootstrap_hash !== currentBootstrapHash || seed.current_bootstrap_hash !== currentBootstrapHash) return "recovery continuation current bootstrap hash did not verify"
  if (seed.current_bootstrap.continuity_assessment_status === "degraded") return "recovery continuation current bootstrap is degraded"
  const restoredWorkingSet = durableCommanderInvestigationWorkingSet(seed.working_set as CommanderInvestigationWorkingSet)
  if (restoredWorkingSet.working_set_hash !== seed.working_set_hash || seed.working_set.working_set_hash !== seed.working_set_hash) return "recovery continuation working set hash did not verify"
  if (stableHash(seed.consumed) !== stableHash(seed.effective_budget.consumed)) return "recovery continuation consumed budget counters did not verify"
  const consumed = seed.effective_budget.consumed
  if (seed.next_turn_index !== consumed.model_turns + 1) return "recovery continuation next turn index did not verify"
  if (seed.provider_request_count_before !== consumed.provider_requests) return "recovery continuation provider request count did not verify"
  if (seed.working_set.provider_audit.provider_request_count !== consumed.provider_requests) return "recovery continuation provider audit count did not verify"
  if (seed.recovery_kind === "checkpoint" && seed.working_set.model_turn_count !== consumed.model_turns) return "recovery continuation working set model-turn count did not verify"
  if (seed.working_set.tool_call_count !== consumed.tool_calls) return "recovery continuation working set tool-call count did not verify"
  if (seed.working_set.tool_search_call_count !== consumed.tool_search_calls) return "recovery continuation working set tool-search count did not verify"
  if (seed.working_set.cumulative_tool_result_bytes !== consumed.cumulative_tool_result_bytes) return "recovery continuation working set result-byte count did not verify"
  if (seed.working_set.consecutive_no_progress_turns !== consumed.consecutive_no_progress_turns) return "recovery continuation working set no-progress count did not verify"
  if (seed.working_set.evidence_cards.length + seed.working_set.omitted_evidence_count !== consumed.evidence_cards) return "recovery continuation working set evidence count did not verify"
  if (seed.turn_summaries.length + seed.working_set.omitted_turn_count !== consumed.turn_summaries) return "recovery continuation turn-summary count did not verify"
  const replayMessageHash = stableHash({ latest_assistant: seed.latest_assistant, latest_tool_results: seed.latest_tool_results })
  if (seed.replay_message_hash !== replayMessageHash) return "recovery continuation replay message hash did not verify"
  const replayToolCallCount = seed.latest_assistant?.content.filter((part) => part.type === "tool_call").length ?? 0
  if (seed.replay_summary.tool_call_count !== replayToolCallCount || seed.replay_summary.tool_result_count !== seed.latest_tool_results.length) return "recovery continuation replay message counts did not verify"
  if (!seed.replay_summary.replay_protocol_available && (replayToolCallCount > 0 || seed.latest_tool_results.length > 0)) return "recovery continuation replay messages are unavailable"
  if (seed.replay_summary.replay_protocol_available && !seed.replay_exchange_hash) return "recovery continuation replay exchange reference is missing"
  if (seed.replay_summary.replay_protocol_available && seed.replay_exchange_hash !== seed.replay_summary.replay_exchange_hash) return "recovery continuation replay exchange reference did not verify"
  if (seed.loaded_tool_refs.length !== consumed.loaded_schemas || seed.loaded_tools.length !== consumed.loaded_schemas) return "recovery continuation loaded schema count did not verify"
  const loadedToolIntegrityError = validateRecoveryLoadedTools(seed.loaded_tools, seed.loaded_tool_refs, currentDescriptors)
  if (loadedToolIntegrityError) return loadedToolIntegrityError
  if (seed.elapsed_active_ms_before !== seed.effective_budget.consumed.elapsed_active_ms) return "recovery continuation elapsed active time did not verify"
  const effectiveBudgetHash = stableHash({ ...seed.effective_budget.effective_budget, budget_hash: "" })
  if (seed.effective_budget.effective_budget.budget_hash !== effectiveBudgetHash) return "recovery continuation effective budget hash did not verify"
  if (seed.effective_budget.effective_budget_hash !== effectiveBudgetHash || seed.effective_budget_hash !== effectiveBudgetHash) return "recovery continuation effective budget reference did not verify"
  const continuationBudgetHash = stableHash({ ...seed.effective_budget, effective_budget_hash: effectiveBudgetHash, budget_hash: "" })
  if (seed.effective_budget.budget_hash !== continuationBudgetHash) return "recovery continuation budget hash did not verify"
  const requestPreviewHash = stableHash({ ...seed.first_model_request_preview, request_preview_hash: "" })
  if (seed.first_model_request_preview.request_preview_hash !== requestPreviewHash) return "recovery first model request preview hash did not verify"
  return undefined
}

function validateRecoveryLoadedTools(loadedTools: CommanderToolDescriptor[], refs: CommanderInvestigationLoadedToolRef[], currentDescriptors: CommanderToolDescriptor[]): string | undefined {
  const toolsById = new Map(loadedTools.map((tool) => [tool.tool_id, tool]))
  const currentById = new Map(currentDescriptors.map((tool) => [tool.tool_id, tool]))
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.tool_id)) return "recovery continuation loaded tool references are not unique"
    seen.add(ref.tool_id)
    const tool = toolsById.get(ref.tool_id)
    if (!tool) return "recovery continuation loaded tool descriptor did not verify"
    const current = currentById.get(ref.tool_id)
    if (!current) return "recovery continuation loaded tool descriptor did not verify"
    if (
      ref.namespace !== tool.namespace ||
      ref.descriptor_version !== tool.version ||
      ref.authority_id !== (tool.authority_id ?? "") ||
      ref.description_hash !== commanderProviderVisibleDescriptionHash(tool) ||
      ref.input_schema_hash !== tool.schema_metadata.input_schema_hash ||
      ref.output_schema_hash !== tool.schema_metadata.output_schema_hash ||
      ("input_schema_bytes" in ref && ref.input_schema_bytes !== tool.schema_metadata.input_schema_bytes) ||
      ("output_schema_bytes" in ref && ref.output_schema_bytes !== tool.schema_metadata.output_schema_bytes) ||
      ("estimated_schema_tokens" in ref && ref.estimated_schema_tokens !== tool.schema_metadata.estimated_schema_tokens) ||
      ref.load_policy !== tool.load_policy ||
      ref.trust_class !== tool.trust_class ||
      ref.instruction_semantics !== tool.instruction_semantics ||
      ref.max_output_bytes !== tool.max_output_bytes ||
      ref.timeout_ms !== tool.timeout_ms ||
      ref.risk !== tool.risk ||
      ref.side_effect_class !== tool.side_effect_class ||
      ref.execution_backend !== tool.execution_backend ||
      ref.process_policy !== tool.process_policy ||
      ref.creates_external_process !== tool.creates_external_process ||
      ref.calls_provider !== tool.calls_provider ||
      ref.mutates_events !== tool.mutates_events ||
      ref.requires_network !== tool.requires_network ||
      ref.requires_credentials !== tool.requires_credentials ||
      ref.requires_approval !== tool.requires_approval ||
      ref.requires_run_lock !== tool.requires_run_lock
    ) return "recovery continuation loaded tool descriptor did not verify"
    if (
      current.namespace !== tool.namespace ||
      current.version !== tool.version ||
      (current.authority_id ?? "") !== (tool.authority_id ?? "") ||
      commanderProviderVisibleDescriptionHash(current) !== commanderProviderVisibleDescriptionHash(tool) ||
      current.schema_metadata.input_schema_hash !== tool.schema_metadata.input_schema_hash ||
      current.schema_metadata.output_schema_hash !== tool.schema_metadata.output_schema_hash ||
      current.schema_metadata.input_schema_bytes !== tool.schema_metadata.input_schema_bytes ||
      current.schema_metadata.output_schema_bytes !== tool.schema_metadata.output_schema_bytes ||
      current.schema_metadata.estimated_schema_tokens !== tool.schema_metadata.estimated_schema_tokens ||
      current.load_policy !== tool.load_policy ||
      current.trust_class !== tool.trust_class ||
      current.instruction_semantics !== tool.instruction_semantics ||
      current.max_output_bytes !== tool.max_output_bytes ||
      current.timeout_ms !== tool.timeout_ms ||
      current.risk !== tool.risk ||
      current.side_effect_class !== tool.side_effect_class ||
      current.execution_backend !== tool.execution_backend ||
      current.process_policy !== tool.process_policy ||
      current.creates_external_process !== tool.creates_external_process ||
      current.calls_provider !== tool.calls_provider ||
      current.mutates_events !== tool.mutates_events ||
      current.requires_network !== tool.requires_network ||
      current.requires_credentials !== tool.requires_credentials ||
      current.requires_approval !== tool.requires_approval ||
      current.requires_run_lock !== tool.requires_run_lock
    ) return "recovery continuation loaded tool descriptor did not verify"
  }
  if (seen.size !== loadedTools.length) return "recovery continuation loaded tool descriptor did not verify"
  return undefined
}

function recoveryFirstRequestPreviewBlocker(
  seed: CommanderInvestigationRecoveryContinuationSeed,
  request: CommanderModelStepRequest,
  context: CommanderInvestigationContext,
  loadedTools: CommanderToolDescriptor[],
): string | undefined {
  const actual = recoveryFirstRequestPreview(seed, request, context, loadedTools)
  return actual.request_preview_hash === seed.first_model_request_preview.request_preview_hash ? undefined : "first recovered model request no longer matches the approved preparation preview"
}

function recoveryFirstRequestPreview(
  seed: CommanderInvestigationRecoveryContinuationSeed,
  request: CommanderModelStepRequest,
  context: CommanderInvestigationContext,
  loadedTools: CommanderToolDescriptor[],
): CommanderInvestigationRecoveryFirstModelRequestPreview {
  const preview: CommanderInvestigationRecoveryFirstModelRequestPreview = {
    request_id: request.request_id,
    provider_id: request.provider_id,
    provider_kind: request.provider_kind,
    model_id: request.model_id,
    turn_index: seed.next_turn_index,
    tool_protocol: request.tool_protocol,
    tool_choice: "auto",
    max_output_tokens: request.max_output_tokens,
    input_bytes: context.input_bytes,
    estimated_input_tokens: context.estimated_tokens,
    message_count: context.messages.length,
    message_roles: context.messages.map((message) => message.role),
    loaded_tool_ids: loadedTools.map((tool) => tool.tool_id),
    loaded_tool_schema_hash: stableHash(loadedTools.map(commanderToolSchemaFromDescriptor)),
    context_hash: stableHash({ messages: context.messages, input_bytes: context.input_bytes, estimated_tokens: context.estimated_tokens }),
    recovery_notice_hash: seed.recovery_notice_hash,
    old_pending_request_id: seed.pending_model_step_ref?.model_request_id,
    old_request_replayed: false,
    tool_execution_replayed: false,
    provider_called: false,
    request_preview_hash: "",
  }
  preview.request_preview_hash = stableHash({ ...preview, request_preview_hash: "" })
  return preview
}

function sha256JsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function stableResult(value: CommanderInvestigationResult): unknown {
  return {
    ...value,
    investigation_id: "",
    bootstrap_id: "",
    context_budget_id: "",
    budget: {
      ...value.budget,
      budget_id: "",
      source_profile_id: "",
      source_context_budget_id: "",
      warnings: [],
      budget_hash: "",
    },
    started_at: "",
    completed_at: "",
    duration_ms: 0,
    durability: undefined,
    investigation_event_count: 0,
    in_memory_only: true,
    working_set_persisted: false,
    investigation_events_appended: false,
    events_appended: value.external_api_audit_events_appended > 0,
    evidence: value.evidence.map((item) => ({ ...item, observed_at: "" })),
    warnings: [],
    turn_summaries: value.turn_summaries.map((item) => ({ ...item, model_request_id: "", model_result_hash: "", tool_execution_ids: [], provider_audit_request_ids: [], warnings: [], turn_hash: "" })),
    provider_audit: stableCommanderInvestigationProviderAudit(value.provider_audit),
  }
}

function preview(value: string | undefined, max: number): string {
  return redactText(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : undefined
}

function controllerCallId(investigationId: string, turn: number, callIndex: number, toolCallId: string): string {
  const safeToolCallId = toolCallId.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "missing_tool_call_id"
  return `${investigationId}_call_${turn}_${callIndex}_${safeToolCallId}`
}
