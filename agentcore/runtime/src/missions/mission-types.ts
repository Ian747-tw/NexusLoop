export type WorkIntentKind = "user_message" | "resume" | "system"
export type WorkIntentStatus = "created" | "queued" | "sent" | "failed" | "cancelled"
export type MissionStatus = "created" | "sent" | "failed" | "completed" | "cancelled"

export const MISSION_PROTOCOL_VERSION = 1

export interface WorkIntent {
  intent_id: string
  kind: WorkIntentKind
  message: string
  created_at: string
  status: WorkIntentStatus
}

export interface MissionRecord {
  mission_id: string
  intent_id: string
  project_dir: string
  objective: string
  status: MissionStatus
  created_at: string
  updated_at: string
  sent_at?: string
  failure_reason?: string
}

export interface MissionPacket {
  missionId: string
  intentId: string
  message: string
  objective: string
  createdAt: string
  protocolVersion: typeof MISSION_PROTOCOL_VERSION
}

export interface MissionStatusSummary {
  pending_count: number
  failed_count: number
  last_mission_id?: string
}

export interface MissionCreatedResult {
  intent: WorkIntent
  mission: MissionRecord
}
