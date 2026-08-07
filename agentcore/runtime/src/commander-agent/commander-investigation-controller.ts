import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import { COMMANDER_TOOL_PHASES, COMMANDER_TOOL_REGISTRY } from "../commander-tools/commander-tool-registry"
import { isToolAllowedInPhase } from "../commander-tools/commander-tool-service"
import { COMMANDER_GITHUB_READ_TOOL_IDS } from "../commander-tools/commander-github-read-types"
import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolDescriptor, CommanderToolPhase, CommanderToolSchemaMetadata } from "../commander-tools/commander-tool-types"
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
import type { CommanderInvestigationCheckpoint, CommanderInvestigationLoadedToolRef } from "./commander-investigation-journal-types"
import { CommanderInvestigationJournalConflictError } from "./commander-investigation-journal-service"
import type { CommanderInvestigationRecoveryContinuationSeed, CommanderInvestigationRecoveryFirstModelRequestPreview } from "./commander-investigation-recovery-execution-types"
import {
  COMMANDER_INVESTIGATION_HARD_CAPS,
  commanderInvestigationRecoveryCurrentPolicyLimits,
  deriveCommanderInvestigationRecoveryContinuationBudget,
} from "./commander-investigation-recovery-budget"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import { reconstructCommanderRecoveryReplayExchangeFromDurable } from "./commander-investigation-recovery-replay"
import { durableCommanderInvestigationWorkingSet, stableCommanderInvestigationProviderAudit, stableCommanderInvestigationWorkingSet } from "./commander-investigation-working-set"

const HARD_CAPS = COMMANDER_INVESTIGATION_HARD_CAPS

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

    return this.executePreparedInvestigation({
      mode: "new",
      input,
      investigationId,
      started,
      wallStartedMs,
      bootstrap,
      budget,
      toolProtocol,
      loaded,
      workingSet,
      turns,
      latestAssistant,
      latestToolResults,
      providerRequests,
      recentResults,
      nextTurnIndex: 1,
      requestIdForTurn: (turn) => `${investigationId}_turn_${turn}`,
      abortSignal: input.abort_signal,
      persistCheckpoints: true,
      persistTerminalTurnCheckpoint: true,
    })
  }

  async runFromRecoverySeed(seed: CommanderInvestigationRecoveryContinuationSeed, options: { abort_signal?: AbortSignal } = {}): Promise<CommanderInvestigationResult> {
    const continuationStarted = this.now()
    const neutralInput = neutralRecoveryBlockedInput()
    const neutralStarted = continuationStarted
    const neutralWallStartedMs = performance.now()
    const neutralBlockedRecoveryResult = (blocker: string) =>
      this.finish(neutralInput, "recovery_seed_rejected", "blocked", "controller_error", minimalBootstrap(neutralInput), fallbackBudget(neutralInput.phase, "recovery_seed_blocked"), "native", [], emptyWorkingSet(neutralInput, [], this.options.providerAuditPolicy), 0, [], [blocker], [], neutralStarted, undefined, elapsedWallMs(neutralWallStartedMs))
    const expectedHash = stableHash({
      seed_version: 1,
      investigation_id: seed.investigation_id,
      recovery_kind: seed.recovery_kind,
      immutable_identity: seed.immutable_identity,
      normalized_input_hash: seed.normalized_input_hash,
      original_started_at: seed.original_started_at,
      recovery_basis_hash: seed.recovery_basis_hash,
      pending_model_boundary_hash: seed.pending_model_boundary_hash,
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
      replay_exchange: seed.replay_exchange,
      replay_exchange_hash: seed.replay_exchange_hash,
      replay_message_hash: seed.replay_message_hash,
      recovery_notice_hash: seed.recovery_notice_hash,
      pre_model_gate_snapshot_hash: seed.pre_model_gate_snapshot.gate_snapshot_hash,
      next_turn_index: seed.next_turn_index,
      elapsed_active_ms_before: seed.elapsed_active_ms_before,
      provider_request_count_before: seed.provider_request_count_before,
      external_api_audit_count_before: seed.external_api_audit_count_before,
      unresolved_provider_attempt_count: seed.unresolved_provider_attempt_count,
      uncertain_model_turn_charge: seed.uncertain_model_turn_charge,
      first_model_request_preview_hash: seed.first_model_request_preview.request_preview_hash,
    })
    if (expectedHash !== seed.execution_preparation_hash) return neutralBlockedRecoveryResult("recovery continuation seed hash did not verify")
    const authoritativeCheckpoint = await this.recoverySeedCheckpoint(seed)
    if (authoritativeCheckpoint.blocker) return neutralBlockedRecoveryResult(authoritativeCheckpoint.blocker)
    const checkpoint = authoritativeCheckpoint.checkpoint!
    const authoritativeSource = authoritativeCheckpoint.source!
    if (!authoritativeSource.record || !authoritativeSource.normalized_input) return neutralBlockedRecoveryResult("recovery continuation authoritative journal input is unavailable")
    const input: CommanderInvestigationInput = { ...authoritativeSource.normalized_input, investigation_id: seed.investigation_id, abort_signal: options.abort_signal }
    const resultStarted = canonicalDate(authoritativeSource.record.started_at) ?? continuationStarted
    const authoritativeElapsedBefore = Math.max(0, checkpoint.elapsed_active_ms)
    const wallStartedMs = performance.now() - authoritativeElapsedBefore
    const authoritativeTurns = checkpoint.turn_summaries.map((turn) => redactValue(turn) as CommanderInvestigationTurnSummary)
    const checkpointWorkingSet = restoreRecoveryWorkingSetFromCheckpoint(checkpoint)
    const authoritativeWorkingSet = checkpointWorkingSet.workingSet
      ? (redactValue(checkpointWorkingSet.workingSet) as CommanderInvestigationWorkingSet)
      : (redactValue(checkpoint.working_set) as CommanderInvestigationWorkingSet)
    const authoritativeProviderRequests = checkpoint.provider_request_count
    const finishAfterJournalLookup = (blocker: string, bootstrap: { bootstrap_id: string; bootstrap_hash: string } = minimalBootstrap(input), loadedTools: CommanderToolDescriptor[] = []) =>
      this.finish(input, authoritativeSource.investigation_id, "blocked", "controller_error", bootstrap, checkpoint.budget, checkpoint.tool_protocol, authoritativeTurns, authoritativeWorkingSet, authoritativeProviderRequests, loadedTools, [blocker], [], resultStarted, undefined, elapsedWallMs(wallStartedMs))
    if (seed.elapsed_active_ms_before !== authoritativeElapsedBefore || seed.effective_budget.consumed.elapsed_active_ms !== authoritativeElapsedBefore) {
      return finishAfterJournalLookup("recovery continuation checkpoint elapsed active time did not verify")
    }
    const identityError = validateRecoveryIdentity(seed)
    if (identityError) return finishAfterJournalLookup(identityError)
    const currentBootstrap = await this.options.bootstrapService.compile({ ...input, include_continuity: true })
    const currentBootstrapHash = sha256JsonHash({ ...currentBootstrap, estimated_bytes: 0, estimated_tokens: 0, bootstrap_hash: "" })
    if (currentBootstrap.bootstrap_hash !== currentBootstrapHash || currentBootstrapHash !== seed.current_bootstrap_hash || stableHash(currentBootstrap) !== stableHash(seed.current_bootstrap)) {
      return finishAfterJournalLookup("recovery continuation current bootstrap did not match controller compilation", currentBootstrap)
    }
    if (currentBootstrap.continuity_assessment_status === "degraded") return finishAfterJournalLookup("recovery continuation current bootstrap is degraded", currentBootstrap)
    const prepared = validateAndPrepareRecoverySeed(seed, this.options.descriptors, this.options.boundToolIds, checkpoint)
    if (prepared.blocker) return finishAfterJournalLookup(prepared.blocker, currentBootstrap)
    if (checkpointWorkingSet.blocker) return finishAfterJournalLookup(checkpointWorkingSet.blocker, currentBootstrap, prepared.loadedTools)
    const authoritativeBudget = await this.deriveRecoveryContinuationBudget(input, checkpoint, authoritativeSource.pending_model_step, Boolean(authoritativeSource.resolved_pending_boundary))
    if (authoritativeBudget.blockers.length > 0) return finishAfterJournalLookup(authoritativeBudget.blockers[0], currentBootstrap, prepared.loadedTools)
    if (stableHash(authoritativeBudget.budget) !== stableHash(seed.effective_budget)) {
      return finishAfterJournalLookup("recovery continuation budget no longer matches current authority", currentBootstrap, prepared.loadedTools)
    }
    const budget = authoritativeBudget.budget.effective_budget
    const loaded = new Map(prepared.loadedTools!.map((tool) => [tool.tool_id, tool]))
    const workingSet = redactValue(checkpointWorkingSet.workingSet!) as CommanderInvestigationWorkingSet
    if (workingSet.model_turn_count < authoritativeBudget.budget.consumed.model_turns) {
      workingSet.model_turn_count = authoritativeBudget.budget.consumed.model_turns
      workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
    }
    const turns = authoritativeTurns
    const latestAssistant = prepared.latestAssistant
    const latestToolResults = prepared.latestToolResults!
    const providerRequests = authoritativeProviderRequests
    const recentResults = new Map(workingSet.recent_result_signatures.map((item) => [item.signature_hash, { count: item.count, last_turn_index: item.last_turn_index }]))
    if (!this.options.modelAdapter) return this.finish(input, seed.investigation_id, "blocked", "adapter_not_configured", currentBootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["Commander investigation model adapter is not configured"], [], resultStarted, undefined, elapsedWallMs(wallStartedMs))
    if (options.abort_signal?.aborted) return this.finish(input, seed.investigation_id, "cancelled", "caller_cancelled", currentBootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["caller aborted recovered investigation"], [], resultStarted, undefined, elapsedWallMs(wallStartedMs))
    if (authoritativeBudget.budget.remaining.wall_time_ms <= 0) return this.finish(input, seed.investigation_id, "budget_exhausted", "wall_time_exhausted", currentBootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["recovery continuation wall-time budget exhausted"], [], resultStarted, undefined, elapsedWallMs(wallStartedMs))
    if (authoritativeBudget.budget.remaining.model_turns <= 0) return this.finish(input, seed.investigation_id, "budget_exhausted", "max_model_turns", currentBootstrap, budget, seed.tool_protocol, turns, workingSet, providerRequests, Array.from(loaded.values()), ["recovery continuation model-turn budget exhausted"], [], resultStarted, undefined, elapsedWallMs(wallStartedMs))
    return this.executePreparedInvestigation({
      mode: "recovery",
      input,
      investigationId: seed.investigation_id,
      started: resultStarted,
      wallStartedMs,
      bootstrap: currentBootstrap,
      budget,
      toolProtocol: seed.tool_protocol,
      loaded,
      workingSet,
      turns,
      latestAssistant,
      latestToolResults,
      providerRequests,
      recentResults,
      nextTurnIndex: seed.next_turn_index,
      requestIdForTurn: (turn) => `${expectedRecoveryRequestPrefix(seed, authoritativeCheckpoint.checkpoint!)}_turn_${turn}`,
      abortSignal: options.abort_signal,
      recoveryNotice: seed.recovery_notice,
      firstRequestPreview: seed.first_model_request_preview,
      preModelGateSnapshot: seed.pre_model_gate_snapshot,
      persistCheckpoints: Boolean(this.options.persistenceObserver),
      persistTerminalTurnCheckpoint: false,
      durationMs: () => elapsedWallMs(wallStartedMs),
    })
	  }

  private async deriveRecoveryContinuationBudget(input: CommanderInvestigationInput, checkpoint: CommanderInvestigationCheckpoint, pendingModelStep?: import("./commander-investigation-journal-types").CommanderInvestigationModelStepStartedPayload, uncertainProviderAttempt = false) {
    const profile = this.options.toolService.profile({ phase: input.phase })
    const context = await this.options.contextBudgetService.preview({
      purpose: "commander_research_decision",
      role: "commander",
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      max_context_tokens: checkpoint.budget.max_context_tokens,
      max_context_bytes: checkpoint.budget.max_context_bytes,
    })
    const allocation = context.budget.allocations.find((item) => item.section === "tool_or_mcp_schema")
    const currentContext = {
      context_budget_id: context.budget.budget_id,
      input_context_bytes: context.budget.max_context_bytes === undefined
        ? undefined
        : Math.max(0, context.budget.max_context_bytes - (context.budget.safety_margin_bytes ?? 0)),
      input_context_tokens: context.budget.max_context_tokens === undefined
        ? undefined
        : Math.max(0, context.budget.max_context_tokens - (context.budget.max_output_tokens ?? 0) - (context.budget.safety_margin_tokens ?? 0)),
      tool_schema_allocation_bytes: allocation?.max_bytes,
      tool_schema_allocation_tokens: allocation?.max_tokens,
      blockers: context.blockers,
      warnings: context.warnings,
    }
    return {
      budget: deriveCommanderInvestigationRecoveryContinuationBudget({
        checkpoint,
        current_policy_limits: commanderInvestigationRecoveryCurrentPolicyLimits({ profile, context: currentContext }),
        pending_model_step: pendingModelStep,
        uncertain_provider_attempt: uncertainProviderAttempt,
      }),
      blockers: context.blockers.map((item) => preview(item, 300)).slice(0, 8),
    }
  }

  private async recoverySeedCheckpoint(seed: CommanderInvestigationRecoveryContinuationSeed): Promise<{ source?: CommanderInvestigationRecoverySource; checkpoint?: CommanderInvestigationCheckpoint; blocker?: string }> {
    if (!this.options.recoverySource) return { blocker: "recovery continuation authoritative journal source is required" }
    const source = await this.options.recoverySource(seed.investigation_id)
    if (!source || source.projection_status !== "ready" || !source.latest_checkpoint) return { blocker: "recovery continuation authoritative journal checkpoint is unavailable" }
    if (source.recovery_basis_hash !== seed.recovery_basis_hash) return { blocker: "recovery continuation authoritative journal basis did not verify" }
    const checkpoint = source.latest_checkpoint
    if (
      checkpoint.checkpoint_id !== seed.checkpoint_ref.checkpoint_id ||
      checkpoint.checkpoint_sequence !== seed.checkpoint_ref.checkpoint_sequence ||
      checkpoint.checkpoint_hash !== seed.checkpoint_ref.checkpoint_hash
    ) return { blocker: "recovery continuation authoritative journal checkpoint reference did not verify" }
    if (seed.pending_model_step_ref) {
      const pending = source.pending_model_step
      const resolved = source.resolved_pending_boundary
      if (
        (!pending && !resolved) ||
        (pending && (
          pending.model_request_id !== seed.pending_model_step_ref.model_request_id ||
          pending.turn_index !== seed.pending_model_step_ref.turn_index ||
          pending.base_checkpoint_id !== seed.pending_model_step_ref.base_checkpoint_id ||
          pending.base_checkpoint_sequence !== seed.pending_model_step_ref.base_checkpoint_sequence ||
          pending.base_checkpoint_hash !== seed.pending_model_step_ref.base_checkpoint_hash ||
          pending.working_set_hash !== seed.pending_model_step_ref.working_set_hash ||
          pending.context_hash !== seed.pending_model_step_ref.context_hash
        )) ||
        (resolved && (
          resolved.model_request_id !== seed.pending_model_step_ref.model_request_id ||
          resolved.turn_index !== seed.pending_model_step_ref.turn_index ||
          resolved.base_checkpoint_ref.checkpoint_id !== seed.pending_model_step_ref.base_checkpoint_id ||
          resolved.base_checkpoint_ref.checkpoint_sequence !== seed.pending_model_step_ref.base_checkpoint_sequence ||
          resolved.base_checkpoint_ref.checkpoint_hash !== seed.pending_model_step_ref.base_checkpoint_hash ||
          resolved.working_set_hash !== seed.pending_model_step_ref.working_set_hash ||
          resolved.context_hash !== seed.pending_model_step_ref.context_hash ||
          resolved.resolved_by_recovery_attempt_id !== source.current_recovery_attempt?.recovery_attempt_id
        ))
      ) return { blocker: "recovery continuation authoritative journal pending boundary did not verify" }
    } else if (source.pending_model_step) {
      return { blocker: "recovery continuation authoritative journal pending boundary did not verify" }
    }
    const checkpointHasReplay = Boolean(checkpoint.replay_exchange)
    if (checkpoint.checkpoint_sequence > 0 && !checkpointHasReplay) return { blocker: "recovery continuation authoritative checkpoint replay exchange is missing" }
    if (checkpointHasReplay !== seed.replay_summary.replay_protocol_available) return { blocker: "recovery continuation replay availability did not match journal checkpoint" }
    return { source, checkpoint }
  }

  private async executePreparedInvestigation(state: CommanderInvestigationPreparedLoopState): Promise<CommanderInvestigationResult> {
    const {
      input,
      investigationId,
      started,
      wallStartedMs,
      bootstrap,
      budget,
      toolProtocol,
      loaded,
      workingSet,
      turns,
      requestIdForTurn,
      abortSignal,
      recoveryNotice,
      firstRequestPreview,
      preModelGateSnapshot,
      persistCheckpoints,
      persistTerminalTurnCheckpoint,
    } = state
    let latestAssistant = state.latestAssistant
    let latestToolResults = state.latestToolResults
    let providerRequests = state.providerRequests
    const recentResults = state.recentResults
    const finish = (
      status: CommanderInvestigationResult["status"],
      reason: CommanderInvestigationStopReason,
      blockers: string[],
      warnings: string[] = [],
      finalSummary?: string,
    ) => this.finish(input, investigationId, status, reason, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), blockers, warnings, started, finalSummary, state.durationMs?.())

    for (let turn = state.nextTurnIndex; turn <= budget.max_model_turns; turn += 1) {
      const preModelWarnings: string[] = []
      if (abortSignal?.aborted) return finish("cancelled", "caller_cancelled", [state.mode === "recovery" ? "caller aborted recovered investigation" : "caller aborted investigation"])
      const humanBeforeModel = await this.checkControl(input, "model_step", turn)
      const humanStop = stopReasonForControl(humanBeforeModel)
      if (humanStop) return finish("needs_human_review", humanStop, [humanBeforeModel.summary_preview ?? humanStop], humanBeforeModel.warnings)
      if (humanBeforeModel.warnings.length) preModelWarnings.push(...humanBeforeModel.warnings)
      const providerBeforeModel = await this.checkProvider(input, "model_step", turn)
      if (providerBeforeModel && !providerBeforeModel.ready) return finish("blocked", "provider_preflight_blocked", providerBeforeModel.blockers, [...preModelWarnings, ...providerBeforeModel.warnings])
      if (providerBeforeModel?.warnings.length) preModelWarnings.push(...providerBeforeModel.warnings)
      if (turn === state.nextTurnIndex && preModelGateSnapshot) {
        const gateBlocker = preModelGateSnapshotBlocker(preModelGateSnapshot, turn, humanBeforeModel, providerBeforeModel)
        if (gateBlocker) return finish("blocked", "controller_error", [gateBlocker], preModelWarnings)
        preModelWarnings.splice(0, preModelWarnings.length, ...preModelGateSnapshot.human_control_warnings, ...preModelGateSnapshot.provider_preflight_warnings)
      }
      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return finish("budget_exhausted", "wall_time_exhausted", ["Commander investigation wall-time budget exhausted"], preModelWarnings)

      const contextWorkingSet = workingSetWithAdditionalWarnings(workingSet, preModelWarnings)
      const context = this.options.contextService.build({ bootstrap, workingSet: contextWorkingSet, loadedTools: Array.from(loaded.values()), toolProtocol, budget, latestAssistant, latestToolResults, recoveryNotice })
      const deferredPreModelWarnings = [...preModelWarnings]
      if (context.blocked) return finish("budget_exhausted", "context_budget_exhausted", context.blockers, [...preModelWarnings, ...context.warnings])
      if (context.warnings.length) deferredPreModelWarnings.push(...context.warnings)
      if (elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return finish("budget_exhausted", "wall_time_exhausted", ["Commander investigation wall-time budget exhausted before model request"], [...preModelWarnings, ...context.warnings])
      const deadline = deadlineSignal(abortSignal, budget, wallStartedMs)
      const request: CommanderModelStepRequest = {
        request_id: requestIdForTurn(turn),
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
      if (turn === state.nextTurnIndex && firstRequestPreview) {
        const firstRequestBlocker = recoveryFirstRequestPreviewBlocker(firstRequestPreview, request, context, Array.from(loaded.values()), recoveryNotice?.notice_hash)
        if (firstRequestBlocker) {
          deadline.cancel()
          return finish("blocked", "controller_error", [firstRequestBlocker], [...preModelWarnings, ...context.warnings])
        }
      }
      if (persistCheckpoints) {
        const observedModelStep = await this.observeModelStepStarted(input, investigationId, turn, request.request_id, toolProtocol, context, workingSet, Array.from(loaded.values()), providerRequests)
        if (observedModelStep.blocker) {
          deadline.cancel()
          return this.finish(input, investigationId, observedModelStep.status!, observedModelStep.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [observedModelStep.blocker], [], started, undefined, state.durationMs?.())
        }
      }
      const modelResult = await this.options.modelAdapter!.executeOneStep(request).finally(deadline.cancel)
      if (deferredPreModelWarnings.length) {
        workingSet.current_warnings.push(...deferredPreModelWarnings)
        workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
      }
      const requestCountBlocker = modelRequestCountBlocker(modelResult)
      if (!Number.isInteger(modelResult.request_count) || modelResult.request_count < 0) return finish("failed", "controller_error", [requestCountBlocker ?? "model adapter returned an invalid request_count"], modelResult.warnings)
      providerRequests += modelResult.request_count
      workingSet.model_turn_count = turn
      const transportInterrupted = modelResult.status === "cancelled" || modelResult.status === "failed"
      const audit = observeProviderAudit(workingSet.provider_audit, this.options.providerAuditPolicy, modelResult)
      if (requestCountBlocker) return finish("failed", "controller_error", [requestCountBlocker], [...modelResult.warnings, ...audit.warnings])
      if (abortSignal?.aborted && transportInterrupted) return finish("cancelled", "caller_cancelled", ["caller aborted investigation during model request"], [...modelResult.warnings, ...audit.warnings])
      if (deadline.expired() && transportInterrupted) return finish("budget_exhausted", "wall_time_exhausted", ["Commander investigation wall-time budget exhausted during model request"], [...modelResult.warnings, ...audit.warnings])
      if (audit.blocker) return finish("failed", "provider_audit_incomplete", [audit.blocker], [...modelResult.warnings, ...audit.warnings])
      if (abortSignal?.aborted) return finish("cancelled", "caller_cancelled", ["caller aborted investigation during model request"], modelResult.warnings)
      if (deadline.expired()) return finish("budget_exhausted", "wall_time_exhausted", ["Commander investigation wall-time budget exhausted during model request"], modelResult.warnings)
      if (modelResult.status !== "tool_call") {
        latestAssistant = modelResult.assistant_message
        latestToolResults = []
        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, true, [], modelResult.warnings, audit.metadata)
        appendTurnSummary(turns, summary, workingSet, budget)
        if (persistCheckpoints && persistTerminalTurnCheckpoint) {
          const checkpointObserved = await this.observeCheckpoint(input, investigationId, bootstrap, budget, toolProtocol, turn, loaded, workingSet, turns, latestAssistant, latestToolResults, providerRequests, wallStartedMs)
          if (checkpointObserved.blocker) return this.finish(input, investigationId, checkpointObserved.status!, checkpointObserved.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [checkpointObserved.blocker], [], started, undefined, state.durationMs?.())
        }
        if (modelResult.status === "final") return finish("final", "model_final", [], [...modelResult.warnings, ...(modelResult.tool_calls.length === 0 && workingSet.evidence_cards.length === 0 ? ["model finalized without acquired evidence"] : [])], modelResult.text)
        if (modelResult.status === "refusal") return finish("refused", "model_refusal", [], modelResult.warnings)
        if (modelResult.status === "cancelled") return finish("cancelled", "caller_cancelled", [modelResult.error ?? "model request cancelled"], modelResult.warnings)
        if (modelResult.status === "malformed") return finish("failed", "model_malformed", [modelResult.error ?? "model output malformed"], modelResult.warnings)
        return finish("failed", "provider_failed", [modelResult.error ?? "provider request failed"], modelResult.warnings)
      }

      const validation = validateToolCalls(modelResult.tool_calls, loaded, budget, workingSet)
      if (validation.blocker) {
        const summary = turnSummary(turn, request.request_id, modelResult, context, [], [], [], workingSet.tool_call_count, false, [validation.blocker], modelResult.warnings, audit.metadata)
        appendTurnSummary(turns, summary, workingSet, budget)
        return finish(validation.reason === "max_tool_calls_per_turn" || validation.reason === "max_tool_calls" ? "budget_exhausted" : "blocked", validation.reason, [validation.blocker], modelResult.warnings)
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
        if (humanToolStop) return finish("needs_human_review", humanToolStop, [humanBeforeTool.summary_preview ?? humanToolStop], humanBeforeTool.warnings)
        if (humanBeforeTool.warnings.length) workingSet.current_warnings.push(...humanBeforeTool.warnings)
        if (workingSet.tool_call_count >= budget.max_tool_calls) return finish("budget_exhausted", "max_tool_calls", ["max tool calls exhausted"])
        const args = normalizedControllerArgs(call, input.phase)
        if (call.tool_id === TOOL_SEARCH_ID && workingSet.tool_search_call_count + 1 > budget.max_tool_search_calls) return finish("budget_exhausted", "max_tool_search_calls", ["max tool search calls exhausted"])
        const callIndex = executions.length + 1
        const executionId = `${investigationId}_exec_${turn}_${callIndex}`
        const callId = controllerCallId(investigationId, turn, callIndex, call.tool_call_id)
        const controllerBlocker = this.controllerPreflightBlocker(call, args, input.phase, loaded, budget)
        if (!controllerBlocker && elapsedWallMs(wallStartedMs) >= budget.max_wall_time_ms) return finish("budget_exhausted", "wall_time_exhausted", ["Commander investigation wall-time budget exhausted before tool execution"])
        let toolDeadlineExpired = false
        let execution: CommanderToolExecutionResult
        if (controllerBlocker) {
          execution = controllerBlockedExecution(executionId, callId, call, input.phase, controllerBlocker, this.now())
        } else {
          const toolDeadline = deadlineSignal(abortSignal, budget, wallStartedMs)
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
            remaining_tool_call_budget: budget.max_tool_calls - workingSet.tool_call_count,
          }).finally(toolDeadline.cancel)
          toolDeadlineExpired = toolDeadline.expired()
        }
        if (abortSignal?.aborted) return finish("cancelled", "caller_cancelled", ["caller aborted investigation during tool execution"], execution.warnings)
        if (toolDeadlineExpired) return finish("budget_exhausted", "wall_time_exhausted", ["Commander investigation wall-time budget exhausted during tool execution"], execution.warnings)
        executions.push(execution)
        const externalRequestCount = execution.external_api_audit_event_count ?? 0
        const toolBudgetCharge = externalRequestCount > 0 ? externalRequestCount : 1
        if (toolBudgetCharge > budget.max_tool_calls - workingSet.tool_call_count) return finish("budget_exhausted", "max_tool_calls", ["GitHub external request count exceeded remaining max_tool_calls budget"])
        workingSet.tool_call_count += toolBudgetCharge
        if (call.tool_id === TOOL_SEARCH_ID) workingSet.tool_search_call_count += 1
        const resultBytesCap = perToolResultCap(execution.max_output_bytes, context.input_bytes + currentTurnToolResultBytes, budget, modelResult.tool_calls.length - executions.length + 1)
        const toolMessage = toCommanderToolResultMessage(execution, resultBytesCap)
        latestToolResults.push(toolMessage)
        const toolMessageBytes = Buffer.byteLength(toolMessage.content)
        currentTurnToolResultBytes += toolMessageBytes
        workingSet.cumulative_tool_result_bytes += toolMessageBytes
        if (workingSet.cumulative_tool_result_bytes > budget.max_cumulative_tool_result_bytes) return finish("budget_exhausted", "max_cumulative_tool_result_bytes", ["cumulative tool-result byte budget exhausted"])
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
        if (repeatCount >= 2) return finish("no_progress", "repeated_identical_call", ["repeated identical tool call/result detected"])
        if (execution.status === "cancelled") return finish("cancelled", "tool_execution_cancelled", ["tool execution cancelled"], execution.warnings)
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
      if (persistCheckpoints) {
        const checkpointObserved = await this.observeCheckpoint(input, investigationId, bootstrap, budget, toolProtocol, turn, loaded, workingSet, turns, latestAssistant, latestToolResults, providerRequests, wallStartedMs)
        if (checkpointObserved.blocker) return this.finish(input, investigationId, checkpointObserved.status!, checkpointObserved.reason!, bootstrap, budget, toolProtocol, turns, workingSet, providerRequests, Array.from(loaded.values()), [checkpointObserved.blocker], [], started, undefined, state.durationMs?.())
      }
      if (workingSet.consecutive_no_progress_turns >= budget.max_consecutive_no_progress_turns) return finish("no_progress", "consecutive_no_progress", ["consecutive no-progress turn limit reached"])
    }
    return finish("budget_exhausted", "max_model_turns", ["max model turns exhausted"])
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

  private finish(input: CommanderInvestigationInput, investigationId: string, status: CommanderInvestigationResult["status"], stopReason: CommanderInvestigationStopReason, bootstrap: { bootstrap_id: string; bootstrap_hash: string }, budget: CommanderInvestigationBudget, protocol: CommanderModelToolProtocol, turns: CommanderInvestigationTurnSummary[], workingSet: CommanderInvestigationWorkingSet, providerRequests: number, loadedTools: CommanderToolDescriptor[], blockers: string[], warnings: string[], started: Date, finalSummary?: string, activeDurationMs?: number): CommanderInvestigationResult {
    applyCurrentProviderAuditPolicy(workingSet, this.options.providerAuditPolicy)
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
      duration_ms: Math.max(0, Math.floor(activeDurationMs ?? completed.getTime() - started.getTime())),
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

type CommanderInvestigationPreparedLoopState = {
  mode: "new" | "recovery"
  input: CommanderInvestigationInput
  investigationId: string
  started: Date
  wallStartedMs: number
  bootstrap: CommanderInvestigationBootstrap
  budget: CommanderInvestigationBudget
  toolProtocol: CommanderModelToolProtocol
  loaded: Map<string, CommanderToolDescriptor>
  workingSet: CommanderInvestigationWorkingSet
  turns: CommanderInvestigationTurnSummary[]
  latestAssistant?: CommanderModelAssistantMessage
  latestToolResults: CommanderModelToolResultMessage[]
  providerRequests: number
  recentResults: Map<string, { count: number; last_turn_index: number }>
  nextTurnIndex: number
  requestIdForTurn(turn: number): string
  abortSignal?: AbortSignal
  recoveryNotice?: CommanderInvestigationRecoveryContinuationSeed["recovery_notice"]
  firstRequestPreview?: CommanderInvestigationRecoveryFirstModelRequestPreview
  preModelGateSnapshot?: CommanderInvestigationRecoveryContinuationSeed["pre_model_gate_snapshot"]
  persistCheckpoints: boolean
  persistTerminalTurnCheckpoint: boolean
  durationMs?: () => number
}

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
    transport_dispatch_count: 0,
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

function applyCurrentProviderAuditPolicy(workingSet: CommanderInvestigationWorkingSet, policy: CommanderInvestigationProviderAuditPolicy | undefined): void {
  if (policy?.required !== true) return
  const summary = workingSet.provider_audit
  summary.audit_required = true
  summary.transport_kind = policy.transport_kind
  addUniqueCapped(summary.connector_ids, policy.connector_id, 4)
  summary.all_provider_requests_audited = summary.provider_request_count > 0 && summary.external_api_audit_event_count === summary.provider_request_count
  workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
}

function observeProviderAudit(summary: CommanderInvestigationProviderAuditSummary, policy: CommanderInvestigationProviderAuditPolicy | undefined, modelResult: CommanderModelStepResult): { metadata?: CommanderConnectorModelTransportMetadata; blocker?: string; warnings: string[] } {
  if (policy?.required === true) {
    summary.audit_required = true
    summary.transport_kind = policy.transport_kind
    addUniqueCapped(summary.connector_ids, policy.connector_id, 4)
  }
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
    summary.transport_dispatch_count = (summary.transport_dispatch_count ?? 0) + (metadata.transport_dispatch_count ?? 0)
    summary.successful_audit_count += metadata.successful_audit_count
    summary.failed_audit_count += metadata.failed_audit_count
    if (metadata.request_body_persisted || metadata.response_body_persisted || metadata.credentials_persisted) summary.warnings.push("provider transport metadata reported persisted sensitive content")
  }
  if (policy?.required !== true) {
    summary.all_provider_requests_audited = summary.transport_kind === "none" || summary.external_api_audit_event_count === summary.provider_request_count
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
  if ((metadata.transport_dispatch_count ?? 0) > requestCount) return { blocker: "configured provider transport dispatch count exceeds request_count", warnings: [] }
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
    transport_dispatch_count: integerOrZero(raw.transport_dispatch_count),
    dropped_header_names: Array.isArray(raw.dropped_header_names) ? raw.dropped_header_names.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => preview(item, 80)) : [],
    request_body_persisted: raw.request_body_persisted === false ? false : true as never,
    response_body_persisted: raw.response_body_persisted === false ? false : true as never,
    credentials_persisted: raw.credentials_persisted === false ? false : true as never,
  }
}

function integerOrZero(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function canonicalDate(value: string): Date | undefined {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? undefined : parsed
}

function addUniqueCapped(items: string[], value: string, cap: number): void {
  if (items.includes(value)) return
  if (items.length < cap) items.push(value)
}

function minimalBootstrap(input: CommanderInvestigationInput) {
  return { bootstrap_id: `commander_investigation_bootstrap_${stableHash(input).slice(0, 16)}`, bootstrap_hash: stableHash({ objective: input.objective, phase: input.phase }) }
}

function neutralRecoveryBlockedInput(): CommanderInvestigationInput {
  return {
    investigation_id: "recovery_seed_rejected",
    phase: "general_read",
    objective: "Recovery continuation seed was rejected before authoritative journal lookup.",
    requested_by: "runtime",
    provider_id: "unverified_recovery_seed",
    provider_kind: "unverified_recovery_seed",
    model_id: "unverified_recovery_seed",
    tool_protocol: "native",
  }
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

function validateAndPrepareRecoverySeed(seed: CommanderInvestigationRecoveryContinuationSeed, currentDescriptors: CommanderToolDescriptor[], boundToolIds: readonly string[], checkpoint: CommanderInvestigationCheckpoint): { loadedTools?: CommanderToolDescriptor[]; latestAssistant?: CommanderModelAssistantMessage; latestToolResults?: CommanderModelToolResultMessage[]; blocker?: string } {
  const identityError = validateRecoveryIdentity(seed)
  if (identityError) return { blocker: identityError }
  if (stableHash(seed.loaded_tool_refs) !== stableHash(checkpoint.loaded_tools)) return { blocker: "recovery continuation loaded tool references did not match journal checkpoint" }
  const loaded = reconstructRecoveryLoadedTools(checkpoint.loaded_tools, currentDescriptors, boundToolIds, seed.normalized_input.phase)
  if (loaded.blocker) return { blocker: loaded.blocker }
  const integrity = validateRecoverySeedIntegrity(seed, loaded.loadedTools!, currentDescriptors, checkpoint)
  if (integrity) return { blocker: integrity }
  const replay = reconstructRecoveryReplayFromSeed(seed, loaded.loadedTools!, checkpoint)
  if (replay.blocker) return { blocker: replay.blocker }
  return { loadedTools: loaded.loadedTools, latestAssistant: replay.latestAssistant, latestToolResults: replay.latestToolResults }
}

function validateRecoverySeedIntegrity(seed: CommanderInvestigationRecoveryContinuationSeed, loadedTools: CommanderToolDescriptor[], currentDescriptors: CommanderToolDescriptor[], checkpoint?: CommanderInvestigationCheckpoint): string | undefined {
  if (stableHash(seed.normalized_input) !== seed.normalized_input_hash) return "recovery continuation normalized input hash did not verify"
  const currentBootstrapHash = sha256JsonHash({ ...seed.current_bootstrap, estimated_bytes: 0, estimated_tokens: 0, bootstrap_hash: "" })
  if (seed.current_bootstrap.bootstrap_hash !== currentBootstrapHash || seed.current_bootstrap_hash !== currentBootstrapHash) return "recovery continuation current bootstrap hash did not verify"
  if (seed.current_bootstrap.continuity_assessment_status === "degraded") return "recovery continuation current bootstrap is degraded"
  const restoredWorkingSet = durableCommanderInvestigationWorkingSet(seed.working_set as CommanderInvestigationWorkingSet)
  if (restoredWorkingSet.working_set_hash !== seed.working_set_hash || seed.working_set.working_set_hash !== seed.working_set_hash) return "recovery continuation working set hash did not verify"
  if (checkpoint) {
    const checkpointWorkingSet = restoreRecoveryWorkingSetFromCheckpoint(checkpoint)
    if (checkpointWorkingSet.blocker) return checkpointWorkingSet.blocker
    if (restoredWorkingSet.working_set_hash !== checkpointWorkingSet.workingSet!.working_set_hash) return "recovery continuation working set did not match journal checkpoint"
    if (stableHash(seed.turn_summaries) !== stableHash(checkpoint.turn_summaries)) return "recovery continuation turn summaries did not match journal checkpoint"
  }
  if (stableHash(seed.consumed) !== stableHash(seed.effective_budget.consumed)) return "recovery continuation consumed budget counters did not verify"
  const consumed = seed.effective_budget.consumed
  if (seed.next_turn_index !== consumed.model_turns + 1) return "recovery continuation next turn index did not verify"
  if (seed.provider_request_count_before !== consumed.provider_requests) return "recovery continuation provider request count did not verify"
  if (seed.working_set.provider_audit.provider_request_count !== consumed.provider_requests) return "recovery continuation provider audit count did not verify"
  if (seed.recovery_kind === "checkpoint" && seed.working_set.model_turn_count !== consumed.model_turns) return "recovery continuation working set model-turn count did not verify"
  if (seed.recovery_kind === "checkpoint" && (seed.uncertain_model_turn_charge !== 0 || seed.unresolved_provider_attempt_count !== 0)) return "recovery continuation uncertain attempt accounting did not verify"
  if (seed.recovery_kind === "uncertain_provider_outcome") {
    if (!seed.pending_model_step_ref) return "recovery continuation pending boundary did not verify"
    if (seed.uncertain_model_turn_charge !== 1 || seed.unresolved_provider_attempt_count !== 1) return "recovery continuation uncertain attempt accounting did not verify"
    if (consumed.model_turns !== seed.working_set.model_turn_count + 1) return "recovery continuation uncertain model-turn charge did not verify"
    if (consumed.model_turns < seed.pending_model_step_ref.turn_index) return "recovery continuation uncertain model-turn charge did not verify"
    if (seed.next_turn_index <= seed.pending_model_step_ref.turn_index) return "recovery continuation uncertain next turn did not verify"
  }
  if (seed.working_set.tool_call_count !== consumed.tool_calls) return "recovery continuation working set tool-call count did not verify"
  if (seed.working_set.tool_search_call_count !== consumed.tool_search_calls) return "recovery continuation working set tool-search count did not verify"
  if (seed.working_set.cumulative_tool_result_bytes !== consumed.cumulative_tool_result_bytes) return "recovery continuation working set result-byte count did not verify"
  if (seed.working_set.consecutive_no_progress_turns !== consumed.consecutive_no_progress_turns) return "recovery continuation working set no-progress count did not verify"
  if (seed.working_set.evidence_cards.length + seed.working_set.omitted_evidence_count !== consumed.evidence_cards) return "recovery continuation working set evidence count did not verify"
  if (seed.turn_summaries.length + seed.working_set.omitted_turn_count !== consumed.turn_summaries) return "recovery continuation turn-summary count did not verify"
  const replay = reconstructRecoveryReplayFromSeed(seed, loadedTools, checkpoint)
  if (replay.blocker) return replay.blocker
  const replayMessageHash = stableHash({ replay_exchange_hash: seed.replay_exchange_hash, latest_assistant: replay.latestAssistant, latest_tool_results: replay.latestToolResults })
  if (seed.replay_message_hash !== replayMessageHash) return "recovery continuation replay message hash did not verify"
  if (stableHash({ latest_assistant: seed.latest_assistant, latest_tool_results: seed.latest_tool_results }) !== stableHash({ latest_assistant: replay.latestAssistant, latest_tool_results: replay.latestToolResults })) return "recovery continuation replay messages do not match durable exchange"
  const replayToolCallCount = replay.latestAssistant?.content.filter((part) => part.type === "tool_call").length ?? 0
  if (seed.replay_summary.tool_call_count !== replayToolCallCount || seed.replay_summary.tool_result_count !== replay.latestToolResults.length) return "recovery continuation replay message counts did not verify"
  if (!seed.replay_summary.replay_protocol_available && (replayToolCallCount > 0 || replay.latestToolResults.length > 0)) return "recovery continuation replay messages are unavailable"
  if (seed.replay_summary.replay_protocol_available && !seed.replay_exchange_hash) return "recovery continuation replay exchange reference is missing"
  if (seed.replay_summary.replay_protocol_available && seed.replay_exchange_hash !== seed.replay_summary.replay_exchange_hash) return "recovery continuation replay exchange reference did not verify"
  if (seed.loaded_tool_refs.length !== consumed.loaded_schemas || loadedTools.length !== consumed.loaded_schemas) return "recovery continuation loaded schema count did not verify"
  const loadedToolIntegrityError = validateRecoveryLoadedTools(loadedTools, seed.loaded_tool_refs, currentDescriptors)
  if (loadedToolIntegrityError) return loadedToolIntegrityError
  const seedLoadedToolIntegrityError = validateRecoveryLoadedTools(seed.loaded_tools, seed.loaded_tool_refs, currentDescriptors)
  if (seedLoadedToolIntegrityError) return seedLoadedToolIntegrityError
  if (seed.elapsed_active_ms_before !== seed.effective_budget.consumed.elapsed_active_ms) return "recovery continuation elapsed active time did not verify"
  const effectiveBudgetHash = stableHash({ ...seed.effective_budget.effective_budget, budget_hash: "" })
  if (seed.effective_budget.effective_budget.budget_hash !== effectiveBudgetHash) return "recovery continuation effective budget hash did not verify"
  if (seed.effective_budget.effective_budget_hash !== effectiveBudgetHash || seed.effective_budget_hash !== effectiveBudgetHash) return "recovery continuation effective budget reference did not verify"
  const continuationBudgetHash = stableHash({ ...seed.effective_budget, effective_budget_hash: effectiveBudgetHash, budget_hash: "" })
  if (seed.effective_budget.budget_hash !== continuationBudgetHash) return "recovery continuation budget hash did not verify"
  const recoveryNoticeError = validateRecoveryNotice(seed)
  if (recoveryNoticeError) return recoveryNoticeError
  if (checkpoint) {
    const expectedPrefix = expectedRecoveryRequestPrefix(seed, checkpoint)
    if (seed.request_id_prefix !== expectedPrefix) return "recovery continuation request id prefix did not verify"
    const expectedRequestId = `${expectedPrefix}_turn_${seed.next_turn_index}`
    if (seed.first_model_request_preview.request_id !== expectedRequestId) return "recovery first model request id did not verify"
    if (seed.pending_model_step_ref?.model_request_id === expectedRequestId || checkpoint.turn_summaries.some((turn) => turn.model_request_id === expectedRequestId)) return "recovery request id collides with historical model request id"
  }
  const requestPreviewHash = stableHash({ ...seed.first_model_request_preview, request_preview_hash: "" })
  if (seed.first_model_request_preview.request_preview_hash !== requestPreviewHash) return "recovery first model request preview hash did not verify"
  return undefined
}

function restoreRecoveryWorkingSetFromCheckpoint(checkpoint: CommanderInvestigationCheckpoint): { workingSet?: CommanderInvestigationWorkingSet; blocker?: string } {
  const workingSet = durableCommanderInvestigationWorkingSet(checkpoint.working_set as unknown as CommanderInvestigationWorkingSet)
  const checkpointToolIds = checkpoint.loaded_tools.map((tool) => tool.tool_id).sort()
  if (JSON.stringify(workingSet.loaded_tool_ids) !== JSON.stringify(checkpointToolIds)) return { blocker: "checkpoint loaded tool references do not match working-set loaded_tool_ids" }
  if (workingSet.working_set_hash !== checkpoint.working_set.working_set_hash) return { blocker: "checkpoint durable working-set hash could not be revalidated" }
  return { workingSet }
}

function expectedRecoveryRequestPrefix(seed: CommanderInvestigationRecoveryContinuationSeed, checkpoint: CommanderInvestigationCheckpoint): string {
  return `${checkpoint.investigation_id}_recovery_${checkpoint.checkpoint_sequence}_${stableHash({
    basis: seed.recovery_basis_hash,
    checkpoint: checkpoint.checkpoint_hash,
    pending: seed.pending_model_step_ref?.model_request_id,
    bootstrap: seed.current_bootstrap.bootstrap_hash,
    notice: seed.recovery_notice.notice_hash,
  }).slice(0, 12)}`
}

function validateRecoveryIdentity(seed: CommanderInvestigationRecoveryContinuationSeed): string | undefined {
  const input = seed.normalized_input
  const identity = seed.immutable_identity
  if (identity.investigation_id !== seed.investigation_id) return "recovery continuation identity investigation_id did not verify"
  if (input.investigation_id !== undefined && input.investigation_id !== seed.investigation_id) return "recovery continuation normalized input investigation_id did not verify"
  if (input.phase !== identity.phase) return "recovery continuation identity phase did not verify"
  if (stableHash(input.objective) !== identity.objective_hash) return "recovery continuation identity objective hash did not verify"
  if (input.requested_by !== identity.requested_by) return "recovery continuation identity requested_by did not verify"
  if (input.mission_id !== identity.mission_id) return "recovery continuation identity mission_id did not verify"
  if (input.session_id !== identity.session_id) return "recovery continuation identity session_id did not verify"
  if (input.launch_id !== identity.launch_id) return "recovery continuation identity launch_id did not verify"
  if (input.provider_id !== identity.provider_id) return "recovery continuation identity provider_id did not verify"
  if (input.provider_kind !== identity.provider_kind) return "recovery continuation identity provider_kind did not verify"
  if (input.model_id !== identity.model_id) return "recovery continuation identity model_id did not verify"
  if ((input.tool_protocol ?? "auto") !== identity.tool_protocol && input.tool_protocol !== undefined) return "recovery continuation identity tool protocol did not verify"
  if (seed.tool_protocol !== identity.tool_protocol) return "recovery continuation tool protocol did not verify"
  if (seed.original_bootstrap_ref.bootstrap_id !== identity.bootstrap_id || seed.original_bootstrap_ref.bootstrap_hash !== identity.bootstrap_hash) return "recovery continuation identity bootstrap reference did not verify"
  if (seed.effective_budget.original_budget_id !== identity.budget_id || seed.effective_budget.original_budget_hash !== identity.budget_hash) return "recovery continuation identity budget reference did not verify"
  const basis = {
    basis_version: 1 as const,
    investigation_id: seed.investigation_id,
    projection_status: "ready" as const,
    immutable_identity: identity,
    normalized_input_hash: seed.normalized_input_hash,
    latest_checkpoint_id: seed.checkpoint_ref.checkpoint_id,
    latest_checkpoint_sequence: seed.checkpoint_ref.checkpoint_sequence,
    latest_checkpoint_hash: seed.checkpoint_ref.checkpoint_hash,
    pending_model_request_id: seed.pending_model_step_ref?.model_request_id,
    pending_model_boundary_hash: seed.pending_model_step_ref ? seed.pending_model_boundary_hash : undefined,
    terminal_hash: undefined,
    recovery_kind: seed.recovery_kind,
    basis_hash: "",
  }
  const basisHash = stableHash({ ...basis, basis_hash: "" })
  if (!seed.recovery_basis_hash || basisHash !== seed.recovery_basis_hash) return "recovery continuation basis hash did not verify"
  if (seed.recovery_kind === "uncertain_provider_outcome" && (!seed.pending_model_step_ref || !seed.pending_model_boundary_hash)) return "recovery continuation pending boundary did not verify"
  if (seed.recovery_kind === "checkpoint" && (seed.pending_model_step_ref || seed.pending_model_boundary_hash)) return "recovery continuation pending boundary did not verify"
  return undefined
}

function reconstructRecoveryReplayFromSeed(seed: CommanderInvestigationRecoveryContinuationSeed, loadedTools: CommanderToolDescriptor[], checkpoint?: CommanderInvestigationCheckpoint): { latestAssistant?: CommanderModelAssistantMessage; latestToolResults: CommanderModelToolResultMessage[]; blocker?: string } {
  if (seed.replay_summary.replay_protocol_available) {
    if (!checkpoint) return { latestToolResults: [], blocker: "recovery continuation authoritative checkpoint is required for replay exchange" }
    if (!verifyRecoveryCheckpoint(checkpoint)) return { latestToolResults: [], blocker: "recovery continuation authoritative checkpoint hash did not verify" }
    if (
      checkpoint.checkpoint_id !== seed.checkpoint_ref.checkpoint_id ||
      checkpoint.checkpoint_sequence !== seed.checkpoint_ref.checkpoint_sequence ||
      checkpoint.checkpoint_hash !== seed.checkpoint_ref.checkpoint_hash
    ) return { latestToolResults: [], blocker: "recovery continuation authoritative checkpoint reference did not verify" }
    if (!checkpoint.replay_exchange) return { latestToolResults: [], blocker: "recovery continuation authoritative checkpoint replay exchange is missing" }
    if (stableHash(seed.replay_exchange) !== stableHash(checkpoint.replay_exchange)) return { latestToolResults: [], blocker: "recovery continuation replay exchange does not match journal checkpoint" }
  }
  const expectedCheckpointTurn = seed.pending_model_step_ref ? seed.pending_model_step_ref.turn_index - 1 : seed.next_turn_index - 1
  const replay = reconstructCommanderRecoveryReplayExchangeFromDurable({
    exchange: seed.replay_summary.replay_protocol_available ? checkpoint!.replay_exchange : seed.replay_exchange,
    checkpointKind: seed.replay_summary.replay_protocol_available ? "turn_complete" : "initial",
    checkpointSequence: seed.replay_summary.replay_protocol_available ? seed.checkpoint_ref.checkpoint_sequence : 0,
    checkpointTurnIndex: expectedCheckpointTurn,
    loadedTools,
    protocol: seed.tool_protocol,
  })
  if (replay.blockers.length) return { latestToolResults: [], blocker: replay.blockers[0] }
  if (seed.replay_summary.replay_protocol_available && !seed.replay_exchange) return { latestToolResults: [], blocker: "recovery continuation durable replay exchange is missing" }
  if (!seed.replay_summary.replay_protocol_available && seed.replay_exchange) return { latestToolResults: [], blocker: "recovery continuation durable replay exchange is unexpected" }
  if (seed.replay_summary.replay_exchange_hash !== replay.summary.replay_exchange_hash) return { latestToolResults: [], blocker: "recovery continuation replay exchange reference did not verify" }
  return { latestAssistant: replay.latest_assistant, latestToolResults: replay.latest_tool_results }
}

function verifyRecoveryCheckpoint(checkpoint: CommanderInvestigationCheckpoint): boolean {
  const semanticStateHash = stableHash({
    ...checkpoint,
    checkpoint_id: "",
    checkpoint_hash: "",
    semantic_state_hash: "",
    created_at: "",
    elapsed_active_ms: 0,
    provider_audit: undefined,
    working_set: {
      ...checkpoint.working_set,
      provider_audit: { ...checkpoint.working_set.provider_audit, audit_request_ids: [] },
      evidence_cards: checkpoint.working_set.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
    },
    turn_summaries: checkpoint.turn_summaries.map((item) => ({ ...item, provider_audit_request_ids: [], turn_hash: "" })),
  })
  return (
    checkpoint.semantic_state_hash === semanticStateHash &&
    checkpoint.checkpoint_id === `commander_inv_checkpoint_${checkpoint.checkpoint_sequence}_${semanticStateHash.slice(0, 16)}` &&
    checkpoint.checkpoint_hash === stableHash({ ...checkpoint, checkpoint_hash: "" })
  )
}

function validateRecoveryNotice(seed: CommanderInvestigationRecoveryContinuationSeed): string | undefined {
  const notice = seed.recovery_notice
  const pending = seed.pending_model_step_ref
  const expectedContinuityDrift = seed.current_bootstrap_hash !== seed.original_bootstrap_ref.bootstrap_hash
  const expectedKind = pending ? "uncertain_provider_continuation" : "checkpoint_continuation"
  const expectedOutcome = pending ? "uncertain" : "not_pending"
  const expectedWarning = pending
    ? "Previous provider outcome is uncertain; do not infer success or failure, do not replay the old request, and continue only from the accepted checkpoint with a fresh request."
    : "Recovery uses a fresh current context from the accepted checkpoint; exact assistant prose and raw tool results are unavailable."
  const noticeHash = stableHash({ ...notice, warning: redactText(notice.warning), notice_hash: "" })
  if (notice.notice_hash !== noticeHash || seed.recovery_notice_hash !== noticeHash) return "recovery continuation notice hash did not verify"
  if (
    notice.notice_version !== 1 ||
    notice.kind !== expectedKind ||
    notice.investigation_id !== seed.investigation_id ||
    notice.checkpoint_id !== seed.checkpoint_ref.checkpoint_id ||
    notice.checkpoint_sequence !== seed.checkpoint_ref.checkpoint_sequence ||
    notice.checkpoint_hash !== seed.checkpoint_ref.checkpoint_hash ||
    notice.original_bootstrap_hash !== seed.original_bootstrap_ref.bootstrap_hash ||
    notice.current_bootstrap_hash !== seed.current_bootstrap_hash ||
    seed.continuity_drift_detected !== expectedContinuityDrift ||
    notice.continuity_drift_detected !== expectedContinuityDrift ||
    notice.previous_provider_outcome !== expectedOutcome ||
    notice.previous_model_request_id !== pending?.model_request_id ||
    notice.previous_provider_request_may_have_been_sent !== Boolean(pending) ||
    notice.previous_provider_response_available !== false ||
    notice.previous_tool_execution_known !== false ||
    notice.previous_request_replay_forbidden !== true ||
    notice.previous_tool_execution_replay_forbidden !== true ||
    notice.exact_replay_supported !== false ||
    notice.original_assistant_text_available !== false ||
    notice.durable_tool_results_are_summary_only !== true ||
    notice.counters_preserved !== true ||
    notice.fresh_request_required !== true ||
    notice.next_turn_index !== seed.next_turn_index ||
    notice.warning !== expectedWarning
  ) {
    return "recovery continuation notice did not verify"
  }
  return undefined
}

function preModelGateSnapshotBlocker(
  snapshot: CommanderInvestigationRecoveryContinuationSeed["pre_model_gate_snapshot"],
  turn: number,
  human: CommanderInvestigationControlSnapshot,
  provider: CommanderInvestigationProviderPreflightSnapshot | undefined,
): string | undefined {
  const actual = {
    snapshot_version: 1 as const,
    turn_index: turn,
    human_control_action: human.action === "continue" ? "continue" as const : "continue" as const,
    human_control_warnings: human.warnings.map((item) => preview(item, 240)).slice(0, 12),
    provider_preflight_ready: provider?.ready ?? true,
    provider_preflight_warnings: (provider?.warnings ?? []).map((item) => preview(item, 240)).slice(0, 12),
    gate_snapshot_hash: "",
  }
  actual.gate_snapshot_hash = stableHash({ ...actual, gate_snapshot_hash: "" })
  if (snapshot.gate_snapshot_hash !== stableHash({ ...snapshot, gate_snapshot_hash: "" })) return "recovery pre-model gate snapshot hash did not verify"
  if (snapshot.gate_snapshot_hash !== actual.gate_snapshot_hash) return "recovery pre-model gate snapshot changed since approval"
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
    const actual = recomputeToolSchemaMetadata(tool)
    const currentActual = recomputeToolSchemaMetadata(current)
    if (!actual || !currentActual) return "recovery continuation loaded tool actual schema did not verify"
    if (
      actual.input_schema_hash !== tool.schema_metadata.input_schema_hash ||
      actual.output_schema_hash !== tool.schema_metadata.output_schema_hash ||
      actual.input_schema_bytes !== tool.schema_metadata.input_schema_bytes ||
      actual.output_schema_bytes !== tool.schema_metadata.output_schema_bytes ||
      actual.estimated_schema_tokens !== tool.schema_metadata.estimated_schema_tokens ||
      currentActual.input_schema_hash !== current.schema_metadata.input_schema_hash ||
      currentActual.output_schema_hash !== current.schema_metadata.output_schema_hash ||
      currentActual.input_schema_bytes !== current.schema_metadata.input_schema_bytes ||
      currentActual.output_schema_bytes !== current.schema_metadata.output_schema_bytes ||
      currentActual.estimated_schema_tokens !== current.schema_metadata.estimated_schema_tokens
    ) return "recovery continuation loaded tool actual schema did not verify"
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

function reconstructRecoveryLoadedTools(refs: CommanderInvestigationLoadedToolRef[], currentDescriptors: CommanderToolDescriptor[], boundToolIds: readonly string[], phase: CommanderToolPhase): { loadedTools?: CommanderToolDescriptor[]; blocker?: string } {
  const currentById = new Map(currentDescriptors.map((tool) => [tool.tool_id, tool]))
  const loaded: CommanderToolDescriptor[] = []
  const seen = new Set<string>()
  for (const ref of refs.slice().sort((a, b) => a.tool_id.localeCompare(b.tool_id))) {
    if (seen.has(ref.tool_id)) return { blocker: "recovery continuation loaded tool references are not unique" }
    seen.add(ref.tool_id)
    const current = currentById.get(ref.tool_id)
    if (!current) return { blocker: "recovery continuation loaded tool descriptor did not verify" }
    if (!boundToolIds.includes(current.tool_id)) return { blocker: "recovery continuation loaded tool binding did not verify" }
    if (current.availability !== "implemented_read_surface") return { blocker: "recovery continuation loaded tool availability did not verify" }
    if (current.load_policy === "never_exposed") return { blocker: "recovery continuation loaded tool load policy did not verify" }
    if (!isToolAllowedInPhase(current, phase)) return { blocker: "recovery continuation loaded tool phase eligibility did not verify" }
    if (!isSafeRecoveryTool(current)) return { blocker: "recovery continuation loaded tool authority did not verify" }
    const schema = recomputeToolSchemaMetadata(current)
    if (!schema) return { blocker: "recovery continuation loaded tool schema did not verify" }
    if (
      schema.input_schema_hash !== current.schema_metadata.input_schema_hash ||
      schema.output_schema_hash !== current.schema_metadata.output_schema_hash ||
      schema.input_schema_bytes !== current.schema_metadata.input_schema_bytes ||
      schema.output_schema_bytes !== current.schema_metadata.output_schema_bytes ||
      schema.estimated_schema_tokens !== current.schema_metadata.estimated_schema_tokens
    ) return { blocker: "recovery continuation loaded tool actual schema did not verify" }
    if (
      ref.input_schema_hash !== schema.input_schema_hash ||
      ref.output_schema_hash !== schema.output_schema_hash ||
      ("input_schema_bytes" in ref && ref.input_schema_bytes !== schema.input_schema_bytes) ||
      ("output_schema_bytes" in ref && ref.output_schema_bytes !== schema.output_schema_bytes) ||
      ("estimated_schema_tokens" in ref && ref.estimated_schema_tokens !== schema.estimated_schema_tokens)
    ) return { blocker: "recovery continuation loaded tool actual schema did not verify" }
    loaded.push(deepFreeze(structuredClone(current)) as CommanderToolDescriptor)
  }
  return { loadedTools: loaded }
}

function isSafeRecoveryTool(tool: CommanderToolDescriptor): boolean {
  const fixedGitRead = (tool.tool_id === "repo.git_status" || tool.tool_id === "repo.git_diff")
    && tool.execution_backend === "restricted_git_read"
    && tool.process_policy === "fixed_git_read_only"
  const githubRead = COMMANDER_GITHUB_READ_TOOL_IDS.includes(tool.tool_id as typeof COMMANDER_GITHUB_READ_TOOL_IDS[number])
    && tool.namespace === "github_read"
    && tool.side_effect_class === "external_read"
    && tool.execution_backend === "runtime_service"
    && tool.requires_network
    && tool.requires_credentials
    && tool.requires_run_lock
  return tool.risk === "safe_read"
    && ((tool.side_effect_class === "none" || tool.side_effect_class === "internal_read") || githubRead)
    && !tool.calls_provider
    && !tool.mutates_events
    && (githubRead || !tool.requires_network)
    && (githubRead || !tool.requires_credentials)
    && !tool.requires_approval
    && (githubRead || !tool.requires_run_lock)
    && (!tool.creates_external_process || fixedGitRead)
}

function recomputeToolSchemaMetadata(tool: CommanderToolDescriptor): CommanderToolSchemaMetadata | undefined {
  if (!tool.input_schema || !tool.output_schema) return undefined
  const inputBytes = jsonBytes(tool.input_schema)
  const outputBytes = jsonBytes(tool.output_schema)
  return {
    input_schema_hash: sha256JsonHash(tool.input_schema),
    output_schema_hash: sha256JsonHash(tool.output_schema),
    input_schema_bytes: inputBytes,
    output_schema_bytes: outputBytes,
    estimated_schema_tokens: Math.ceil((inputBytes + outputBytes) / 4),
    schema_loaded: true,
  }
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  }
  return value
}

function recoveryFirstRequestPreviewBlocker(
  approvedPreview: CommanderInvestigationRecoveryFirstModelRequestPreview,
  request: CommanderModelStepRequest,
  context: CommanderInvestigationContext,
  loadedTools: CommanderToolDescriptor[],
  recoveryNoticeHash?: string,
): string | undefined {
  const actual = recoveryFirstRequestPreview(approvedPreview.turn_index, approvedPreview.old_pending_request_id, recoveryNoticeHash, request, context, loadedTools)
  return actual.request_preview_hash === approvedPreview.request_preview_hash ? undefined : "first recovered model request no longer matches the approved preparation preview"
}

function recoveryFirstRequestPreview(
  turnIndex: number,
  oldPendingRequestId: string | undefined,
  recoveryNoticeHash: string | undefined,
  request: CommanderModelStepRequest,
  context: CommanderInvestigationContext,
  loadedTools: CommanderToolDescriptor[],
): CommanderInvestigationRecoveryFirstModelRequestPreview {
  const preview: CommanderInvestigationRecoveryFirstModelRequestPreview = {
    request_id: request.request_id,
    provider_id: request.provider_id,
    provider_kind: request.provider_kind,
    model_id: request.model_id,
    turn_index: turnIndex,
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
    recovery_notice_hash: recoveryNoticeHash ?? "",
    old_pending_request_id: oldPendingRequestId,
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
