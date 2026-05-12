import type { ExecutorClaim, MissionProgress, MissionRecord, MissionResult } from "./mission-types"
import { MISSION_TOOL_NAMES, type ExecutorToolCall, type ExecutorToolResult, type MissionToolName } from "./mission-tool-types"
import { redactText, redactValue } from "../security/redaction"

const MISSION_TOOL_NAME_SET = new Set<string>(MISSION_TOOL_NAMES)
const MAX_MISSION_LIST_LIMIT = 100

export interface MissionToolRouterHandlers {
  getMission(missionId: string): Promise<MissionRecord | null>
  listRecentMissions(limit?: number): Promise<MissionRecord[]>
  claimMission(input: { mission_id: string; executor_id: string }): Promise<ExecutorClaim>
  recordMissionProgress(input: { mission_id: string; claim_id: string; message: string }): Promise<MissionProgress>
  submitMissionResult(input: { mission_id: string; claim_id: string; summary: string; artifacts?: string[]; research_result_ids?: string[] }): Promise<MissionResult>
  completeMission(missionId: string, input?: { result_id?: string; summary?: string }): Promise<MissionRecord>
  failMission(missionId: string, reason: string): Promise<MissionRecord>
  cancelMission(missionId: string, reason?: string): Promise<MissionRecord>
  releaseMissionClaim(claimId: string, reason?: string): Promise<ExecutorClaim>
  listMissionClaims(missionId: string): Promise<ExecutorClaim[]>
  listMissionProgress(missionId: string): Promise<MissionProgress[]>
  listMissionResults(missionId: string): Promise<MissionResult[]>
}

export interface MissionToolRouterOptions {
  handlers: MissionToolRouterHandlers
  now?: () => Date
}

export class MissionToolRouter {
  private readonly handlers: MissionToolRouterHandlers
  private readonly now: () => Date

  constructor(options: MissionToolRouterOptions) {
    this.handlers = options.handlers
    this.now = options.now ?? (() => new Date())
  }

  async handle(call: ExecutorToolCall): Promise<ExecutorToolResult> {
    let callId = fallbackString(call, "call_id", "invalid_call")
    let tool = fallbackString(call, "tool", "invalid_tool")
    try {
      const envelope = validateEnvelope(call)
      callId = envelope.callId
      tool = envelope.tool
      if (!MISSION_TOOL_NAME_SET.has(tool)) throw new Error(`unknown executor tool: ${tool}`)
      const result = await this.dispatch(tool as MissionToolName, envelope.payload)
      return {
        call_id: redactText(callId),
        tool: redactText(tool),
        ok: true,
        result: redactValue(result),
        created_at: this.now().toISOString(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        call_id: redactText(callId),
        tool: redactText(tool),
        ok: false,
        error: redactText(message),
        created_at: this.now().toISOString(),
      }
    }
  }

  private dispatch(tool: MissionToolName, payload: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case "mission.get":
        return this.handlers.getMission(requiredString(payload.mission_id ?? payload.missionId, "mission_id"))
      case "mission.list_recent":
        return this.handlers.listRecentMissions(optionalPositiveInteger(payload.limit, "limit", MAX_MISSION_LIST_LIMIT))
      case "mission.claim":
        return this.handlers.claimMission({
          mission_id: requiredString(payload.mission_id ?? payload.missionId, "mission_id"),
          executor_id: requiredString(payload.executor_id ?? payload.executorId, "executor_id"),
        })
      case "mission.record_progress":
        return this.handlers.recordMissionProgress({
          mission_id: requiredString(payload.mission_id ?? payload.missionId, "mission_id"),
          claim_id: requiredString(payload.claim_id ?? payload.claimId, "claim_id"),
          message: requiredString(payload.message, "message"),
        })
      case "mission.submit_result":
        return this.handlers.submitMissionResult({
          mission_id: requiredString(payload.mission_id ?? payload.missionId, "mission_id"),
          claim_id: requiredString(payload.claim_id ?? payload.claimId, "claim_id"),
          summary: requiredString(payload.summary, "summary"),
          artifacts: optionalStringArray(payload.artifacts, "artifacts"),
          research_result_ids: optionalStringArray(payload.research_result_ids ?? payload.researchResultIds, "research_result_ids"),
        })
      case "mission.complete":
        return this.handlers.completeMission(requiredString(payload.mission_id ?? payload.missionId, "mission_id"), {
          result_id: optionalString(payload.result_id ?? payload.resultId, "result_id"),
          summary: optionalString(payload.summary, "summary"),
        })
      case "mission.fail":
        return this.handlers.failMission(requiredString(payload.mission_id ?? payload.missionId, "mission_id"), requiredString(payload.reason, "reason"))
      case "mission.cancel":
        return this.handlers.cancelMission(requiredString(payload.mission_id ?? payload.missionId, "mission_id"), optionalString(payload.reason, "reason"))
      case "mission.release_claim":
        return this.handlers.releaseMissionClaim(requiredString(payload.claim_id ?? payload.claimId, "claim_id"), optionalString(payload.reason, "reason"))
      case "mission.list_claims":
        return this.handlers.listMissionClaims(requiredString(payload.mission_id ?? payload.missionId, "mission_id"))
      case "mission.list_progress":
        return this.handlers.listMissionProgress(requiredString(payload.mission_id ?? payload.missionId, "mission_id"))
      case "mission.list_results":
        return this.handlers.listMissionResults(requiredString(payload.mission_id ?? payload.missionId, "mission_id"))
    }
  }
}

function validateEnvelope(call: ExecutorToolCall): { callId: string; tool: string; payload: Record<string, unknown> } {
  if (!isRecord(call)) throw new Error("executor tool call must be an object")
  const callId = requiredString(call.call_id, "call_id")
  const tool = requiredString(call.tool, "tool")
  if (!isRecord(call.payload)) throw new Error("payload must be an object")
  return { callId, tool, payload: call.payload }
}

function fallbackString(value: unknown, field: string, fallback: string): string {
  if (!isRecord(value)) return fallback
  const candidate = value[field]
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return value.trim()
}

function optionalPositiveInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), max)
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
