import type { OperatorCommandExecutionResult, OperatorStagedCommand } from "./operator-actions"

export type Screen = "boot" | "init" | "resume" | "main"

export type FocusTarget =
  | "init-choice"
  | "resume-choice"
  | "executor"
  | "commander"
  | "system-actions"
  | "search-records"
  | "approval"
  | "message-box"

export type Choice = {
  id: string
  label: string
}

export type StreamLine = {
  title: string
  detail?: string
  status?: string
}

export type HeaderState = {
  projectName: string
  runtimeStatus: string
  providerStatus: string
  modelStatus: string
  activeMissionId: string
  activeTrainingCount: number
  openObligationsCount: number
}

export type CommanderState = {
  programState: string
  workIntent: string
  mission: string
  budget: string
  obligations: string[]
  candidates: string[]
  decisions: StreamLine[]
}

export type ApprovalState = {
  specApprovals: StreamLine[]
  candidateApprovals: StreamLine[]
  clarifications: StreamLine[]
}

export type ProviderOnboardingState = {
  provider: string
  model: string
  credentialSource: string
  localEndpoint: string
  connectionStatus: string
}

export type ProjectOnboardingState = {
  plainTextSpec: string
  gpuQuota: string
  wakeHooks: string
  maxParallelRuns: number
  approvalRequirements: string[]
  riskyFields: string[]
}

export type SearchState = {
  query: string
  recordFilters: string[]
  labelFilters: string[]
  records: StreamLine[]
}

export type RuntimeStatusSummary = {
  runtimeStatus: string
  mode: string
  projectName: string
  specApproved: boolean
  lockHeld: boolean
}

export type ResearchProjectionSummary = {
  mode: string
  ok: boolean
  stale: boolean
  reason?: string
  pending_count: number
}

export type ReasoningProviderStatusSummary = {
  kind: "fake" | "minimax" | string
  provider_id: string
  connector_id?: string
  model?: string
  max_input_bytes: number
  max_output_bytes: number
  timeout_ms?: number
  system_prompt_version?: string
  enabled_for: string[]
}

export type MissionRecord = {
  mission_id: string
  intent_id?: string
  objective?: string
  status: string
  created_at?: string
  updated_at?: string
  claimed_at?: string
  completed_at?: string
  cancelled_at?: string
  failure_reason?: string
  cancellation_reason?: string
  completion_summary?: string
  completion_result_id?: string
}

export type MissionSummaryState = {
  pending_count: number
  failed_count: number
  active_claim_count?: number
  completed_count?: number
  cancelled_count?: number
  last_mission_id?: string
  recent: MissionRecord[]
}

export type ExecutorClaimSummary = {
  claim_id: string
  mission_id: string
  executor_id: string
  status: string
  claimed_at?: string
  released_at?: string
  release_reason?: string
}

export type MissionProgressSummary = {
  progress_id: string
  mission_id: string
  claim_id: string
  message: string
  created_at?: string
}

export type MissionResultSummary = {
  result_id: string
  mission_id: string
  claim_id: string
  summary: string
  status: string
  created_at?: string
}

export type MissionExecutionState = {
  selectedMissionId?: string
  selectedClaimId?: string
  selectedResultId?: string
  selectedMission?: MissionRecord | null
  claims: ExecutorClaimSummary[]
  progress: MissionProgressSummary[]
  results: MissionResultSummary[]
  commandError?: string
  lastCommand?: string
}

export type ReviewRequestSummary = {
  review_id: string
  mission_id?: string
  claim_id?: string
  result_id?: string
  request_type: string
  title: string
  summary: string
  requested_by: string
  status: string
  created_at?: string
  updated_at?: string
  decision_at?: string
  decision_by?: string
  decision_reason?: string
}

export type ReviewStatusSummary = {
  pending_count: number
  approved_count: number
  rejected_count: number
  cancelled_count: number
  last_review_id?: string
}

export type ReviewsState = {
  pending: ReviewRequestSummary[]
  recent: ReviewRequestSummary[]
  selectedReview?: ReviewRequestSummary | null
  summary?: ReviewStatusSummary
  commandError?: string
}

export type CommanderProposalSummary = {
  proposal_id: string
  mission_id?: string
  claim_id?: string
  result_id?: string
  review_id?: string
  action_kind: string
  title: string
  summary: string
  proposed_by: string
  status: string
  action_payload?: Record<string, unknown>
  created_at?: string
  updated_at?: string
  decision_at?: string
  applied_at?: string
  application_result?: string
  failure_reason?: string
}

export type ProposalStatusSummary = {
  proposed_count: number
  review_requested_count: number
  approved_count: number
  rejected_count: number
  cancelled_count: number
  applied_count: number
  last_proposal_id?: string
}

export type ProposalsState = {
  recent: CommanderProposalSummary[]
  selectedProposal?: CommanderProposalSummary | null
  summary?: ProposalStatusSummary
  commandError?: string
}

export type CommanderProposalBundleSummary = {
  bundle_id: string
  title: string
  summary: string
  created_by: string
  status: string
  proposal_ids: string[]
  created_at?: string
  updated_at?: string
  cancelled_at?: string
  cancellation_reason?: string
  applied_at?: string
  failure_reason?: string
}

export type ProposalBundleStatusSummary = {
  open_count: number
  review_requested_count: number
  approved_count: number
  partially_approved_count: number
  applied_count: number
  partially_applied_count: number
  cancelled_count: number
  last_bundle_id?: string
}

export type ProposalBundleReadinessSummary = {
  bundle_id: string
  proposal_count: number
  proposed_count: number
  review_requested_count: number
  approved_count: number
  rejected_count: number
  cancelled_count: number
  applied_count: number
  blocked_count: number
  ready_to_apply: boolean
  blockers: string[]
}

export type ProposalBundlesState = {
  recent: CommanderProposalBundleSummary[]
  selectedBundle?: CommanderProposalBundleSummary | null
  readiness?: ProposalBundleReadinessSummary | null
  summary?: ProposalBundleStatusSummary
  commandError?: string
}

export type CommanderPlaybookFieldSummary = {
  name: string
  label: string
  required: boolean
  field_type: string
}

export type CommanderPlaybookSummary = {
  playbook_id: string
  title: string
  description: string
  required_fields: CommanderPlaybookFieldSummary[]
  generated_action_kinds: string[]
  creates_bundle: boolean
}

export type CommanderPlaybookDraftSummary = {
  draft_id?: string
  playbook_id: string
  proposal_ids: string[]
  bundle_id?: string
  review_ids?: string[]
  created_at: string
}

export type CommanderPlaybooksState = {
  catalog: CommanderPlaybookSummary[]
  selectedPlaybook?: CommanderPlaybookSummary | null
  lastDraft?: CommanderPlaybookDraftSummary | null
  commandError?: string
}

export type CommanderWorkbenchDraftSummary = {
  draft_id: string
  playbook_id: string
  status: string
  proposed_by: string
  field_values: Record<string, string>
  proposal_ids: string[]
  bundle_id?: string
  review_ids?: string[]
  created_at: string
  updated_at: string
  cancelled_at?: string
  cancellation_reason?: string
}

export type CommanderWorkbenchStatusSummary = {
  drafted_count: number
  review_requested_count: number
  partially_review_requested_count: number
  cancelled_count: number
  last_draft_id?: string
}

export type CommanderWorkbenchReadinessSummary = {
  draft_id: string
  proposal_count: number
  bundle_id?: string
  review_count: number
  missing_review_count: number
  approved_review_count: number
  rejected_review_count: number
  cancelled_review_count: number
  applied_proposal_count: number
  blockers: string[]
  ready_to_apply: boolean
}

export type CommanderWorkbenchState = {
  drafts: CommanderWorkbenchDraftSummary[]
  selectedDraft?: CommanderWorkbenchDraftSummary | null
  readiness?: CommanderWorkbenchReadinessSummary | null
  summary?: CommanderWorkbenchStatusSummary
  commandError?: string
}

export type CommanderApplyPreviewSummary = {
  target_type: string
  target_id: string
  ready_to_apply: boolean
  proposal_ids: string[]
  bundle_id?: string
  draft_id?: string
  approved_count: number
  applied_count: number
  blocked_count: number
  blockers: string[]
  apply_mode: string
  would_apply: string[]
  would_skip: string[]
}

export type CommanderApplyResultSummary = {
  target_type: string
  target_id: string
  applied: boolean
  applied_proposal_ids: string[]
  skipped_proposal_ids: string[]
  result_summary: string
  created_at: string
}

export type CommanderApplyState = {
  preview?: CommanderApplyPreviewSummary | null
  lastResult?: CommanderApplyResultSummary | null
  commandError?: string
}

export type CommanderAuditEventSummary = {
  event_id?: string
  event_index: number
  kind: string
  category: string
  target_type?: string
  target_id?: string
  related_ids: Record<string, string[]>
  created_at?: string
  title: string
  summary: string
}

export type CommanderAuthorityChainSummary = {
  target_type: string
  target_id: string
  related_ids: Record<string, string[]>
  events: CommanderAuditEventSummary[]
  missing_links: string[]
}

export type CommanderAuditState = {
  timeline: CommanderAuditEventSummary[]
  selectedChain?: CommanderAuthorityChainSummary | null
  commandError?: string
  lastTargetType?: string
  lastTargetId?: string
}

export type CommanderQueueKind =
  | "needs_review"
  | "ready_to_apply"
  | "blocked"
  | "failed_apply"
  | "recently_applied"
  | "drafts_needing_review"
  | "bundles_needing_review"
  | "stale_open"

export type CommanderQueueItemSummary = {
  queue: CommanderQueueKind
  target_type: string
  target_id: string
  title: string
  summary: string
  status: string
  priority?: string
  related_ids: Record<string, string[]>
  blockers?: string[]
  created_at?: string
  updated_at?: string
}

export type CommanderQueueSummary = {
  needs_review_count: number
  ready_to_apply_count: number
  blocked_count: number
  failed_apply_count: number
  recently_applied_count: number
  drafts_needing_review_count: number
  bundles_needing_review_count: number
  stale_open_count: number
  last_updated_at?: string
}

export type CommanderQueuesState = {
  summary?: CommanderQueueSummary
  selectedQueue?: CommanderQueueKind
  items: CommanderQueueItemSummary[]
  totalConsidered?: number
  limit?: number
  commandError?: string
}

export type CommanderTargetType =
  | "mission"
  | "claim"
  | "result"
  | "review"
  | "proposal"
  | "bundle"
  | "draft"
  | "runtime"

export type CommanderSuggestedCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_review?: boolean
  requires_active_runtime?: boolean
}

export type CommanderTargetContextSummary = {
  target_type: CommanderTargetType
  target_id: string
  found: boolean
  title: string
  summary: string
  status?: string
  record_kind?: string
  related_ids: Record<string, string[]>
  queue_membership: CommanderQueueKind[]
  audit_event_count: number
  recent_audit_events: CommanderAuditEventSummary[]
  suggested_commands: CommanderSuggestedCommandSummary[]
  missing_links: string[]
}

export type CommanderNavigationState = {
  selected?: CommanderTargetContextSummary | null
  commandError?: string
}

export type OperatorActionsState = {
  staged?: OperatorStagedCommand | null
  lastResult?: OperatorCommandExecutionResult | null
  commandError?: string
}

export type ExternalApiConnectorSummary = {
  connector_id: string
  title: string
  description?: string
  base_url: string
  allowed_hosts: string[]
  allowed_methods: string[]
  timeout_ms: number
  max_response_bytes: number
  created_at?: string
  updated_at?: string
  credential_refs?: Array<{
    name: string
    source: string
    inject_as: string
    target_name: string
    prefix?: string
    env_name?: string
  }>
}

export type ExternalApiRequestPreviewSummary = {
  connector_id: string
  method: string
  url: string
  allowed: boolean
  blockers: string[]
  redacted_headers: Record<string, string>
  has_body: boolean
  body_bytes: number
  credential_refs_used: string[]
}

export type ExternalApiRequestResultSummary = {
  request_id: string
  connector_id: string
  method: string
  url: string
  status_code?: number
  ok: boolean
  response_bytes?: number
  response_preview?: string
  error?: string
  dry_run: boolean
  created_at: string
}

export type ExternalApiAuditRecordSummary = {
  request_id: string
  connector_id: string
  method: string
  url: string
  status_code?: number
  ok: boolean
  dry_run: boolean
  requested_by: string
  error?: string
  created_at: string
}

export type ExternalApiResearchIngestionPreviewSummary = {
  connector_id: string
  topic_id: string
  method: string
  url: string
  allowed: boolean
  blockers: string[]
  would_create_source: boolean
  would_create_note: boolean
  max_ingested_bytes: number
  credential_refs_used: string[]
  redacted_headers: Record<string, string>
}

export type ExternalApiResearchIngestionResultSummary = {
  ingestion_id: string
  request_id?: string
  connector_id: string
  topic_id: string
  source_id?: string
  note_id?: string
  artifact_id?: string
  audit_request_id?: string
  ok: boolean
  dry_run: boolean
  ingested_bytes: number
  response_preview: string
  error?: string
  created_at: string
}

export type ExternalApiResearchIngestionRecordSummary = {
  ingestion_id: string
  connector_id: string
  topic_id: string
  source_id?: string
  note_id?: string
  artifact_id?: string
  audit_request_id?: string
  ok: boolean
  dry_run: boolean
  requested_by: string
  error?: string
  created_at: string
}

export type ExternalApiResearchState = {
  preview?: ExternalApiResearchIngestionPreviewSummary | null
  lastResult?: ExternalApiResearchIngestionResultSummary | null
  ingestions: ExternalApiResearchIngestionRecordSummary[]
  commandError?: string
}

export type ExternalApiState = {
  connectors: ExternalApiConnectorSummary[]
  selectedConnector?: ExternalApiConnectorSummary | null
  preview?: ExternalApiRequestPreviewSummary | null
  lastResult?: ExternalApiRequestResultSummary | null
  audit: ExternalApiAuditRecordSummary[]
  research?: ExternalApiResearchState
  commandError?: string
}

export type ResearchSynthesisRecommendedActionSummary = {
  title: string
  summary: string
  action_kind: string
  evidence_ids: string[]
}

export type ResearchSynthesisPreviewSummary = {
  topic_id: string
  topic_title: string
  evidence_counts: {
    sources: number
    notes: number
    artifacts: number
    ingestions: number
  }
  context_bytes: number
  max_context_bytes: number
  included_evidence_ids: string[]
  excluded_evidence_count: number
  blockers: string[]
  redacted_context_preview: string
}

export type ResearchSynthesisResultSummary = {
  synthesis_id: string
  topic_id: string
  provider_id: string
  source_note_id?: string
  artifact_id?: string
  proposal_ids?: string[]
  title: string
  summary: string
  findings: string[]
  risks: string[]
  open_questions: string[]
  recommended_actions: ResearchSynthesisRecommendedActionSummary[]
  context_hash: string
  output_hash: string
  created_at: string
  requested_by: string
}

export type ResearchSynthesisRecordSummary = {
  synthesis_id: string
  topic_id: string
  provider_id: string
  source_note_id?: string
  artifact_id?: string
  proposal_ids?: string[]
  title: string
  summary_preview: string
  created_at: string
  requested_by: string
}

export type ResearchSynthesisState = {
  preview?: ResearchSynthesisPreviewSummary | null
  selected?: ResearchSynthesisResultSummary | null
  recent: ResearchSynthesisRecordSummary[]
  commandError?: string
}

export type CommanderCycleRecommendedActionSummary = {
  title: string
  summary: string
  action_kind: string
  rationale: string
  evidence_ids?: string[]
  synthesis_ids?: string[]
  related_target_type?: string
  related_target_id?: string
}

export type CommanderCyclePreviewSummary = {
  objective?: string
  topic_id?: string
  mission_id?: string
  context_counts: {
    sources: number
    notes: number
    artifacts: number
    syntheses: number
    proposals: number
    reviews: number
    queues: number
  }
  context_bytes: number
  max_context_bytes: number
  included_evidence_ids: string[]
  included_synthesis_ids: string[]
  blockers: string[]
  redacted_context_preview: string
}

export type CommanderCycleResultSummary = {
  cycle_id: string
  provider_id: string
  objective?: string
  topic_id?: string
  mission_id?: string
  title: string
  summary: string
  findings: string[]
  risks: string[]
  recommended_actions: CommanderCycleRecommendedActionSummary[]
  proposal_ids?: string[]
  bundle_id?: string
  context_hash: string
  output_hash: string
  created_at: string
  requested_by: string
}

export type CommanderCycleRecordSummary = {
  cycle_id: string
  provider_id: string
  objective_preview?: string
  topic_id?: string
  mission_id?: string
  title: string
  summary_preview: string
  proposal_ids?: string[]
  bundle_id?: string
  created_at: string
  requested_by: string
}

export type CommanderCycleState = {
  preview?: CommanderCyclePreviewSummary | null
  selected?: CommanderCycleResultSummary | null
  recent: CommanderCycleRecordSummary[]
  commandError?: string
}

export type ResearchTopicSummary = {
  id: string
  title: string
  status: string
  created_at?: string
  updated_at?: string
}

export type ResearchNoteSummary = {
  id: string
  topic_id: string
  source_id?: string
  content: string
  tags: string[]
  created_at?: string
}

export type ResearchEventSummary = {
  event_id: string
  event_type: string
  entity_type: string
  entity_id: string
  created_at?: string
}

export type ResearchTopicSnapshotSummary = {
  topic: ResearchTopicSummary
  stats: {
    source_count: number
    note_count: number
    artifact_count: number
    report_count: number
    reviewed_source_count: number
    rejected_source_count: number
  }
  latest_event?: ResearchEventSummary
}

export type ResearchProjectionUiSummary = ResearchProjectionSummary & {
  last_event_id?: string
}

export type ResearchRecordsState = {
  topics: ResearchTopicSummary[]
  selectedTopic?: ResearchTopicSnapshotSummary | null
  notes: ResearchNoteSummary[]
  events: ResearchEventSummary[]
  projection?: ResearchProjectionUiSummary
  lastQuery?: string
  selectedTopicId?: string
  commandError?: string
}

export type UiState = {
  screen: Screen
  projectDir: string
  focus: FocusTarget
  initChoices: Choice[]
  initSelection: number
  resumeChoices: Choice[]
  resumeSelection: number
  header: HeaderState
  executor: StreamLine[]
  commander: CommanderState
  systemActions: StreamLine[]
  search: SearchState
  approval: ApprovalState
  providerOnboarding: ProviderOnboardingState
  projectOnboarding: ProjectOnboardingState
  messageDraft: string
  submittedMessages: string[]
  lastCommand?: string
  runtimeStatus?: RuntimeStatusSummary
  adapterStatus?: Record<string, unknown>
  reasoningProvider?: ReasoningProviderStatusSummary
  researchProjection?: ResearchProjectionSummary
  missions?: MissionSummaryState
  missionExecution?: MissionExecutionState
  runtimeCommandError?: string
  research?: ResearchRecordsState
  reviews?: ReviewsState
  proposals?: ProposalsState
  proposalBundles?: ProposalBundlesState
  commanderPlaybooks?: CommanderPlaybooksState
  commanderWorkbench?: CommanderWorkbenchState
  commanderApply?: CommanderApplyState
  commanderAudit?: CommanderAuditState
  commanderQueues?: CommanderQueuesState
  commanderNavigation?: CommanderNavigationState
  operatorActions?: OperatorActionsState
  externalApi?: ExternalApiState
  researchSynthesis?: ResearchSynthesisState
  commanderCycle?: CommanderCycleState
}

export function initialState(projectDir: string): UiState {
  return {
    screen: "boot",
    projectDir,
    focus: "message-box",
    initChoices: [
      { id: "initialize", label: "Initialize" },
      { id: "cancel", label: "Cancel" },
    ],
    initSelection: 0,
    resumeChoices: [
      { id: "resume", label: "Resume previous run" },
      { id: "new-session", label: "Start new session" },
      { id: "records", label: "View records only" },
    ],
    resumeSelection: 0,
    header: {
      projectName: projectDir.split(/[\\/]/).filter(Boolean).at(-1) ?? "project",
      runtimeStatus: "connecting",
      providerStatus: "provider: placeholder",
      modelStatus: "model: placeholder",
      activeMissionId: "none",
      activeTrainingCount: 0,
      openObligationsCount: 0,
    },
    executor: [],
    commander: {
      programState: "idle",
      workIntent: "none",
      mission: "none",
      budget: "not allocated",
      obligations: [],
      candidates: [],
      decisions: [],
    },
    systemActions: [],
    search: {
      query: "",
      recordFilters: ["research_result", "training_run", "trial", "candidate", "artifact", "citation"],
      labelFilters: ["probe", "smoke_test", "full_training", "finding", "bug_diagnosis"],
      records: [],
    },
    approval: {
      specApprovals: [],
      candidateApprovals: [],
      clarifications: [],
    },
    providerOnboarding: {
      provider: "not configured",
      model: "not configured",
      credentialSource: "not selected",
      localEndpoint: "",
      connectionStatus: "not tested",
    },
    projectOnboarding: {
      plainTextSpec: "",
      gpuQuota: "unset",
      wakeHooks: "unset",
      maxParallelRuns: 1,
      approvalRequirements: [],
      riskyFields: [],
    },
    messageDraft: "",
    submittedMessages: [],
    missions: {
      pending_count: 0,
      failed_count: 0,
      active_claim_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      recent: [],
    },
    missionExecution: {
      claims: [],
      progress: [],
      results: [],
    },
    research: {
      topics: [],
      selectedTopic: null,
      notes: [],
      events: [],
    },
    reviews: {
      pending: [],
      recent: [],
    },
    proposals: {
      recent: [],
    },
    proposalBundles: {
      recent: [],
    },
    commanderPlaybooks: {
      catalog: [],
      selectedPlaybook: null,
      lastDraft: null,
    },
    commanderWorkbench: {
      drafts: [],
      selectedDraft: null,
      readiness: null,
    },
    commanderApply: {
      preview: null,
      lastResult: null,
    },
    commanderAudit: {
      timeline: [],
      selectedChain: null,
    },
    commanderQueues: {
      selectedQueue: "needs_review",
      items: [],
    },
    commanderNavigation: {
      selected: null,
    },
    commanderCycle: {
      preview: null,
      selected: null,
      recent: [],
    },
  }
}
