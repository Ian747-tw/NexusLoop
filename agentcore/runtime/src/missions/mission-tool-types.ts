export const MISSION_TOOL_NAMES = [
  "mission.get",
  "mission.list_recent",
  "mission.claim",
  "mission.record_progress",
  "mission.submit_result",
  "mission.complete",
  "mission.fail",
  "mission.cancel",
  "mission.release_claim",
  "mission.list_claims",
  "mission.list_progress",
  "mission.list_results",
] as const

export type MissionToolName = (typeof MISSION_TOOL_NAMES)[number]

export interface ExecutorToolCall {
  call_id: string
  tool: string
  payload: Record<string, unknown>
  created_at?: string
}

export interface ExecutorToolResult {
  call_id: string
  tool: string
  ok: boolean
  result?: unknown
  error?: string
  created_at: string
}
