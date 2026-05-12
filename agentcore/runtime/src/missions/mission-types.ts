export type WorkIntentKind = "user_message" | "resume" | "system"
export type WorkIntentStatus = "created" | "queued" | "sent" | "failed" | "cancelled"
export type MissionStatus = "created" | "sent" | "claimed" | "running" | "failed" | "completed" | "cancelled"
export type ExecutorClaimStatus = "active" | "released" | "completed" | "failed" | "cancelled"
export type MissionResultStatus = "submitted" | "accepted" | "rejected"

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
  claimed_at?: string
  running_at?: string
  completed_at?: string
  cancelled_at?: string
  failure_reason?: string
  cancellation_reason?: string
  completion_summary?: string
  completion_result_id?: string
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
  active_claim_count: number
  completed_count: number
  cancelled_count: number
  last_mission_id?: string
}

export interface MissionCreatedResult {
  intent: WorkIntent
  mission: MissionRecord
}

export interface ExecutorClaim {
  claim_id: string
  mission_id: string
  executor_id: string
  claimed_at: string
  status: ExecutorClaimStatus
  released_at?: string
  completed_at?: string
  failed_at?: string
  cancelled_at?: string
  release_reason?: string
  failure_reason?: string
  cancellation_reason?: string
}

export interface MissionProgress {
  progress_id: string
  mission_id: string
  claim_id: string
  message: string
  created_at: string
}

export interface MissionResult {
  result_id: string
  mission_id: string
  claim_id: string
  summary: string
  artifacts?: string[]
  research_result_ids?: string[]
  created_at: string
  status: MissionResultStatus
}

export interface ClaimMissionInput {
  mission_id: string
  executor_id: string
}

export interface MissionProgressInput {
  mission_id: string
  claim_id: string
  message: string
}

export interface MissionResultInput {
  mission_id: string
  claim_id: string
  summary: string
  artifacts?: string[]
  research_result_ids?: string[]
}

export interface CompleteMissionInput {
  result_id?: string
  summary?: string
}
