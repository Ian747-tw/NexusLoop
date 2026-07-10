import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeCommanderQuestionService } from "../opencode-session/opencode-commander-question-service"
import type { CommanderGuidanceService } from "../opencode-session/opencode-commander-guidance-service"
import type { CommanderGuidanceDeliveryService } from "../opencode-session/opencode-guidance-delivery-service"
import type { OpenCodeHumanControlService } from "../opencode-session/opencode-human-control-service"
import type { OpenCodeLaunchGateService } from "../opencode-session/opencode-launch-gate-service"
import type { OpenCodeProgressService } from "../opencode-session/opencode-progress-service"
import type { OpenCodeResultReportService } from "../opencode-session/opencode-result-report-service"
import type { OpenCodeResultReviewService } from "../opencode-session/opencode-result-review-service"
import type { OpenCodeSessionService } from "../opencode-session/opencode-session-service"
import type { OpenCodeTimeoutWatchdogService } from "../opencode-session/opencode-timeout-watchdog-service"
import type { OpenCodeWakeActionExecutionService } from "../opencode-session/opencode-wake-action-execution-service"
import type { OpenCodeWakeSupervisorService } from "../opencode-session/opencode-wake-supervisor-service"
import type { OpenCodeWakeSupervisorExecutionService } from "../opencode-session/opencode-wake-supervisor-execution-service"
import type { ResearchMemoryService } from "../research-memory/research-memory-service"
import type { ResearchIngestionService } from "../research/research-ingestion-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "../opencode-session/opencode-launch-gate-types"
import type { OpenCodeSessionPlan, OpenCodeSessionRecord } from "../opencode-session/opencode-session-types"
import type { ResearchMemoryCandidate } from "../research-memory/research-memory-types"
import type {
  CommanderContinuityCommand,
  CommanderContinuityOpenLoop,
  CommanderContinuityOpenLoopInput,
  CommanderContinuityOpenLoopKind,
  CommanderContinuityOpenLoopSeverity,
  CommanderContinuityPacketBudget,
  CommanderContinuitySection,
  CommanderContinuitySourceRef,
  CommanderContinuitySummary,
  CommanderContinuitySummaryInput,
  CommanderContinuityThreadCard,
  CommanderContinuityThreadInput,
  CommanderMidMissionContinuityInput,
  CommanderMidMissionContinuityPacket,
  CommanderProposalContinuityInput,
  CommanderProposalContinuityPacket,
  CommanderContinuityDecisionReadiness,
} from "./commander-continuity-types"

const MAX_TEXT = 420
const MAX_LIST = 100
const ACTIVE_LAUNCH_STATUSES = new Set(["launch_started", "launched"])
const BLOCKING_SEVERITIES = new Set<CommanderContinuityOpenLoopSeverity>(["blocking", "critical"])

export type CommanderContinuityServiceOptions = {
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  progressService: OpenCodeProgressService
  watchdogService: OpenCodeTimeoutWatchdogService
  questionService: OpenCodeCommanderQuestionService
  guidanceService: CommanderGuidanceService
  guidanceDeliveryService: CommanderGuidanceDeliveryService
  humanControlService: OpenCodeHumanControlService
  wakeSupervisorService: OpenCodeWakeSupervisorService
  wakeExecutionService: OpenCodeWakeSupervisorExecutionService
  wakeActionExecutionService: OpenCodeWakeActionExecutionService
  resultReportService: OpenCodeResultReportService
  resultReviewService: OpenCodeResultReviewService
  researchIngestionService: ResearchIngestionService
  researchMemoryService: ResearchMemoryService
  now?: () => Date
}

export class CommanderContinuityService {
  private readonly now: () => Date

  constructor(private readonly options: CommanderContinuityServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async proposal(input: CommanderProposalContinuityInput = {}): Promise<CommanderProposalContinuityPacket> {
    const generatedAt = this.now().toISOString()
    const objective = bound(input.objective ?? "")
    const normalizedObjective = normalizeObjective(objective)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "continuity packet is read-only; no Commander proposal was generated, no provider/MCP/online research was called, no research.db write occurred, and no mission state changed",
      "proposal lineage service is not fully wired; using bounded recent execution/research lineage",
      "continuity thread inference is best-effort; explicit proposal thread IDs are future work",
    ])
    if (!objective) blockers.push("objective is required")

    const maxRecent = clamp(input.max_recent_sessions, 5, 1, 20)
    const maxOpenLoops = clamp(input.max_open_loops, 12, 1, 50)
    const maxCandidates = clamp(input.max_research_candidates, 8, 1, 20)
    const maxInspected = clamp(input.max_inspected_memory, 4, 0, 8)
    const includeOpenLoops = input.include_open_loops !== false
    const includeRecent = input.include_recent_sessions !== false
    const includeResearch = input.include_research_memory !== false
    const includeNearDuplicates = input.include_near_duplicates !== false

    const recentSessions = includeRecent ? await this.options.opencodeSessionService.list({ limit: maxRecent, mission_id: optional(input.mission_id) }) : []
    const openLoops = includeOpenLoops ? await this.openLoops({ session_id: optional(input.session_id), limit: maxOpenLoops }) : []
    const research = includeResearch && objective ? await this.researchSection(objective, {
      maxCandidates,
      maxInspected,
      includeNearDuplicates,
      sessionId: optional(input.session_id),
      missionId: optional(input.mission_id),
    }) : null

    if (!research) warnings.add("research-memory section omitted by request or missing objective")
    if (research?.main.length === 0 && research.failures.length === 0 && research.probes.length === 0) warnings.add("no bounded research-memory candidates matched the objective")
    const noveltyRisk = research?.near_duplicates?.novelty_risk
    const hasBlockingLoops = openLoops.some((loop) => loop.blocking)
    const readiness: CommanderContinuityDecisionReadiness = blockers.length
      ? "blocked"
      : hasBlockingLoops
        ? "open_loops_pending"
        : noveltyRisk === "high"
          ? "duplicate_risk_high"
          : research && research.profile.has_research_db_projection === false
            ? "needs_research_memory"
            : "ready"

    const sourceRefs = uniqueRefs([
      ...recentSessions.map((session) => ref("opencode_session", session.session_id, "recent planned session", sessionObjective(session), session.status)),
      ...openLoops.map((loop) => loop.source_ref),
      ...researchRefs(research?.main ?? []),
      ...researchRefs(research?.failures ?? []),
      ...researchRefs(research?.probes ?? []),
    ])
    const sections = buildSections([
      section("authority", "Authority capsule", "Continuity packet is bounded read-only context; future Commander proposal gate must explicitly consume it.", [], 1),
      section("project_direction", "Project direction", recentSessions.length ? `Recent sessions suggest current direction around ${joinPreviews(recentSessions.map(sessionObjective), 3)}.` : "No recent planned sessions available; using objective as direction anchor.", recentSessions.map((session) => ref("opencode_session", session.session_id, "recent session", sessionObjective(session), session.status)), recentSessions.length),
      section("proposal_lineage", "Proposal lineage", "Best-effort lineage uses recent sessions, result reviews, research ingestions, and wake/action records; explicit proposal thread IDs are future work.", [], 0, ["proposal lineage service is not fully wired"]),
      section("recent_execution", "Recent execution", recentSessions.length ? `${recentSessions.length} recent sessions considered.` : "No recent execution sessions were found.", recentSessions.map((session) => ref("opencode_session", session.session_id, "recent execution", sessionObjective(session), session.status)), recentSessions.length),
      section("open_loops", "Open loops", openLoops.length ? `${openLoops.length} open loops should influence Commander decisions.` : "No open loops detected in bounded scan.", openLoops.map((loop) => loop.source_ref), openLoops.length, [], maxOpenLoops),
      section("research_memory", "Research memory", research ? researchSummary(research) : "Research memory omitted or unavailable.", researchRefs([...(research?.main ?? []), ...(research?.failures ?? []), ...(research?.probes ?? [])]), (research?.main.length ?? 0) + (research?.failures.length ?? 0) + (research?.probes.length ?? 0)),
      section("omitted_raw_logs", "Omitted raw logs", "Raw logs, raw OpenCode output, files, diffs, full event log, provider output, and full research.db are excluded.", [], 0),
    ])
    const budget = budgetFor("proposal", input.target_token_budget, sections)
    const packetHash = hash(stableJson({ objective, readiness, openLoops: openLoops.map((loop) => loop.loop_id), research: research?.near_duplicates?.near_duplicate_hash, sourceRefs: sourceRefs.map((source) => source.source_id) }))
    return redactValue({
      packet_id: `commander_continuity_proposal_${packetHash.slice(0, 16)}`,
      packet_kind: "proposal",
      status: blockers.length ? "blocked" : sourceRefs.length ? "ready" : "partial",
      objective_preview: objective,
      normalized_objective_preview: normalizedObjective,
      readiness,
      authority_summary: "Read-only Commander continuity packet; it does not generate proposals, call providers, write research.db, prompt OpenCode, or mutate missions.",
      project_direction_summary: recentSessions.length ? `Recent direction: ${joinPreviews(recentSessions.map(sessionObjective), 3)}` : "No explicit project direction record was found; objective anchors this preview.",
      proposal_lineage_summary: "Best-effort lineage uses bounded recent sessions/results/reviews/ingestions. Dedicated proposal thread IDs are future work.",
      recent_execution_summary: recentSessions.length ? `${recentSessions.length} bounded recent sessions included.` : "No recent sessions included.",
      open_loops: openLoops,
      research_memory_summary: research ? researchSummary(research) : "Research-memory search omitted.",
      research_search_profile_summary: research ? profileSummary(research.profile) : "research memory profile omitted",
      research_queries_executed: research ? researchQueries(objective) : [],
      research_candidates_summary: research ? candidateSummary([...(research.main), ...(research.failures), ...(research.probes)]) : "no research candidates inspected",
      near_duplicate_summary: research?.near_duplicates ? `near duplicate risk ${research.near_duplicates.novelty_risk}; strongest=${research.near_duplicates.strongest_duplicate_score ?? "none"}` : "near-duplicate preview omitted",
      inspected_memory_refs: (research?.inspected ?? []).filter((item) => item.status === "ready").map((item) => ref(item.source_kind, item.memory_id, item.label, item.summary_preview ?? item.question_preview, item.status)),
      novelty_risk: noveltyRisk,
      missing_memory_warning: !research || !research.profile.has_research_db_projection || ((research.main.length + research.failures.length + research.probes.length) === 0),
      why_not_duplicate_required: noveltyRisk === "high",
      blockers: boundArray(blockers),
      warnings: boundArray([...warnings]),
      sections,
      source_refs: sourceRefs.slice(0, 40),
      recommended_commands: proposalCommands(objective, openLoops),
      budget,
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `Proposal continuity packet readiness=${readiness}; open_loops=${openLoops.length}; novelty=${noveltyRisk ?? "unknown"}.`,
      packet_hash: packetHash,
    })
  }

  async midMission(input: CommanderMidMissionContinuityInput = {}): Promise<CommanderMidMissionContinuityPacket> {
    const generatedAt = this.now().toISOString()
    const sessionIdInput = optional(input.session_id)
    const launchIdInput = optional(input.launch_id)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "mid-mission continuity packet is read-only; no Commander proposal, provider/MCP call, research.db write, OpenCode prompt, process control, wake action, or mission mutation occurs",
    ])
    if (!sessionIdInput && !launchIdInput) blockers.push("session_id or launch_id is required")
    const launch = launchIdInput ? await this.options.launchGateService.get(launchIdInput) : null
    if (launchIdInput && !launch) blockers.push("launch_id does not resolve")
    const sessionId = sessionIdInput ?? launch?.session_id ?? ""
    const session = sessionId ? await this.options.opencodeSessionService.get(sessionId) : null
    if (sessionId && !session) blockers.push("session_id does not resolve")
    const activeLaunch = launch ?? (sessionId ? await latestActiveLaunch(this.options.launchGateService, sessionId) : null)
    if (!activeLaunch && sessionId) blockers.push("mid-mission packet requires a launch_started or launched OpenCode session")
    if (activeLaunch && !ACTIVE_LAUNCH_STATUSES.has(activeLaunch.status)) blockers.push(`mid-mission packet requires launch_started or launched; current status is ${activeLaunch.status}`)
    if (activeLaunch && sessionIdInput && activeLaunch.session_id !== sessionIdInput) blockers.push("launch_id does not belong to session_id")

    const sid = sessionId || activeLaunch?.session_id || ""
    const lid = activeLaunch?.launch_id
    const [progress, watchdogs, forcedReports, questions, guidance, deliveries, humanControls, wakePreview, wakeExecution, wakeAction, reports, reviews, ingestions] = await Promise.all([
      sid ? this.options.progressService.latest({ session_id: sid, launch_id: lid }) : Promise.resolve(null),
      sid ? this.options.watchdogService.list({ session_id: sid, launch_id: lid, limit: 10 }) : Promise.resolve([]),
      sid ? this.options.watchdogService.listForcedReports({ session_id: sid, launch_id: lid, limit: 10 }) : Promise.resolve([]),
      sid ? this.options.questionService.listAll({ session_id: sid, launch_id: lid }) : Promise.resolve([]),
      sid ? this.options.guidanceService.listAll({ session_id: sid, launch_id: lid }) : Promise.resolve([]),
      sid ? this.options.guidanceDeliveryService.list({ session_id: sid, launch_id: lid, limit: 10 }) : Promise.resolve([]),
      sid ? this.options.humanControlService.listAll({ session_id: sid, launch_id: lid }) : Promise.resolve([]),
      sid ? this.options.wakeSupervisorService.preview({ session_id: sid, launch_id: lid }).catch(() => null) : Promise.resolve(null),
      sid ? this.options.wakeExecutionService.latest({ session_id: sid, launch_id: lid }) : Promise.resolve(null),
      sid ? this.options.wakeActionExecutionService.latest({ session_id: sid, launch_id: lid }) : Promise.resolve(null),
      sid ? this.options.resultReportService.list({ session_id: sid, launch_id: lid, limit: 10 }) : Promise.resolve([]),
      sid ? this.options.resultReviewService.list({ session_id: sid, launch_id: lid, limit: 10 }) : Promise.resolve([]),
      sid ? this.options.researchIngestionService.list({ session_id: sid, launch_id: lid, limit: 10 }) : Promise.resolve([]),
    ])
    const openLoops = input.include_open_loops === false ? [] : await this.openLoops({ session_id: sid, launch_id: lid, limit: clamp(input.max_open_loops, 12, 1, 50) })
    const objective = bound(session?.objective ?? "")
    const includeResearch = input.include_research_memory === true || questions.some((question) => question.status === "pending_commander") || watchdogs.some((watchdog) => watchdog.watchdog_status === "timed_out" || watchdog.watchdog_status === "stale")
    const research = includeResearch && objective ? await this.researchSection(objective, { maxCandidates: clamp(input.max_research_candidates, 3, 1, 12), maxInspected: 1, includeNearDuplicates: false, sessionId: sid, missionId: session?.mission_id }) : null
    if (!research) warnings.add("research memory omitted to save tokens; no explicit include_research_memory request or blocker-driven memory need")
    if (deliveries.some((delivery) => delivery.delivery_status_after === "pending_delivery")) warnings.add("operator_handoff delivery metadata may not mean OpenCode received guidance")
    const hasBlockingLoops = openLoops.some((loop) => loop.blocking)
    const readiness: CommanderContinuityDecisionReadiness = blockers.length ? "blocked" : hasBlockingLoops ? "needs_human_review" : openLoops.length ? "open_loops_pending" : "ready"
    const sourceRefs = uniqueRefs([
      session ? ref("opencode_session", session.session_id, "planned session", session.objective, session.status) : undefined,
      activeLaunch ? ref("opencode_launch", activeLaunch.launch_id, "active launch", activeLaunch.status, activeLaunch.status) : undefined,
      progress ? ref("opencode_progress", progress.progress_id, progress.kind, progress.report_summary_preview, progress.execution_state) : undefined,
      ...watchdogs.slice(0, 3).map((item) => ref("opencode_watchdog", item.watchdog_id, "watchdog", item.recommended_action, item.watchdog_status)),
      ...questions.slice(0, 4).map((item) => ref("commander_question", item.question_id, item.question_type, item.question_preview, item.status)),
      ...guidance.slice(0, 4).map((item) => ref("commander_guidance", item.guidance_id, item.guidance_scope, item.answer_preview, item.delivery_status)),
      ...humanControls.slice(0, 4).map((item) => ref("human_control", item.control_id, item.control_kind, item.human_note_preview, item.projected_state_after)),
      ...reports.slice(0, 3).map((item) => ref("result_report", item.report_id, item.result_kind, item.summary_preview, item.review_state)),
      ...reviews.slice(0, 3).map((item) => ref("result_review", item.review_id, item.decision, item.rationale_preview, item.projection_state_after)),
      ...ingestions.slice(0, 3).map((item) => ref("research_ingestion", item.ingestion_id, item.evidence_kind, item.evidence_summary_preview, item.research_db_written ? "written" : "not_written")),
      ...openLoops.map((loop) => loop.source_ref),
    ])
    const sections = buildSections([
      section("active_session", "Active session", session ? `Session objective: ${session.objective}` : "Session is missing.", session ? [ref("opencode_session", session.session_id, "session", session.objective, session.status)] : [], session ? 1 : 0),
      section("execution_state", "Execution state", progress ? `Latest progress ${progress.kind}/${progress.execution_state}: ${progress.report_summary_preview}` : "No progress evidence found.", progress ? [ref("opencode_progress", progress.progress_id, progress.kind, progress.report_summary_preview, progress.execution_state)] : [], progress ? 1 : 0),
      section("dialogue_guidance", "Commander dialogue and guidance", `questions=${questions.length}; guidance=${guidance.length}; deliveries=${deliveries.length}`, [...questions.slice(0, 4).map((item) => ref("commander_question", item.question_id, item.question_type, item.question_preview, item.status)), ...guidance.slice(0, 4).map((item) => ref("commander_guidance", item.guidance_id, item.guidance_scope, item.answer_preview, item.delivery_status))], questions.length + guidance.length + deliveries.length),
      section("human_controls", "Human controls", humanControls.length ? `${humanControls.length} human-control records found.` : "No human-control metadata found.", humanControls.slice(0, 5).map((item) => ref("human_control", item.control_id, item.control_kind, item.human_note_preview, item.projected_state_after)), humanControls.length),
      section("wake_result_state", "Wake/result state", `wake=${wakePreview?.supervisor_status ?? "none"}; result_reports=${reports.length}; reviews=${reviews.length}; ingestions=${ingestions.length}`, sourceRefs.filter((item) => ["wake_supervisor", "result_report", "result_review", "research_ingestion"].includes(item.source_kind)), reports.length + reviews.length + ingestions.length),
      section("research_memory", "Research memory", research ? researchSummary(research) : "Research memory omitted.", researchRefs([...(research?.main ?? [])]), research?.main.length ?? 0),
      section("omitted_raw_logs", "Omitted raw logs", "Raw logs, raw OpenCode output, files, diffs, full event log, provider output, and full research.db are excluded.", [], 0),
    ])
    const budget = budgetFor("mid_mission", input.target_token_budget, sections)
    const packetHash = hash(stableJson({ sid, lid, readiness, progress: progress?.progress_id, loops: openLoops.map((loop) => loop.loop_id), wake: wakePreview?.supervisor_hash }))
    return redactValue({
      packet_id: `commander_continuity_midmission_${packetHash.slice(0, 16)}`,
      packet_kind: "mid_mission",
      status: blockers.length ? "blocked" : sourceRefs.length ? "ready" : "partial",
      session_id: sid,
      launch_id: lid,
      objective_preview: objective,
      readiness,
      active_session_summary: session ? `Session ${sid} objective=${session.objective}` : "session missing",
      latest_progress_summary: progress ? `${progress.kind}/${progress.execution_state}: ${progress.report_summary_preview}` : "no progress evidence",
      watchdog_summary: watchdogs[0] ? `${watchdogs[0].watchdog_status}: ${watchdogs[0].recommended_action}` : "no watchdog evidence",
      commander_dialogue_summary: `pending questions=${questions.filter((item) => item.status === "pending_commander" || item.status === "pending_human").length}`,
      guidance_delivery_summary: `guidance pending delivery=${guidance.filter((item) => item.delivery_status === "not_delivered" || item.delivery_status === "pending_delivery").length}; delivery records=${deliveries.length}`,
      human_control_summary: humanControls[0] ? `${humanControls[0].control_kind}/${humanControls[0].projected_state_after}: ${humanControls[0].human_note_preview}` : "no human-control metadata",
      wake_supervision_summary: wakePreview ? `${wakePreview.supervisor_status}/${wakePreview.recommended_action}` : "wake supervisor preview unavailable",
      result_state_summary: `reports=${reports.length}; reviews=${reviews.length}; ingestions=${ingestions.length}`,
      local_session_working_memory_summary: input.include_local_working_memory === false ? "local working memory omitted by request" : "bounded latest progress, watchdog, Commander dialogue, human-control, wake, result, and research refs only",
      research_memory_summary: research ? researchSummary(research) : undefined,
      open_loops: openLoops,
      blockers: boundArray(blockers),
      warnings: boundArray([...warnings]),
      sections,
      source_refs: sourceRefs.slice(0, 40),
      recommended_commands: midmissionCommands(sid, openLoops),
      budget,
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `Mid-mission continuity packet readiness=${readiness}; open_loops=${openLoops.length}.`,
      packet_hash: packetHash,
    })
  }

  async summary(input: CommanderContinuitySummaryInput = {}): Promise<CommanderContinuitySummary> {
    const limit = clamp(input.limit, 10, 1, 50)
    const [sessions, launches, loops] = await Promise.all([
      this.options.opencodeSessionService.list({ limit }),
      this.options.launchGateService.listAll({}),
      this.openLoops({ limit: 100 }),
    ])
    const activeSessions = new Set(launches.filter((launch) => ACTIVE_LAUNCH_STATUSES.has(launch.status)).map((launch) => launch.session_id))
    const threadCards = await Promise.all(sessions.slice(0, limit).map((session) => this.threadCardForSession(session, launches, loops)))
    return redactValue({
      total_recent_sessions: sessions.length,
      active_session_count: activeSessions.size,
      stale_or_timed_out_count: loops.filter((loop) => loop.loop_kind === "session_stale" || loop.loop_kind === "watchdog_timed_out").length,
      pending_question_count: loops.filter((loop) => loop.loop_kind === "pending_commander_question").length,
      pending_guidance_delivery_count: loops.filter((loop) => loop.loop_kind === "pending_guidance_delivery").length,
      human_attention_count: loops.filter((loop) => loop.loop_kind.startsWith("human_")).length,
      result_reports_needing_review_count: loops.filter((loop) => loop.loop_kind === "result_report_needs_review").length,
      accepted_reviews_not_ingested_count: loops.filter((loop) => loop.loop_kind === "accepted_review_not_ingested").length,
      open_loop_count: loops.length,
      latest_threads: threadCards,
      generated_at: this.now().toISOString(),
    })
  }

  async openLoops(input: CommanderContinuityOpenLoopInput = {}): Promise<CommanderContinuityOpenLoop[]> {
    const limit = clamp(input.limit, 20, 1, 100)
    const sessionId = optional(input.session_id)
    const launchId = optional(input.launch_id)
    const loops: CommanderContinuityOpenLoop[] = []
    const [questions, guidance, deliveries, humanControls, reports, reviews, ingestions, watchdogs, forcedReports, wakeActions] = await Promise.all([
      this.options.questionService.listAll({ session_id: sessionId, launch_id: launchId }),
      this.options.guidanceService.listAll({ session_id: sessionId, launch_id: launchId }),
      this.options.guidanceDeliveryService.list({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
      this.options.humanControlService.listAll({ session_id: sessionId, launch_id: launchId }),
      this.options.resultReportService.list({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
      this.options.resultReviewService.list({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
      this.options.researchIngestionService.list({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
      this.options.watchdogService.list({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
      this.options.watchdogService.listForcedReports({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
      this.options.wakeActionExecutionService.list({ session_id: sessionId, launch_id: launchId, limit: MAX_LIST }),
    ])
    for (const question of questions.filter((item) => item.status === "pending_commander" || item.status === "pending_human")) loops.push(loop("pending_commander_question", "blocking", question.session_id, question.launch_id, ref("commander_question", question.question_id, question.question_type, question.question_preview, question.status), `/commander-guidance question=${question.question_id} answer=<answer>`, question.created_at))
    for (const item of guidance.filter((record) => record.delivery_status === "not_delivered" || record.delivery_status === "pending_delivery")) loops.push(loop("pending_guidance_delivery", "warning", item.session_id, item.launch_id, ref("commander_guidance", item.guidance_id, item.guidance_scope, item.answer_preview, item.delivery_status), `/commander-guidance-deliver guidance=${item.guidance_id} mode=operator_handoff`, item.created_at))
    for (const delivery of deliveries.filter((item) => item.delivery_status_after === "pending_delivery")) loops.push(loop("pending_guidance_delivery", "warning", delivery.session_id, delivery.launch_id, ref("guidance_delivery", delivery.delivery_id, delivery.delivery_mode, "operator handoff may not equal real OpenCode delivery", delivery.delivery_status_after), `/commander-guidance-delivery-latest guidance=${delivery.guidance_id}`, delivery.created_at))
    for (const control of humanControls) {
      const kind = humanLoopKind(control.projected_state_after)
      if (kind) loops.push(loop(kind, kind === "human_stop" ? "critical" : "blocking", control.session_id, control.launch_id, ref("human_control", control.control_id, control.control_kind, control.human_note_preview, control.projected_state_after), `/opencode-human-controls session=${control.session_id}`, control.recorded_at))
    }
    const reviewedReportIds = new Set(reviews.map((review) => review.report_id))
    for (const report of reports.filter((item) => (item.review_state === "needs_commander_review" || item.review_state === "needs_human_review") && !reviewedReportIds.has(item.report_id))) loops.push(loop("result_report_needs_review", "blocking", report.session_id, report.launch_id, ref("result_report", report.report_id, report.result_kind, report.summary_preview, report.review_state), `/opencode-result-review report=${report.report_id} decision=<decision> rationale=<rationale>`, report.recorded_at))
    const ingestedReviewIds = new Set(ingestions.filter((item) => item.research_db_written).map((item) => item.review_id))
    for (const review of reviews.filter((item) => item.projection_state_after === "reviewed_accepted" && !ingestedReviewIds.has(item.review_id))) loops.push(loop("accepted_review_not_ingested", "warning", review.session_id, review.launch_id, ref("result_review", review.review_id, itemLabel(review.decision), review.rationale_preview, review.projection_state_after), `/research-ingestion review=${review.review_id}`, review.recorded_at))
    for (const ingestion of ingestions.filter((item) => !item.research_db_written)) loops.push(loop("research_ingestion_failed", "warning", ingestion.session_id, ingestion.launch_id, ref("research_ingestion", ingestion.ingestion_id, ingestion.evidence_kind, ingestion.evidence_summary_preview, "not_written"), `/research-ingestion-latest review=${ingestion.review_id}`, ingestion.recorded_at))
    for (const watchdog of watchdogs.filter((item) => item.watchdog_status === "timed_out" || item.watchdog_status === "stale")) loops.push(loop(watchdog.watchdog_status === "timed_out" ? "watchdog_timed_out" : "session_stale", "blocking", watchdog.session_id, watchdog.launch_id, ref("watchdog", watchdog.watchdog_id, "watchdog", watchdog.recommended_action, watchdog.watchdog_status), `/opencode-force-report session=${watchdog.session_id} reason=<reason>`, watchdog.recorded_at))
    for (const request of forcedReports) loops.push(loop("forced_report_requested", "info", request.session_id, request.launch_id, ref("forced_report", request.request_id, "forced report requested", request.reason, "requested"), `/opencode-progress-latest session=${request.session_id}`, request.requested_at))
    for (const action of wakeActions.filter((item) => item.status === "blocked" || item.effect_kind === "manual_action_required")) loops.push(loop(action.status === "blocked" ? "wake_action_blocked" : "wake_action_manual_required", "warning", action.session_id, action.launch_id, ref("wake_action_execution", action.action_execution_id, action.action_kind, action.summary_preview, action.status), `/opencode-wake-action-show ${action.action_execution_id}`, action.recorded_at))
    const filtered = loops
      .filter((item) => !input.kind || item.loop_kind === input.kind)
      .filter((item) => !input.severity || item.severity === input.severity)
      .sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? ""))
      .slice(0, limit)
    return redactValue(filtered)
  }

  async thread(input: CommanderContinuityThreadInput = {}): Promise<CommanderContinuityThreadCard | null> {
    const sessionId = optional(input.session_id)
    const launchId = optional(input.launch_id)
    const objective = optional(input.objective)
    let launch: OpenCodeLaunchResult | null = null
    if (launchId) launch = await this.options.launchGateService.get(launchId)
    const sid = sessionId ?? launch?.session_id
    const session = sid ? await this.options.opencodeSessionService.get(sid) : null
    if (session) return this.threadCardForSession(session, await this.options.launchGateService.listAll({ session_id: session.session_id }), await this.openLoops({ session_id: session.session_id, limit: 50 }))
    if (!objective && !input.thread_id && !input.mission_id) return null
    const hashValue = hash(stableJson({ thread_id: input.thread_id, mission_id: input.mission_id, objective }))
    return redactValue({
      thread_id: input.thread_id ?? `continuity_thread_${hashValue.slice(0, 16)}`,
      mission_id: optional(input.mission_id),
      objective_preview: bound(objective ?? input.thread_id ?? input.mission_id ?? "unknown thread"),
      latest_status: "best_effort",
      open_loop_count: 0,
      summary_preview: "Best-effort thread inference only; explicit proposal thread IDs are future work.",
    })
  }

  private async researchSection(objective: string, input: { maxCandidates: number; maxInspected: number; includeNearDuplicates: boolean; sessionId?: string; missionId?: string }) {
    const [profile, main, failures, probes, near] = await Promise.all([
      this.options.researchMemoryService.searchProfile(),
      this.options.researchMemoryService.preview({ query: objective, limit: input.maxCandidates, session_id: input.sessionId, mission_id: input.missionId, include_failures: true, include_artifacts: false }),
      this.options.researchMemoryService.preview({ query: `${objective} failed blocked unstable regression`, labels: ["failure"], limit: input.maxCandidates, include_failures: true, include_artifacts: false, session_id: input.sessionId, mission_id: input.missionId }),
      this.options.researchMemoryService.preview({ query: `${objective} probe partial inconclusive`, labels: ["probe"], limit: input.maxCandidates, include_failures: true, include_artifacts: false, session_id: input.sessionId, mission_id: input.missionId }),
      input.includeNearDuplicates ? this.options.researchMemoryService.nearDuplicates({ objective, limit: input.maxCandidates, include_failures: true, include_artifacts: false, session_id: input.sessionId, mission_id: input.missionId }) : Promise.resolve(undefined),
    ])
    const topIds = unique([...main.candidates, ...failures.candidates, ...probes.candidates].map((candidate) => candidate.result_id)).slice(0, input.maxInspected)
    const inspected = topIds.map((memory_id) => {
      try {
        return this.options.researchMemoryService.inspect({ memory_id, include_artifacts: false, include_citations: true })
      } catch {
        return null
      }
    })
    return { profile, main: main.candidates, failures: failures.candidates, probes: probes.candidates, near_duplicates: near, inspected: inspected.filter((item): item is NonNullable<typeof item> => !!item) }
  }

  private async threadCardForSession(session: OpenCodeSessionRecord | OpenCodeSessionPlan, launches: OpenCodeLaunchRecord[], loops: CommanderContinuityOpenLoop[]): Promise<CommanderContinuityThreadCard> {
    const launch = launches.find((item) => item.session_id === session.session_id)
    const [report, review, ingestion] = await Promise.all([
      this.options.resultReportService.latest({ session_id: session.session_id, launch_id: launch?.launch_id }),
      this.options.resultReviewService.latest({ session_id: session.session_id, launch_id: launch?.launch_id }),
      this.options.researchIngestionService.latest({ session_id: session.session_id, launch_id: launch?.launch_id }),
    ])
    const hashValue = hash(stableJson({ session: session.session_id, launch: launch?.launch_id, mission: session.mission_id }))
    const openLoopCount = loops.filter((loopItem) => loopItem.session_id === session.session_id).length
    return redactValue({
      thread_id: `continuity_thread_${hashValue.slice(0, 16)}`,
      session_id: session.session_id,
      launch_id: launch?.launch_id,
      mission_id: session.mission_id,
      objective_preview: bound(sessionObjective(session)),
      latest_status: launch?.status ?? session.status,
      latest_result_report_id: report?.report_id,
      latest_result_review_id: review?.review_id,
      latest_research_ingestion_id: ingestion?.ingestion_id,
      open_loop_count: openLoopCount,
      last_updated_at: report?.recorded_at ?? review?.recorded_at ?? ingestion?.recorded_at ?? ("created_at" in session ? session.created_at : undefined),
      summary_preview: `Best-effort continuity thread for session ${session.session_id}; open_loops=${openLoopCount}.`,
    })
  }
}

export function readCommanderProposalContinuityInput(value: unknown): CommanderProposalContinuityInput {
  const input = isRecord(value) ? value : {}
  return {
    objective: optional(input.objective),
    mission_id: optional(input.missionId ?? input.mission_id ?? input.mission),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_near_duplicates: optionalBoolean(input.includeNearDuplicates ?? input.include_near_duplicates),
    include_open_loops: optionalBoolean(input.includeOpenLoops ?? input.include_open_loops),
    include_recent_sessions: optionalBoolean(input.includeRecentSessions ?? input.include_recent_sessions),
    max_recent_sessions: optionalNumber(input.maxRecentSessions ?? input.max_recent_sessions),
    max_open_loops: optionalNumber(input.maxOpenLoops ?? input.max_open_loops),
    max_research_candidates: optionalNumber(input.maxResearchCandidates ?? input.max_research_candidates),
    max_inspected_memory: optionalNumber(input.maxInspectedMemory ?? input.max_inspected_memory),
    target_token_budget: optionalNumber(input.targetTokenBudget ?? input.target_token_budget),
    model_id: optional(input.modelId ?? input.model_id),
  }
}

export function readCommanderMidMissionContinuityInput(value: unknown): CommanderMidMissionContinuityInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_open_loops: optionalBoolean(input.includeOpenLoops ?? input.include_open_loops),
    include_local_working_memory: optionalBoolean(input.includeLocalWorkingMemory ?? input.include_local_working_memory),
    max_open_loops: optionalNumber(input.maxOpenLoops ?? input.max_open_loops),
    max_research_candidates: optionalNumber(input.maxResearchCandidates ?? input.max_research_candidates),
    target_token_budget: optionalNumber(input.targetTokenBudget ?? input.target_token_budget),
    model_id: optional(input.modelId ?? input.model_id),
  }
}

export function readCommanderContinuitySummaryInput(value: unknown): CommanderContinuitySummaryInput {
  const input = isRecord(value) ? value : {}
  return { limit: optionalNumber(input.limit), include_closed: optionalBoolean(input.includeClosed ?? input.include_closed) }
}

export function readCommanderContinuityOpenLoopInput(value: unknown): CommanderContinuityOpenLoopInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    severity: optional(input.severity),
    kind: optional(input.kind ?? input.loopKind ?? input.loop_kind),
    limit: optionalNumber(input.limit),
  }
}

export function readCommanderContinuityThreadInput(value: unknown): CommanderContinuityThreadInput {
  const input = isRecord(value) ? value : {}
  return {
    thread_id: optional(input.threadId ?? input.thread_id ?? input.thread),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    mission_id: optional(input.missionId ?? input.mission_id ?? input.mission),
    objective: optional(input.objective),
  }
}

function proposalCommands(objective: string, loops: CommanderContinuityOpenLoop[]): CommanderContinuityCommand[] {
  const commands: CommanderContinuityCommand[] = [
    { label: "Preview proposal packet", command: `/commander-continuity-preview objective=${shellish(objective)}`, command_type: "read" },
    { label: "Near duplicates", command: `/research-memory-near-duplicates query=${shellish(objective)}`, command_type: "read" },
    { label: "Open loops", command: "/commander-open-loops", command_type: "read" },
    ...loops.slice(0, 3).map((loopItem) => ({ label: `Resolve ${loopItem.loop_kind}`, command: loopItem.recommended_command ?? "/commander-open-loops", command_type: loopItem.recommended_command?.startsWith("/commander-open-loops") ? "read" as const : "write" as const, notes: "manual explicit command required; continuity preview does not execute recommendations" })),
  ]
  return commands.slice(0, 10)
}

function midmissionCommands(sessionId: string, loops: CommanderContinuityOpenLoop[]): CommanderContinuityCommand[] {
  const commands: CommanderContinuityCommand[] = [
    { label: "Latest progress", command: `/opencode-progress-latest session=${sessionId || "<session_id>"}`, command_type: "read" },
    { label: "Wake supervisor preview", command: `/opencode-wake-supervisor-preview session=${sessionId || "<session_id>"}`, command_type: "read" },
    { label: "Open loops", command: `/commander-open-loops session=${sessionId || "<session_id>"}`, command_type: "read" },
    ...loops.slice(0, 3).map((loopItem) => ({ label: `Review ${loopItem.loop_kind}`, command: loopItem.recommended_command ?? `/commander-open-loops session=${sessionId || "<session_id>"}`, command_type: "write" as const, notes: "manual explicit command required; continuity preview does not execute recommendations" })),
  ]
  return commands.slice(0, 10)
}

async function latestActiveLaunch(service: OpenCodeLaunchGateService, sessionId: string): Promise<OpenCodeLaunchRecord | null> {
  return (await service.listAll({ session_id: sessionId })).find((launch) => ACTIVE_LAUNCH_STATUSES.has(launch.status)) ?? null
}

function humanLoopKind(state: string): CommanderContinuityOpenLoopKind | undefined {
  if (state === "pause_requested") return "human_pause"
  if (state === "stop_requested") return "human_stop"
  if (state === "correction_pending") return "human_correction"
  if (state === "override_pending") return "human_override"
  return undefined
}

function loop(kind: CommanderContinuityOpenLoopKind, severity: CommanderContinuityOpenLoopSeverity, sessionId: string | undefined, launchId: string | undefined, source: CommanderContinuitySourceRef, command: string, createdAt?: string): CommanderContinuityOpenLoop {
  const hashValue = hash(stableJson({ kind, source, command }))
  return {
    loop_id: `continuity_loop_${hashValue.slice(0, 16)}`,
    loop_kind: kind,
    severity,
    blocking: BLOCKING_SEVERITIES.has(severity),
    session_id: sessionId,
    launch_id: launchId,
    source_ref: source,
    summary_preview: bound(`${kind}: ${source.summary_preview ?? source.label ?? source.source_id}`),
    recommended_command: command,
    created_at: createdAt,
  }
}

function section(sectionKind: string, title: string, summary: string, refs: CommanderContinuitySourceRef[], itemCount: number, warnings: string[] = [], cap?: number): CommanderContinuitySection {
  return {
    section_id: `continuity_section_${sectionKind}`,
    section_kind: sectionKind,
    status: cap && itemCount > cap ? "truncated" : itemCount > 0 || refs.length > 0 ? "included" : sectionKind.startsWith("omitted") ? "excluded" : "missing",
    title,
    summary_preview: bound(summary),
    source_refs: uniqueRefs(refs).slice(0, cap ?? 12),
    item_count: itemCount,
    omitted_count: cap ? Math.max(0, itemCount - cap) : 0,
    warnings: boundArray(warnings),
  }
}

function buildSections(sections: CommanderContinuitySection[]): CommanderContinuitySection[] {
  return sections.map((item) => ({ ...item, summary_preview: bound(item.summary_preview) }))
}

function budgetFor(kind: "proposal" | "mid_mission", requested: number | undefined, sections: CommanderContinuitySection[]): CommanderContinuityPacketBudget {
  const target = clamp(requested, kind === "proposal" ? 6000 : 4000, 500, 32_000)
  const sectionBudgets: Record<string, number> = kind === "proposal"
    ? { authority: 300, project_direction: 500, proposal_lineage: 700, recent_execution: 900, open_loops: 700, research_memory: 1800, inspected_memory: 1500, readiness: 400 }
    : { authority_session: 400, execution_state: 800, dialogue_guidance: 700, human_controls: 500, wake_result_state: 700, local_working_memory: 700, research_memory_optional: 800, readiness: 300 }
  const estimated = estimateTokens(JSON.stringify(sections))
  const omitted = sections.filter((item) => item.status === "excluded" || item.status === "missing").map((item) => item.section_kind)
  const truncation = sections.filter((item) => item.status === "truncated").map((item) => `${item.title} truncated ${item.omitted_count} item(s)`)
  return {
    target_token_budget: target,
    estimated_token_count: estimated,
    section_budgets: sectionBudgets,
    omitted_sections: omitted,
    truncation_warnings: truncation,
  }
}

function sessionObjective(session: OpenCodeSessionRecord | OpenCodeSessionPlan): string {
  return "objective" in session ? session.objective : session.summary_preview
}

function researchQueries(objective: string): string[] {
  return [objective, `${objective} failed blocked unstable regression`, `${objective} probe partial inconclusive`].map((item) => bound(item))
}

function researchSummary(research: { profile: { search_engine: string; semantic_search_enabled: false; vector_index_enabled: false; fts_index_enabled: false; has_research_db_projection: boolean }; main: unknown[]; failures: unknown[]; probes: unknown[]; near_duplicates?: { novelty_risk: string } }): string {
  return `search=${research.profile.search_engine}; semantic=${research.profile.semantic_search_enabled}; vector=${research.profile.vector_index_enabled}; fts=${research.profile.fts_index_enabled}; candidates=${research.main.length + research.failures.length + research.probes.length}; novelty=${research.near_duplicates?.novelty_risk ?? "unknown"}; projection=${research.profile.has_research_db_projection}`
}

function profileSummary(profile: { search_engine: string; semantic_search_enabled: false; vector_index_enabled: false; fts_index_enabled: false; scan_limit: number; max_limit: number }): string {
  return `${profile.search_engine}; semantic_search_enabled=${profile.semantic_search_enabled}; vector_index_enabled=${profile.vector_index_enabled}; fts_index_enabled=${profile.fts_index_enabled}; scan_limit=${profile.scan_limit}; max_limit=${profile.max_limit}`
}

function candidateSummary(candidates: ResearchMemoryCandidate[]): string {
  if (candidates.length === 0) return "no bounded research candidates"
  return joinPreviews(candidates.map((candidate) => `${candidate.label}:${candidate.question_preview}`), 4)
}

function researchRefs(candidates: ResearchMemoryCandidate[]): CommanderContinuitySourceRef[] {
  return candidates.flatMap((candidate) => candidate.source_refs.map((source) => ref(source.source_kind, source.source_id, source.label ?? candidate.label, source.summary_preview ?? candidate.question_preview, candidate.status)))
}

function ref(sourceKind: string, sourceId: string, label?: string, summary?: string, status?: string): CommanderContinuitySourceRef {
  return { source_kind: bound(sourceKind, 80), source_id: bound(sourceId, 180), label: optionalBound(label, 120), summary_preview: optionalBound(summary, MAX_TEXT), status: optionalBound(status, 80), pointer_only: true }
}

function uniqueRefs(refs: Array<CommanderContinuitySourceRef | undefined>): CommanderContinuitySourceRef[] {
  const seen = new Set<string>()
  const out: CommanderContinuitySourceRef[] = []
  for (const item of refs) {
    if (!item?.source_id) continue
    const key = `${item.source_kind}:${item.source_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function normalizeObjective(value: string): string {
  return bound(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
}

function itemLabel(value: string): string {
  return bound(value, 120)
}

function joinPreviews(values: string[], limit: number): string {
  return bound(values.filter(Boolean).slice(0, limit).join("; ") || "none")
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function boundArray(values: string[] | undefined, limit = 20): string[] {
  return (values ?? []).map((item) => bound(item)).filter(Boolean).slice(0, limit)
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const safe = bound(value)
  return safe || undefined
}

function optionalBound(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const safe = bound(value, max)
  return safe || undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() ? Number(value) : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value === "true") return true
    if (value === "false") return false
  }
  return undefined
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, Math.trunc(numeric)))
}

function bound(value: unknown, max = MAX_TEXT): string {
  return redactText(String(value ?? "")).replace(/\s+/g, " ").trim().slice(0, max)
}

function shellish(value: string): string {
  return bound(value, 120).replace(/\s+/g, "-")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested
    return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
  })
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
