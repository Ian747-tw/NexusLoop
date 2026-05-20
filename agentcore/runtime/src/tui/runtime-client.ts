import type { RuntimeEvent, RuntimeResearchProjectionHealth, RuntimeStatus } from "../events/event-types"
import type { ExecutorClaim, MissionProgress, MissionRecord, MissionResult } from "../missions/mission-types"
import type { ReviewRequest, ReviewRequestInput, ReviewStatusSummary } from "../missions/review-types"
import type { CommanderProposal, CommanderProposalInput, ProposalStatusSummary } from "../missions/proposal-types"
import type { ListResearchEventsOptions, Note, ResearchEvent, SearchOptions, Topic, TopicSnapshot } from "../research-db/research-db"

export interface SubmitUserMessageResult {
  accepted: true
  missionId: string
  intentId: string
}

export interface RuntimeClient {
  command(name: "runtime.status"): Promise<RuntimeStatus>
  command(name: "runtime.resume" | "runtime.start_new_session" | "runtime.view_records"): Promise<unknown>
  command(name: "runtime.shutdown", payload?: { reason?: string }): Promise<unknown>
  command(name: "runtime.get_mission", payload: { missionId: string }): Promise<MissionRecord | null>
  command(name: "runtime.list_recent_missions", payload?: { limit?: number }): Promise<MissionRecord[]>
  command(name: "runtime.claim_mission", payload: { missionId: string; executorId: string }): Promise<ExecutorClaim>
  command(name: "runtime.record_mission_progress", payload: { missionId: string; claimId: string; message: string }): Promise<MissionProgress>
  command(name: "runtime.submit_mission_result", payload: { missionId: string; claimId: string; summary: string; artifacts?: string[]; researchResultIds?: string[] }): Promise<MissionResult>
  command(name: "runtime.complete_mission", payload: { missionId: string; resultId?: string; summary?: string }): Promise<MissionRecord>
  command(name: "runtime.fail_mission", payload: { missionId: string; reason: string }): Promise<MissionRecord>
  command(name: "runtime.cancel_mission", payload: { missionId: string; reason?: string }): Promise<MissionRecord>
  command(name: "runtime.release_mission_claim", payload: { claimId: string; reason?: string }): Promise<ExecutorClaim>
  command(name: "runtime.list_mission_claims", payload: { missionId: string }): Promise<ExecutorClaim[]>
  command(name: "runtime.list_mission_progress", payload: { missionId: string }): Promise<MissionProgress[]>
  command(name: "runtime.list_mission_results", payload: { missionId: string }): Promise<MissionResult[]>
  command(name: "runtime.create_review_request", payload: Omit<ReviewRequestInput, "mission_id" | "claim_id" | "result_id" | "request_type"> & { missionId?: string; claimId?: string; resultId?: string; requestType?: ReviewRequestInput["request_type"] }): Promise<ReviewRequest>
  command(name: "runtime.get_review_request", payload: { reviewId: string }): Promise<ReviewRequest | null>
  command(name: "runtime.list_review_requests", payload?: { status?: ReviewRequest["status"]; limit?: number }): Promise<ReviewRequest[]>
  command(name: "runtime.approve_review_request", payload: { reviewId: string; decidedBy: string; reason?: string }): Promise<ReviewRequest>
  command(name: "runtime.reject_review_request", payload: { reviewId: string; decidedBy: string; reason?: string }): Promise<ReviewRequest>
  command(name: "runtime.cancel_review_request", payload: { reviewId: string; decidedBy: string; reason?: string }): Promise<ReviewRequest>
  command(name: "runtime.review_status"): Promise<ReviewStatusSummary>
  command(name: "runtime.create_commander_proposal", payload: Omit<CommanderProposalInput, "mission_id" | "claim_id" | "result_id" | "action_kind" | "action_payload" | "proposed_by"> & { missionId?: string; claimId?: string; resultId?: string; actionKind: CommanderProposalInput["action_kind"]; actionPayload?: Record<string, unknown>; proposedBy: string }): Promise<CommanderProposal>
  command(name: "runtime.get_commander_proposal", payload: { proposalId: string }): Promise<CommanderProposal | null>
  command(name: "runtime.list_commander_proposals", payload?: { status?: CommanderProposal["status"]; limit?: number }): Promise<CommanderProposal[]>
  command(name: "runtime.request_proposal_review", payload: { proposalId: string; title?: string; summary?: string; requestedBy: string }): Promise<CommanderProposal>
  command(name: "runtime.cancel_commander_proposal", payload: { proposalId: string; reason?: string }): Promise<CommanderProposal>
  command(name: "runtime.apply_commander_proposal", payload: { proposalId: string }): Promise<CommanderProposal>
  command(name: "runtime.proposal_status"): Promise<ProposalStatusSummary>
  command(name: "research.list_topics", payload?: { query?: string }): Promise<Topic[]>
  command(name: "research.get_topic_snapshot", payload: { topicId: string }): Promise<TopicSnapshot | null>
  command(name: "research.list_events", payload?: { options?: ListResearchEventsOptions }): Promise<ResearchEvent[]>
  command(name: "research.search_notes", payload: { topicId: string; query: string; options?: SearchOptions }): Promise<Note[]>
  command(name: "research.projection_status"): Promise<RuntimeResearchProjectionHealth>
  command(name: "research.rebuild_projection", payload?: { force?: boolean }): Promise<RuntimeResearchProjectionHealth>
  command(name: "runtime.submit_user_message", payload: { message: string }): Promise<SubmitUserMessageResult>
  submitUserMessage(message: string): Promise<SubmitUserMessageResult>
  stream(): AsyncIterable<RuntimeEvent>
}

export interface RuntimeCommandEnvelope {
  command:
    | "runtime.status"
    | "runtime.resume"
    | "runtime.start_new_session"
    | "runtime.view_records"
    | "runtime.get_mission"
    | "runtime.list_recent_missions"
    | "runtime.claim_mission"
    | "runtime.record_mission_progress"
    | "runtime.submit_mission_result"
    | "runtime.complete_mission"
    | "runtime.fail_mission"
    | "runtime.cancel_mission"
    | "runtime.release_mission_claim"
    | "runtime.list_mission_claims"
    | "runtime.list_mission_progress"
    | "runtime.list_mission_results"
    | "runtime.create_review_request"
    | "runtime.get_review_request"
    | "runtime.list_review_requests"
    | "runtime.approve_review_request"
    | "runtime.reject_review_request"
    | "runtime.cancel_review_request"
    | "runtime.review_status"
    | "runtime.create_commander_proposal"
    | "runtime.get_commander_proposal"
    | "runtime.list_commander_proposals"
    | "runtime.request_proposal_review"
    | "runtime.cancel_commander_proposal"
    | "runtime.apply_commander_proposal"
    | "runtime.proposal_status"
    | "research.list_topics"
    | "research.get_topic_snapshot"
    | "research.list_events"
    | "research.search_notes"
    | "research.projection_status"
    | "research.rebuild_projection"
    | "runtime.submit_user_message"
    | "runtime.shutdown"
  payload?: Record<string, unknown>
}
