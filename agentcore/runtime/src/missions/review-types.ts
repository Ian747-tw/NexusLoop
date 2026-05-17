export type ReviewRequestType =
  | "mission_completion"
  | "mission_failure"
  | "mission_cancellation"
  | "claim_release"
  | "result_acceptance"
  | "operator_checkpoint"
  | "other"

export type ReviewStatus = "pending" | "approved" | "rejected" | "cancelled"

export interface ReviewRequest {
  review_id: string
  mission_id?: string
  claim_id?: string
  result_id?: string
  request_type: ReviewRequestType
  title: string
  summary: string
  requested_by: string
  status: ReviewStatus
  created_at: string
  updated_at: string
  decision_at?: string
  decision_by?: string
  decision_reason?: string
}

export interface ReviewRequestInput {
  mission_id?: string
  claim_id?: string
  result_id?: string
  request_type?: ReviewRequestType
  title: string
  summary: string
  requested_by: string
}

export interface ReviewDecision {
  review_id: string
  decision: Exclude<ReviewStatus, "pending">
  decided_by: string
  reason?: string
  decided_at: string
}

export interface ReviewStatusSummary {
  pending_count: number
  approved_count: number
  rejected_count: number
  cancelled_count: number
  last_review_id?: string
}
