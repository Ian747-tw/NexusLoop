import { redactText, redactUnknown } from "./redaction"
import type { KeySideEffect } from "./keyboard"
import type { RuntimeClient, SubmitUserMessageResult } from "./runtime"
import type {
  ExecutorClaimSummary,
  MissionRecord,
  MissionExecutionState,
  MissionProgressSummary,
  MissionResultSummary,
  MissionSummaryState,
  ResearchEventSummary,
  ResearchNoteSummary,
  ResearchProjectionSummary,
  ResearchProjectionUiSummary,
  ResearchRecordsState,
  ResearchTopicSnapshotSummary,
  ResearchTopicSummary,
  RuntimeStatusSummary,
  UiState,
} from "./state"

const RESEARCH_TOPIC_LIMIT = 10
const RESEARCH_NOTE_LIMIT = 10
const RESEARCH_EVENT_LIMIT = 10
const MISSION_EXECUTION_LIMIT = 10
const PREVIEW_LENGTH = 160

export type RuntimeUiEffect =
  | KeySideEffect
  | { type: "load-runtime-status" }
  | { type: "load-recent-missions"; limit?: number }
  | { type: "refresh-runtime-records" }
  | { type: "load-research-topics"; query?: string; limit?: number }
  | { type: "load-research-topic-snapshot"; topicId: string }
  | { type: "search-research-notes"; topicId: string; query: string; limit?: number }
  | { type: "load-research-events"; limit?: number }
  | { type: "load-research-projection-status" }
  | { type: "rebuild-research-projection" }
  | { type: "refresh-research-records" }
  | { type: "load-mission-details"; missionId: string }
  | { type: "load-mission-execution-records"; missionId: string }
  | { type: "load-mission-claims"; missionId: string }
  | { type: "load-mission-progress"; missionId: string }
  | { type: "load-mission-results"; missionId: string }
  | { type: "claim-mission"; missionId: string; executorId: string }
  | { type: "record-mission-progress"; missionId: string; claimId: string; message: string }
  | { type: "submit-mission-result"; missionId: string; claimId: string; summary: string }
  | { type: "complete-mission"; missionId: string; resultId?: string; summary?: string }
  | { type: "fail-mission"; missionId: string; reason: string }
  | { type: "cancel-mission"; missionId: string; reason?: string }
  | { type: "release-mission-claim"; claimId: string; reason?: string }

export async function applyRuntimeUiEffect(
  state: UiState,
  runtime: RuntimeClient,
  effect: RuntimeUiEffect,
): Promise<UiState> {
  try {
    switch (effect.type) {
      case "load-runtime-status":
        return applyRuntimeStatus(state, await runtime.command("runtime.status"))
      case "load-recent-missions":
        return applyRecentMissions(state, await runtime.command("runtime.list_recent_missions", { limit: effect.limit ?? 5 }))
      case "refresh-runtime-records":
        return await refreshRuntimeRecords(state, runtime)
      case "load-research-topics":
        return applyResearchTopics(
          state,
          await runtime.command("research.list_topics", effect.query ? { query: effect.query } : {}),
          effect.query,
          effect.limit ?? RESEARCH_TOPIC_LIMIT,
        )
      case "load-research-topic-snapshot":
        return applyResearchTopicSnapshot(
          state,
          await runtime.command("research.get_topic_snapshot", { topicId: effect.topicId }),
          effect.topicId,
        )
      case "search-research-notes":
        return applyResearchNotes(
          state,
          await runtime.command("research.search_notes", {
            topicId: effect.topicId,
            query: effect.query,
            options: { limit: effect.limit ?? RESEARCH_NOTE_LIMIT },
          }),
          effect.topicId,
          effect.query,
          effect.limit ?? RESEARCH_NOTE_LIMIT,
        )
      case "load-research-events":
        return applyResearchEvents(
          state,
          await runtime.command("research.list_events", { options: { limit: effect.limit ?? RESEARCH_EVENT_LIMIT } }),
          effect.limit ?? RESEARCH_EVENT_LIMIT,
        )
      case "load-research-projection-status":
        return applyResearchProjectionStatus(state, await runtime.command("research.projection_status"))
      case "rebuild-research-projection": {
        const next = applyResearchProjectionStatus(state, await runtime.command("research.rebuild_projection", { force: true }))
        return await refreshResearchRecordsOrRecordError(next, runtime)
      }
      case "refresh-research-records":
        return await refreshResearchRecords(state, runtime)
      case "load-mission-details":
        return applyMissionDetails(state, await runtime.command("runtime.get_mission", { missionId: effect.missionId }), effect.missionId)
      case "load-mission-execution-records":
        return await loadMissionExecutionRecords(state, runtime, effect.missionId)
      case "load-mission-claims":
        return applyMissionClaims(state, await runtime.command("runtime.list_mission_claims", { missionId: effect.missionId }), effect.missionId)
      case "load-mission-progress":
        return applyMissionProgress(state, await runtime.command("runtime.list_mission_progress", { missionId: effect.missionId }), effect.missionId)
      case "load-mission-results":
        return applyMissionResults(state, await runtime.command("runtime.list_mission_results", { missionId: effect.missionId }), effect.missionId)
      case "claim-mission": {
        const next = applyMissionClaim(state, await runtime.command("runtime.claim_mission", { missionId: effect.missionId, executorId: effect.executorId }))
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "record-mission-progress": {
        const next = applyMissionProgressRecord(state, await runtime.command("runtime.record_mission_progress", { missionId: effect.missionId, claimId: effect.claimId, message: effect.message }))
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "submit-mission-result": {
        const next = applyMissionResultRecord(state, await runtime.command("runtime.submit_mission_result", { missionId: effect.missionId, claimId: effect.claimId, summary: effect.summary }))
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "complete-mission": {
        const next = applyMissionDetails(state, await runtime.command("runtime.complete_mission", { missionId: effect.missionId, resultId: effect.resultId, summary: effect.summary }), effect.missionId)
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "fail-mission": {
        const next = applyMissionDetails(state, await runtime.command("runtime.fail_mission", { missionId: effect.missionId, reason: effect.reason }), effect.missionId)
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "cancel-mission": {
        const next = applyMissionDetails(state, await runtime.command("runtime.cancel_mission", { missionId: effect.missionId, reason: effect.reason }), effect.missionId)
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "release-mission-claim": {
        const claim = readExecutorClaim(await runtime.command("runtime.release_mission_claim", { claimId: effect.claimId, reason: effect.reason }))
        if (!claim) throw new Error("runtime.release_mission_claim returned invalid claim")
        const next = applyMissionClaim(state, claim)
        return await refreshAfterMissionWrite(next, runtime, claim.mission_id)
      }
      case "send-user-message": {
        const result = await runtime.sendUserMessage(effect.message)
        const next = result ? applySubmissionResult(state, result) : state
        return await refreshRuntimeRecordsOrRecordError(next, runtime)
      }
      case "send-command": {
        const next = await applyNamedRuntimeCommand(state, runtime, effect.command, effect.args ?? [])
        return shouldRefreshAfterCommand(effect.command) ? await refreshRuntimeRecordsOrRecordError(next, runtime) : next
      }
    }
  } catch (error) {
    if (isMissionExecutionEffect(effect)) return recordMissionExecutionCommandError(state, error)
    if (isResearchEffect(effect)) return recordResearchCommandError(state, error)
    return recordRuntimeCommandError(state, error)
  }
}

export async function refreshRuntimeRecords(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next = state
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-runtime-status" })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-recent-missions", limit: 5 })
  return next
}

export async function refreshResearchRecords(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next: UiState = { ...state, research: { ...researchState(state), commandError: undefined } }
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-research-projection-status" })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-research-topics", limit: RESEARCH_TOPIC_LIMIT })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-research-events", limit: RESEARCH_EVENT_LIMIT })
  return next
}

async function refreshRuntimeRecordsOrRecordError(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  try {
    return await refreshRuntimeRecords(state, runtime)
  } catch (error) {
    return recordRuntimeCommandError(state, error)
  }
}

async function refreshResearchRecordsOrRecordError(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  try {
    return await refreshResearchRecords(state, runtime)
  } catch (error) {
    return recordResearchCommandError(state, error)
  }
}

async function loadMissionExecutionRecords(state: UiState, runtime: RuntimeClient, missionId: string): Promise<UiState> {
  let next = await applyRuntimeUiEffect(state, runtime, { type: "load-mission-details", missionId })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-mission-claims", missionId })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-mission-progress", missionId })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-mission-results", missionId })
  return next
}

async function refreshAfterMissionWrite(state: UiState, runtime: RuntimeClient, missionId: string): Promise<UiState> {
  let next = await loadMissionExecutionRecords(state, runtime, missionId)
  next = await refreshRuntimeRecordsOrRecordError(next, runtime)
  return next
}

function applyNamedRuntimeCommand(state: UiState, runtime: RuntimeClient, command: string, args: string[]): Promise<UiState> {
  const commandState = { ...state, lastCommand: command }
  switch (command) {
    case "status":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-runtime-status" })
    case "missions":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-recent-missions", limit: 5 })
    case "research":
      return refreshResearchRecordsOrRecordError(commandState, runtime)
    case "topics":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-topics", limit: RESEARCH_TOPIC_LIMIT })
    case "topic":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-topic-snapshot", topicId: requiredArg(args, 0, "topicId") })
    case "notes":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "search-research-notes",
        topicId: requiredArg(args, 0, "topicId"),
        query: requiredRest(args, 1, "query"),
        limit: RESEARCH_NOTE_LIMIT,
      })
    case "research-events":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-events", limit: RESEARCH_EVENT_LIMIT })
    case "projection":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-projection-status" })
    case "rebuild-projection":
      return applyRuntimeUiEffect(commandState, runtime, { type: "rebuild-research-projection" })
    case "mission":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-execution-records", missionId: requiredArg(args, 0, "missionId") })
    case "claims":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-claims", missionId: requiredArg(args, 0, "missionId") })
    case "progress":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-progress", missionId: requiredArg(args, 0, "missionId") })
    case "results":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-results", missionId: requiredArg(args, 0, "missionId") })
    case "claim":
      return applyRuntimeUiEffect(commandState, runtime, { type: "claim-mission", missionId: requiredArg(args, 0, "missionId"), executorId: requiredArg(args, 1, "executorId") })
    case "progress-add":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "record-mission-progress",
        missionId: requiredArg(args, 0, "missionId"),
        claimId: requiredArg(args, 1, "claimId"),
        message: requiredRest(args, 2, "message"),
      })
    case "result":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "submit-mission-result",
        missionId: requiredArg(args, 0, "missionId"),
        claimId: requiredArg(args, 1, "claimId"),
        summary: requiredRest(args, 2, "summary"),
      })
    case "complete":
      return applyRuntimeUiEffect(commandState, runtime, completeMissionEffect(args))
    case "fail":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "fail-mission",
        missionId: requiredArg(args, 0, "missionId"),
        reason: requiredRest(args, 1, "reason"),
      })
    case "cancel-mission":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "cancel-mission",
        missionId: requiredArg(args, 0, "missionId"),
        reason: optionalRest(args, 1),
      })
    case "release-claim":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "release-mission-claim",
        claimId: requiredArg(args, 0, "claimId"),
        reason: optionalRest(args, 1),
      })
    case "resume":
      return runClientCommand(state, runtime, command)
    case "new-session":
      return runClientCommand(state, runtime, command)
    case "records":
      return runClientCommand(state, runtime, command)
    case "shutdown":
      return runClientCommand(state, runtime, command)
    case "initialize":
    case "cancel":
      return Promise.resolve({ ...state, lastCommand: command, runtimeCommandError: undefined })
    default:
      throw new Error(`unknown TUI command: ${command}`)
  }
}

async function runClientCommand(state: UiState, runtime: RuntimeClient, command: string): Promise<UiState> {
  await runtime.sendCommand(command)
  return { ...state, lastCommand: command, runtimeCommandError: undefined }
}

function shouldRefreshAfterCommand(command: string): boolean {
  return ["resume", "new-session", "records"].includes(command)
}

function isResearchEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") {
    return (
      effect.type.startsWith("load-research") ||
      effect.type === "search-research-notes" ||
      effect.type === "rebuild-research-projection" ||
      effect.type === "refresh-research-records"
    )
  }
  return researchCommands.has(effect.command)
}

const researchCommands = new Set([
  "research",
  "topics",
  "topic",
  "notes",
  "research-events",
  "projection",
  "rebuild-projection",
])

function isMissionExecutionEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") {
    return missionExecutionEffectTypes.has(effect.type)
  }
  return missionExecutionCommands.has(effect.command)
}

const missionExecutionCommands = new Set([
  "mission",
  "claims",
  "progress",
  "results",
  "claim",
  "progress-add",
  "result",
  "complete",
  "fail",
  "cancel-mission",
  "release-claim",
])

const missionExecutionEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-mission-details",
  "load-mission-execution-records",
  "load-mission-claims",
  "load-mission-progress",
  "load-mission-results",
  "claim-mission",
  "record-mission-progress",
  "submit-mission-result",
  "complete-mission",
  "fail-mission",
  "cancel-mission",
  "release-mission-claim",
])

function applyRuntimeStatus(state: UiState, value: unknown): UiState {
  if (!isRecord(value)) throw new Error("runtime.status returned non-object result")
  const runtimeStatus: RuntimeStatusSummary = {
    runtimeStatus: readString(value.runtimeStatus, "unknown"),
    mode: readString(value.mode, "unknown"),
    projectName: readString(value.projectName, state.header.projectName),
    specApproved: readBoolean(value.specApproved),
    lockHeld: readBoolean(value.lockHeld),
  }
  const researchProjection = readResearchProjection(value.researchProjection)
  const missions = readMissionSummary(value.missions, state.missions?.recent ?? [])
  return {
    ...state,
    runtimeStatus,
    adapterStatus: isRecord(value.adapterStatus) ? redactUnknown(value.adapterStatus) : state.adapterStatus,
    researchProjection: researchProjection ?? state.researchProjection,
    missions: missions ?? state.missions,
    runtimeCommandError: undefined,
    header: {
      ...state.header,
      projectName: runtimeStatus.projectName,
      runtimeStatus: runtimeStatus.runtimeStatus,
      activeMissionId: missions?.last_mission_id ?? state.header.activeMissionId,
    },
  }
}

function applyRecentMissions(state: UiState, value: unknown): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_recent_missions returned non-array result")
  const recent = value.map(readMissionRecord).filter((mission): mission is MissionRecord => mission !== null)
  const current = state.missions ?? {
    pending_count: 0,
    failed_count: 0,
    active_claim_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    recent: [],
  }
  return {
    ...state,
    missions: {
      ...current,
      last_mission_id: recent[0]?.mission_id ?? current.last_mission_id,
      recent,
    },
    runtimeCommandError: state.lastCommand === "missions" ? undefined : state.runtimeCommandError,
    header: {
      ...state.header,
      activeMissionId: recent[0]?.mission_id ?? current.last_mission_id ?? state.header.activeMissionId,
    },
  }
}

function applyMissionDetails(state: UiState, value: unknown, missionId: string): UiState {
  return {
    ...state,
    missionExecution: {
      ...missionExecutionState(state),
      selectedMissionId: redactText(missionId),
      selectedMission: readMissionRecord(value),
      commandError: undefined,
    },
    header: {
      ...state.header,
      activeMissionId: redactText(missionId),
    },
  }
}

function applyMissionClaims(state: UiState, value: unknown, missionId: string): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_mission_claims returned non-array result")
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: selectedMissionForTarget(state, selectedMissionId),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      claims: value.map(readExecutorClaim).filter((claim): claim is ExecutorClaimSummary => claim !== null).slice(0, MISSION_EXECUTION_LIMIT),
      commandError: state.lastCommand === "claims" ? undefined : state.missionExecution?.commandError,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionProgress(state: UiState, value: unknown, missionId: string): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_mission_progress returned non-array result")
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: selectedMissionForTarget(state, selectedMissionId),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      progress: value.map(readMissionProgress).filter((item): item is MissionProgressSummary => item !== null).slice(0, MISSION_EXECUTION_LIMIT),
      commandError: state.lastCommand === "progress" ? undefined : state.missionExecution?.commandError,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionResults(state: UiState, value: unknown, missionId: string): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_mission_results returned non-array result")
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: selectedMissionForTarget(state, selectedMissionId),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      results: value.map(readMissionResult).filter((item): item is MissionResultSummary => item !== null).slice(0, MISSION_EXECUTION_LIMIT),
      commandError: state.lastCommand === "results" ? undefined : state.missionExecution?.commandError,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionClaim(state: UiState, value: unknown): UiState {
  const claim = readExecutorClaim(value)
  if (!claim) throw new Error("runtime.claim_mission returned invalid claim")
  const current = missionExecutionState(state)
  const claims = [claim, ...current.claims.filter((item) => item.claim_id !== claim.claim_id)].slice(0, MISSION_EXECUTION_LIMIT)
  return {
    ...state,
    missionExecution: {
      ...current,
      selectedMissionId: claim.mission_id,
      selectedClaimId: claim.claim_id,
      claims,
      commandError: undefined,
    },
  }
}

function applyMissionProgressRecord(state: UiState, value: unknown): UiState {
  const progress = readMissionProgress(value)
  if (!progress) throw new Error("runtime.record_mission_progress returned invalid progress")
  const current = missionExecutionState(state)
  return {
    ...state,
    missionExecution: {
      ...current,
      selectedMissionId: progress.mission_id,
      selectedClaimId: progress.claim_id,
      progress: [progress, ...current.progress.filter((item) => item.progress_id !== progress.progress_id)].slice(0, MISSION_EXECUTION_LIMIT),
      commandError: undefined,
    },
  }
}

function applyMissionResultRecord(state: UiState, value: unknown): UiState {
  const result = readMissionResult(value)
  if (!result) throw new Error("runtime.submit_mission_result returned invalid result")
  const current = missionExecutionState(state)
  return {
    ...state,
    missionExecution: {
      ...current,
      selectedMissionId: result.mission_id,
      selectedClaimId: result.claim_id,
      selectedResultId: result.result_id,
      results: [result, ...current.results.filter((item) => item.result_id !== result.result_id)].slice(0, MISSION_EXECUTION_LIMIT),
      commandError: undefined,
    },
  }
}

function applyResearchTopics(state: UiState, value: unknown, query: string | undefined, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("research.list_topics returned non-array result")
  return {
    ...state,
    research: {
      ...researchState(state),
      topics: value.map(readResearchTopic).filter((topic): topic is ResearchTopicSummary => topic !== null).slice(0, limit),
      lastQuery: query === undefined ? state.research?.lastQuery : redactText(query),
      commandError: state.lastCommand === "topics" ? undefined : state.research?.commandError,
    },
  }
}

function applyResearchTopicSnapshot(state: UiState, value: unknown, topicId: string): UiState {
  return {
    ...state,
    research: {
      ...researchState(state),
      selectedTopic: readTopicSnapshot(value),
      selectedTopicId: redactText(topicId),
      commandError: undefined,
    },
  }
}

function applyResearchNotes(state: UiState, value: unknown, topicId: string, query: string, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("research.search_notes returned non-array result")
  return {
    ...state,
    research: {
      ...researchState(state),
      notes: value.map(readResearchNote).filter((note): note is ResearchNoteSummary => note !== null).slice(0, limit),
      selectedTopic: state.research?.selectedTopic?.topic.id === redactText(topicId) ? state.research.selectedTopic : null,
      selectedTopicId: redactText(topicId),
      lastQuery: redactText(query),
      commandError: undefined,
    },
  }
}

function applyResearchEvents(state: UiState, value: unknown, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("research.list_events returned non-array result")
  return {
    ...state,
    research: {
      ...researchState(state),
      events: value.map(readResearchEvent).filter((event): event is ResearchEventSummary => event !== null).slice(0, limit),
      commandError: state.lastCommand === "research-events" ? undefined : state.research?.commandError,
    },
  }
}

function applyResearchProjectionStatus(state: UiState, value: unknown): UiState {
  const projection = readResearchProjectionUi(value)
  return {
    ...state,
    research: {
      ...researchState(state),
      projection,
      commandError: state.lastCommand === "projection" || state.lastCommand === "rebuild-projection"
        ? undefined
        : state.research?.commandError,
    },
  }
}

function applySubmissionResult(state: UiState, result: SubmitUserMessageResult): UiState {
  return {
    ...state,
    header: { ...state.header, activeMissionId: result.missionId },
    systemActions: [
      ...state.systemActions,
      { title: "mission submitted", detail: `mission_id=${redactText(result.missionId)} intent_id=${redactText(result.intentId)}` },
    ].slice(-12),
  }
}

function recordRuntimeCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    runtimeCommandError: message,
    systemActions: [...state.systemActions, { title: "runtime command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordResearchCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    research: {
      ...researchState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "research command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordMissionExecutionCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    missionExecution: {
      ...missionExecutionState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "mission execution command error", detail: message, status: "failed" }].slice(-12),
  }
}

function readResearchProjection(value: unknown): ResearchProjectionSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    mode: readString(value.mode, "unknown"),
    ok: readBoolean(value.ok),
    stale: readBoolean(value.stale),
    reason: typeof value.reason === "string" ? redactText(value.reason) : undefined,
    pending_count: readNumber(value.pending_count, 0),
  }
}

function readResearchProjectionUi(value: unknown): ResearchProjectionUiSummary {
  if (!isRecord(value)) throw new Error("research.projection_status returned non-object result")
  return {
    mode: readString(value.mode, "unknown"),
    ok: readBoolean(value.ok),
    stale: readBoolean(value.stale),
    reason: typeof value.reason === "string" ? redactText(value.reason) : undefined,
    pending_count: readNumber(value.pending_count, 0),
    last_event_id: typeof value.last_event_id === "string" ? redactText(value.last_event_id) : undefined,
  }
}

function readMissionSummary(value: unknown, recent: MissionRecord[]): MissionSummaryState | undefined {
  if (!isRecord(value)) return undefined
  return {
    pending_count: readNumber(value.pending_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    active_claim_count: readNumber(value.active_claim_count, 0),
    completed_count: readNumber(value.completed_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    last_mission_id: typeof value.last_mission_id === "string" ? redactText(value.last_mission_id) : undefined,
    recent,
  }
}

function readMissionRecord(value: unknown): MissionRecord | null {
  if (!isRecord(value) || typeof value.mission_id !== "string" || typeof value.status !== "string") return null
  return {
    mission_id: redactText(value.mission_id),
    intent_id: typeof value.intent_id === "string" ? redactText(value.intent_id) : undefined,
    objective: typeof value.objective === "string" ? redactText(value.objective) : undefined,
    status: redactText(value.status),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
    claimed_at: typeof value.claimed_at === "string" ? redactText(value.claimed_at) : undefined,
    completed_at: typeof value.completed_at === "string" ? redactText(value.completed_at) : undefined,
    cancelled_at: typeof value.cancelled_at === "string" ? redactText(value.cancelled_at) : undefined,
    failure_reason: typeof value.failure_reason === "string" ? redactText(value.failure_reason) : undefined,
    cancellation_reason: typeof value.cancellation_reason === "string" ? redactText(value.cancellation_reason) : undefined,
    completion_summary: typeof value.completion_summary === "string" ? redactText(value.completion_summary) : undefined,
    completion_result_id: typeof value.completion_result_id === "string" ? redactText(value.completion_result_id) : undefined,
  }
}

function readExecutorClaim(value: unknown): ExecutorClaimSummary | null {
  if (!isRecord(value) || typeof value.claim_id !== "string" || typeof value.mission_id !== "string") return null
  return {
    claim_id: redactText(value.claim_id),
    mission_id: redactText(value.mission_id),
    executor_id: redactText(readString(value.executor_id, "unknown")),
    status: redactText(readString(value.status, "unknown")),
    claimed_at: typeof value.claimed_at === "string" ? redactText(value.claimed_at) : undefined,
    released_at: typeof value.released_at === "string" ? redactText(value.released_at) : undefined,
    release_reason: typeof value.release_reason === "string" ? redactText(value.release_reason) : undefined,
  }
}

function readMissionProgress(value: unknown): MissionProgressSummary | null {
  if (!isRecord(value) || typeof value.progress_id !== "string" || typeof value.mission_id !== "string" || typeof value.claim_id !== "string") return null
  return {
    progress_id: redactText(value.progress_id),
    mission_id: redactText(value.mission_id),
    claim_id: redactText(value.claim_id),
    message: preview(readString(value.message, "")),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readMissionResult(value: unknown): MissionResultSummary | null {
  if (!isRecord(value) || typeof value.result_id !== "string" || typeof value.mission_id !== "string" || typeof value.claim_id !== "string") return null
  return {
    result_id: redactText(value.result_id),
    mission_id: redactText(value.mission_id),
    claim_id: redactText(value.claim_id),
    summary: preview(readString(value.summary, "")),
    status: redactText(readString(value.status, "unknown")),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readResearchTopic(value: unknown): ResearchTopicSummary | null {
  if (!isRecord(value) || typeof value.id !== "string") return null
  return {
    id: redactText(value.id),
    title: readString(value.title, "untitled"),
    status: readString(value.status, "unknown"),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
  }
}

function readResearchNote(value: unknown): ResearchNoteSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.topic_id !== "string") return null
  return {
    id: redactText(value.id),
    topic_id: redactText(value.topic_id),
    source_id: typeof value.source_id === "string" ? redactText(value.source_id) : undefined,
    content: preview(readString(value.content, "")),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string").map(redactText).slice(0, 6) : [],
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readResearchEvent(value: unknown): ResearchEventSummary | null {
  if (
    !isRecord(value) ||
    typeof value.event_id !== "string" ||
    typeof value.event_type !== "string" ||
    typeof value.entity_type !== "string" ||
    typeof value.entity_id !== "string"
  ) return null
  return {
    event_id: redactText(value.event_id),
    event_type: redactText(value.event_type),
    entity_type: redactText(value.entity_type),
    entity_id: redactText(value.entity_id),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readTopicSnapshot(value: unknown): ResearchTopicSnapshotSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error("research.get_topic_snapshot returned non-object result")
  const topic = readResearchTopic(value.topic)
  if (!topic) return null
  const stats = isRecord(value.stats) ? value.stats : {}
  return {
    topic,
    stats: {
      source_count: readNumber(stats.source_count, 0),
      note_count: readNumber(stats.note_count, 0),
      artifact_count: readNumber(stats.artifact_count, 0),
      report_count: readNumber(stats.report_count, 0),
      reviewed_source_count: readNumber(stats.reviewed_source_count, 0),
      rejected_source_count: readNumber(stats.rejected_source_count, 0),
    },
    latest_event: readResearchEvent(value.latest_event) ?? undefined,
  }
}

function researchState(state: UiState): ResearchRecordsState {
  return state.research ?? { topics: [], selectedTopic: null, notes: [], events: [] }
}

function missionExecutionState(state: UiState): MissionExecutionState {
  return state.missionExecution ?? { claims: [], progress: [], results: [] }
}

function selectedMissionForTarget(state: UiState, selectedMissionId: string): MissionRecord | null {
  return state.missionExecution?.selectedMission?.mission_id === selectedMissionId
    ? state.missionExecution.selectedMission
    : null
}

function completeMissionEffect(args: string[]): Extract<RuntimeUiEffect, { type: "complete-mission" }> {
  const missionId = requiredMissionIdArg(args, 0)
  const second = args[1]
  if (!second) return { type: "complete-mission", missionId }
  if (second === "--result") {
    return { type: "complete-mission", missionId, resultId: requiredArg(args, 2, "resultId"), summary: optionalRest(args, 3) }
  }
  if (second.startsWith("--result=")) {
    const resultId = second.slice("--result=".length).trim()
    if (!resultId) throw new Error("resultId is required")
    return { type: "complete-mission", missionId, resultId, summary: optionalRest(args, 2) }
  }
  return { type: "complete-mission", missionId, summary: requiredRest(args, 1, "summary") }
}

function requiredArg(args: string[], index: number, field: string): string {
  const value = args[index]
  if (!value) throw new Error(`${field} is required`)
  return value
}

function requiredMissionIdArg(args: string[], index: number): string {
  const value = args[index]
  if (!value || value.startsWith("--")) throw new Error("missionId is required")
  return value
}

function requiredRest(args: string[], index: number, field: string): string {
  const value = args.slice(index).join(" ").trim()
  if (!value) throw new Error(`${field} is required`)
  return value
}

function optionalRest(args: string[], index: number): string | undefined {
  const value = args.slice(index).join(" ").trim()
  return value || undefined
}

function preview(value: string): string {
  return value.length > PREVIEW_LENGTH ? `${value.slice(0, PREVIEW_LENGTH)}...` : value
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? redactText(value) : fallback
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
