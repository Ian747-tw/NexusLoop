import { redactText, redactValue } from "../security/redaction"
import type { CommanderToolDescriptor, CommanderToolPhase } from "../commander-tools/commander-tool-types"
import { COMMANDER_TOOL_PHASES } from "../commander-tools/commander-tool-registry"
import { stableHash } from "./commander-model-schema"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"
import type {
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
import type {
  CommanderInvestigationCheckpoint,
  CommanderInvestigationLoadedToolRef,
} from "./commander-investigation-journal-types"

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
    const checkpoint = source.latest_checkpoint
    if (!checkpoint || !source.normalized_input || !source.immutable_identity) {
      return this.withSource(source, "blocked", "none", "inspect_corrupt_record", undefined, undefined, undefined, undefined, ["ready journal did not expose an authoritative checkpoint/input source"], [], generatedAt)
    }

    const recoveryKind = source.pending_model_step ? "uncertain_provider_outcome" : "checkpoint"
    const checkpointSummary = checkpointSummaryFrom(checkpoint)
    const pending = source.pending_model_step ? pendingSummaryFrom(source.pending_model_step) : undefined
    const toolCompatibility = this.toolCompatibility(checkpoint.loaded_tools, checkpoint.phase)
    const providerCompatibility = this.providerCompatibility(source, checkpoint.phase)
    const budgetCompatibility = this.budgetCompatibility(checkpoint)
    const continuityCompatibility = await this.continuityCompatibility(source, checkpoint, validated.include_current_continuity !== false)
    const humanControl = await this.humanControl(checkpoint.phase, record.session_id, record.launch_id)
    const contextCompatibility = this.contextCompatibility(checkpoint, toolCompatibility, budgetCompatibility)
    let blockers = [
      ...toolCompatibility.blockers,
      ...providerCompatibility.blockers,
      ...budgetCompatibility.blockers,
      ...contextCompatibility.blockers,
      ...continuityCompatibility.blockers,
      ...humanControl.blockers,
    ].slice(0, 24)
    const warnings = [
      ...toolCompatibility.warnings,
      ...providerCompatibility.warnings,
      ...budgetCompatibility.warnings,
      ...contextCompatibility.warnings,
      ...continuityCompatibility.warnings,
      ...humanControl.warnings,
      ...(source.pending_model_step ? ["pending model-step outcome remains uncertain; external API audit counts do not resolve it"] : []),
    ].slice(0, 32)
    const packet = this.recoveryPacket(source, checkpoint, recoveryKind, budgetCompatibility, humanControl, continuityCompatibility, blockers, warnings)
    if (!packet) blockers = [...blockers, "recovery packet could not fit within the durable preview cap"].slice(0, 24)
    const humanReview = recoveryKind === "uncertain_provider_outcome" || humanControl.action === "human_review_required"
    const compatible = blockers.length === 0 && toolCompatibility.compatible && providerCompatibility.compatible && budgetCompatibility.compatible && contextCompatibility.within_current_context_budget && continuityCompatibility.current_bootstrap_ready
    const status = blockers.length ? "blocked" : humanReview ? "human_review_required" : compatible ? "ready_for_approval" : "blocked"
    const recommendedAction: CommanderInvestigationRecoveryRecommendedAction = recoveryKind === "uncertain_provider_outcome"
      ? blockers.length ? "reconfigure_runtime" : "review_uncertain_provider_outcome"
      : compatible
        ? "approve_resume_from_checkpoint"
        : providerCompatibility.blockers.length
          ? "reconfigure_runtime"
          : "inspect_corrupt_record"
    return this.withSource(source, status, recoveryKind, recommendedAction, checkpointSummary, pending, packet, {
      toolCompatibility,
      providerCompatibility,
      budgetCompatibility,
      contextCompatibility,
      continuityCompatibility,
      humanControl,
    }, blockers, warnings, generatedAt)
  }

  private toolCompatibility(stored: CommanderInvestigationLoadedToolRef[], phase: CommanderToolPhase): CommanderInvestigationRecoveryToolCompatibilitySummary {
    const tools = stored.map((ref) => this.oneToolCompatibility(ref, phase))
    const storedSubset = tools.every((tool) => tool.binding_present)
    const blockers = tools.flatMap((tool) => tool.blockers).slice(0, 24)
    const warnings = tools.flatMap((tool) => tool.warnings).slice(0, 16)
    const summary = {
      tools,
      binding_count: this.options.boundToolIds.length,
      stored_subset_of_current_bindings: storedSubset,
      compatible: blockers.length === 0 && tools.every((tool) => tool.compatible),
      blockers,
      warnings,
      compatibility_hash: "",
    }
    summary.compatibility_hash = stableHash({ ...summary, compatibility_hash: "" })
    return summary
  }

  private oneToolCompatibility(stored: CommanderInvestigationLoadedToolRef, phase: CommanderToolPhase): CommanderInvestigationRecoveryToolCompatibility {
    const current = this.options.descriptors.find((tool) => tool.tool_id === stored.tool_id)
    const bindingPresent = this.options.boundToolIds.includes(stored.tool_id)
    const fixedGitException = stored.tool_id === "repo.git_status" || stored.tool_id === "repo.git_diff"
    const implemented = current?.availability === "implemented_read_surface"
    const allowedInPhase = Boolean(current?.allowed_phases.includes(phase))
    const authorityMatch = Boolean(current && (current.authority_id ?? "") === stored.authority_id)
    const schemaMatch = Boolean(current && current.schema_metadata.input_schema_hash === stored.input_schema_hash && current.schema_metadata.output_schema_hash === stored.output_schema_hash)
    const descriptorMatch = Boolean(current && current.version === stored.descriptor_version && current.load_policy === stored.load_policy && current.trust_class === stored.trust_class && current.instruction_semantics === stored.instruction_semantics)
    const capabilityEnvelopeMatch = Boolean(current &&
      stored.namespace === current.namespace &&
      stored.risk === current.risk &&
      stored.side_effect_class === current.side_effect_class &&
      stored.execution_backend === current.execution_backend &&
      stored.process_policy === current.process_policy &&
      stored.creates_external_process === current.creates_external_process &&
      stored.calls_provider === current.calls_provider &&
      stored.mutates_events === current.mutates_events &&
      stored.requires_network === current.requires_network &&
      stored.requires_credentials === current.requires_credentials &&
      stored.requires_approval === current.requires_approval &&
      stored.requires_run_lock === current.requires_run_lock)
    const safeReadAuthority = Boolean(current && current.risk === "safe_read" && (current.side_effect_class === "none" || current.side_effect_class === "internal_read") && !current.mutates_events && !current.calls_provider && !current.requires_network && !current.requires_credentials && !current.requires_approval && !current.requires_run_lock && (!current.creates_external_process || fixedGitException && current.execution_backend === "restricted_git_read" && current.process_policy === "fixed_git_read_only"))
    const blockers: string[] = []
    if (!current) blockers.push(`stored loaded tool ${stored.tool_id} no longer has a descriptor`)
    if (!bindingPresent) blockers.push(`stored loaded tool ${stored.tool_id} is not in the current Commander binding allowlist`)
    if (current && !implemented) blockers.push(`stored loaded tool ${stored.tool_id} is not an implemented read surface`)
    if (current && !allowedInPhase) blockers.push(`stored loaded tool ${stored.tool_id} is no longer allowed in phase ${phase}`)
    if (current && !authorityMatch) blockers.push(`stored loaded tool ${stored.tool_id} authority_id changed`)
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
      stored_input_schema_hash: stored.input_schema_hash,
      current_input_schema_hash: current?.schema_metadata.input_schema_hash,
      stored_output_schema_hash: stored.output_schema_hash,
      current_output_schema_hash: current?.schema_metadata.output_schema_hash,
      stored_load_policy: stored.load_policy,
      current_load_policy: current?.load_policy,
      stored_trust_class: stored.trust_class,
      current_trust_class: current?.trust_class,
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
      compatible: blockers.length === 0 && readiness.configuration_ready && identityMatch && phaseEnabled && commanderRole && protocolSupported && providerSource === "configured_connector",
      blockers,
      warnings,
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
    return result
  }

  private budgetCompatibility(checkpoint: CommanderInvestigationCheckpoint): CommanderInvestigationRecoveryBudgetCompatibility {
    const stored = checkpoint.budget
    const profile = this.options.currentProfile({ phase: checkpoint.phase })
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
      no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns,
    }
    const currentLimits = {
      max_model_turns: Math.min(stored.max_model_turns, Math.max(4, Math.ceil(profile.max_tool_calls_future / 2) + profile.max_tool_search_calls_future + 2)),
      max_tool_calls: Math.min(stored.max_tool_calls, profile.max_tool_calls_future),
      max_tool_search_calls: Math.min(stored.max_tool_search_calls, profile.max_tool_search_calls_future),
      max_loaded_schemas: Math.min(stored.max_loaded_schemas, profile.max_loaded_schemas),
      max_cumulative_tool_result_bytes: Math.min(stored.max_cumulative_tool_result_bytes, profile.max_cumulative_result_bytes_future),
      max_wall_time_ms: Math.min(stored.max_wall_time_ms, profile.max_wall_time_ms_future),
      max_consecutive_no_progress_turns: stored.max_consecutive_no_progress_turns,
      max_evidence_cards: stored.max_evidence_cards,
      max_turn_summaries: stored.max_turn_summaries,
    }
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
    const exhausted = Object.entries(effective).filter(([key, value]) => value <= 0 && !optionalDimensions.has(key)).map(([key]) => key)
    if (effective.loaded_schemas < 0) exhausted.push("loaded_schemas")
    const stricter = Object.entries(currentLimits).filter(([key, value]) => {
      const storedValue = (stored as unknown as Record<string, number>)[key]
      return typeof storedValue === "number" && typeof value === "number" && value < storedValue
    }).map(([key]) => key)
    const blockers = exhausted.map((dimension) => `remaining recovery budget exhausted for ${dimension}`).slice(0, 12)
    const result = {
      stored_budget_id: stored.budget_id,
      stored_budget_hash: stored.budget_hash,
      current_profile_id: profile.profile_id,
      current_context_budget_id: stored.source_context_budget_id,
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
      warnings: stricter.map((dimension) => `current phase profile is stricter for ${dimension}`).slice(0, 12),
      compatibility_hash: "",
    }
    result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
    return result
  }

  private contextCompatibility(checkpoint: CommanderInvestigationCheckpoint, tools: CommanderInvestigationRecoveryToolCompatibilitySummary, budget: CommanderInvestigationRecoveryBudgetCompatibility): CommanderInvestigationRecoveryContextCompatibility {
    const capability = this.options.modelCapability({ provider_kind: checkpoint.provider_kind, model_id: checkpoint.model_id, role: "commander" })
    const loadedSchemaBytes = tools.tools.reduce((sum, tool) => {
      const descriptor = this.options.descriptors.find((candidate) => candidate.tool_id === tool.tool_id)
      return sum + (descriptor?.schema_metadata.input_schema_bytes ?? 0) + (descriptor?.schema_metadata.output_schema_bytes ?? 0)
    }, 0)
    const loadedSchemaTokens = tools.tools.reduce((sum, tool) => {
      const descriptor = this.options.descriptors.find((candidate) => candidate.tool_id === tool.tool_id)
      return sum + (descriptor?.schema_metadata.estimated_schema_tokens ?? 0)
    }, 0)
    const latestBytes = checkpoint.replay_exchange ? bytes(checkpoint.replay_exchange) : 0
    const evidenceBytes = bytes(checkpoint.working_set.evidence_cards.map((card) => ({ evidence_id: card.evidence_id, title: card.title, summary_preview: card.summary_preview })))
    const packetBytes = bytes({
      identity: checkpoint.investigation_id,
      loaded_tools: checkpoint.loaded_tools,
      evidence: checkpoint.working_set.evidence_cards,
      digests: checkpoint.working_set.recent_execution_digests,
    })
    const storedMaxContextBytes = checkpoint.budget.max_context_bytes ?? 65_536
    const currentMaxContextBytes = Math.min(storedMaxContextBytes, capability.max_context_bytes ?? storedMaxContextBytes)
    const currentMaxContextTokens = capability.max_context_tokens
    const estimatedBytes = packetBytes + loadedSchemaBytes + latestBytes + evidenceBytes
    const estimatedTokens = Math.ceil(packetBytes / 4) + loadedSchemaTokens + Math.ceil((latestBytes + evidenceBytes) / 4)
    const blockers = [
      ...(estimatedBytes > currentMaxContextBytes ? ["estimated recovery context exceeds current model context byte budget"] : []),
      ...(currentMaxContextTokens !== undefined && estimatedTokens > currentMaxContextTokens ? ["estimated recovery context exceeds current model context token budget"] : []),
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

  private async continuityCompatibility(source: CommanderInvestigationRecoverySource, checkpoint: CommanderInvestigationCheckpoint, include: boolean): Promise<CommanderInvestigationRecoveryContinuityCompatibility> {
    const blockers: string[] = []
    const warnings: string[] = []
    let current
    if (!include) {
      warnings.push("current continuity was not assessed")
      if (checkpoint.phase === "mid_mission_supervision") blockers.push("mid-mission recovery requires current continuity assessment")
    } else if (source.normalized_input) {
      try {
        current = await this.options.currentBootstrap(source.normalized_input)
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
      current_bootstrap_ready: Boolean(current && blockers.length === 0),
      continuity_drift_detected: drift,
      current_readiness: current?.readiness,
      current_open_loop_count: current?.open_loops.length ?? 0,
      current_blocker_count: current?.blockers.length ?? blockers.length,
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

  private recoveryPacket(source: CommanderInvestigationRecoverySource, checkpoint: CommanderInvestigationCheckpoint, recoveryKind: "checkpoint" | "uncertain_provider_outcome", budget: CommanderInvestigationRecoveryBudgetCompatibility, human: CommanderInvestigationRecoveryHumanControl, continuity: CommanderInvestigationRecoveryContinuityCompatibility, blockers: string[], warnings: string[]): CommanderInvestigationRecoveryPacket | undefined {
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
  ): CommanderInvestigationRecoveryPreview {
    const record = source.record
    const preview = {
      preview_id: `commander_recovery_preview_${stableHash({ source: source.source_hash, generated_at: generatedAt }).slice(0, 16)}`,
      preview_version: 1 as const,
      status,
      recovery_kind: recoveryKind,
      recommended_action: action,
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
      automatic_resume_allowed: false as const,
      human_approval_required: status === "ready_for_approval" || status === "human_review_required",
      exact_replay_supported: false as const,
      original_assistant_text_available: false as const,
      provider_request_replay_allowed: false as const,
      tool_execution_replay_allowed: false as const,
      fresh_context_required: true as const,
      same_journal_resume_candidate: status === "ready_for_approval" || status === "human_review_required",
      terminal_continuation_requires_new_investigation: record?.status !== undefined && record.status !== "running",
      recovery_plan_hash: packet ? stableHash({
        record_hash: record?.record_hash,
        checkpoint_hash: checkpoint?.checkpoint_hash,
        pending_model_request_id: pending?.model_request_id,
        tool: compat?.toolCompatibility.compatibility_hash,
        provider: compat?.providerCompatibility.compatibility_hash,
        budget: compat?.budgetCompatibility.compatibility_hash,
        continuity: compat?.continuityCompatibility.compatibility_hash,
        human: compat?.humanControl.compatibility_hash,
        packet: packet.packet_hash,
        recoveryKind,
        action,
      }) : undefined,
      blockers: blockers.map((item) => bound(item, 240)).slice(0, 24),
      warnings: warnings.map((item) => bound(item, 240)).slice(0, 32),
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
  const result = { tools: [], binding_count: 0, stored_subset_of_current_bindings: true, compatible: false, blockers: [], warnings: [], compatibility_hash: "" }
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
  const result = { stored_checkpoint_bytes: 0, estimated_recovery_packet_bytes: 0, estimated_recovery_packet_tokens: 0, loaded_schema_bytes: 0, loaded_schema_tokens: 0, latest_protocol_summary_bytes: 0, evidence_summary_bytes: 0, within_current_context_budget: false, exact_replay_supported: false as const, fresh_context_required: true as const, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function emptyContinuityCompatibility(): CommanderInvestigationRecoveryContinuityCompatibility {
  const result = { current_bootstrap_ready: false, continuity_drift_detected: false, current_open_loop_count: 0, current_blocker_count: 0, blockers: [], warnings: [], compatibility_hash: "" }
  result.compatibility_hash = stableHash({ ...result, compatibility_hash: "" })
  return result
}

function bound(value: string, max: number): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, max)
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

export function isKnownCommanderRecoveryPhase(value: string): value is CommanderToolPhase {
  return (COMMANDER_TOOL_PHASES as readonly string[]).includes(value)
}
