import { createHash } from "node:crypto"
import type { ContextBudgetService } from "../context/context-budget-service"
import type { CommanderContinuityService } from "../continuity/commander-continuity-service"
import type { CommanderMidMissionContinuityPacket, CommanderContinuitySourceRef } from "../continuity/commander-continuity-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchReadinessService } from "./opencode-launch-readiness-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeSessionInstructionPackService } from "./opencode-session-instruction-pack-service"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  OpenCodeContinuationInput,
  OpenCodeContinuationPacket,
  OpenCodeContinuityBudget,
  OpenCodeContinuityDelta,
  OpenCodeContinuityMode,
  OpenCodeContinuitySection,
  OpenCodeContinuitySourceRef,
  OpenCodeSessionContinuityInput,
  OpenCodeSessionContinuityPacket,
} from "./opencode-session-continuity-types"

const ACTIVE_LAUNCH_STATUSES = new Set(["launch_started", "launched"])
const MAX_TEXT = 420
const MAX_REFS = 48
const MAX_DELTA_IDS = 5
const EXECUTOR_SOURCE_KINDS = new Set([
  "opencode_session", "opencode_launch", "opencode_progress", "opencode_watchdog",
  "commander_question", "commander_guidance", "guidance_delivery", "human_control",
  "wake_supervisor", "wake_supervisor_execution", "wake_action_execution", "result_report",
  "result_review", "research_ingestion", "research_memory",
])

export type PreviousRefreshSnapshot = {
  refresh_id: string
  packet_hash: string
  refresh_hash: string
  target_session_id: string
  continuity_mode: string
  source_refs: OpenCodeContinuitySourceRef[]
  section_hashes?: Record<string, string>
  base_pack_hash?: string
}

export type OpenCodeSessionContinuityServiceOptions = {
  sessionService: OpenCodeSessionService
  launchService: OpenCodeLaunchGateService
  launchReadinessService: OpenCodeLaunchReadinessService
  instructionPackService: OpenCodeSessionInstructionPackService
  commanderContinuityService: CommanderContinuityService
  contextBudgetService: ContextBudgetService
  previousRefresh: (refreshId: string) => Promise<PreviousRefreshSnapshot | null>
  latestRefresh: (sessionId: string) => Promise<PreviousRefreshSnapshot | null>
  now?: () => Date
}

export class OpenCodeSessionContinuityService {
  private readonly now: () => Date

  constructor(private readonly options: OpenCodeSessionContinuityServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async session(input: OpenCodeSessionContinuityInput = {}): Promise<OpenCodeSessionContinuityPacket> {
    const resolved = await this.resolveBase(input.session_id, input.launch_id)
    return this.compileSession(input, resolved)
  }

  async continuation(input: OpenCodeContinuationInput = {}): Promise<OpenCodeContinuationPacket> {
    const mode = readMode(input.continuity_mode)
    const sourceSessionId = bound(input.source_session_id ?? "", 120)
    const requestedTargetSessionId = bound(input.target_session_id ?? "", 120)
    const sameSessionMode = mode === "continue_same_session" || mode === "patch_session"
    const targetSessionId = mode === "fork_from_session" ? requestedTargetSessionId : sameSessionMode ? sourceSessionId : bound(requestedTargetSessionId || sourceSessionId, 120)
    const base = await this.resolveBase(sourceSessionId, input.source_launch_id)
    const blockers = [...base.blockers]
    const warnings = [...base.warnings]
    if (!sourceSessionId) blockers.push("source_session_id is required")
    if (input.continuity_mode && !["continue_same_session", "fork_from_session", "patch_session", "resume_from_checkpoint"].includes(input.continuity_mode)) blockers.push("continuity_mode is unsupported")
    if (!input.continuity_mode || input.continuity_mode === "active_refresh") blockers.push("continuation_mode must be continue_same_session, fork_from_session, patch_session, or resume_from_checkpoint")
    if (sameSessionMode && requestedTargetSessionId && requestedTargetSessionId !== sourceSessionId) blockers.push(`${mode} target_session_id must match source_session_id`)
    const reason = bound(input.continuation_reason ?? input.patch_reason ?? input.fork_reason ?? "")
    if (mode === "continue_same_session" && !reason) blockers.push("continuation_reason is required")
    if (mode === "patch_session" && !bound(input.patch_reason ?? "")) blockers.push("patch_reason is required")
    if (mode === "fork_from_session" && !bound(input.fork_reason ?? "")) blockers.push("fork_reason is required")
    if (mode === "resume_from_checkpoint" && !bound(input.checkpoint_id ?? "")) blockers.push("checkpoint_id is required")
    if (mode === "resume_from_checkpoint") {
      blockers.push("checkpoint-to-OpenCode continuity binding is future 9W/9X work")
      warnings.push("checkpoint contents were not read or restored")
    }
    let targetPack = base.pack
    if (mode === "fork_from_session") {
      if (!targetSessionId) warnings.push("target_session_id is required for a non-dry fork refresh write")
      if (targetSessionId && targetSessionId === sourceSessionId) blockers.push("fork target_session_id must differ from source_session_id")
      if (targetSessionId) {
        const targetSession = await this.options.sessionService.get(targetSessionId)
        if (!targetSession) blockers.push("target session does not resolve")
        const packs = await this.options.instructionPackService.list({ session_id: targetSessionId, limit: 1, status: "written" })
        targetPack = packs[0] ? await this.options.instructionPackService.get(packs[0].pack_id) : null
        if (!targetPack) warnings.push("target session needs its own written base instruction pack before artifact write")
      }
    }
    const packet = await this.compileSession({
      session_id: sourceSessionId,
      launch_id: input.source_launch_id,
      previous_refresh_id: input.previous_refresh_id,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      max_context_tokens: input.max_context_tokens,
      max_context_bytes: input.max_context_bytes,
      research_memory_mode: input.research_memory_mode,
      max_progress_items: input.max_progress_items,
      max_research_candidates: input.max_research_candidates,
    }, base)
    blockers.push(...packet.blockers)
    warnings.push(...packet.warnings)
    if ((mode === "continue_same_session" || mode === "patch_session") && !base.launch?.native_session_id) warnings.push("native_session_id is missing; artifact compilation remains available but native continuation is not ready")
    const readiness = blockers.length ? (mode === "resume_from_checkpoint" ? "needs_checkpoint_binding" : "blocked") : mode === "fork_from_session" && !targetSessionId ? "needs_target_session" : packet.continuity_readiness
    const sections = [
      ...packet.sections,
      makeSection("continuation_lineage", "high", [
        `mode=${mode}`,
        `source_session=${sourceSessionId || "missing"}`,
        `target_session=${targetSessionId || "not selected"}`,
        `reason=${reason || "missing"}`,
        `preserve=${boundedArray(input.preserve).join(", ") || "latest bounded snapshot"}`,
        `discard=${boundedArray(input.discard).join(", ") || "raw history"}`,
      ].join("; "), [], []),
    ]
    const packetHash = hash(stableJson({
      mode,
      sourceSessionId,
      targetSessionId,
      reason,
      checkpoint: input.checkpoint_id,
      preserve: boundedArray(input.preserve),
      discard: boundedArray(input.discard),
      objective_delta: bound(input.objective_delta ?? ""),
      source: packet.packet_hash,
      targetPack: targetPack?.pack_hash,
    }))
    return redactValue({
      packet_id: `opencode_continuation_${packetHash.slice(0, 20)}`,
      packet_kind: "continuation",
      continuity_mode: mode,
      status: blockers.length ? "blocked" : "ready",
      continuity_readiness: readiness,
      consumption_status: "not_delivered",
      source_session_id: sourceSessionId,
      source_launch_id: base.launch?.launch_id,
      source_native_session_id: base.launch?.native_session_id,
      target_session_id: targetSessionId || undefined,
      checkpoint_id: bound(input.checkpoint_id ?? "") || undefined,
      continuation_reason_preview: reason,
      patch_reason_preview: bound(input.patch_reason ?? "") || undefined,
      fork_reason_preview: bound(input.fork_reason ?? "") || undefined,
      parent_child_summary: mode === "fork_from_session" ? `${sourceSessionId} -> ${targetSessionId || "unselected target"}` : `${sourceSessionId} remains the target session`,
      preserve_summary: boundedArray(input.preserve).length ? boundedArray(input.preserve) : ["immutable base pack", "latest bounded tactical snapshot", "durable source refs"],
      discard_summary: boundedArray(input.discard).length ? boundedArray(input.discard) : ["raw transcript", "raw logs", "full event history"],
      objective_delta_preview: bound(input.objective_delta ?? "") || undefined,
      base_pack_id: base.pack?.pack_id,
      base_pack_hash: base.pack?.pack_hash,
      target_base_pack_id: targetPack?.pack_id,
      target_base_pack_hash: targetPack?.pack_hash,
      previous_refresh_id: packet.previous_refresh_id,
      sections,
      delta: packet.delta,
      source_refs: packet.source_refs,
      blockers: unique(blockers),
      warnings: unique(warnings),
      recommended_commands: packet.recommended_commands,
      budget: packet.budget,
      generated_at: this.now().toISOString(),
      redacted_summary_preview: blockers[0] ?? `${mode} continuity artifact preview for ${sourceSessionId}`,
      packet_hash: packetHash,
      ...safetyFlags(),
    }) as OpenCodeContinuationPacket
  }

  private async resolveBase(sessionIdInput?: string, launchIdInput?: string) {
    const blockers: string[] = []
    const warnings = ["native_session_id is pointer evidence only; no native attachment or liveness verification occurred"]
    if (!sessionIdInput && !launchIdInput) blockers.push("session_id or launch_id is required")
    const launchById = launchIdInput ? await this.options.launchService.get(launchIdInput) : null
    if (launchIdInput && !launchById) blockers.push("launch_id does not resolve")
    const sessionId = bound(sessionIdInput ?? launchById?.session_id ?? "", 120)
    const session = sessionId ? await this.options.sessionService.get(sessionId) : null
    if (sessionId && !session) blockers.push("session_id does not resolve")
    const launch = launchById ?? (sessionId ? await latestActiveLaunch(this.options.launchService, sessionId) : null)
    if (!launch && sessionId) blockers.push("active session continuity requires a launch_started or launched record")
    if (launch && !ACTIVE_LAUNCH_STATUSES.has(launch.status)) blockers.push(`active session continuity requires launch_started or launched; current status is ${launch.status}`)
    if (launch && sessionIdInput && launch.session_id !== sessionIdInput) blockers.push("launch_id does not belong to session_id")
    const pack = launch?.pack_id ? await this.options.instructionPackService.get(launch.pack_id) : null
    if (!launch?.pack_id) blockers.push("launch record does not anchor a base instruction pack")
    if (launch?.pack_id && !pack) blockers.push("base instruction pack does not resolve")
    if (pack && pack.session_id !== sessionId) blockers.push("launch pack does not belong to session")
    if (sessionId && launch?.pack_id && pack) {
      const readiness = await this.options.launchReadinessService.preview({ session_id: sessionId, pack_id: launch.pack_id })
      if (!readiness.instruction_files_verified || !readiness.manifest_verified || !readiness.config_verified) blockers.push("base instruction pack on-disk integrity verification failed")
    }
    return { sessionId, session, launch, pack, blockers, warnings }
  }

  private async compileSession(input: OpenCodeSessionContinuityInput, base: Awaited<ReturnType<OpenCodeSessionContinuityService["resolveBase"]>>): Promise<OpenCodeSessionContinuityPacket> {
    const generatedAt = this.now().toISOString()
    const blockers = [...base.blockers]
    const warnings = [...base.warnings]
    const mode = readResearchMode(input.research_memory_mode)
    const mid = base.sessionId ? await this.options.commanderContinuityService.midMission({
      session_id: base.sessionId,
      launch_id: base.launch?.launch_id,
      include_research_memory: mode === "include" ? true : mode === "omit" ? false : undefined,
      include_open_loops: true,
      include_local_working_memory: true,
      max_open_loops: clamp(input.max_open_loops, 12, 1, 30),
      max_research_candidates: clamp(input.max_research_candidates, 3, 1, 3),
      target_token_budget: clamp(input.max_context_tokens, 4000, 1000, 128000),
      model_id: input.model_id,
    }) : emptyMid()
    blockers.push(...mid.blockers)
    for (const warning of mid.warnings) {
      if (/operator_handoff|session-scoped|FTS|lexical|research memory/i.test(warning)) warnings.push(warning)
    }
    const refs = mid.source_refs.filter((item) => EXECUTOR_SOURCE_KINDS.has(item.source_kind)).slice(0, MAX_REFS).map(toRef)
    const includeResearchAuto = mode === "auto" && (mid.open_loops.some((loop) => loop.loop_kind === "pending_commander_question" || loop.loop_kind === "watchdog_timed_out") || /blocker|question/i.test(mid.latest_progress_summary))
    if (mode === "omit" || (mode === "auto" && !includeResearchAuto)) warnings.push("research memory omitted to save tokens; tactical state did not require bounded retrieval")
    const budgetPreview = await this.options.contextBudgetService.preview({
      purpose: "opencode_executor_session",
      role: "executor",
      session_id: base.sessionId || undefined,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      max_context_tokens: input.max_context_tokens,
      max_context_bytes: input.max_context_bytes,
    })
    blockers.push(...budgetPreview.blockers)
    const previous = await this.resolvePrevious(input.previous_refresh_id, base.sessionId)
    if (previous.error) blockers.push(previous.error)
    const sections = executorSections(base, mid, refs, mode, includeResearchAuto)
    const budget = applyBudget(sections, budgetPreview.budget)
    const delta = buildContinuityDelta(refs, sections, previous.snapshot)
    const humanBlocked = mid.open_loops.some((loop) => loop.loop_kind === "human_stop" || loop.loop_kind === "human_pause")
    const readiness = blockers.length ? "blocked" : humanBlocked ? "needs_human_review" : base.launch?.native_session_id ? "ready_for_artifact" : "needs_native_session_id"
    const packetHash = hash(stableJson({ session: base.sessionId, launch: base.launch?.launch_id, pack: base.pack?.pack_hash, refs: refs.map((item) => [item.source_kind, item.source_id, item.status]), delta: delta.delta_hash, sections: sections.map((item) => [item.section_kind, item.summary_preview]), budget: budget.budget_id }))
    return redactValue({
      packet_id: `opencode_continuity_${packetHash.slice(0, 20)}`,
      packet_kind: "session_refresh",
      continuity_mode: "active_refresh",
      status: blockers.length ? "blocked" : refs.length ? "ready" : "partial",
      continuity_readiness: readiness,
      consumption_status: "not_delivered",
      source_session_id: base.sessionId,
      target_session_id: base.sessionId,
      launch_id: base.launch?.launch_id,
      native_session_id: base.launch?.native_session_id,
      native_session_link_status: base.launch?.native_session_id ? "linked" : "missing",
      base_pack_id: base.pack?.pack_id,
      base_pack_hash: base.pack?.pack_hash,
      base_context_packet_id: base.pack?.packet_id,
      base_context_packet_hash: base.pack?.packet_hash,
      previous_refresh_id: previous.snapshot?.refresh_id,
      previous_refresh_hash: previous.snapshot?.refresh_hash,
      context_strategy: "immutable_base_plus_latest_snapshot_and_delta",
      objective_preview: bound(base.session?.objective ?? ""),
      current_task_preview: bound(base.session?.opencode_context_seed ?? base.session?.objective ?? ""),
      success_criteria: boundedArray(base.session?.success_criteria),
      constraints: boundedArray(base.session?.constraints),
      latest_progress_summary: mid.latest_progress_summary,
      current_blocker_summary: mid.open_loops.find((loop) => loop.blocking)?.summary_preview,
      pending_question_count: refs.filter((item) => item.source_kind === "commander_question" && /pending/i.test(item.status ?? "")).length,
      pending_guidance_count: refs.filter((item) => item.source_kind === "commander_guidance" && /not_delivered|pending/i.test(item.status ?? "")).length,
      pending_delivery_count: refs.filter((item) => item.source_kind === "guidance_delivery" && /pending/i.test(item.status ?? "")).length,
      latest_human_control_state: mid.human_control_summary,
      watchdog_status: mid.watchdog_summary,
      wake_status: mid.wake_supervision_summary,
      result_state: mid.result_state_summary,
      research_memory_mode: mode,
      sections,
      delta,
      source_refs: refs,
      blockers: unique(blockers),
      warnings: unique(warnings),
      recommended_commands: continuityCommands(base.sessionId),
      budget,
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `Executor-safe continuity snapshot for ${base.sessionId}; consumption_status=not_delivered`,
      packet_hash: packetHash,
      ...safetyFlags(),
    }) as OpenCodeSessionContinuityPacket
  }

  private async resolvePrevious(explicitId: string | undefined, sessionId: string): Promise<{ snapshot: PreviousRefreshSnapshot | null; error?: string }> {
    const snapshot = explicitId ? await this.options.previousRefresh(explicitId) : sessionId ? await this.options.latestRefresh(sessionId) : null
    if (explicitId && !snapshot) return { snapshot: null, error: "previous_refresh_id does not resolve" }
    if (snapshot && snapshot.target_session_id !== sessionId) return { snapshot, error: "previous refresh belongs to another target session" }
    return { snapshot }
  }
}

export function readOpenCodeSessionContinuityInput(value: unknown): OpenCodeSessionContinuityInput {
  const input = isRecord(value) ? value : {}
  return { session_id: optional(input.sessionId ?? input.session_id ?? input.session), launch_id: optional(input.launchId ?? input.launch_id ?? input.launch), previous_refresh_id: optional(input.previousRefreshId ?? input.previousRefresh ?? input.previous_refresh_id ?? input.previous_refresh), provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider), model_id: optional(input.modelId ?? input.model_id ?? input.model), max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens), max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes), research_memory_mode: readResearchMode(input.researchMemoryMode ?? input.research_memory_mode ?? input.research_memory), max_progress_items: optionalNumber(input.maxProgressItems ?? input.max_progress_items ?? input.max_progress), max_open_loops: optionalNumber(input.maxOpenLoops ?? input.max_open_loops), max_research_candidates: optionalNumber(input.maxResearchCandidates ?? input.max_research_candidates) }
}

export function readOpenCodeContinuationInput(value: unknown): OpenCodeContinuationInput {
  const input = isRecord(value) ? value : {}
  return { source_session_id: optional(input.sourceSessionId ?? input.sourceSession ?? input.source_session_id ?? input.source_session), source_launch_id: optional(input.sourceLaunchId ?? input.sourceLaunch ?? input.source_launch_id ?? input.source_launch), target_session_id: optional(input.targetSessionId ?? input.targetSession ?? input.target_session_id ?? input.target_session), continuity_mode: optional(input.continuityMode ?? input.continuity_mode ?? input.mode), continuation_reason: optional(input.continuationReason ?? input.continuation_reason ?? input.reason), patch_reason: optional(input.patchReason ?? input.patch_reason), fork_reason: optional(input.forkReason ?? input.fork_reason), checkpoint_id: optional(input.checkpointId ?? input.checkpoint_id ?? input.checkpoint), previous_refresh_id: optional(input.previousRefreshId ?? input.previousRefresh ?? input.previous_refresh_id ?? input.previous_refresh), preserve: readArray(input.preserve), discard: readArray(input.discard), objective_delta: optional(input.objectiveDelta ?? input.objective_delta), provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider), model_id: optional(input.modelId ?? input.model_id ?? input.model), max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens), max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes), research_memory_mode: readResearchMode(input.researchMemoryMode ?? input.research_memory_mode ?? input.research_memory), max_progress_items: optionalNumber(input.maxProgressItems ?? input.max_progress_items ?? input.max_progress), max_research_candidates: optionalNumber(input.maxResearchCandidates ?? input.max_research_candidates) }
}

function executorSections(base: any, mid: CommanderMidMissionContinuityPacket, refs: OpenCodeContinuitySourceRef[], researchMode: string, includeResearchAuto: boolean): OpenCodeContinuitySection[] {
  const select = (...kinds: string[]) => refs.filter((item) => kinds.includes(item.source_kind))
  return [
    makeSection("authority_boundary", "required", "OpenCode is tactical executor; Commander owns strategy; runtime owns durable authority and gates.", [], []),
    makeSection("session_identity", "required", `session=${base.sessionId}; launch=${base.launch?.launch_id ?? "missing"}; native_session=${base.launch?.native_session_id ?? "missing"}; base_pack=${base.pack?.pack_id ?? "missing"}`, select("opencode_session", "opencode_launch"), []),
    makeSection("tactical_objective", "required", `${base.session?.objective ?? "missing objective"}; success=${(base.session?.success_criteria ?? []).join("; ")}; constraints=${(base.session?.constraints ?? []).join("; ")}`, select("opencode_session"), []),
    makeSection("current_execution_state", "high", mid.latest_progress_summary, select("opencode_progress"), []),
    makeSection("recent_attempts", "medium", mid.local_session_working_memory_summary, select("opencode_progress", "result_report"), []),
    makeSection("pending_questions", "high", mid.commander_dialogue_summary, select("commander_question"), []),
    makeSection("commander_guidance", "high", mid.guidance_delivery_summary, select("commander_guidance", "guidance_delivery"), /pending|operator_handoff/i.test(mid.guidance_delivery_summary) ? ["Guidance metadata exists, but OpenCode receipt is not proven."] : []),
    makeSection("human_controls", "required", mid.human_control_summary, select("human_control"), []),
    makeSection("watchdog_and_wake", "high", `${mid.watchdog_summary}; ${mid.wake_supervision_summary}`, select("opencode_watchdog", "wake_supervisor", "wake_supervisor_execution", "wake_action_execution"), []),
    makeSection("result_state", "medium", mid.result_state_summary, select("result_report", "result_review", "research_ingestion"), ["result-review acceptance is evidence disposition, not mission completion"]),
    makeSection("relevant_files_tests_artifacts", "medium", "Only bounded file/test/artifact claims from durable progress and result refs are included; contents and diffs are excluded.", select("opencode_progress", "result_report"), []),
    makeSection("research_memory_advisory", "low", researchMode === "omit" || (researchMode === "auto" && !includeResearchAuto) ? "omitted to save tokens" : (mid.research_memory_summary ?? "bounded research memory unavailable"), select("research_memory"), ["research memory is advisory; missing matches do not prove novelty"]),
    makeSection("omitted_raw_content", "excluded", "Raw OpenCode transcripts, logs, diffs, file contents, event history, Commander chat, provider output, and full research.db are excluded.", [], []),
  ]
}

function makeSection(kind: string, priority: OpenCodeContinuitySection["priority"], summary: string, refs: OpenCodeContinuitySourceRef[], warnings: string[]): OpenCodeContinuitySection {
  const bounded = bound(summary)
  const bytes = Buffer.byteLength(bounded, "utf8")
  return { section_id: `continuity_section_${hash(kind).slice(0, 12)}`, section_kind: kind, status: priority === "excluded" ? "excluded" : refs.length ? "included" : kind === "authority_boundary" || kind === "tactical_objective" || kind === "omitted_raw_content" ? "included" : "missing", priority, summary_preview: bounded, item_count: refs.length, omitted_count: 0, estimated_tokens: Math.ceil(bytes / 4), estimated_bytes: bytes, source_refs: refs.slice(0, 8), warnings: warnings.map((item) => bound(item)).slice(0, 4) }
}

function applyBudget(sections: OpenCodeContinuitySection[], profile: any): OpenCodeContinuityBudget {
  const maxTokens = profile.max_context_tokens
  const maxBytes = profile.max_context_bytes
  let estimatedBytes = sections.reduce((sum, item) => sum + item.estimated_bytes, 0)
  let estimatedTokens = Math.ceil(estimatedBytes / 4)
  const omitted: string[] = []
  const warnings: string[] = []
  const optional = sections.filter((item) => ["low", "medium"].includes(item.priority)).reverse()
  for (const section of optional) {
    if ((maxTokens && estimatedTokens > Math.max(0, maxTokens - (profile.max_output_tokens ?? 0) - (profile.safety_margin_tokens ?? 0))) || (maxBytes && estimatedBytes > Math.max(0, maxBytes - (profile.safety_margin_bytes ?? 0)))) {
      section.status = "omitted"
      omitted.push(section.section_kind)
      estimatedBytes -= section.estimated_bytes
      estimatedTokens = Math.ceil(estimatedBytes / 4)
      warnings.push(`${section.section_kind} omitted to preserve required executor context`)
    }
  }
  const sectionBudgets = Object.fromEntries((profile.allocations ?? []).map((item: any) => [item.section, item.max_tokens ?? 0]))
  return { budget_id: profile.budget_id, provider_kind: profile.provider_kind, model_id: profile.model_id, max_context_tokens: maxTokens, max_context_bytes: maxBytes, max_output_tokens: profile.max_output_tokens, safety_margin_tokens: profile.safety_margin_tokens, safety_margin_bytes: profile.safety_margin_bytes, target_input_tokens: maxTokens ? Math.max(0, maxTokens - (profile.max_output_tokens ?? 0) - (profile.safety_margin_tokens ?? 0)) : undefined, estimated_input_tokens: estimatedTokens, estimated_input_bytes: estimatedBytes, over_budget: Boolean((maxTokens && estimatedTokens > maxTokens) || (maxBytes && estimatedBytes > maxBytes)), section_budgets: sectionBudgets, omitted_sections: omitted, truncation_warnings: warnings }
}

export function buildContinuityDelta(refs: OpenCodeContinuitySourceRef[], sections: OpenCodeContinuitySection[], previous: PreviousRefreshSnapshot | null): OpenCodeContinuityDelta {
  const previousKeys = new Set((previous?.source_refs ?? []).map((item) => `${item.source_kind}:${item.source_id}`))
  const newRefs = refs.filter((item) => !previousKeys.has(`${item.source_kind}:${item.source_id}`))
  const ids = (kind: string) => newRefs.filter((item) => item.source_kind === kind).map((item) => item.source_id).slice(0, MAX_DELTA_IDS)
  const changed = previous
    ? sections.filter((item) => item.status !== "excluded" && previous.section_hashes?.[item.section_kind] !== continuitySectionHash(item)).map((item) => item.section_kind)
    : sections.filter((item) => item.status === "included").map((item) => item.section_kind)
  const payload = { previous: previous?.refresh_id, refs: newRefs.map((item) => [item.source_kind, item.source_id]), changed, section_hashes: Object.fromEntries(sections.map((item) => [item.section_kind, continuitySectionHash(item)])) }
  return {
    delta_kind: previous ? "incremental" : "initial_snapshot",
    previous_refresh_id: previous?.refresh_id,
    previous_packet_hash: previous?.packet_hash,
    changed_section_kinds: unique(changed).slice(0, 20),
    new_progress_ids: ids("opencode_progress"), new_question_ids: ids("commander_question"), new_guidance_ids: ids("commander_guidance"), new_delivery_ids: ids("guidance_delivery"), new_human_control_ids: ids("human_control"), new_watchdog_ids: ids("opencode_watchdog"), new_wake_execution_ids: ids("wake_supervisor_execution"), new_wake_action_ids: ids("wake_action_execution"), new_result_report_ids: ids("result_report"), new_result_review_ids: ids("result_review"), new_research_ingestion_ids: ids("research_ingestion"), new_research_memory_ids: ids("research_memory"),
    summary_preview: newRefs.length || changed.length ? `${newRefs.length} new durable source refs across ${unique(changed).length} changed sections` : previous ? "no substantive continuity delta" : "initial bounded tactical snapshot",
    delta_hash: hash(stableJson(payload)),
  }
}

export function continuitySectionHash(section: OpenCodeContinuitySection): string {
  return hash(stableJson({
    status: section.status,
    summary: section.summary_preview,
    refs: section.source_refs.map((ref) => [ref.source_kind, ref.source_id, ref.status, ref.label, ref.summary_preview]),
  }))
}

function continuityCommands(sessionId: string) { return [
  { label: "Preview refresh artifact", command: `/opencode-context-refresh-preview session=${sessionId}`, command_type: "read" as const },
  { label: "Write refresh artifact", command: `/opencode-context-refresh-write session=${sessionId}`, command_type: "write" as const, requires_active_runtime: true, notes: "writes immutable artifact metadata only; no OpenCode delivery" },
  { label: "Inspect human controls", command: `/opencode-human-controls session=${sessionId}`, command_type: "read" as const },
] }

async function latestActiveLaunch(service: OpenCodeLaunchGateService, sessionId: string): Promise<OpenCodeLaunchRecord | OpenCodeLaunchResult | null> {
  const launches = await service.listAll({ session_id: sessionId })
  return launches.filter((item) => ACTIVE_LAUNCH_STATUSES.has(item.status)).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null
}
function toRef(item: CommanderContinuitySourceRef): OpenCodeContinuitySourceRef { return { source_kind: bound(item.source_kind, 80), source_id: bound(item.source_id, 160), label: item.label ? bound(item.label) : undefined, status: item.status ? bound(item.status, 80) : undefined, summary_preview: item.summary_preview ? bound(item.summary_preview) : undefined, pointer_only: true } }
function safetyFlags() { return { delivery_performed: false as const, opencode_prompt_sent: false as const, native_session_action_performed: false as const, process_control_performed: false as const, session_state_mutated: false as const, mission_mutated: false as const, provider_called: false as const, mcp_called: false as const, research_db_written: false as const } }
function readMode(value: unknown): Exclude<OpenCodeContinuityMode, "active_refresh"> { return value === "fork_from_session" || value === "patch_session" || value === "resume_from_checkpoint" ? value : "continue_same_session" }
function readResearchMode(value: unknown): "auto" | "include" | "omit" { return value === "include" || value === "omit" ? value : "auto" }
function boundedArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => bound(item)).filter(Boolean).slice(0, 12) : [] }
function readArray(value: unknown): string[] | undefined { if (Array.isArray(value)) return boundedArray(value); if (typeof value === "string") return value.split(",").map((item) => bound(item)).filter(Boolean).slice(0, 12); return undefined }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function optional(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? bound(value.trim()) : undefined }
function optionalNumber(value: unknown): number | undefined { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value); return undefined }
function clamp(value: unknown, fallback: number, min: number, max: number) { return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback }
function bound(value: string, max = MAX_TEXT) { const redacted = redactText(String(value ?? "").trim()); return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted }
function unique<T>(items: T[]): T[] { return [...new Set(items)] }
function hash(value: string) { return createHash("sha256").update(value).digest("hex") }
function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)) }
function sortValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortValue); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)])) }
function emptyMid(): CommanderMidMissionContinuityPacket { return { packet_id: "missing", packet_kind: "mid_mission", status: "blocked", session_id: "", objective_preview: "", readiness: "blocked", active_session_summary: "", latest_progress_summary: "", watchdog_summary: "", commander_dialogue_summary: "", guidance_delivery_summary: "", human_control_summary: "", wake_supervision_summary: "", result_state_summary: "", local_session_working_memory_summary: "", open_loops: [], blockers: [], warnings: [], sections: [], source_refs: [], recommended_commands: [], budget: { target_token_budget: 4000, estimated_token_count: 0, section_budgets: {}, omitted_sections: [], truncation_warnings: [] }, generated_at: "", redacted_summary_preview: "", packet_hash: "" } }
