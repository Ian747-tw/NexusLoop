import { redactText, redactUnknown } from "./redaction"
import type { KeySideEffect } from "./keyboard"
import type { RuntimeClient, SubmitUserMessageResult } from "./runtime"
import type { MissionRecord, MissionSummaryState, ResearchProjectionSummary, RuntimeStatusSummary, UiState } from "./state"

export type RuntimeUiEffect =
  | KeySideEffect
  | { type: "load-runtime-status" }
  | { type: "load-recent-missions"; limit?: number }
  | { type: "refresh-runtime-records" }

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
      case "send-user-message": {
        const result = await runtime.sendUserMessage(effect.message)
        const next = result ? applySubmissionResult(state, result) : state
        return await refreshRuntimeRecordsOrRecordError(next, runtime)
      }
      case "send-command": {
        const next = await applyNamedRuntimeCommand(state, runtime, effect.command)
        return shouldRefreshAfterCommand(effect.command) ? await refreshRuntimeRecordsOrRecordError(next, runtime) : next
      }
    }
  } catch (error) {
    return recordRuntimeCommandError(state, error)
  }
}

export async function refreshRuntimeRecords(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next = state
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-runtime-status" })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-recent-missions", limit: 5 })
  return next
}

async function refreshRuntimeRecordsOrRecordError(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  try {
    return await refreshRuntimeRecords(state, runtime)
  } catch (error) {
    return recordRuntimeCommandError(state, error)
  }
}

function applyNamedRuntimeCommand(state: UiState, runtime: RuntimeClient, command: string): Promise<UiState> {
  switch (command) {
    case "status":
      return applyRuntimeUiEffect({ ...state, lastCommand: command }, runtime, { type: "load-runtime-status" })
    case "missions":
      return applyRuntimeUiEffect({ ...state, lastCommand: command }, runtime, { type: "load-recent-missions", limit: 5 })
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
  }
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
