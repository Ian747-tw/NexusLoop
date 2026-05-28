import type { RuntimeEvent, RuntimeResearchProjectionHealth, RuntimeStatus } from "../events/event-types"
import type { ExecutorClaim, MissionProgress, MissionRecord, MissionResult } from "../missions/mission-types"
import type { ReviewRequest, ReviewRequestInput, ReviewStatusSummary } from "../missions/review-types"
import type { CommanderProposal, CommanderProposalInput, ProposalStatusSummary } from "../missions/proposal-types"
import type { CommanderProposalBundle, CommanderProposalBundleInput, CommanderProposalBundleReadiness, CommanderProposalBundleStatus, CommanderProposalBundleSummary } from "../missions/proposal-bundle-types"
import type { CommanderPlaybook, CommanderPlaybookDraftInput, CommanderPlaybookDraftResult } from "../missions/commander-playbook-types"
import type { CommanderPlaybookDraft, CommanderPlaybookDraftReadiness, CommanderPlaybookDraftStatus, CommanderPlaybookDraftSummary } from "../missions/commander-playbook-draft-types"
import type { CommanderApplyPreview, CommanderApplyResult, CommanderApplyTargetType } from "../missions/commander-apply-types"
import type { CommanderAuditEventKind, CommanderAuditTimeline, CommanderAuthorityChain } from "../missions/commander-audit-types"
import type { CommanderQueueKind, CommanderQueueResult, CommanderQueueSummary } from "../missions/commander-queue-types"
import type { CommanderTargetContext, CommanderTargetType } from "../missions/commander-target-context-types"
import type { ExternalApiAuditRecord, ExternalApiConnectorSummary, ExternalApiRequestInput, ExternalApiRequestPreview, ExternalApiRequestResult } from "../external-api/api-connector-types"
import type { ExternalApiResearchIngestionInput, ExternalApiResearchIngestionPreview, ExternalApiResearchIngestionRecord, ExternalApiResearchIngestionResult } from "../external-api/api-research-ingestion-types"
import type { ResearchSynthesisInput, ResearchSynthesisPreview, ResearchSynthesisRecord, ResearchSynthesisResult } from "../research-synthesis/research-synthesis-types"
import type { CommanderCycleInput, CommanderCyclePreview, CommanderCycleRecord, CommanderCycleResult } from "../commander-cycle/commander-cycle-types"
import type { ReasoningProviderStatus } from "../reasoning/reasoning-provider-config"
import type { ReasoningProviderHealth, ReasoningProviderSmokePreview, ReasoningProviderSmokeResult } from "../reasoning/reasoning-health-types"
import type { OpenCodeHandoffPreview, OpenCodeHandoffRecord, OpenCodeHandoffResult } from "../opencode/opencode-handoff-types"
import type { ListResearchEventsOptions, Note, ResearchEvent, SearchOptions, Topic, TopicSnapshot } from "../research-db/research-db"

export interface SubmitUserMessageResult {
  accepted: true
  missionId: string
  intentId: string
}

export interface RuntimeClient {
  command(name: "runtime.status"): Promise<RuntimeStatus>
  command(name: "runtime.reasoning_provider_status"): Promise<ReasoningProviderStatus>
  command(name: "runtime.reasoning_provider_health"): Promise<ReasoningProviderHealth>
  command(name: "runtime.preview_reasoning_provider_smoke", payload?: { surface?: string; requestedBy?: string; requested_by?: string }): Promise<ReasoningProviderSmokePreview>
  command(name: "runtime.execute_reasoning_provider_smoke", payload?: { surface?: string; dryRun?: boolean; dry_run?: boolean; requestedBy?: string; requested_by?: string }): Promise<ReasoningProviderSmokeResult>
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
  command(name: "runtime.create_proposal_bundle", payload: Omit<CommanderProposalBundleInput, "created_by"> & { createdBy: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.get_proposal_bundle", payload: { bundleId: string }): Promise<CommanderProposalBundle | null>
  command(name: "runtime.list_proposal_bundles", payload?: { status?: CommanderProposalBundleStatus; limit?: number }): Promise<CommanderProposalBundle[]>
  command(name: "runtime.add_proposal_to_bundle", payload: { bundleId: string; proposalId: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.proposal_bundle_readiness", payload: { bundleId: string }): Promise<CommanderProposalBundleReadiness>
  command(name: "runtime.request_proposal_bundle_reviews", payload: { bundleId: string; requestedBy: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.apply_proposal_bundle", payload: { bundleId: string; allowPartial?: boolean }): Promise<CommanderProposalBundle>
  command(name: "runtime.cancel_proposal_bundle", payload: { bundleId: string; reason?: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.proposal_bundle_status"): Promise<CommanderProposalBundleSummary>
  command(name: "runtime.list_commander_playbooks"): Promise<CommanderPlaybook[]>
  command(name: "runtime.get_commander_playbook", payload: { playbookId: string }): Promise<CommanderPlaybook | null>
  command(name: "runtime.draft_commander_playbook", payload: Omit<CommanderPlaybookDraftInput, "playbook_id" | "proposed_by" | "requested_by" | "bundle_title" | "bundle_summary" | "create_bundle" | "request_reviews"> & {
    playbookId: string
    proposedBy?: string
    requestedBy?: string
    bundleTitle?: string
    bundleSummary?: string
    createBundle?: boolean
    requestReviews?: boolean
  }): Promise<CommanderPlaybookDraftResult>
  command(name: "runtime.get_commander_playbook_draft", payload: { draftId: string }): Promise<CommanderPlaybookDraft | null>
  command(name: "runtime.list_commander_playbook_drafts", payload?: { status?: CommanderPlaybookDraftStatus; limit?: number }): Promise<CommanderPlaybookDraft[]>
  command(name: "runtime.commander_playbook_draft_status"): Promise<CommanderPlaybookDraftSummary>
  command(name: "runtime.commander_playbook_draft_readiness", payload: { draftId: string }): Promise<CommanderPlaybookDraftReadiness>
  command(name: "runtime.request_commander_playbook_draft_reviews", payload: { draftId: string; requestedBy: string }): Promise<CommanderPlaybookDraft>
  command(name: "runtime.cancel_commander_playbook_draft", payload: { draftId: string; reason?: string }): Promise<CommanderPlaybookDraft>
  command(name: "runtime.commander_apply_preview", payload: { targetType: CommanderApplyTargetType; targetId: string }): Promise<CommanderApplyPreview>
  command(name: "runtime.apply_commander_target", payload: { targetType: CommanderApplyTargetType; targetId: string; allowPartial?: boolean; dryRun?: boolean }): Promise<CommanderApplyResult>
  command(name: "runtime.commander_audit_timeline", payload?: { limit?: number; category?: CommanderAuditEventKind; targetType?: string; targetId?: string; afterEventId?: string; beforeEventId?: string }): Promise<CommanderAuditTimeline>
  command(name: "runtime.commander_authority_chain", payload: { targetType: string; targetId: string }): Promise<CommanderAuthorityChain>
  command(name: "runtime.commander_queue_summary", payload?: { staleAfterMs?: number }): Promise<CommanderQueueSummary>
  command(name: "runtime.commander_queue", payload: { queue: CommanderQueueKind; limit?: number; staleAfterMs?: number }): Promise<CommanderQueueResult>
  command(name: "runtime.commander_target_context", payload: { targetType: CommanderTargetType; targetId: string } | { target_type: CommanderTargetType; target_id: string }): Promise<CommanderTargetContext>
  command(name: "runtime.list_external_api_connectors"): Promise<ExternalApiConnectorSummary[]>
  command(name: "runtime.get_external_api_connector", payload: { connectorId: string } | { connector_id: string }): Promise<ExternalApiConnectorSummary | null>
  command(name: "runtime.preview_external_api_request", payload: ExternalApiRequestInput | {
    connectorId: string
    method: ExternalApiRequestInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    dryRun?: boolean
    requestedBy: string
  }): Promise<ExternalApiRequestPreview>
  command(name: "runtime.execute_external_api_request", payload: ExternalApiRequestInput | {
    connectorId: string
    method: ExternalApiRequestInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    dryRun?: boolean
    requestedBy: string
  }): Promise<ExternalApiRequestResult>
  command(name: "runtime.list_external_api_audit", payload?: { limit?: number }): Promise<ExternalApiAuditRecord[]>
  command(name: "runtime.preview_external_api_research_ingestion", payload: ExternalApiResearchIngestionInput | {
    connectorId: string
    method: ExternalApiResearchIngestionInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    topicId: string
    sourceTitle: string
    noteTitle?: string
    requestedBy: string
    responseSelector?: ExternalApiResearchIngestionInput["response_selector"]
    tags?: string[]
    dryRun?: boolean
  }): Promise<ExternalApiResearchIngestionPreview>
  command(name: "runtime.execute_external_api_research_ingestion", payload: ExternalApiResearchIngestionInput | {
    connectorId: string
    method: ExternalApiResearchIngestionInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    topicId: string
    sourceTitle: string
    noteTitle?: string
    requestedBy: string
    responseSelector?: ExternalApiResearchIngestionInput["response_selector"]
    tags?: string[]
    dryRun?: boolean
  }): Promise<ExternalApiResearchIngestionResult>
  command(name: "runtime.list_external_api_research_ingestions", payload?: { limit?: number }): Promise<ExternalApiResearchIngestionRecord[]>
  command(name: "runtime.preview_research_synthesis", payload: ResearchSynthesisInput | {
    topicId: string
    objective?: string
    providerId?: string
    createProposals?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<ResearchSynthesisPreview>
  command(name: "runtime.execute_research_synthesis", payload: ResearchSynthesisInput | {
    topicId: string
    objective?: string
    providerId?: string
    createProposals?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<ResearchSynthesisResult>
  command(name: "runtime.get_research_synthesis", payload: { synthesisId: string } | { synthesis_id: string }): Promise<ResearchSynthesisResult | null>
  command(name: "runtime.list_research_syntheses", payload?: { limit?: number }): Promise<ResearchSynthesisRecord[]>
  command(name: "runtime.preview_commander_cycle", payload: CommanderCycleInput | {
    objective?: string
    topicId?: string
    missionId?: string
    providerId?: string
    createProposals?: boolean
    createBundle?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<CommanderCyclePreview>
  command(name: "runtime.execute_commander_cycle", payload: CommanderCycleInput | {
    objective?: string
    topicId?: string
    missionId?: string
    providerId?: string
    createProposals?: boolean
    createBundle?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<CommanderCycleResult>
  command(name: "runtime.get_commander_cycle", payload: { cycleId: string } | { cycle_id: string }): Promise<CommanderCycleResult | null>
  command(name: "runtime.list_commander_cycles", payload?: { limit?: number }): Promise<CommanderCycleRecord[]>
  command(name: "runtime.preview_opencode_handoff", payload: { proposalId: string; requestedBy?: string; dryRun?: boolean } | { proposal_id: string; requested_by?: string; dry_run?: boolean }): Promise<OpenCodeHandoffPreview>
  command(name: "runtime.execute_opencode_handoff", payload: { proposalId: string; requestedBy?: string; dryRun?: boolean } | { proposal_id: string; requested_by?: string; dry_run?: boolean }): Promise<OpenCodeHandoffResult>
  command(name: "runtime.list_opencode_handoffs", payload?: { limit?: number }): Promise<OpenCodeHandoffRecord[]>
  command(name: "runtime.get_opencode_handoff", payload: { handoffId: string } | { handoff_id: string }): Promise<OpenCodeHandoffResult | null>
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
    | "runtime.reasoning_provider_status"
    | "runtime.reasoning_provider_health"
    | "runtime.preview_reasoning_provider_smoke"
    | "runtime.execute_reasoning_provider_smoke"
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
    | "runtime.create_proposal_bundle"
    | "runtime.get_proposal_bundle"
    | "runtime.list_proposal_bundles"
    | "runtime.add_proposal_to_bundle"
    | "runtime.proposal_bundle_readiness"
    | "runtime.request_proposal_bundle_reviews"
    | "runtime.apply_proposal_bundle"
    | "runtime.cancel_proposal_bundle"
    | "runtime.proposal_bundle_status"
    | "runtime.list_commander_playbooks"
    | "runtime.get_commander_playbook"
    | "runtime.draft_commander_playbook"
    | "runtime.get_commander_playbook_draft"
    | "runtime.list_commander_playbook_drafts"
    | "runtime.commander_playbook_draft_status"
    | "runtime.commander_playbook_draft_readiness"
    | "runtime.request_commander_playbook_draft_reviews"
    | "runtime.cancel_commander_playbook_draft"
    | "runtime.commander_apply_preview"
    | "runtime.apply_commander_target"
    | "runtime.commander_audit_timeline"
    | "runtime.commander_authority_chain"
    | "runtime.commander_queue_summary"
    | "runtime.commander_queue"
    | "runtime.commander_target_context"
    | "runtime.list_external_api_connectors"
    | "runtime.get_external_api_connector"
    | "runtime.preview_external_api_request"
    | "runtime.execute_external_api_request"
    | "runtime.list_external_api_audit"
    | "runtime.preview_external_api_research_ingestion"
    | "runtime.execute_external_api_research_ingestion"
    | "runtime.list_external_api_research_ingestions"
    | "runtime.preview_research_synthesis"
    | "runtime.execute_research_synthesis"
    | "runtime.get_research_synthesis"
    | "runtime.list_research_syntheses"
    | "runtime.preview_commander_cycle"
    | "runtime.execute_commander_cycle"
    | "runtime.get_commander_cycle"
    | "runtime.list_commander_cycles"
    | "runtime.preview_opencode_handoff"
    | "runtime.execute_opencode_handoff"
    | "runtime.list_opencode_handoffs"
    | "runtime.get_opencode_handoff"
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
