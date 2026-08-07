import { redactText, redactValue } from "../security/redaction"
import type { CommanderToolDescriptor, CommanderToolPhase } from "../commander-tools/commander-tool-types"
import { COMMANDER_GITHUB_READ_TOOL_IDS } from "../commander-tools/commander-github-read-types"
import { COMMANDER_TOOL_PHASES } from "../commander-tools/commander-tool-registry"
import { isToolAllowedInPhase } from "../commander-tools/commander-tool-service"
import { stableHash } from "./commander-model-schema"
import { CommanderInvestigationContextService } from "./commander-investigation-context-service"
import {
  CommanderInvestigationRecoveryContinuationBuilder,
  commanderRecoveryExecutionPreparationSummaryFromSeed,
} from "./commander-investigation-recovery-execution-service"
import { commanderInvestigationRecoveryCurrentPolicyLimits } from "./commander-investigation-recovery-budget"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import type {
  CommanderInvestigationRecoveryBoundToolAuthorityRef,
  CommanderInvestigationRecoveryBudgetCompatibility,
  CommanderInvestigationRecoveryCheckpointSummary,
  CommanderInvestigationRecoveryContextCompatibility,
  CommanderInvestigationRecoveryContinuityCompatibility,
  CommanderInvestigationRecoveryHumanControl,
  CommanderInvestigationRecoveryPacket,
  CommanderInvestigationRecoveryPendingModelStep,
  CommanderInvestigationRecoveryPreview,
  CommanderInvestigationRecoveryPreviewInput,
  CommanderInvestigationRecoveryProviderCompatibility,
  CommanderInvestigationRecoveryRecommendedAction,
  CommanderInvestigationRecoveryServiceOptions,
  CommanderInvestigationRecoveryToolCompatibility,
  CommanderInvestigationRecoveryToolCompatibilitySummary,
} from "./commander-investigation-recovery-types"
import type { CommanderInvestigationRecoveryExecutionPreparationSummary } from "./commander-investigation-recovery-execution-types"
import type {
  CommanderInvestigationCheckpoint,
  CommanderInvestigationLoadedToolRef,
} from "./commander-investigation-journal-types"
import { commanderProviderVisibleDescriptionHash } from "./commander-model-schema"

const PACKET_DEFAULT_CAP = 32_000
const PACKET_HARD_CAP = 48_000

export class CommanderInvestigationRecoveryService {
  private readonly now: () => Date

  constructor(private readonly options: CommanderInvestigationRecoveryServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: CommanderInvestigationRecoveryPreviewInput): Promise<CommanderInvestigationRecoveryPreview> {
    const validated = validateInput(input)
    const generatedAt = this.now().toISOString()
    if (validated.blocker) return this.empty(validated.investigation_id, "blocked", "none", "none", [validated.blocker], [], generatedAt)
    const source = await this.options.recoverySource({ investigation_id: validated.investigation_id })
    if (!source) return this.empty(validated.investigation_id, "not_found", "none", "none", ["Commander investigation record was not found"], [], generatedAt)

    const record = source.record
    if (!record || source.projection_status !== "ready") {
      return this.withSource(source, "blocked", "none", "inspect_corrupt_record", undefined, undefined, undefined, undefined, ["Commander investigation journal projection is not recovery-authoritative"], [], generatedAt)
    }
    if (record.status !== "running") {
      return this.withSource(source, "not_applicable", "none", terminalAction(record.status), undefined, undefined, undefined, undefined, [], ["terminal Commander investigation journals are not reopened in 9W3B1"], generatedAt)
    }
    if (source.current_recovery_attempt) {
      const attempt = source.current_recovery_attempt
      return this.withSource(
        source,
        "recovery_in_progress",
        attempt.recovery_kind,
        "await_recovery_completion",
        source.latest_checkpoint ? checkpointSummaryFrom(source.latest_checkpoint) : undefined,
        undefined,
        undefined,
        undefined,
        [],
        ["recovery execution may have been interrupted; approval remains consumed and automatic retry is forbidden"],
        generatedAt,
      )
    }
    const checkpoint = source.latest_checkpoint
    if (!checkpoint || !source.normalized_input || !source.immutable_identity) {
      return this.withSource(source, "blocked", "none", "inspect_corrupt_record", undefined, undefined, undefined, undefined, ["ready journal did not expose an authoritative checkpoint/input source"], [], generatedAt)
    }

    const recoveryKind = source.pending_model_step ? "uncertain_provider_outcome" : "checkpoint"
    const checkpointSummary = checkpointSummaryFrom(checkpoint)
    const pending = source.pending_model_step ? pendingSummaryFrom(source.pending_model_step) : undefined
    const terminalCheckpoint = terminalCheckpointOutcome(checkpoint)
    if (terminalCheckpoint) {
      return this.withSource(source, "blocked", "none", "start_new_investigation", checkpointSummary, undefined, undefined, undefined, [
        `latest checkpoint already records terminal model status ${terminalCheckpoint}; same-journal recovery is not supported without a terminal event`,
      ], [
        "terminal model outcome was checkpointed before the durable finished event; original assistant prose is unavailable for exact replay",
      ], generatedAt)
    }
    const toolCompatibility = this.toolCompatibility(checkpoint.loaded_tools, checkpoint.phase)
    const providerCompatibility = this.providerCompatibility(source, checkpoint.phase)
    const currentContextBudget = await this.options.currentContextBudget({
      phase: checkpoint.phase,
      provider_kind: checkpoint.provider_kind,
      model_id: checkpoint.model_id,
      max_context_tokens: checkpoint.budget.max_context_tokens,
      max_context_bytes: checkpoint.budget.max_context_bytes,
    })
    const budgetCompatibility = this.budgetCompatibility(checkpoint, currentContextBudget)
    const includeCurrentContinuity = validated.include_current_continuity !== false
    const continuityCompatibility = await this.continuityCompatibility(source, checkpoint, includeCurrentContinuity)
    const humanControl = await this.humanControl(checkpoint.phase, record.session_id, record.launch_id)
    const preliminaryBlockers = [
      ...toolCompatibility.blockers,
      ...providerCompatibility.blockers,
      ...budgetCompatibility.blockers,
      ...continuityCompatibility.blockers,
      ...humanControl.blockers,
    ].slice(0, 24)
    const preliminaryWarnings = [
      ...toolCompatibility.warnings,
      ...providerCompatibility.warnings,
      ...budgetCompatibility.warnings,
      ...continuityCompatibility.warnings,
      ...humanControl.warnings,
      ...(source.pending_model_step ? ["pending model-step outcome remains uncertain; external API audit counts do not resolve it"] : []),
    ].slice(0, 32)
    let executionPreparation: CommanderInvestigationRecoveryExecutionPreparationSummary | undefined
    let packet = this.recoveryPacket(source, checkpoint, recoveryKind, budgetCompatibility, humanControl, continuityCompatibility, preliminaryBlockers, preliminaryWarnings, providerCompatibility, executionPreparation)
    let contextCompatibility = packet ? this.contextCompatibility(checkpoint, toolCompatibility, budgetCompatibility, packet, continuityCompatibility, currentContextBudget) : emptyContextCompatibility()
    let blockers: string[] = []
    let warnings: string[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      blockers = collectPreviewBlockers(toolCompatibility, providerCompatibility, budgetCompatibility, contextCompatibility, continuityCompatibility, humanControl)
      warnings = collectPreviewWarnings(toolCompatibility, providerCompatibility, budgetCompatibility, contextCompatibility, continuityCompatibility, humanControl, Boolean(source.pending_model_step))
      const nextPacket = this.recoveryPacket(source, checkpoint, recoveryKind, budgetCompatibility, humanControl, continuityCompatibility, blockers, warnings, providerCompatibility, executionPreparation)
      const nextContext = nextPacket ? this.contextCompatibility(checkpoint, toolCompatibility, budgetCompatibility, nextPacket, continuityCompatibility, currentContextBudget) : emptyContextCompatibility()
      const stable = nextPacket?.packet_hash === packet?.packet_hash && nextContext.compatibility_hash === contextCompatibility.compatibility_hash
      packet = nextPacket
      contextCompatibility = nextContext
      if (stable) break
    }
    blockers = collectPreviewBlockers(toolCompatibility, providerCompatibility, budgetCompatibility, contextCompatibility, continuityCompatibility, humanControl)
    warnings = collectPreviewWarnings(toolCompatibility, providerCompatibility, budgetCompatibility, contextCompatibility, continuityCompatibility, humanControl, Boolean(source.pending_model_step))
    executionPreparation = await this.executionPreparation(source, checkpoint, recoveryKind, {
      toolCompatibility,
      providerCompatibility,
      budgetCompatibility,
      contextCompatibility,
      continuityCompatibility,
      humanControl,
    }, blockers, warnings)
    const preparationBlockers = blockers.filter((item) => item.startsWith("recovery preparation blocked:"))
    const preparationWarnings = warnings.filter((item) => item.startsWith("recovery preparation warning:"))
    packet = this.recoveryPacket(source, checkpoint, recoveryKind, budgetCompatibility, humanControl, continuityCompatibility, blockers, warnings, providerCompatibility, executionPreparation)
    contextCompatibility = packet ? this.contextCompatibility(checkpoint, toolCompatibility, budgetCompatibility, packet, continuityCompatibility, currentContextBudget) : emptyContextCompatibility()
    blockers = [...collectPreviewBlockers(toolCompatibility, providerCompatibility, budgetCompatibility, contextCompatibility, continuityCompatibility, humanControl), ...preparationBlockers].slice(0, 24)
    warnings = [...collectPreviewWarnings(toolCompatibility, providerCompatibility, budgetCompatibility, contextCompatibility, continuityCompatibility, humanControl, Boolean(source.pending_model_step)), ...preparationWarnings].slice(0, 32)
    packet = this.recoveryPacket(source, checkpoint, recoveryKind, budgetCompatibility, humanControl, continuityCompatibility, blockers, warnings, providerCompatibility, executionPreparation)
    if (!packet) blockers = [...blockers, "recovery packet could not fit within the durable preview cap"].slice(0, 24)
    const humanReview = recoveryKind === "uncertain_provider_outcome" || humanControl.action === "human_review_required"
    const continuityReady = continuityCompatibility.current_bootstrap_ready || !includeCurrentContinuity && checkpoint.phase !== "mid_mission_supervision"
    const compatible = blockers.length === 0 && toolCompatibility.compatible && providerCompatibility.compatible && budgetCompatibility.compatible && contextCompatibility.within_current_context_budget && continuityReady && humanControl.action === "continue"
    const status = blockers.length ? "blocked" : humanReview ? "human_review_required" : compatible ? "ready_for_approval" : "blocked"
    const recommendedAction = recommendedActionFor({
      recoveryKind,
      compatible,
      blockers,
      toolCompatibility,
      providerCompatibility,
      budgetCompatibility,
      contextCompatibility,
      continuityCompatibility,
      continuityReady,
      humanControl,
    })
    return this.withSource(source, status, recoveryKind, recommendedAction, checkpointSummary, pending, packet, {
      toolCompatibility,
      providerCompatibility,
      budgetCompatibility,
      contextCompatibility,
      continuityCompatibility,
      humanControl,
    }, blockers, warnings, generatedAt, executionPreparation)
  }

  private toolCompatibility(stored: CommanderInvestigationLoadedToolRef[], phase: CommanderToolPhase): CommanderInvestigationRecoveryToolCompatibilitySummary {
    const tools = stored.map((ref) => this.oneToolCompatibility(ref, phase))
    const currentBoundToolRefs = this.currentBoundToolRefs(phase)
    const storedSubset = tools.every((tool) => tool.binding_present)
    const boundRefBlockers = currentBoundToolRefs.filter((tool) => !tool.descriptor_present).map((tool) => `current Commander binding ${tool.tool_id} no longer has a descriptor`)
    const blockers = [...tools.flatMap((tool) => tool.blockers), ...boundRefBlockers].slice(0, 24)
    const warnings = tools.flatMap((tool) => tool.warnings).slice(0, 16)
    const summary = {
      tools,
      binding_count: this.options.boundToolIds.length,
      current_bound_tool_refs: currentBoundToolRefs,
      stored_subset_of_current_bindings: storedSubset,
      compatible: blockers.length === 0 && tools.every((tool) => tool.compatible),
      blockers,
      warnings,
      compatibility_hash: "",
    }
    summary.compatibility_hash = stableHash({ ...summary, compatibility_hash: "" })
    return summary
  }

  private currentBoundToolRefs(phase: CommanderToolPhase): CommanderInvestigationRecoveryBoundToolAuthorityRef[] {
    return [...this.options.boundToolIds].sort().map((toolId) => {
      const current = this.options.descriptors.find((tool) => tool.tool_id === toolId)
      if (!current) {
        const missing = { tool_id: toolId, descriptor_present: false, binding_ref_hash: "" }
        return { ...missing, binding_ref_hash: stableHash(missing) }
      }
      const ref = {
        tool_id: current.tool_id,
        descriptor_present: true,
        descriptor_version: current.version,
        authority_id: current.authority_id ?? "",
        runtime_command: current.runtime_command ?? "",
        slash_command: current.slash_command ?? "",
        input_schema_hash: current.schema_metadata.input_schema_hash,
        output_schema_hash: current.schema_metadata.output_schema_hash,
        load_policy: current.load_policy,
        trust_class: current.trust_class,
        instruction_semantics: current.instruction_semantics,
        namespace: current.namespace,
        allowed_in_phase: isToolAllowedInPhase(current, phase),
        availability: current.availability,
        risk: current.risk,
        side_effect_class: current.side_effect_class,
        execution_backend: current.execution_backend,
        process_policy: current.process_policy,
        max_output_bytes: current.max_output_bytes,
        timeout_ms: current.timeout_ms,
        creates_external_process: current.creates_external_process,
        calls_provider: current.calls_provider,
        mutates_events: current.mutates_events,
        requires_network: current.requires_network,
        requires_credentials: current.requires_credentials,
        requires_approval: current.requires_approval,
        requires_run_lock: current.requires_run_lock,
        description_hash: commanderProviderVisibleDescriptionHash(current),
        binding_ref_hash: "",
      }
      return { ...ref, binding_ref_hash: stableHash(ref) }
    })
  }

  private oneToolCompatibility(stored: CommanderInvestigationLoadedToolRef, phase: CommanderToolPhase): CommanderInvestigationRecoveryToolCompatibility {
    const current = this.options.descriptors.find((tool) => tool.tool_id === stored.tool_id)
    const bindingPresent = this.options.boundToolIds.includes(stored.tool_id)
    const fixedGitException = stored.tool_id === "repo.git_status" || stored.tool_id === "repo.git_diff"
    const githubReadException = current !== undefined
      && COMMANDER_GITHUB_READ_TOOL_IDS.includes(current.tool_id as typeof COMMANDER_GITHUB_READ_TOOL_IDS[number])
      && current.namespace === "github_read"
      && current.side_effect_class === "external_read"
      && current.execution_backend === "runtime_service"
      && current.requires_network === true
      && current.requires_credentials === true
      && current.requires_run_lock === true
    const implemented = current?.availability === "implemented_read_surface"
    const allowedInPhase = Boolean(current && isToolAllowedInPhase(current, phase))
    const authorityMatch = Boolean(current && (current.authority_id ?? "") === stored.authority_id)
    const currentDescriptionHash = current ? commanderProviderVisibleDescriptionHash(current) : undefined
    const descriptionMatch = Boolean(current && stored.description_hash !== undefined && stored.description_hash === currentDescriptionHash)
    const schemaMatch = Boolean(current && current.schema_metadata.input_schema_hash === stored.input_schema_hash && current.schema_metadata.output_schema_hash === stored.output_schema_hash)
    const descriptorMatch = Boolean(current && current.version === stored.descriptor_version && current.load_policy === stored.load_policy && current.trust_class === stored.trust_class && current.instruction_semantics === stored.instruction_semantics)
    const capabilityEnvelopeMatch = Boolean(current &&
      stored.namespace === current.namespace &&
      stored.risk === current.risk &&
      stored.side_effect_class === current.side_effect_class &&
      stored.execution_backend === current.execution_backend &&
      stored.process_policy === current.process_policy &&
      stored.max_output_bytes === current.max_output_bytes &&
      stored.timeout_ms === current.timeout_ms &&
      stored.creates_external_process === current.creates_external_process &&
      stored.calls_provider === current.calls_provider &&
      stored.mutates_events === current.mutates_events &&
      stored.requires_network === current.requires_network &&
      stored.requires_credentials === current.requires_credentials &&
      stored.requires_approval === current.requires_approval &&
      stored.requires_run_lock === current.requires_run_lock)
    const safeReadAuthority = Boolean(current && current.risk === "safe_read" && !current.mutates_events && !current.calls_provider && !current.requires_approval && ((current.side_effect_class === "none" || current.side_effect_class === "internal_read") && !current.requires_network && !current.requires_credentials && !current.requires_run_lock || githubReadException) && (!current.creates_external_process || fixedGitException && current.execution_backend === "restricted_git_read" && current.process_policy === "fixed_git_read_only"))
    const blockers: string[] = []
    if (!current) blockers.push(`stored loaded tool ${stored.tool_id} no longer has a descriptor`)
    if (!bindingPresent) blockers.push(`stored loaded tool ${stored.tool_id} is not in the current Commander binding allowlist`)
    if (current && !implemented) blockers.push(`stored loaded tool ${stored.tool_id} is not an implemented read surface`)
    if (current && !allowedInPhase) blockers.push(`stored loaded tool ${stored.tool_id} is no longer allowed in phase ${phase}`)
    if (current && !authorityMatch) blockers.push(`stored loaded tool ${stored.tool_id} authority_id changed`)
    if (current && !descriptionMatch) blockers.push(`stored loaded tool ${stored.tool_id} provider-visible description changed or is incomplete`)
    if (current && !schemaMatch) blockers.push(`stored loaded tool ${stored.tool_id} schema hash changed`)
    if (current && !descriptorMatch) blockers.push(`stored loaded tool ${stored.tool_id} descriptor metadata changed`)
    if (current && !capabilityEnvelopeMatch) blockers.push(`stored loaded tool ${stored.tool_id} capability envelope changed or is incomplete`)
    if (current && !safeReadAuthority) blockers.push(`stored loaded tool ${stored.tool_id} no longer satisfies safe-read recovery authority`)
    const result = {
      tool_id: stored.tool_id,
      stored_namespace: stored.namespace,
      current_namespace: current?.namespace,
      stored_descriptor_version: stored.descriptor_version,
      current_descriptor_version: current?.version,
      stored_authority_id: stored.authority_id,
      current_authority_id: current?.authority_id ?? "",
      stored_description_hash: stored.description_hash,
      current_description_hash: currentDescriptionHash,
      stored_input_schema_hash: stored.input_schema_hash,
      current_input_schema_hash: current?.schema_metadata.input_schema_hash,
      stored_output_schema_hash: stored.output_schema_hash,
      current_output_schema_hash: current?.schema_metadata.output_schema_hash,
      stored_load_policy: stored.load_policy,
      current_load_policy: current?.load_policy,
      stored_trust_class: stored.trust_class,
      current_trust_class: current?.trust_class,
      stored_max_output_bytes: stored.max_output_bytes,
      current_max_output_bytes: current?.max_output_bytes,
      stored_timeout_ms: stored.timeout_ms,
      current_timeout_ms: current?.timeout_ms,
      stored_risk: stored.risk,
      current_risk: current?.risk,
      stored_side_effect_class: stored.side_effect_class,
      current_side_effect_class: current?.side_effect_class,
      stored_execution_backend: stored.execution_backend,
      current_execution_backend: current?.execution_backend,
      stored_process_policy: stored.process_policy,
      current_process_policy: current?.process_policy,
      binding_present: bindingPresent,
      implemented_read_surface: implemented,
      allowed_in_phase: allowedInPhase,
      authority_match: authorityMatch,
      safe_read_authority: safeReadAuthority,
      schema_match: schemaMatch,
      descriptor_match: descriptorMatch,
      description_match: descriptionMatch,
      capability_envelope_match: capabilityEnvelopeMatch,
      compatible: blockers.length === 0,
      blockers: blockers.slice(0, 8),
      warnings: [],
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
    return result
  }

  private providerCompatibility(source: CommanderInvestigationRecoverySource, phase: CommanderToolPhase): CommanderInvestigationRecoveryProviderCompatibility {
    const record = source.record
    const readiness = this.options.providerReadiness({ phase, provider_id: record?.provider_id, provider_kind: record?.provider_kind, model_id: record?.model_id })
    const executionEnvelope = this.options.providerExecutionEnvelope?.({ phase, provider_id: record?.provider_id, provider_kind: record?.provider_kind, model_id: record?.model_id })
    const capability = this.options.modelCapability({ provider_kind: record?.provider_kind, model_id: record?.model_id, role: "commander" })
    const providerSource = readiness.provider_source
    const identityMatch = providerSource === "configured_connector"
      ? readiness.provider_id === record?.provider_id && readiness.provider_kind === record?.provider_kind && readiness.model_id === record?.model_id
      : providerSource === "injected_adapter"
    const phaseEnabled = providerSource !== "configured_connector" || readiness.enabled_phases.includes(phase)
    const commanderRole = capability.role_support.includes("commander")
    const protocol = record?.tool_protocol
    const protocolSupported = protocol === "json_fallback" || capability.supports_tools === true || capability.supports_tools === "unknown"
    const warnings = [
      ...readiness.warnings,
      ...(providerSource === "injected_adapter" ? ["injected Commander adapter is internal/test only; production recovery execution remains blocked"] : []),
      ...(protocol === "native" && capability.supports_tools === "unknown" ? ["stored native protocol has unknown current tool support"] : []),
    ].slice(0, 16)
    const blockers = [
      ...readiness.blockers.filter((blocker) => !blocker.includes("RuntimeServer mode is active") && !blocker.includes("RuntimeServer is started") && !blocker.includes("RuntimeServer lifecycle is ready") && !blocker.includes("RuntimeServer shutdown is not requested") && !blocker.includes("RuntimeServer run lock is held")),
      ...(!identityMatch ? ["configured provider/model identity does not match the durable investigation"] : []),
      ...(!phaseEnabled ? ["durable investigation phase is not enabled for the configured provider"] : []),
      ...(!commanderRole ? ["current model capability does not support Commander role"] : []),
      ...(!protocolSupported ? ["stored tool protocol is not supported by the current model capability"] : []),
      ...(providerSource === "injected_adapter" ? ["configured connector-backed provider is required for production recovery"] : []),
      ...(providerSource === "none" ? ["Commander investigation provider is not configured"] : []),
    ].slice(0, 16)
    const result = {
      provider_source: providerSource,
      stored_provider_id: record?.provider_id,
      stored_provider_kind: record?.provider_kind,
      stored_model_id: record?.model_id,
      configured_provider_id: readiness.provider_id,
      configured_provider_kind: readiness.provider_kind,
      configured_model_id: readiness.model_id,
      identity_match: identityMatch,
      phase_enabled: phaseEnabled,
      configuration_ready: readiness.configuration_ready,
      execution_ready_now: readiness.execution_ready,
      capability_id: readiness.capability_id || capability.capability_id,
      commander_role_supported: commanderRole,
      stored_tool_protocol_supported: protocolSupported,
      connector_available: readiness.checks.find((check) => check.name === "connector_exists")?.ok ?? providerSource !== "configured_connector",
      credentials_ready: readiness.checks.find((check) => check.name === "credential_values_present")?.ok ?? providerSource !== "configured_connector",
      supports_streaming: false as const,
      execution_envelope: executionEnvelope,
      compatible: blockers.length === 0 && readiness.configuration_ready && identityMatch && phaseEnabled && commanderRole && protocolSupported && providerSource === "configured_connector",
      blockers,
      warnings,
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({
      provider_source: result.provider_source,
      stored_provider_id: result.stored_provider_id,
      stored_provider_kind: result.stored_provider_kind,
      stored_model_id: result.stored_model_id,
      configured_provider_id: result.configured_provider_id,
      configured_provider_kind: result.configured_provider_kind,
      configured_model_id: result.configured_model_id,
      identity_match: result.identity_match,
      phase_enabled: result.phase_enabled,
      configuration_ready: result.configuration_ready,
      capability_id: result.capability_id,
      commander_role_supported: result.commander_role_supported,
      stored_tool_protocol_supported: result.stored_tool_protocol_supported,
      connector_available: result.connector_available,
      credentials_ready: result.credentials_ready,
      supports_streaming: result.supports_streaming,
      execution_envelope_hash: result.execution_envelope?.execution_envelope_hash,
      compatible: result.compatible,
      blockers: result.blockers,
      warnings: result.warnings,
    })
    return result
  }

  private budgetCompatibility(checkpoint: CommanderInvestigationCheckpoint, currentContextBudget: import("./commander-investigation-recovery-types").CommanderInvestigationRecoveryCurrentContextBudget): CommanderInvestigationRecoveryBudgetCompatibility {
    const stored = checkpoint.budget
    const profile = this.options.currentProfile({ phase: checkpoint.phase })
    const loadedSchemaUsage = this.loadedSchemaUsage(checkpoint)
    const consumed = {
      model_turns: checkpoint.working_set.model_turn_count,
      provider_requests: checkpoint.provider_request_count,
      tool_calls: checkpoint.working_set.tool_call_count,
      tool_search_calls: checkpoint.working_set.tool_search_call_count,
      result_bytes: checkpoint.working_set.cumulative_tool_result_bytes,
      elapsed_ms: checkpoint.elapsed_active_ms,
      evidence_cards: checkpoint.working_set.evidence_cards.length + checkpoint.working_set.omitted_evidence_count,
      turn_summaries: checkpoint.turn_summaries.length + checkpoint.working_set.omitted_turn_count,
      loaded_schemas: checkpoint.loaded_tools.length,
      loaded_schema_bytes: loadedSchemaUsage.bytes,
      loaded_schema_tokens: loadedSchemaUsage.tokens,
      no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns,
    }
    const currentLimits = commanderInvestigationRecoveryCurrentPolicyLimits({ profile, context: currentContextBudget })
    const storedRemaining = {
      model_turns: stored.max_model_turns - consumed.model_turns,
      tool_calls: stored.max_tool_calls - consumed.tool_calls,
      tool_search_calls: stored.max_tool_search_calls - consumed.tool_search_calls,
      result_bytes: stored.max_cumulative_tool_result_bytes - consumed.result_bytes,
      wall_time_ms: stored.max_wall_time_ms - consumed.elapsed_ms,
      evidence_cards: stored.max_evidence_cards - consumed.evidence_cards,
      turn_summaries: stored.max_turn_summaries - consumed.turn_summaries,
      loaded_schemas: stored.max_loaded_schemas - consumed.loaded_schemas,
      no_progress_turns: stored.max_consecutive_no_progress_turns - consumed.no_progress_turns,
    }
    const effective = {
      model_turns: Math.min(storedRemaining.model_turns, currentLimits.max_model_turns - consumed.model_turns),
      tool_calls: Math.min(storedRemaining.tool_calls, currentLimits.max_tool_calls - consumed.tool_calls),
      tool_search_calls: Math.min(storedRemaining.tool_search_calls, currentLimits.max_tool_search_calls - consumed.tool_search_calls),
      loaded_schemas: Math.min(storedRemaining.loaded_schemas, currentLimits.max_loaded_schemas - consumed.loaded_schemas),
      result_bytes: Math.min(storedRemaining.result_bytes, currentLimits.max_cumulative_tool_result_bytes - consumed.result_bytes),
      wall_time_ms: Math.min(storedRemaining.wall_time_ms, currentLimits.max_wall_time_ms - consumed.elapsed_ms),
      evidence_cards: storedRemaining.evidence_cards,
      turn_summaries: storedRemaining.turn_summaries,
      no_progress_turns: storedRemaining.no_progress_turns,
    }
    const optionalDimensions = new Set(["evidence_cards", "turn_summaries", "loaded_schemas"])
    const finalAnswerConditionalDimensions = new Set(["tool_calls", "tool_search_calls", "result_bytes"])
    const exhausted = Object.entries(effective).filter(([key, value]) => {
      if (optionalDimensions.has(key)) return false
      if (finalAnswerConditionalDimensions.has(key)) return value < 0
      return value <= 0
    }).map(([key]) => key)
    if (effective.loaded_schemas < 0) exhausted.push("loaded_schemas")
    const effectiveSchemaAllocationBytes = minDefined(stored.tool_schema_allocation_bytes, currentLimits.tool_schema_allocation_bytes)
    const effectiveSchemaAllocationTokens = minDefined(stored.tool_schema_allocation_tokens, currentLimits.tool_schema_allocation_tokens)
    if (effectiveSchemaAllocationBytes !== undefined && consumed.loaded_schema_bytes > effectiveSchemaAllocationBytes) exhausted.push("tool_schema_allocation_bytes")
    if (effectiveSchemaAllocationTokens !== undefined && consumed.loaded_schema_tokens > effectiveSchemaAllocationTokens) exhausted.push("tool_schema_allocation_tokens")
    const stricter = Object.entries(currentLimits).filter(([key, value]) => {
      const storedValue = (stored as unknown as Record<string, number>)[key]
      return typeof storedValue === "number" && typeof value === "number" && value < storedValue
    }).map(([key]) => key)
    const blockers = [
      ...exhausted.map((dimension) => `remaining recovery budget exhausted for ${dimension}`),
      ...currentContextBudget.blockers.map((item) => `current context budget blocks recovery: ${item}`),
    ].slice(0, 12)
    const result = {
      stored_budget_id: stored.budget_id,
      stored_budget_hash: stored.budget_hash,
      current_profile_id: profile.profile_id,
      current_context_budget_id: currentContextBudget.context_budget_id ?? stored.source_context_budget_id,
      stored_limits: {
        max_model_turns: stored.max_model_turns,
        max_tool_calls: stored.max_tool_calls,
        max_tool_search_calls: stored.max_tool_search_calls,
        max_loaded_schemas: stored.max_loaded_schemas,
        max_cumulative_tool_result_bytes: stored.max_cumulative_tool_result_bytes,
        max_wall_time_ms: stored.max_wall_time_ms,
        max_consecutive_no_progress_turns: stored.max_consecutive_no_progress_turns,
        max_evidence_cards: stored.max_evidence_cards,
        max_turn_summaries: stored.max_turn_summaries,
        tool_schema_allocation_bytes: stored.tool_schema_allocation_bytes,
        tool_schema_allocation_tokens: stored.tool_schema_allocation_tokens,
      },
      consumed,
      stored_remaining: storedRemaining,
      current_policy_limits: currentLimits,
      effective_remaining: effective,
      model_turns_remaining: effective.model_turns,
      tool_calls_remaining: effective.tool_calls,
      tool_search_calls_remaining: effective.tool_search_calls,
      result_bytes_remaining: effective.result_bytes,
      wall_time_remaining_ms: effective.wall_time_ms,
      evidence_slots_remaining: effective.evidence_cards,
      turn_summary_slots_remaining: effective.turn_summaries,
      no_progress_count: checkpoint.working_set.consecutive_no_progress_turns,
      repeat_signature_count: checkpoint.working_set.recent_result_signatures.length,
      exhausted_dimensions: exhausted,
      stricter_current_policy_dimensions: stricter,
      compatible: blockers.length === 0,
      blockers,
      warnings: [
        ...stricter.map((dimension) => `current phase/context policy is stricter for ${dimension}`),
        ...currentContextBudget.warnings.map((item) => `current context budget warning: ${item}`),
      ].slice(0, 12),
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
    return result
  }

  private contextCompatibility(checkpoint: CommanderInvestigationCheckpoint, tools: CommanderInvestigationRecoveryToolCompatibilitySummary, budget: CommanderInvestigationRecoveryBudgetCompatibility, packet: CommanderInvestigationRecoveryPacket, continuity: CommanderInvestigationRecoveryContinuityCompatibility, currentContextBudget: import("./commander-investigation-recovery-types").CommanderInvestigationRecoveryCurrentContextBudget): CommanderInvestigationRecoveryContextCompatibility {
    const capability = this.options.modelCapability({ provider_kind: checkpoint.provider_kind, model_id: checkpoint.model_id, role: "commander" })
    const loadedSchemaUsage = this.loadedSchemaUsage(checkpoint)
    const loadedSchemaBytes = loadedSchemaUsage.bytes
    const loadedSchemaTokens = loadedSchemaUsage.tokens
    const latestBytes = checkpoint.replay_exchange ? bytes(checkpoint.replay_exchange) : 0
    const evidenceBytes = bytes(packet.evidence_pointers)
    const packetBytes = bytes(packet)
    const bootstrapBytes = continuity.current_bootstrap_bytes
    const bootstrapTokens = continuity.current_bootstrap_tokens
    const storedMaxContextBytes = checkpoint.budget.max_context_bytes ?? 65_536
    const currentMaxContextBytes = Math.min(storedMaxContextBytes, capability.max_context_bytes ?? storedMaxContextBytes)
    const storedMaxContextTokens = checkpoint.budget.max_context_tokens
    const currentMaxContextTokens = storedMaxContextTokens === undefined
      ? capability.max_context_tokens
      : capability.max_context_tokens === undefined
        ? storedMaxContextTokens
        : Math.min(storedMaxContextTokens, capability.max_context_tokens)
    const currentInputContextBytes = minDefined(currentMaxContextBytes, currentContextBudget.input_context_bytes) ?? currentMaxContextBytes
    const currentInputContextTokens = minDefined(currentMaxContextTokens, currentContextBudget.input_context_tokens)
    const estimatedBytes = packetBytes + loadedSchemaBytes + latestBytes + bootstrapBytes
    const estimatedTokens = Math.ceil(packetBytes / 4) + loadedSchemaTokens + Math.ceil(latestBytes / 4) + bootstrapTokens
    const blockers = [
      ...(estimatedBytes > currentInputContextBytes ? ["estimated recovery context exceeds current model context byte budget"] : []),
      ...(currentInputContextTokens !== undefined && estimatedTokens > currentInputContextTokens ? ["estimated recovery context exceeds current model context token budget"] : []),
    ]
    const result = {
      current_context_budget_id: capability.capability_id,
      stored_checkpoint_bytes: bytes(checkpoint),
      estimated_recovery_packet_bytes: packetBytes,
      estimated_recovery_packet_tokens: Math.ceil(packetBytes / 4),
      loaded_schema_bytes: loadedSchemaBytes,
      loaded_schema_tokens: loadedSchemaTokens,
      latest_protocol_summary_bytes: latestBytes,
      evidence_summary_bytes: evidenceBytes,
      current_bootstrap_bytes: bootstrapBytes,
      current_bootstrap_tokens: bootstrapTokens,
      current_input_context_bytes: currentInputContextBytes,
      current_input_context_tokens: currentInputContextTokens,
      within_current_context_budget: blockers.length === 0 && budget.compatible,
      exact_replay_supported: false as const,
      fresh_context_required: true as const,
      blockers,
      warnings: ["future recovery must build a fresh bounded context; exact assistant prose replay is unsupported"],
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
    return result
  }

  private loadedSchemaUsage(checkpoint: CommanderInvestigationCheckpoint): { bytes: number; tokens: number } {
    return checkpoint.loaded_tools.reduce((sum, tool) => {
      const descriptor = this.options.descriptors.find((candidate) => candidate.tool_id === tool.tool_id)
      return {
        bytes: sum.bytes + (descriptor?.schema_metadata.input_schema_bytes ?? 0) + (descriptor?.schema_metadata.output_schema_bytes ?? 0),
        tokens: sum.tokens + (descriptor?.schema_metadata.estimated_schema_tokens ?? 0),
      }
    }, { bytes: 0, tokens: 0 })
  }

  private async continuityCompatibility(source: CommanderInvestigationRecoverySource, checkpoint: CommanderInvestigationCheckpoint, include: boolean): Promise<CommanderInvestigationRecoveryContinuityCompatibility> {
    const blockers: string[] = []
    const warnings: string[] = []
    let current
    if (!include) {
      warnings.push("current continuity was not assessed")
      if (checkpoint.phase === "mid_mission_supervision") blockers.push("mid-mission recovery requires current continuity assessment")
      if (source.normalized_input) {
        try {
          current = await this.options.currentBootstrap({ ...source.normalized_input, include_continuity: false })
          if (current.continuity_assessment_status === "degraded") {
            blockers.push("current non-continuity bootstrap is degraded and cannot size recovery")
          }
          blockers.push(...current.blockers.slice(0, 8))
          warnings.push(...current.warnings.slice(0, 8))
        } catch (error) {
          blockers.push(`current non-continuity bootstrap failed: ${redactText(error instanceof Error ? error.message : String(error)).slice(0, 180)}`)
        }
      } else {
        blockers.push("validated normalized input is unavailable for current bootstrap sizing")
      }
    } else if (source.normalized_input) {
      try {
        current = await this.options.currentBootstrap({ ...source.normalized_input, include_continuity: true })
        if (current.continuity_assessment_status === "degraded") {
          blockers.push("current continuity assessment is degraded and cannot authorize recovery")
        }
        blockers.push(...current.blockers.slice(0, 8))
        warnings.push(...current.warnings.slice(0, 8))
      } catch (error) {
        blockers.push(`current continuity bootstrap failed: ${redactText(error instanceof Error ? error.message : String(error)).slice(0, 180)}`)
      }
    } else {
      blockers.push("validated normalized input is unavailable for continuity comparison")
    }
    const drift = Boolean(current && current.bootstrap_hash !== checkpoint.bootstrap_ref.bootstrap_hash)
    if (drift) warnings.push("current continuity bootstrap hash differs from the stored bootstrap reference")
    const result = {
      original_bootstrap_id: checkpoint.bootstrap_ref.bootstrap_id,
      original_bootstrap_hash: checkpoint.bootstrap_ref.bootstrap_hash,
      current_bootstrap_id: current?.bootstrap_id,
      current_bootstrap_hash: current?.bootstrap_hash,
      current_bootstrap_ready: include && Boolean(current && (current.continuity_assessment_status ?? "ready") === "ready" && blockers.length === 0),
      continuity_drift_detected: drift,
      current_readiness: current?.readiness,
      current_open_loop_count: current?.open_loops.length ?? 0,
      current_blocker_count: current?.blockers.length ?? blockers.length,
      current_bootstrap_bytes: current?.estimated_bytes ?? 0,
      current_bootstrap_tokens: current?.estimated_tokens ?? 0,
      human_control_summary: current?.human_control_summary,
      blockers: blockers.slice(0, 12),
      warnings: warnings.slice(0, 12),
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
    return result
  }

  private async humanControl(phase: CommanderToolPhase, sessionId?: string, launchId?: string): Promise<CommanderInvestigationRecoveryHumanControl> {
    if (!sessionId && !launchId) return finalizeHumanControl({ checked: false, source_kind: "none", action: "continue", blockers: [], warnings: [] })
    const snapshot = await this.options.currentHumanControl({ phase, session_id: sessionId, launch_id: launchId })
    const action = snapshot.action === "stop" ? "blocked" : snapshot.action === "pause" || snapshot.action === "needs_human_review" ? "human_review_required" : "continue"
    const blockers = action === "blocked" ? [snapshot.summary_preview ?? "durable human stop blocks recovery readiness"] : []
    const warnings = [
      ...snapshot.warnings,
      ...(action === "human_review_required" ? [snapshot.summary_preview ?? "durable human control requires review before recovery"] : []),
      ...(snapshot.projected_state === "resume_requested" ? ["OpenCode resume request is not Commander recovery approval"] : []),
    ].slice(0, 12)
    return finalizeHumanControl({
      checked: true,
      source_kind: snapshot.source_kind,
      control_id: snapshot.control_id,
      projected_state: snapshot.projected_state,
      action,
      summary_preview: snapshot.summary_preview,
      blockers,
      warnings,
    })
  }

  private async executionPreparation(
    source: CommanderInvestigationRecoverySource,
    checkpoint: CommanderInvestigationCheckpoint,
    recoveryKind: "checkpoint" | "uncertain_provider_outcome",
    compat: {
      toolCompatibility: CommanderInvestigationRecoveryToolCompatibilitySummary
      providerCompatibility: CommanderInvestigationRecoveryProviderCompatibility
      budgetCompatibility: CommanderInvestigationRecoveryBudgetCompatibility
      contextCompatibility: CommanderInvestigationRecoveryContextCompatibility
      continuityCompatibility: CommanderInvestigationRecoveryContinuityCompatibility
      humanControl: CommanderInvestigationRecoveryHumanControl
    },
    blockers: string[],
    warnings: string[],
  ): Promise<CommanderInvestigationRecoveryExecutionPreparationSummary | undefined> {
    if (!this.options.continuationBuilder) return undefined
    if (blockers.length > 0) return undefined
    if (!compat.toolCompatibility.compatible || !compat.providerCompatibility.compatible || !compat.budgetCompatibility.compatible || !compat.contextCompatibility.within_current_context_budget || !compat.continuityCompatibility.current_bootstrap_ready || compat.humanControl.action !== "continue") return undefined
    const builder = new CommanderInvestigationRecoveryContinuationBuilder({
      ...this.options.continuationBuilder,
      contextService: this.options.continuationBuilder.contextService ?? new CommanderInvestigationContextService(),
    })
    const built = await builder.build({ source, preview: {
      recovery_kind: recoveryKind,
      recovery_packet: { packet_hash: "preparation_probe" },
      budget_compatibility: compat.budgetCompatibility,
    } as CommanderInvestigationRecoveryPreview, checkpoint })
    warnings.push(...built.warnings.map((item) => `recovery preparation warning: ${item}`))
    if (!built.seed) {
      blockers.push(...built.blockers.map((item) => `recovery preparation blocked: ${item}`))
      return undefined
    }
    return commanderRecoveryExecutionPreparationSummaryFromSeed(built.seed)
  }

  private recoveryPacket(source: CommanderInvestigationRecoverySource, checkpoint: CommanderInvestigationCheckpoint, recoveryKind: "checkpoint" | "uncertain_provider_outcome", budget: CommanderInvestigationRecoveryBudgetCompatibility, human: CommanderInvestigationRecoveryHumanControl, continuity: CommanderInvestigationRecoveryContinuityCompatibility, blockers: string[], warnings: string[], provider?: CommanderInvestigationRecoveryProviderCompatibility, preparation?: CommanderInvestigationRecoveryExecutionPreparationSummary): CommanderInvestigationRecoveryPacket | undefined {
    let packet: CommanderInvestigationRecoveryPacket = {
      packet_id: "",
      packet_version: 1,
      investigation_id: checkpoint.investigation_id,
      recovery_kind: recoveryKind,
      immutable_identity: source.immutable_identity,
      objective_preview: source.record?.objective_preview,
      phase: checkpoint.phase,
      original_bootstrap_ref: checkpoint.bootstrap_ref,
      current_continuity_ref: continuity.current_bootstrap_id && continuity.current_bootstrap_hash ? { bootstrap_id: continuity.current_bootstrap_id, bootstrap_hash: continuity.current_bootstrap_hash } : undefined,
      checkpoint_ref: { checkpoint_id: checkpoint.checkpoint_id, checkpoint_sequence: checkpoint.checkpoint_sequence, checkpoint_hash: checkpoint.checkpoint_hash },
      pending_model_step_ref: source.pending_model_step ? { model_request_id: source.pending_model_step.model_request_id, turn_index: source.pending_model_step.turn_index, base_checkpoint_id: source.pending_model_step.base_checkpoint_id, base_checkpoint_hash: source.pending_model_step.base_checkpoint_hash } : undefined,
      loaded_tool_refs: checkpoint.loaded_tools.slice(0, 24),
      evidence_pointers: checkpoint.working_set.evidence_cards.map(evidencePointer).slice(0, 24),
      execution_digests: checkpoint.working_set.recent_execution_digests.slice(-24),
      repeat_signatures: checkpoint.working_set.recent_result_signatures.slice(-64),
      no_progress_state: { consecutive_no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns, max_consecutive_no_progress_turns: checkpoint.budget.max_consecutive_no_progress_turns },
      remaining_budget: { effective_remaining: budget.effective_remaining, exhausted_dimensions: budget.exhausted_dimensions },
      provider_execution_envelope_hash: provider?.execution_envelope?.execution_envelope_hash,
      execution_preparation_hash: preparation?.execution_preparation_hash,
      first_model_request_preview_hash: preparation?.first_model_request_preview_hash,
      uncertain_model_turn_charge: preparation?.uncertain_model_turn_charge,
      unresolved_provider_attempt_count: preparation?.unresolved_provider_attempt_count,
      current_human_control: human,
      warnings: warnings.slice(0, 16),
      blockers: blockers.slice(0, 16),
      assistant_text_persisted: false,
      exact_replay_supported: false,
      raw_tool_results_persisted: false,
      full_transcript_persisted: false,
      provider_request_replay_allowed: false,
      tool_execution_replay_allowed: false,
      fresh_context_required: true,
      packet_hash: "",
    }
    packet = compactPacket(packet)
    packet.packet_hash = stableHash({ ...packet, packet_id: "", packet_hash: "" })
    packet.packet_id = `commander_recovery_packet_${packet.packet_hash.slice(0, 16)}`
    return bytes(packet) <= PACKET_HARD_CAP ? packet : undefined
  }

  private withSource(
    source: CommanderInvestigationRecoverySource,
    status: CommanderInvestigationRecoveryPreview["status"],
    recoveryKind: CommanderInvestigationRecoveryPreview["recovery_kind"],
    action: CommanderInvestigationRecoveryRecommendedAction,
    checkpoint?: CommanderInvestigationRecoveryCheckpointSummary,
    pending?: CommanderInvestigationRecoveryPendingModelStep,
    packet?: CommanderInvestigationRecoveryPacket,
    compat?: {
      toolCompatibility: CommanderInvestigationRecoveryToolCompatibilitySummary
      providerCompatibility: CommanderInvestigationRecoveryProviderCompatibility
      budgetCompatibility: CommanderInvestigationRecoveryBudgetCompatibility
      contextCompatibility: CommanderInvestigationRecoveryContextCompatibility
      continuityCompatibility: CommanderInvestigationRecoveryContinuityCompatibility
      humanControl: CommanderInvestigationRecoveryHumanControl
    },
    blockers: string[] = [],
    warnings: string[] = [],
    generatedAt: string = this.now().toISOString(),
    executionPreparation?: CommanderInvestigationRecoveryExecutionPreparationSummary,
  ): CommanderInvestigationRecoveryPreview {
    const record = source.record
    const planHash = packet ? stableHash({
      recovery_basis_hash: source.recovery_basis_hash,
      checkpoint_hash: checkpoint?.checkpoint_hash,
      pending_model_boundary: pending ? recoveryPendingPlanHash(pending) : undefined,
      tool: compat?.toolCompatibility.compatibility_hash,
      provider: compat?.providerCompatibility.compatibility_hash,
      provider_execution_envelope: compat?.providerCompatibility.execution_envelope?.execution_envelope_hash,
      budget: compat?.budgetCompatibility.compatibility_hash,
      context: compat?.contextCompatibility.compatibility_hash,
      continuity: compat?.continuityCompatibility.compatibility_hash,
      human: compat?.humanControl.compatibility_hash,
      execution_preparation_hash: executionPreparation?.execution_preparation_hash,
      first_model_request_preview_hash: executionPreparation?.first_model_request_preview_hash,
      uncertain_model_turn_charge: executionPreparation?.uncertain_model_turn_charge,
      unresolved_provider_attempt_count: executionPreparation?.unresolved_provider_attempt_count,
      packet: packet.packet_hash,
      recoveryKind,
      action,
    }) : undefined
    const approval = currentApprovalFor(source, planHash, packet?.packet_hash, executionPreparation?.execution_preparation_hash, executionPreparation?.first_model_request_preview_hash, recoveryKind, checkpoint, pending, compat)
    const consumed = Boolean(source.consumed_recovery_approval || source.current_recovery_attempt)
    const effectiveStatus = source.current_recovery_attempt
      ? "recovery_in_progress" as const
      : approval.current && (status === "ready_for_approval" || status === "human_review_required")
      ? "approved_waiting_for_execution" as const
      : status
    const effectiveAction = source.current_recovery_attempt ? "await_recovery_completion" as const : approval.current ? "await_recovery_execution" as const : action
    const preview = {
      preview_id: `commander_recovery_preview_${stableHash({ source: source.source_hash, generated_at: generatedAt }).slice(0, 16)}`,
      preview_version: 1 as const,
      status: effectiveStatus,
      recovery_kind: recoveryKind,
      recommended_action: effectiveAction,
      investigation_id: source.investigation_id,
      record_status: record?.status,
      record_hash: record?.record_hash,
      projection_status: source.projection_status,
      recovery_state: record?.recovery_state,
      phase: record?.phase,
      objective_preview: record?.objective_preview,
      mission_id: record?.mission_id,
      session_id: record?.session_id,
      launch_id: record?.launch_id,
      provider_id: record?.provider_id,
      provider_kind: record?.provider_kind,
      model_id: record?.model_id,
      tool_protocol: record?.tool_protocol,
      checkpoint,
      pending_model_step: pending,
      tool_compatibility: compat?.toolCompatibility ?? emptyToolCompatibility(),
      provider_compatibility: compat?.providerCompatibility ?? emptyProviderCompatibility(),
      budget_compatibility: compat?.budgetCompatibility ?? emptyBudgetCompatibility(),
      context_compatibility: compat?.contextCompatibility ?? emptyContextCompatibility(),
      continuity_compatibility: compat?.continuityCompatibility ?? emptyContinuityCompatibility(),
      human_control: compat?.humanControl ?? finalizeHumanControl({ checked: false, source_kind: "none", action: "continue", blockers: [], warnings: [] }),
      recovery_packet: packet,
      execution_preparation: executionPreparation,
      execution_preparation_hash: executionPreparation?.execution_preparation_hash,
      approval_state: consumed ? "consumed" as const : approval.current ? "current" as const : approval.staleCount > 0 ? "stale" as const : "none" as const,
      current_approval: consumed ? undefined : approval.current,
      stale_approval_count: approval.staleCount,
      recovery_approval_required: !consumed && !approval.current && (status === "ready_for_approval" || status === "human_review_required"),
      recovery_approval_consumed: consumed,
      current_recovery_attempt: source.current_recovery_attempt,
      automatic_resume_allowed: false as const,
      human_approval_required: !consumed && !approval.current && (status === "ready_for_approval" || status === "human_review_required"),
      exact_replay_supported: false as const,
      original_assistant_text_available: false as const,
      provider_request_replay_allowed: false as const,
      tool_execution_replay_allowed: false as const,
      fresh_context_required: true as const,
      same_journal_resume_candidate: !consumed && (status === "ready_for_approval" || status === "human_review_required" || Boolean(approval.current)),
      terminal_continuation_requires_new_investigation: record?.status !== undefined && record.status !== "running",
      recovery_basis_hash: source.recovery_basis_hash,
      recovery_plan_hash: planHash,
      blockers: blockers.map((item) => bound(item, 240)).slice(0, 24),
      warnings: [
        ...warnings,
        ...(!approval.current && approval.staleCount > 0 ? ["one or more prior recovery approvals are stale and do not authorize execution"] : []),
      ].map((item) => bound(item, 240)).slice(0, 32),
      generated_at: generatedAt,
      network_called: false as const,
      provider_called: false as const,
      tool_executed: false as const,
      events_appended: false as const,
      files_written: false as const,
      research_db_written: false as const,
      mission_mutated: false as const,
      proposal_mutated: false as const,
      opencode_action_performed: false as const,
      github_action_performed: false as const,
      mcp_called: false as const,
      preview_hash: "",
    }
    preview.preview_hash = stableHash({ ...preview, preview_id: "", generated_at: "", preview_hash: "" })
    return redactValue(preview) as CommanderInvestigationRecoveryPreview
  }

  private empty(investigationId: string, status: CommanderInvestigationRecoveryPreview["status"], kind: CommanderInvestigationRecoveryPreview["recovery_kind"], action: CommanderInvestigationRecoveryRecommendedAction, blockers: string[], warnings: string[], generatedAt: string): CommanderInvestigationRecoveryPreview {
    return this.withSource({ investigation_id: investigationId, projection_status: "corrupt", source_event_count: 0, source_hash: stableHash({ investigationId, missing: true }) }, status, kind, action, undefined, undefined, undefined, undefined, blockers, warnings, generatedAt)
  }
}

function recommendedActionFor(input: {
  recoveryKind: "checkpoint" | "uncertain_provider_outcome"
  compatible: boolean
  blockers: string[]
  toolCompatibility: CommanderInvestigationRecoveryToolCompatibilitySummary
  providerCompatibility: CommanderInvestigationRecoveryProviderCompatibility
  budgetCompatibility: CommanderInvestigationRecoveryBudgetCompatibility
  contextCompatibility: CommanderInvestigationRecoveryContextCompatibility
  continuityCompatibility: CommanderInvestigationRecoveryContinuityCompatibility
  continuityReady: boolean
  humanControl: CommanderInvestigationRecoveryHumanControl
}): CommanderInvestigationRecoveryRecommendedAction {
  if (input.humanControl.action === "blocked") return "none"
  if (input.humanControl.action === "human_review_required") return "none"
  if (input.budgetCompatibility.exhausted_dimensions.length) return "start_new_investigation"
  if (!input.providerCompatibility.compatible || input.providerCompatibility.blockers.length) return "reconfigure_runtime"
  if (!input.toolCompatibility.compatible || input.toolCompatibility.blockers.length) return "reconfigure_runtime"
  if (!input.contextCompatibility.within_current_context_budget || input.contextCompatibility.blockers.length) return "reconfigure_runtime"
  if (!input.continuityReady || input.continuityCompatibility.blockers.length) return "reconfigure_runtime"
  if (input.compatible) return input.recoveryKind === "uncertain_provider_outcome" ? "review_uncertain_provider_outcome" : "approve_resume_from_checkpoint"
  if (input.recoveryKind === "uncertain_provider_outcome" && input.blockers.length === 0) return "review_uncertain_provider_outcome"
  return "reconfigure_runtime"
}

function validateInput(input: CommanderInvestigationRecoveryPreviewInput): { investigation_id: string; include_current_continuity: boolean; blocker?: string } {
  const keys = Object.keys(input)
  const unknown = keys.find((key) => key !== "investigation_id" && key !== "include_current_continuity")
  const investigationId = typeof input.investigation_id === "string" ? input.investigation_id.trim() : ""
  if (unknown) return { investigation_id: investigationId, include_current_continuity: true, blocker: `unknown recovery preview input key ${unknown}` }
  if (!investigationId || investigationId.length > 200 || !/^[A-Za-z0-9_.:-]+$/.test(investigationId)) return { investigation_id: investigationId || "invalid", include_current_continuity: true, blocker: "investigation_id is required and must use bounded durable ID characters" }
  if (input.include_current_continuity !== undefined && typeof input.include_current_continuity !== "boolean") return { investigation_id: investigationId, include_current_continuity: true, blocker: "include_current_continuity must be boolean when supplied" }
  return { investigation_id: investigationId, include_current_continuity: input.include_current_continuity !== false }
}

function terminalAction(_status: string): CommanderInvestigationRecoveryRecommendedAction {
  return "start_new_investigation"
}

function terminalCheckpointOutcome(checkpoint: CommanderInvestigationCheckpoint): string | undefined {
  const status = checkpoint.turn_summaries.at(-1)?.model_status
  return status && ["cancelled", "failed", "final", "malformed", "refusal"].includes(status) ? status : undefined
}

function collectPreviewBlockers(
  toolCompatibility: CommanderInvestigationRecoveryToolCompatibilitySummary,
  providerCompatibility: CommanderInvestigationRecoveryProviderCompatibility,
  budgetCompatibility: CommanderInvestigationRecoveryBudgetCompatibility,
  contextCompatibility: CommanderInvestigationRecoveryContextCompatibility,
  continuityCompatibility: CommanderInvestigationRecoveryContinuityCompatibility,
  humanControl: CommanderInvestigationRecoveryHumanControl,
): string[] {
  return [
    ...toolCompatibility.blockers,
    ...providerCompatibility.blockers,
    ...budgetCompatibility.blockers,
    ...contextCompatibility.blockers,
    ...continuityCompatibility.blockers,
    ...humanControl.blockers,
  ].slice(0, 24)
}

function collectPreviewWarnings(
  toolCompatibility: CommanderInvestigationRecoveryToolCompatibilitySummary,
  providerCompatibility: CommanderInvestigationRecoveryProviderCompatibility,
  budgetCompatibility: CommanderInvestigationRecoveryBudgetCompatibility,
  contextCompatibility: CommanderInvestigationRecoveryContextCompatibility,
  continuityCompatibility: CommanderInvestigationRecoveryContinuityCompatibility,
  humanControl: CommanderInvestigationRecoveryHumanControl,
  hasPendingModelStep: boolean,
): string[] {
  return [
    ...toolCompatibility.warnings,
    ...providerCompatibility.warnings,
    ...budgetCompatibility.warnings,
    ...contextCompatibility.warnings,
    ...continuityCompatibility.warnings,
    ...humanControl.warnings,
    ...(hasPendingModelStep ? ["pending model-step outcome remains uncertain; external API audit counts do not resolve it"] : []),
  ].slice(0, 32)
}

function checkpointSummaryFrom(checkpoint: CommanderInvestigationCheckpoint): CommanderInvestigationRecoveryCheckpointSummary {
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    checkpoint_sequence: checkpoint.checkpoint_sequence,
    checkpoint_hash: checkpoint.checkpoint_hash,
    semantic_state_hash: checkpoint.semantic_state_hash,
    checkpoint_kind: checkpoint.checkpoint_kind,
    turn_index: checkpoint.turn_index,
    next_turn_index: checkpoint.next_turn_index,
    created_at: checkpoint.created_at,
    provider_request_count: checkpoint.provider_request_count,
    external_api_audit_count: checkpoint.external_api_audit_count,
    model_turn_count: checkpoint.working_set.model_turn_count,
    tool_call_count: checkpoint.working_set.tool_call_count,
    tool_search_call_count: checkpoint.working_set.tool_search_call_count,
    cumulative_tool_result_bytes: checkpoint.working_set.cumulative_tool_result_bytes,
    consecutive_no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns,
    loaded_tool_ids: checkpoint.loaded_tools.map((tool) => tool.tool_id).sort(),
    evidence_ids: checkpoint.working_set.evidence_cards.map((card) => card.evidence_id).slice(0, 24),
    evidence_count: checkpoint.working_set.evidence_cards.length + checkpoint.working_set.omitted_evidence_count,
    omitted_evidence_count: checkpoint.working_set.omitted_evidence_count,
    repeat_signature_count: checkpoint.working_set.recent_result_signatures.length,
    replay_protocol_available: Boolean(checkpoint.replay_exchange?.protocol_relationship_preserved),
    assistant_text_persisted: false,
    exact_replay_supported: false,
    full_tool_results_persisted: false,
  }
}

function pendingSummaryFrom(pending: NonNullable<CommanderInvestigationRecoverySource["pending_model_step"]>): CommanderInvestigationRecoveryPendingModelStep {
  return {
    model_request_id: pending.model_request_id,
    turn_index: pending.turn_index,
    started_at: pending.started_at,
    base_checkpoint_id: pending.base_checkpoint_id,
    base_checkpoint_sequence: pending.base_checkpoint_sequence,
    base_checkpoint_hash: pending.base_checkpoint_hash,
    working_set_hash: pending.working_set_hash,
    context_hash: pending.context_hash,
    input_bytes: pending.input_bytes,
    estimated_input_tokens: pending.estimated_input_tokens,
    provider_request_count_before: pending.provider_request_count_before,
    external_api_audit_count_before: pending.external_api_audit_count_before,
    loaded_tool_ids: pending.loaded_tool_refs.map((tool) => tool.tool_id).sort(),
    outcome: "uncertain",
    human_disposition_required: true,
    provider_request_may_have_been_sent: true,
    provider_response_available: false,
    tool_execution_known_to_have_occurred: false,
  }
}

function recoveryPendingPlanHash(pending: CommanderInvestigationRecoveryPendingModelStep): string {
  return stableHash({
    model_request_id: pending.model_request_id,
    turn_index: pending.turn_index,
    base_checkpoint_id: pending.base_checkpoint_id,
    base_checkpoint_sequence: pending.base_checkpoint_sequence,
    base_checkpoint_hash: pending.base_checkpoint_hash,
    working_set_hash: pending.working_set_hash,
    context_hash: pending.context_hash,
    input_bytes: pending.input_bytes,
    estimated_input_tokens: pending.estimated_input_tokens,
    provider_request_count_before: pending.provider_request_count_before,
    external_api_audit_count_before: pending.external_api_audit_count_before,
    loaded_tool_ids: pending.loaded_tool_ids,
    outcome: pending.outcome,
    human_disposition_required: pending.human_disposition_required,
    provider_request_may_have_been_sent: pending.provider_request_may_have_been_sent,
    provider_response_available: pending.provider_response_available,
    tool_execution_known_to_have_occurred: pending.tool_execution_known_to_have_occurred,
  })
}

function currentApprovalFor(
  source: CommanderInvestigationRecoverySource,
  planHash: string | undefined,
  packetHash: string | undefined,
  executionPreparationHash: string | undefined,
  firstModelRequestPreviewHash: string | undefined,
  recoveryKind: "none" | "checkpoint" | "uncertain_provider_outcome",
  checkpoint: CommanderInvestigationRecoveryCheckpointSummary | undefined,
  pending: CommanderInvestigationRecoveryPendingModelStep | undefined,
  compat: {
    toolCompatibility: CommanderInvestigationRecoveryToolCompatibilitySummary
    providerCompatibility: CommanderInvestigationRecoveryProviderCompatibility
    budgetCompatibility: CommanderInvestigationRecoveryBudgetCompatibility
    contextCompatibility: CommanderInvestigationRecoveryContextCompatibility
    continuityCompatibility: CommanderInvestigationRecoveryContinuityCompatibility
    humanControl: CommanderInvestigationRecoveryHumanControl
  } | undefined,
): { current?: NonNullable<CommanderInvestigationRecoverySource["latest_recovery_approval"]>; staleCount: number } {
  const approvals = source.recovery_approvals ?? []
  if (!planHash || !packetHash || !executionPreparationHash || !firstModelRequestPreviewHash || !source.recovery_basis_hash || recoveryKind === "none" || !checkpoint || !compat) return { staleCount: approvals.length }
  let current: NonNullable<CommanderInvestigationRecoverySource["latest_recovery_approval"]> | undefined
  let staleCount = 0
  for (const approval of approvals) {
    const decisionMatches = recoveryKind === "checkpoint"
      ? approval.decision === "approve_resume_from_checkpoint"
      : approval.decision === "approve_continue_after_uncertain_provider_outcome"
    const matches = decisionMatches &&
      approval.recovery_basis_hash === source.recovery_basis_hash &&
      approval.recovery_plan_hash === planHash &&
      approval.recovery_packet_hash === packetHash &&
      approval.execution_preparation_hash === executionPreparationHash &&
      approval.first_model_request_preview_hash === firstModelRequestPreviewHash &&
      approval.checkpoint_ref.checkpoint_id === checkpoint.checkpoint_id &&
      approval.checkpoint_ref.checkpoint_sequence === checkpoint.checkpoint_sequence &&
      approval.checkpoint_ref.checkpoint_hash === checkpoint.checkpoint_hash &&
      (pending ? approval.pending_model_request_id === pending.model_request_id : approval.pending_model_request_id === undefined) &&
      approval.provider_execution_envelope_hash === compat.providerCompatibility.execution_envelope?.execution_envelope_hash &&
      approval.tool_compatibility_hash === compat.toolCompatibility.compatibility_hash &&
      approval.provider_compatibility_hash === compat.providerCompatibility.compatibility_hash &&
      approval.budget_compatibility_hash === compat.budgetCompatibility.compatibility_hash &&
      approval.context_compatibility_hash === compat.contextCompatibility.compatibility_hash &&
      approval.continuity_compatibility_hash === compat.continuityCompatibility.compatibility_hash &&
      approval.human_control_compatibility_hash === compat.humanControl.compatibility_hash
    if (matches) {
      current = approval
    } else {
      staleCount += 1
    }
  }
  return { current, staleCount }
}

function finalizeHumanControl(input: Omit<CommanderInvestigationRecoveryHumanControl, "compatibility_hash">): CommanderInvestigationRecoveryHumanControl {
  const result = { ...input, compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function evidencePointer(card: CommanderInvestigationCheckpoint["working_set"]["evidence_cards"][number]) {
  return {
    evidence_id: bound(card.evidence_id, 160),
    tool_id: card.tool_id ? bound(card.tool_id, 120) : undefined,
    source_kind: bound(card.source_kind, 80),
    source_id: bound(card.source_id, 240),
    title: bound(card.title, 180),
    summary_preview: bound(card.summary_preview, 500),
    evidence_hash: card.evidence_hash ? bound(card.evidence_hash, 160) : undefined,
    source_refs: card.source_refs.map((ref) => ({
      source_kind: bound(ref.source_kind, 80),
      source_id: bound(ref.source_id, 240),
      label: ref.label ? bound(ref.label, 120) : undefined,
      summary_preview: ref.summary_preview ? bound(ref.summary_preview, 240) : undefined,
      pointer_only: true as const,
    })).slice(0, 8),
  }
}

function compactPacket(packet: CommanderInvestigationRecoveryPacket): CommanderInvestigationRecoveryPacket {
  let next = packet
  while (bytes(next) > PACKET_DEFAULT_CAP && next.execution_digests.length > 4) next = { ...next, execution_digests: next.execution_digests.slice(1) }
  while (bytes(next) > PACKET_DEFAULT_CAP && next.repeat_signatures.length > 8) next = { ...next, repeat_signatures: next.repeat_signatures.slice(1) }
  while (bytes(next) > PACKET_DEFAULT_CAP && next.warnings.length > 4) next = { ...next, warnings: next.warnings.slice(0, -1) }
  while (bytes(next) > PACKET_DEFAULT_CAP && next.evidence_pointers.length > 4) next = { ...next, evidence_pointers: next.evidence_pointers.slice(1) }
  return next
}

function emptyToolCompatibility(): CommanderInvestigationRecoveryToolCompatibilitySummary {
  const result = { tools: [], binding_count: 0, current_bound_tool_refs: [], stored_subset_of_current_bindings: true, compatible: false, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function emptyProviderCompatibility(): CommanderInvestigationRecoveryProviderCompatibility {
  const result = { provider_source: "none" as const, identity_match: false, phase_enabled: false, configuration_ready: false, execution_ready_now: false, commander_role_supported: false, stored_tool_protocol_supported: false, connector_available: false, credentials_ready: false, supports_streaming: false as const, compatible: false, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function emptyBudgetCompatibility(): CommanderInvestigationRecoveryBudgetCompatibility {
  const result = { stored_limits: {}, consumed: {}, stored_remaining: {}, current_policy_limits: {}, effective_remaining: {}, model_turns_remaining: 0, tool_calls_remaining: 0, tool_search_calls_remaining: 0, result_bytes_remaining: 0, wall_time_remaining_ms: 0, evidence_slots_remaining: 0, turn_summary_slots_remaining: 0, no_progress_count: 0, repeat_signature_count: 0, exhausted_dimensions: [], stricter_current_policy_dimensions: [], compatible: false, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function emptyContextCompatibility(): CommanderInvestigationRecoveryContextCompatibility {
  const result = { stored_checkpoint_bytes: 0, estimated_recovery_packet_bytes: 0, estimated_recovery_packet_tokens: 0, loaded_schema_bytes: 0, loaded_schema_tokens: 0, latest_protocol_summary_bytes: 0, evidence_summary_bytes: 0, current_bootstrap_bytes: 0, current_bootstrap_tokens: 0, within_current_context_budget: false, exact_replay_supported: false as const, fresh_context_required: true as const, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function emptyContinuityCompatibility(): CommanderInvestigationRecoveryContinuityCompatibility {
  const result = { current_bootstrap_ready: false, continuity_drift_detected: false, current_open_loop_count: 0, current_blocker_count: 0, current_bootstrap_bytes: 0, current_bootstrap_tokens: 0, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function bound(value: string, max: number): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, max)
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

export function isKnownCommanderRecoveryPhase(value: string): value is CommanderToolPhase {
  return (COMMANDER_TOOL_PHASES as readonly string[]).includes(value)
}
