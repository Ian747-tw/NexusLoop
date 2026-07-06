import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { CommanderGuidanceService } from "./opencode-commander-guidance-service"
import type { OpenCodeCommanderQuestionService } from "./opencode-commander-question-service"
import type { CommanderGuidanceDeliveryService } from "./opencode-guidance-delivery-service"
import type { OpenCodeHumanControlService } from "./opencode-human-control-service"
import type { OpenCodeHumanControlRecord } from "./opencode-human-control-types"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeProgressService } from "./opencode-progress-service"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type { OpenCodeTimeoutWatchdogService } from "./opencode-timeout-watchdog-service"
import type {
  OpenCodeWakeSupervisorCheck,
  OpenCodeWakeSupervisorCommand,
  OpenCodeWakeSupervisorContextSection,
  OpenCodeWakeSupervisorEvidenceRef,
  OpenCodeWakeSupervisorPreview,
  OpenCodeWakeSupervisorPreviewInput,
  OpenCodeWakeSupervisorRecommendedAction,
  OpenCodeWakeSupervisorSessionCard,
  OpenCodeWakeSupervisorStatus,
  OpenCodeWakeSupervisorSummary,
  OpenCodeWakeSupervisorSummaryInput,
} from "./opencode-wake-supervisor-types"

const MAX_LIST = 100
const MAX_TEXT = 360
const DEFAULT_EVIDENCE_LIMIT = 20
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])

export type OpenCodeWakeSupervisorServiceOptions = {
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  progressService: OpenCodeProgressService
  watchdogService: OpenCodeTimeoutWatchdogService
  questionService: OpenCodeCommanderQuestionService
  guidanceService: CommanderGuidanceService
  guidanceDeliveryService: CommanderGuidanceDeliveryService
  humanControlService: OpenCodeHumanControlService
  now?: () => Date
}

export class OpenCodeWakeSupervisorService {
  private readonly now: () => Date

  constructor(private readonly options: OpenCodeWakeSupervisorServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: OpenCodeWakeSupervisorPreviewInput = {}): Promise<OpenCodeWakeSupervisorPreview> {
    const generatedAt = this.now().toISOString()
    const sessionIdInput = optional(input.session_id)
    const launchIdInput = optional(input.launch_id)
    const includeHumanControls = input.include_human_controls !== false
    const includeGuidanceDelivery = input.include_guidance_delivery !== false
    const includeContextPacket = input.include_context_packet !== false
    const includeResearchMemory = input.include_research_memory === true
    const limitEvidence = positiveInteger(input.limit_evidence, DEFAULT_EVIDENCE_LIMIT, MAX_LIST)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "wake supervisor preview is read-only; no wake tick, provider call, OpenCode prompt, process control, file write, research.db write, or mission mutation occurs",
      "recommended write commands require explicit operator execution; this preview does not execute them",
    ])

    if (!sessionIdInput && !launchIdInput) blockers.push("session_id or launch_id is required")

    let launch: OpenCodeLaunchResult | OpenCodeLaunchRecord | null = null
    if (launchIdInput) {
      launch = await this.options.launchGateService.get(launchIdInput)
      if (!launch) blockers.push("launch_id does not resolve to an OpenCode launch record")
    }

    let sessionId = sessionIdInput ?? launch?.session_id ?? ""
    const session = sessionId ? await this.options.opencodeSessionService.get(sessionId) : null
    if (sessionId && !session) blockers.push("session_id does not resolve to a planned OpenCode session")

    if (!launch && sessionId && !launchIdInput) {
      launch = await this.resolveLatestActiveLaunch(sessionId)
      if (!launch) blockers.push("wake supervisor preview requires a launch_started or launched OpenCode launch record")
    }
    if (launch && sessionIdInput && launch.session_id !== sessionIdInput) blockers.push("launch_id does not belong to session_id")
    sessionId = sessionId || launch?.session_id || ""
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`wake supervisor preview requires launch_started or launched status; current status is ${launch.status}`)
    const canReadLaunchEvidence = Boolean(launch && LAUNCHED_STATUSES.has(launch.status))

    const latestProgress = canReadLaunchEvidence && sessionId ? await this.options.progressService.latest({ session_id: sessionId, launch_id: launch?.launch_id }) : null
    const watchdogs = canReadLaunchEvidence && sessionId ? await this.options.watchdogService.list({ session_id: sessionId, launch_id: launch?.launch_id, limit: limitEvidence }) : []
    const latestWatchdog = watchdogs[0]
    const forcedReports = canReadLaunchEvidence && sessionId ? await this.options.watchdogService.listForcedReports({ session_id: sessionId, launch_id: launch?.launch_id, limit: limitEvidence }) : []
    const latestForcedReport = forcedReports[0]
    const currentForcedReport = forcedReports.find((request) => forcedReportMatchesCurrentEvidence(request, latestWatchdog, latestProgress)) ?? null
    const questions = canReadLaunchEvidence && sessionId ? await this.options.questionService.list({ session_id: sessionId, launch_id: launch?.launch_id, limit: limitEvidence }) : []
    const allQuestions = canReadLaunchEvidence && sessionId ? await listAllQuestions(this.options.questionService, { session_id: sessionId, launch_id: launch?.launch_id }) : []
    const pendingQuestions = allQuestions.filter((question) => question.status === "pending_commander" || question.status === "pending_human")
    const renderedPendingQuestions = questions.filter((question) => question.status === "pending_commander" || question.status === "pending_human")
    const renderedPendingQuestion = renderedPendingQuestions[0] ?? pendingQuestions[0]
    const latestGuidance = canReadLaunchEvidence && sessionId ? await this.options.guidanceService.latest({ session_id: sessionId, launch_id: launch?.launch_id }) : null
    const guidanceRecords = canReadLaunchEvidence && sessionId ? await this.options.guidanceService.list({ session_id: sessionId, launch_id: launch?.launch_id, limit: limitEvidence }) : []
    const allGuidance = canReadLaunchEvidence && sessionId ? await listAllGuidance(this.options.guidanceService, { session_id: sessionId, launch_id: launch?.launch_id }) : []
    const pendingGuidance = allGuidance.filter((guidance) => guidance.delivery_status === "not_delivered" || guidance.delivery_status === "pending_delivery")
    const pendingGuidanceRecord = pendingGuidance[0]
    const renderedPendingGuidance = guidanceRecords.find((guidance) => guidance.delivery_status === "not_delivered" || guidance.delivery_status === "pending_delivery") ?? pendingGuidanceRecord
    const renderedGuidance = renderedPendingGuidance ?? latestGuidance
    const deliveries = includeGuidanceDelivery && canReadLaunchEvidence && sessionId ? await this.options.guidanceDeliveryService.list({ session_id: sessionId, launch_id: launch?.launch_id, limit: limitEvidence }) : []
    const latestDelivery = deliveries[0]
    const humanControls = includeHumanControls && canReadLaunchEvidence && sessionId ? await listAllHumanControls(this.options.humanControlService, { session_id: sessionId, launch_id: launch?.launch_id }) : []
    const latestHuman = projectedHumanControl(humanControls)

    if (!latestProgress && launch && blockers.length === 0) warnings.add("no OpenCode progress or heartbeat evidence has been recorded yet")
    if (!latestWatchdog && launch && blockers.length === 0) warnings.add("no watchdog assessment record has been recorded yet")
    if (!includeResearchMemory) warnings.add("research-memory advisory is omitted by default; enable include_research_memory for bounded advisory refs")
    if (!includeContextPacket) warnings.add("context packet section omitted by request")

    const loadedEvidenceRefs = boundEvidence([
      session ? evidence("session_plan", session.session_id, session.status, session.objective, session.created_at) : undefined,
      launch ? evidence("launch", launch.launch_id, launch.status, launchSummary(launch), launch.started_at) : undefined,
      latestProgress ? evidence("progress", latestProgress.progress_id, latestProgress.execution_state, latestProgress.report_summary_preview, latestProgress.recorded_at) : undefined,
      latestWatchdog ? evidence("watchdog", latestWatchdog.watchdog_id, latestWatchdog.watchdog_status, latestWatchdog.report_required ? "report required" : latestWatchdog.recommended_action, latestWatchdog.recorded_at) : undefined,
      latestForcedReport ? evidence("forced_report", latestForcedReport.request_id, "requested", latestForcedReport.reason, latestForcedReport.requested_at) : undefined,
      renderedPendingQuestion ? evidence("commander_question", renderedPendingQuestion.question_id, renderedPendingQuestion.status, renderedPendingQuestion.question_preview, renderedPendingQuestion.created_at) : undefined,
      renderedGuidance ? evidence("commander_guidance", renderedGuidance.guidance_id, renderedGuidance.delivery_status, renderedGuidance.answer_preview, renderedGuidance.created_at) : undefined,
      latestDelivery ? evidence("guidance_delivery", latestDelivery.delivery_id, latestDelivery.delivery_status_after, latestDelivery.summary_preview, latestDelivery.created_at) : undefined,
      latestHuman ? evidence("human_control", latestHuman.control_id, latestHuman.projected_state_after, latestHuman.human_note_preview, latestHuman.recorded_at) : undefined,
    ], MAX_LIST)
    const evidenceRefs = loadedEvidenceRefs.slice(0, limitEvidence)

    const statusDecision = decideStatus({
      latestProgress,
      latestWatchdog,
      currentForcedReport,
      pendingQuestionCount: pendingQuestions.length,
      pendingDeliveryCount: pendingGuidance.length,
      latestGuidanceDeliveryStatus: pendingGuidanceRecord?.delivery_status ?? latestGuidance?.delivery_status,
      latestDeliveryStatus: latestDelivery?.delivery_status_after,
      latestHumanState: latestHuman?.projected_state_after,
    })
    const recommendedCommands = recommendedCommandsForStatus(statusDecision.status, statusDecision.action, {
      sessionId: sessionId || "<session_id>",
      progressId: latestProgress?.progress_id,
      watchdogId: latestWatchdog?.watchdog_id,
      questionId: pendingQuestions[0]?.question_id,
      guidanceId: pendingGuidanceRecord?.guidance_id ?? latestGuidance?.guidance_id,
    })
    const checks = buildChecks({
      sessionRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "session_plan"),
      launchRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "launch"),
      progressRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "progress"),
      watchdogRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "watchdog"),
      questionRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "commander_question"),
      guidanceRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "commander_guidance"),
      deliveryRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "guidance_delivery"),
      humanRef: loadedEvidenceRefs.find((ref) => ref.evidence_kind === "human_control"),
      statusDecision,
      sessionId: sessionId || "<session_id>",
    })
    const contextSections = buildContextSections({
      evidenceRefs: loadedEvidenceRefs,
      includeContextPacket,
      includeResearchMemory,
      latestProgress,
      latestWatchdog,
      pendingQuestions: renderedPendingQuestion ? [renderedPendingQuestion] : [],
      latestGuidance,
      latestDelivery,
      latestHuman,
    })

    const supervisorHash = hash(stableJson({
      session_id: sessionId,
      launch_id: launch?.launch_id ?? launchIdInput,
      supervisor_status: statusDecision.status,
      recommended_action: statusDecision.action,
      latest_progress_id: latestProgress?.progress_id,
      latest_watchdog_id: latestWatchdog?.watchdog_id,
      pending_question_count: pendingQuestions.length,
      pending_delivery_count: pendingGuidance.length,
      latest_human_control_id: latestHuman?.control_id,
      blockers,
    }))

    const status: OpenCodeWakeSupervisorPreview["status"] = blockers.length > 0 ? "blocked" : latestProgress && latestWatchdog ? "ready" : "partial"
    return redactValue({
      preview_id: `opencode_wake_supervisor_preview_${supervisorHash.slice(0, 16)}`,
      status,
      session_id: sessionId,
      launch_id: launch?.launch_id ?? launchIdInput,
      supervisor_status: blockers.length > 0 ? "unknown" : statusDecision.status,
      recommended_action: blockers.length > 0 ? "unknown" : statusDecision.action,
      active_launch_status: launch?.status,
      latest_progress_id: latestProgress?.progress_id,
      latest_progress_kind: latestProgress?.kind,
      latest_progress_state: latestProgress?.execution_state,
      latest_watchdog_id: latestWatchdog?.watchdog_id,
      latest_watchdog_status: latestWatchdog?.watchdog_status,
      latest_forced_report_request_id: latestForcedReport?.request_id,
      pending_question_id: pendingQuestions[0]?.question_id,
      pending_question_count: pendingQuestions.length,
      unanswered_question_count: pendingQuestions.length,
      latest_guidance_id: latestGuidance?.guidance_id,
      latest_guidance_delivery_status: latestGuidance?.delivery_status,
      pending_delivery_count: pendingGuidance.length,
      latest_human_control_id: latestHuman?.control_id,
      latest_human_projected_state: latestHuman?.projected_state_after,
      human_pause_requested: latestHuman?.projected_state_after === "pause_requested",
      human_stop_requested: latestHuman?.projected_state_after === "stop_requested",
      human_correction_pending: latestHuman?.projected_state_after === "correction_pending",
      human_override_pending: latestHuman?.projected_state_after === "override_pending",
      report_required: Boolean(latestWatchdog?.report_required),
      timed_out: latestWatchdog?.watchdog_status === "timed_out",
      stale: latestWatchdog?.watchdog_status === "stale",
      blocked_by_human: latestHuman?.projected_state_after === "pause_requested" || latestHuman?.projected_state_after === "stop_requested",
      checks,
      context_sections: contextSections,
      evidence_refs: evidenceRefs,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings])),
      recommended_commands: recommendedCommands,
      generated_at: generatedAt,
      redacted_summary_preview: blockers.length > 0
        ? blockers[0] ?? "OpenCode wake supervisor preview blocked"
        : `OpenCode wake supervisor ${statusDecision.status}; recommended action ${statusDecision.action}`,
      supervisor_hash: supervisorHash,
    })
  }

  async summary(input: OpenCodeWakeSupervisorSummaryInput = {}): Promise<OpenCodeWakeSupervisorSummary> {
    const limit = positiveInteger(input.limit, 20, MAX_LIST)
    const launches = (await listAllLaunches(this.options.launchGateService)).filter((launch) => LAUNCHED_STATUSES.has(launch.status))
    const matchingCards: OpenCodeWakeSupervisorSessionCard[] = []
    for (const launch of launches) {
      const preview = await this.preview({
        session_id: launch.session_id,
        launch_id: launch.launch_id,
        include_research_memory: input.include_research_memory,
        include_human_controls: input.include_human_controls,
        limit_evidence: DEFAULT_EVIDENCE_LIMIT,
      })
      const card = cardFromPreview(preview)
      if (!input.status_filter || card.supervisor_status === input.status_filter) matchingCards.push(card)
    }
    const cards = matchingCards.slice(0, limit)
    return redactValue({
      total_launched_sessions: launches.length,
      healthy_count: matchingCards.filter((card) => card.supervisor_status === "healthy").length,
      stale_count: matchingCards.filter((card) => card.supervisor_status === "stale").length,
      timed_out_count: matchingCards.filter((card) => card.supervisor_status === "timed_out").length,
      needs_report_count: matchingCards.filter((card) => card.supervisor_status === "needs_report").length,
      needs_commander_answer_count: matchingCards.filter((card) => card.supervisor_status === "needs_commander_answer").length,
      guidance_pending_delivery_count: matchingCards.filter((card) => card.supervisor_status === "guidance_pending_delivery").length,
      human_attention_count: matchingCards.filter((card) => card.supervisor_status === "human_attention" || card.supervisor_status === "human_paused").length,
      stop_requested_count: matchingCards.filter((card) => card.supervisor_status === "stop_requested").length,
      session_cards: cards,
      generated_at: this.now().toISOString(),
    })
  }

  private async resolveLatestActiveLaunch(sessionId: string): Promise<OpenCodeLaunchResult | OpenCodeLaunchRecord | null> {
    const launches = await this.options.launchGateService.list({ session_id: sessionId, limit: MAX_LIST })
    const latest = launches.find((launch) => LAUNCHED_STATUSES.has(launch.status))
    return latest ? (await this.options.launchGateService.get(latest.launch_id)) ?? latest : null
  }
}

export function readOpenCodeWakeSupervisorPreviewInput(value: unknown): OpenCodeWakeSupervisorPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_context_packet: optionalBoolean(input.includeContextPacket ?? input.include_context_packet),
    include_human_controls: optionalBoolean(input.includeHumanControls ?? input.include_human_controls),
    include_guidance_delivery: optionalBoolean(input.includeGuidanceDelivery ?? input.include_guidance_delivery),
    limit_evidence: optionalNumber(input.limitEvidence ?? input.limit_evidence),
  }
}

export function readOpenCodeWakeSupervisorSummaryInput(value: unknown): OpenCodeWakeSupervisorSummaryInput {
  const input = isRecord(value) ? value : {}
  return {
    limit: optionalNumber(input.limit),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_human_controls: optionalBoolean(input.includeHumanControls ?? input.include_human_controls),
    status_filter: optional(input.statusFilter ?? input.status_filter ?? input.status),
  }
}

function decideStatus(input: {
  latestProgress: { kind: string; execution_state: string } | null
  latestWatchdog?: { watchdog_status: string; report_required: boolean } | null
  currentForcedReport?: { request_id: string } | null
  pendingQuestionCount: number
  pendingDeliveryCount: number
  latestGuidanceDeliveryStatus?: string
  latestDeliveryStatus?: string
  latestHumanState?: string
}): { status: OpenCodeWakeSupervisorStatus; action: OpenCodeWakeSupervisorRecommendedAction } {
  if (input.latestHumanState === "stop_requested") return { status: "stop_requested", action: "review_human_control" }
  if (input.latestHumanState === "pause_requested") return { status: "human_paused", action: "review_human_control" }
  if (input.latestHumanState === "correction_pending" || input.latestHumanState === "override_pending" || input.latestHumanState === "escalated" || input.latestHumanState === "report_requested") {
    return { status: "human_attention", action: "review_human_control" }
  }
  if (input.latestWatchdog?.watchdog_status === "timed_out") {
    return { status: "timed_out", action: input.currentForcedReport ? "read_latest_progress" : "request_forced_report" }
  }
  if (input.latestWatchdog?.watchdog_status === "needs_report") {
    return { status: "needs_report", action: input.currentForcedReport ? "read_latest_progress" : "request_forced_report" }
  }
  if (input.latestWatchdog?.watchdog_status === "stale") {
    return { status: "stale", action: input.currentForcedReport ? "read_latest_progress" : "request_forced_report" }
  }
  if (input.latestWatchdog?.watchdog_status === "blocked") {
    return {
      status: "blocked",
      action: input.latestWatchdog.report_required
        ? input.currentForcedReport ? "read_latest_progress" : "request_forced_report"
        : "create_commander_question",
    }
  }
  if (input.pendingQuestionCount > 0) return { status: "needs_commander_answer", action: "answer_commander_question" }
  if (input.pendingDeliveryCount > 0) {
    return { status: "guidance_pending_delivery", action: input.latestDeliveryStatus === "pending_delivery" || input.latestGuidanceDeliveryStatus === "pending_delivery" ? "review_human_control" : "deliver_guidance" }
  }
  if (input.latestProgress?.kind === "blocker" || input.latestProgress?.execution_state === "blocked") return { status: "blocked", action: "create_commander_question" }
  if (input.latestProgress?.kind === "question" || input.latestProgress?.execution_state === "needs_commander") return { status: "needs_commander_answer", action: "create_commander_question" }
  if (input.latestProgress?.kind === "completion_report" || input.latestProgress?.execution_state === "reported_done") return { status: "watch", action: "prepare_result_review" }
  if (input.latestProgress && !input.latestWatchdog) return { status: "watch", action: "record_watchdog" }
  if (input.latestProgress) return { status: "healthy", action: "none" }
  return { status: "unknown", action: "read_latest_progress" }
}

function buildChecks(input: {
  sessionRef?: OpenCodeWakeSupervisorEvidenceRef
  launchRef?: OpenCodeWakeSupervisorEvidenceRef
  progressRef?: OpenCodeWakeSupervisorEvidenceRef
  watchdogRef?: OpenCodeWakeSupervisorEvidenceRef
  questionRef?: OpenCodeWakeSupervisorEvidenceRef
  guidanceRef?: OpenCodeWakeSupervisorEvidenceRef
  deliveryRef?: OpenCodeWakeSupervisorEvidenceRef
  humanRef?: OpenCodeWakeSupervisorEvidenceRef
  statusDecision: { status: OpenCodeWakeSupervisorStatus; action: OpenCodeWakeSupervisorRecommendedAction }
  sessionId: string
}): OpenCodeWakeSupervisorCheck[] {
  return [
    {
      check_id: "session_launch_chain",
      label: "Session and launch chain",
      status: input.sessionRef && input.launchRef ? "pass" : "fail",
      summary_preview: input.sessionRef && input.launchRef ? "planned session and active launch resolve" : "session or active launch evidence is missing",
      evidence_refs: boundEvidence([input.sessionRef, input.launchRef], 4),
      recommended_commands: [{ label: "Show launches", command: `/opencode-launches`, command_type: "read" }],
    },
    {
      check_id: "latest_progress",
      label: "Latest progress evidence",
      status: input.progressRef ? "pass" : "warn",
      summary_preview: input.progressRef ? input.progressRef.summary_preview ?? "progress evidence exists" : "no progress or heartbeat evidence found",
      evidence_refs: boundEvidence([input.progressRef], 2),
      recommended_commands: [{ label: "Read latest progress", command: `/opencode-progress-latest session=${input.sessionId}`, command_type: "read" }],
    },
    {
      check_id: "watchdog_state",
      label: "Watchdog state",
      status: input.statusDecision.status === "timed_out" || input.statusDecision.status === "needs_report" || input.statusDecision.status === "stale" ? "warn" : input.watchdogRef ? "pass" : "unknown",
      summary_preview: input.watchdogRef ? input.watchdogRef.summary_preview ?? "watchdog evidence exists" : "no watchdog record found",
      evidence_refs: boundEvidence([input.watchdogRef], 2),
      recommended_commands: [{ label: "Preview watchdog", command: `/opencode-watchdog-preview session=${input.sessionId}`, command_type: "read" }],
    },
    {
      check_id: "commander_question_guidance",
      label: "Commander question and guidance state",
      status: input.statusDecision.status === "needs_commander_answer" || input.statusDecision.status === "guidance_pending_delivery" ? "warn" : input.questionRef || input.guidanceRef ? "pass" : "unknown",
      summary_preview: `recommended action ${input.statusDecision.action}`,
      evidence_refs: boundEvidence([input.questionRef, input.guidanceRef, input.deliveryRef], 6),
      recommended_commands: recommendedCommandsForStatus(input.statusDecision.status, input.statusDecision.action, { sessionId: input.sessionId, questionId: input.questionRef?.evidence_id, guidanceId: input.guidanceRef?.evidence_id }),
    },
    {
      check_id: "human_control_state",
      label: "Human control state",
      status: input.statusDecision.status === "stop_requested" || input.statusDecision.status === "human_paused" || input.statusDecision.status === "human_attention" ? "warn" : input.humanRef ? "pass" : "unknown",
      summary_preview: input.humanRef ? input.humanRef.summary_preview ?? "human control evidence exists" : "no human control metadata found",
      evidence_refs: boundEvidence([input.humanRef], 2),
      recommended_commands: [{ label: "Review human controls", command: `/opencode-human-controls session=${input.sessionId}`, command_type: "read" }],
    },
  ]
}

function buildContextSections(input: {
  evidenceRefs: OpenCodeWakeSupervisorEvidenceRef[]
  includeContextPacket: boolean
  includeResearchMemory: boolean
  latestProgress: unknown
  latestWatchdog: unknown
  pendingQuestions: unknown[]
  latestGuidance: unknown
  latestDelivery: unknown
  latestHuman: unknown
}): OpenCodeWakeSupervisorContextSection[] {
  const refs = (kind: OpenCodeWakeSupervisorEvidenceRef["evidence_kind"]) => input.evidenceRefs.filter((ref) => ref.evidence_kind === kind)
  return [
    section("session_plan", refs("session_plan").length ? "included" : "missing", refs("session_plan").length ? "planned OpenCode session policy/context metadata is available" : "planned session metadata is missing", refs("session_plan")),
    section("launch_state", refs("launch").length ? "included" : "missing", refs("launch").length ? "active launch metadata is available" : "active launch metadata is missing", refs("launch")),
    section("latest_progress", input.latestProgress ? "included" : "missing", input.latestProgress ? "latest bounded progress/heartbeat evidence included" : "no latest progress evidence", refs("progress")),
    section("watchdog_state", input.latestWatchdog ? "included" : "missing", input.latestWatchdog ? "latest watchdog assessment pointer included" : "no watchdog record", refs("watchdog")),
    section("forced_report_state", refs("forced_report").length ? "pointer_only" : "missing", refs("forced_report").length ? "forced report request pointer included" : "no forced report request", refs("forced_report")),
    section("pending_questions", input.pendingQuestions.length ? "pointer_only" : "missing", input.pendingQuestions.length ? "pending Commander question pointers included" : "no pending Commander questions", refs("commander_question")),
    section("guidance_state", input.latestGuidance ? "pointer_only" : "missing", input.latestGuidance ? "latest Commander guidance pointer included" : "no Commander guidance record", refs("commander_guidance")),
    section("guidance_delivery_state", input.latestDelivery ? "pointer_only" : "missing", input.latestDelivery ? "guidance delivery metadata pointer included" : "no guidance delivery metadata", refs("guidance_delivery")),
    section("human_control_state", input.latestHuman ? "pointer_only" : "missing", input.latestHuman ? "latest human control metadata pointer included" : "no human control metadata", refs("human_control")),
    section("research_memory_advisory", input.includeResearchMemory ? "pointer_only" : "excluded", input.includeResearchMemory ? "research-memory advisory is available only as bounded pointers" : "research-memory advisory omitted by default", refs("research_memory"), input.includeResearchMemory ? [] : ["full research.db is excluded"]),
    section("context_packet", input.includeContextPacket ? "pointer_only" : "excluded", input.includeContextPacket ? "context packet may be inspected through the 9B2 context-packet preview command" : "context packet section omitted by request", refs("context_packet")),
    section("omitted_raw_logs", "excluded", "raw logs and raw OpenCode output are excluded", [], ["raw logs are out of scope"]),
    section("omitted_full_research_db", "excluded", "full research.db dumps are excluded", [], ["use bounded research-memory advisory refs only"]),
    section("omitted_full_event_log", "excluded", "full event log dumps are excluded", [], ["use pointer-only event refs"]),
  ]
}

function recommendedCommandsForStatus(
  status: OpenCodeWakeSupervisorStatus,
  action: OpenCodeWakeSupervisorRecommendedAction,
  ids: { sessionId: string; progressId?: string; watchdogId?: string; questionId?: string; guidanceId?: string },
): OpenCodeWakeSupervisorCommand[] {
  const commands: OpenCodeWakeSupervisorCommand[] = [
    { label: "Read latest progress", command: `/opencode-progress-latest session=${ids.sessionId}`, command_type: "read" },
    { label: "Preview watchdog", command: `/opencode-watchdog-preview session=${ids.sessionId}`, command_type: "read" },
  ]
  if (action === "request_forced_report") commands.push({ label: "Request forced report", command: `/opencode-force-report session=${ids.sessionId} reason=<reason>`, command_type: "write", requires_active_runtime: true, notes: "manual explicit command required; supervisor preview does not execute it" })
  if (action === "record_watchdog") commands.push({ label: "Record watchdog", command: `/opencode-watchdog-record session=${ids.sessionId}`, command_type: "write", requires_active_runtime: true, notes: "manual explicit command required; supervisor preview does not execute it" })
  if (action === "create_commander_question") commands.push({ label: "Create Commander question", command: ids.progressId ? `/opencode-ask-commander progress=${ids.progressId}` : `/opencode-ask-commander session=${ids.sessionId} question=<question>`, command_type: "write", requires_active_runtime: true, notes: "manual explicit command required; supervisor preview does not execute it" })
  if (action === "answer_commander_question") commands.push({ label: "Answer Commander question", command: `/commander-guidance question=${ids.questionId ?? "<question_id>"} answer=<answer>`, command_type: "write", requires_active_runtime: true, notes: "manual explicit command required; supervisor preview does not execute it" })
  if (action === "deliver_guidance") commands.push({ label: "Deliver guidance", command: `/commander-guidance-deliver guidance=${ids.guidanceId ?? "<guidance_id>"} mode=operator_handoff`, command_type: "write", requires_active_runtime: true, notes: "manual explicit command required; supervisor preview does not execute it" })
  if (action === "review_human_control") commands.push({ label: "Review human controls", command: `/opencode-human-controls session=${ids.sessionId}`, command_type: "read" })
  if (status === "watch") commands.push({ label: "Prepare result review", command: `/opencode-progress-latest session=${ids.sessionId}`, command_type: "read", notes: "completion reports do not mark mission completion" })
  commands.push({ label: "Record human note", command: `/opencode-human-note session=${ids.sessionId} note=<note>`, command_type: "write", requires_active_runtime: true, notes: "manual explicit command required; metadata only" })
  return commands.slice(0, 8)
}

function cardFromPreview(preview: OpenCodeWakeSupervisorPreview): OpenCodeWakeSupervisorSessionCard {
  const latestProgressRef = preview.evidence_refs.find((ref) => ref.evidence_kind === "progress")
  return redactValue({
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    supervisor_status: preview.supervisor_status,
    recommended_action: preview.recommended_action,
    latest_progress_at: latestProgressRef?.recorded_at,
    latest_watchdog_status: preview.latest_watchdog_status,
    pending_question_count: preview.pending_question_count,
    pending_delivery_count: preview.pending_delivery_count,
    latest_human_projected_state: preview.latest_human_projected_state,
    summary_preview: preview.redacted_summary_preview,
    supervisor_hash: preview.supervisor_hash,
  })
}

function launchSummary(launch: OpenCodeLaunchResult | OpenCodeLaunchRecord): string {
  if ("summary_preview" in launch && launch.summary_preview) return launch.summary_preview
  if ("output_summary_preview" in launch && launch.output_summary_preview) return launch.output_summary_preview
  return `${launch.adapter_kind} ${launch.status}`
}

function section(sectionName: string, status: OpenCodeWakeSupervisorContextSection["status"], summary: string, refs: OpenCodeWakeSupervisorEvidenceRef[], warnings: string[] = []): OpenCodeWakeSupervisorContextSection {
  return {
    section: sectionName,
    status,
    summary_preview: bound(summary) ?? summary,
    evidence_refs: boundEvidence(refs, 6),
    warnings: boundArray(warnings),
  }
}

function evidence(kind: OpenCodeWakeSupervisorEvidenceRef["evidence_kind"], id: string, status?: string, summary?: string, recordedAt?: string): OpenCodeWakeSupervisorEvidenceRef {
  return {
    evidence_kind: kind,
    evidence_id: bound(id) ?? id,
    status: bound(status),
    summary_preview: bound(summary),
    recorded_at: bound(recordedAt),
    pointer_only: true as const,
  }
}

function forcedReportMatchesCurrentEvidence(
  request: { watchdog_id?: string; latest_progress_id?: string },
  latestWatchdog?: { watchdog_id: string; latest_progress_id?: string } | null,
  latestProgress?: { progress_id: string } | null,
): boolean {
  if (latestWatchdog?.watchdog_id && request.watchdog_id) return request.watchdog_id === latestWatchdog.watchdog_id
  const currentProgressId = latestWatchdog?.latest_progress_id ?? latestProgress?.progress_id
  return currentProgressId ? request.latest_progress_id === currentProgressId : false
}

async function listAllLaunches(service: OpenCodeLaunchGateService): Promise<OpenCodeLaunchRecord[]> {
  const maybeUncapped = service as OpenCodeLaunchGateService & { listAll?: (input?: { session_id?: string; status?: string }) => Promise<OpenCodeLaunchRecord[]> }
  return maybeUncapped.listAll ? maybeUncapped.listAll() : service.list({ limit: MAX_LIST })
}

async function listAllQuestions(
  service: OpenCodeCommanderQuestionService,
  input: { session_id?: string; launch_id?: string },
): Promise<Array<{ question_id: string; status: string; question_preview: string; created_at: string }>> {
  const maybeUncapped = service as OpenCodeCommanderQuestionService & {
    listAll?: (input?: { session_id?: string; launch_id?: string; status?: string }) => Promise<Array<{ question_id: string; status: string; question_preview: string; created_at: string }>>
  }
  return maybeUncapped.listAll ? maybeUncapped.listAll(input) : service.list({ ...input, limit: MAX_LIST })
}

async function listAllGuidance(
  service: CommanderGuidanceService,
  input: { session_id?: string; launch_id?: string },
): Promise<Array<{ guidance_id: string; delivery_status: string; answer_preview: string; created_at: string }>> {
  const maybeUncapped = service as CommanderGuidanceService & {
    listAll?: (input?: { session_id?: string; launch_id?: string; delivery_status?: string }) => Promise<Array<{ guidance_id: string; delivery_status: string; answer_preview: string; created_at: string }>>
  }
  return maybeUncapped.listAll ? maybeUncapped.listAll(input) : service.list({ ...input, limit: MAX_LIST })
}

async function listAllHumanControls(
  service: OpenCodeHumanControlService,
  input: { session_id?: string; launch_id?: string },
): Promise<OpenCodeHumanControlRecord[]> {
  const maybeUncapped = service as OpenCodeHumanControlService & {
    listAll?: (input?: { session_id?: string; launch_id?: string }) => Promise<OpenCodeHumanControlRecord[]>
  }
  return maybeUncapped.listAll ? maybeUncapped.listAll(input) : service.list({ ...input, limit: MAX_LIST })
}

function projectedHumanControl(records: OpenCodeHumanControlRecord[]): OpenCodeHumanControlRecord | undefined {
  return records.find((record) => record.projected_state_after !== "noted") ?? records[0]
}

function boundEvidence(values: Array<OpenCodeWakeSupervisorEvidenceRef | undefined>, maxItems: number): OpenCodeWakeSupervisorEvidenceRef[] {
  return values
    .filter((value): value is OpenCodeWakeSupervisorEvidenceRef => Boolean(value))
    .map((value) => ({
      evidence_kind: value.evidence_kind,
      evidence_id: bound(value.evidence_id) ?? value.evidence_id,
      status: bound(value.status),
      summary_preview: bound(value.summary_preview),
      recorded_at: bound(value.recorded_at),
      pointer_only: true as const,
    }))
    .slice(0, maxItems)
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = optionalNumber(value)
  if (!parsed) return fallback
  return Math.max(1, Math.min(Math.floor(parsed), max))
}

function bound(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const redacted = redactText(value.trim())
  if (!redacted) return undefined
  return redacted.length > max ? `${redacted.slice(0, max - 3)}...` : redacted
}

function boundArray(values: unknown, maxItems = 20): string[] {
  if (!Array.isArray(values)) return []
  return values.map((item) => bound(item)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
