import type { OperatorCommandExecutionResult, OperatorStagedCommand } from "./operator-actions"

export type Screen = "boot" | "init" | "model-setup" | "resume" | "main"

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

export type ModelSetupState = {
  origin: "init" | "main"
  stage: "loading" | "commander" | "executor" | "preview" | "confirmation" | "confirming" | "committed"
  commanderChoices: Choice[]
  executorChoices: Choice[]
  commanderSelection: number
  executorSelection: number
  activeCommanderLabel: string
  activeExecutorLabel: string
  pendingCommanderLabel: string
  pendingExecutorLabel: string
  expectedRevision?: number
  candidateHash?: string
  configurationHash?: string
  activeSetupHash?: string
  pendingSetupHash?: string
  pendingRestart: boolean
  commanderReadiness: string
  executorReadiness: string
  commandError?: string
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

export type ReasoningProviderHealthCheckSummary = {
  name: string
  ok: boolean
  severity: "info" | "warning" | "error" | string
  summary: string
  redacted_detail?: string
}

export type ReasoningProviderHealthSummary = {
  provider_id: string
  kind: "fake" | "minimax" | string
  status: "ok" | "degraded" | "blocked" | string
  enabled_for: string[]
  connector_id?: string
  model?: string
  max_input_bytes: number
  max_output_bytes: number
  timeout_ms?: number
  checks: ReasoningProviderHealthCheckSummary[]
  last_checked_at: string
}

export type ReasoningProviderSmokePreviewSummary = {
  provider_id: string
  kind: "fake" | "minimax" | string
  surface: string
  would_call_network: boolean
  connector_id?: string
  model?: string
  prompt_bytes: number
  max_output_bytes: number
  blockers: string[]
  redacted_request_preview: string
}

export type ReasoningProviderSmokeResultSummary = {
  provider_id: string
  kind: "fake" | "minimax" | string
  surface: string
  ok: boolean
  dry_run: boolean
  connector_id?: string
  model?: string
  request_id?: string
  parsed: boolean
  summary: string
  error?: string
  created_at: string
}

export type ReasoningProviderState = ReasoningProviderStatusSummary & {
  health?: ReasoningProviderHealthSummary
  smokePreview?: ReasoningProviderSmokePreviewSummary
  lastSmoke?: ReasoningProviderSmokeResultSummary
  commandError?: string
}

export type MiniMaxLiveValidationCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type MiniMaxLiveValidationPreviewSummary = {
  validation_id?: string
  status: string
  can_execute: boolean
  provider_kind: string
  provider_id: string
  connector_id?: string
  model?: string
  enabled_surfaces: string[]
  requested_surfaces: string[]
  opt_in_required: boolean
  opt_in_present: boolean
  timeout_ms: number
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
  recommended_commands: MiniMaxLiveValidationCommandSummary[]
  generated_at: string
}

export type MiniMaxLiveValidationSurfaceResultSummary = {
  surface: string
  status: string
  ok: boolean
  parsed: boolean
  request_id?: string
  summary_preview?: string
  error?: string
  duration_ms?: number
  schema_version?: string
}

export type MiniMaxLiveValidationResultSummary = {
  validation_id: string
  status: string
  provider_kind: string
  provider_id: string
  connector_id?: string
  model?: string
  surfaces: MiniMaxLiveValidationSurfaceResultSummary[]
  started_at: string
  completed_at: string
  duration_ms?: number
  requested_by: string
  validation_hash: string
  diagnostics: string[]
  error?: string
}

export type MiniMaxLiveValidationRecordSummary = {
  validation_id: string
  status: string
  provider_id: string
  model?: string
  completed_at: string
  surface_count: number
  succeeded_count: number
  failed_count: number
  summary_preview: string
  validation_hash: string
}

export type MiniMaxLiveValidationState = {
  preview?: MiniMaxLiveValidationPreviewSummary | null
  latestResult?: MiniMaxLiveValidationResultSummary | null
  records: MiniMaxLiveValidationRecordSummary[]
  selected?: MiniMaxLiveValidationResultSummary | null
  commandError?: string
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

export type CommanderToolDescriptorSummary = Record<string, unknown> & {
  tool_id: string
  namespace: string
  name: string
  availability: string
  risk: string
  side_effect_class: string
  load_policy: string
  schema_metadata?: { schema_loaded?: boolean; estimated_schema_tokens?: number; input_schema_hash?: string; output_schema_hash?: string }
  input_field_names?: string[]
  output_field_names?: string[]
  execution_enabled?: false
}

export type CommanderToolRegistrySummaryState = Record<string, unknown> & {
  total_tools: number
  implemented_tools: number
  future_tools: number
  blocked_tools: number
  direct_external_write_count: number
  provider_call_count: number
  github_gateway?: {
    status: "ready" | "blocked"
    connector_id?: string
    repository_count: number
    repositories: string[]
    transport_policy_hash?: string
    blockers: string[]
    warnings: string[]
  }
}

export type CommanderToolSearchPreviewSummary = Record<string, unknown> & {
  status: string
  query_preview: string
  matches: Array<Record<string, unknown> & { tool_id: string; namespace: string; name: string; schema_loaded: boolean; score: number }>
  execution_enabled: false
  warnings: string[]
  blockers: string[]
}

export type CommanderToolProfileSummary = Record<string, unknown> & {
  phase: string
  execution_enabled: false
  allowed_namespaces: string[]
  always_loaded_tool_ids: string[]
  deferred_tool_ids: string[]
  staged_intent_tool_ids: string[]
}

export type CommanderToolBootstrapPreviewSummary = Record<string, unknown> & {
  phase: string
  execution_enabled: false
  always_loaded_tools: CommanderToolDescriptorSummary[]
  deferred_namespaces: Array<Record<string, unknown> & { namespace: string; implemented_count: number; future_count: number }>
  initial_schema_tokens: number
  initial_schema_bytes: number
  over_budget: boolean
  omitted_core_tools: string[]
}

export type CommanderToolRegistryValidationSummary = Record<string, unknown> & {
  status: string
  errors: string[]
  warnings: string[]
  unsafe_exposure_count: number
  authority_mismatch_count: number
}

export type CommanderToolsState = {
  summary?: CommanderToolRegistrySummaryState | null
  records: CommanderToolDescriptorSummary[]
  selected?: CommanderToolDescriptorSummary | null
  search?: CommanderToolSearchPreviewSummary | null
  profile?: CommanderToolProfileSummary | null
  bootstrap?: CommanderToolBootstrapPreviewSummary | null
  validation?: CommanderToolRegistryValidationSummary | null
  commandError?: string
}

export type CommanderInternalReadResultSummary = Record<string, unknown> & {
  tool_id: string
  status: string
  trust_class: string
  instruction_semantics: "none"
  result?: Record<string, unknown> | null
  evidence?: Array<Record<string, unknown> & { evidence_id?: string; source_kind?: string; source_id?: string; summary_preview?: string }>
  warnings?: string[]
  blockers?: string[]
  filesystem_written?: false
  events_appended?: false
  network_called?: false
  provider_called?: false
  mcp_called?: false
  research_db_written?: false
  mission_mutated?: false
  proposal_mutated?: false
  opencode_action_performed?: false
  shell_used?: false
  arbitrary_command_executed?: false
  git_process_invoked?: boolean
}

export type CommanderInternalReadsState = {
  continuitySearch?: CommanderInternalReadResultSummary | null
  repoTree?: CommanderInternalReadResultSummary | null
  repoSearch?: CommanderInternalReadResultSummary | null
  repoFile?: CommanderInternalReadResultSummary | null
  repoSymbol?: CommanderInternalReadResultSummary | null
  gitStatus?: CommanderInternalReadResultSummary | null
  gitDiff?: CommanderInternalReadResultSummary | null
  gitLog?: CommanderInternalReadResultSummary | null
  testManifest?: CommanderInternalReadResultSummary | null
  dependencyManifest?: CommanderInternalReadResultSummary | null
  lastResult?: CommanderInternalReadResultSummary | null
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

export type OpenCodeHandoffPreviewSummary = {
  proposal_id: string
  eligible: boolean
  blockers: string[]
  action_kind: string
  proposal_status: string
  review_id?: string
  review_status?: string
  objective_preview: string
  evidence_ids: string[]
  source_cycle_id?: string
  source_synthesis_id?: string
  would_create_mission: boolean
  would_send_to_adapter: boolean
}

export type OpenCodeHandoffResultSummary = {
  handoff_id: string
  proposal_id: string
  review_id?: string
  mission_id?: string
  intent_id?: string
  adapter_session_id?: string
  objective_preview: string
  sent: boolean
  dry_run: boolean
  created_at: string
  requested_by: string
  source_cycle_id?: string
  source_synthesis_id?: string
  evidence_ids: string[]
}

export type OpenCodeHandoffRecordSummary = {
  handoff_id: string
  proposal_id: string
  mission_id?: string
  intent_id?: string
  sent: boolean
  created_at: string
  requested_by: string
  source_cycle_id?: string
  source_synthesis_id?: string
}

export type OpenCodeHandoffState = {
  preview?: OpenCodeHandoffPreviewSummary | null
  lastResult?: OpenCodeHandoffResultSummary | null
  recent: OpenCodeHandoffRecordSummary[]
  commandError?: string
}

export type OpenCodeProcessSmokePreviewSummary = {
  smoke_id?: string
  status: string
  can_execute: boolean
  adapter_kind?: string
  project_dir: string
  binary_path?: string
  binary_detected: boolean
  opt_in_required: boolean
  opt_in_present: boolean
  timeout_ms: number
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type OpenCodeProcessSmokeResultSummary = {
  smoke_id: string
  status: string
  adapter_kind?: string
  project_dir: string
  binary_path?: string
  started_at: string
  completed_at: string
  duration_ms?: number
  exit_code?: number
  signal?: string
  stdout_preview?: string
  stderr_preview?: string
  diagnostics: string[]
  error?: string
  requested_by: string
  smoke_hash: string
}

export type OpenCodeProcessSmokeRecordSummary = {
  smoke_id: string
  status: string
  adapter_kind?: string
  completed_at: string
  duration_ms?: number
  exit_code?: number
  summary_preview: string
  smoke_hash: string
}

export type OpenCodeProcessSmokeState = {
  preview?: OpenCodeProcessSmokePreviewSummary | null
  latestResult?: OpenCodeProcessSmokeResultSummary | null
  records: OpenCodeProcessSmokeRecordSummary[]
  selected?: OpenCodeProcessSmokeResultSummary | null
  commandError?: string
}

export type OpenCodeHandoffReadinessCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeHandoffReadinessEvidenceSummary = {
  evidence_id: string
  kind: string
  related_id?: string
  status: string
  fresh: boolean
  completed_at?: string
  age_ms?: number
  summary_preview: string
  blockers: string[]
  warnings: string[]
}

export type OpenCodeHandoffReadinessPreviewSummary = {
  readiness_id: string
  status: string
  can_execute_now: false
  proposal_id?: string
  review_id?: string
  mission_id?: string
  handoff_id?: string
  authority: {
    command: string
    slash_command: string
    risk: string
    gate: string
    owner: string
    blocked_by_default: boolean
  }
  latest_smoke?: OpenCodeProcessSmokeRecordSummary
  handoff_preview_summary?: string
  required_evidence: OpenCodeHandoffReadinessEvidenceSummary[]
  optional_evidence: OpenCodeHandoffReadinessEvidenceSummary[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeHandoffReadinessCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type OpenCodeHandoffReadinessSummary = {
  total_considered: number
  ready_count: number
  blocked_count: number
  needs_smoke_count: number
  needs_review_count: number
  latest_smoke_status?: string
  latest_handoff_status?: string
  generated_at: string
}

export type OpenCodeHandoffReadinessState = {
  preview?: OpenCodeHandoffReadinessPreviewSummary | null
  summary?: OpenCodeHandoffReadinessSummary | null
  commandError?: string
}

export type OpenCodeResultReviewCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeResultReviewEvidenceSummary = {
  evidence_id: string
  kind: string
  related_id?: string
  status: string
  fresh: boolean
  completed_at?: string
  age_ms?: number
  summary_preview: string
  blockers: string[]
  warnings: string[]
}

export type OpenCodeResultReviewPacketSummary = {
  packet_id: string
  status: string
  handoff_id?: string
  followup_id?: string
  mission_id?: string
  result_id?: string
  claim_id?: string
  proposal_id?: string
  review_id?: string
  title: string
  objective_preview?: string
  executor_summary_preview?: string
  result_summary_preview?: string
  artifact_previews: string[]
  evidence: OpenCodeResultReviewEvidenceSummary[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeResultReviewCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type OpenCodeResultReviewPacketRecordSummary = {
  packet_id: string
  status: string
  handoff_id?: string
  mission_id?: string
  result_id?: string
  proposal_id?: string
  generated_at: string
  summary_preview: string
}

export type OpenCodeResultReviewSummary = {
  total_considered: number
  ready_count: number
  needs_result_count: number
  failed_count: number
  blocked_count: number
  stale_count: number
  latest_handoff_id?: string
  latest_result_id?: string
  generated_at: string
}

export type OpenCodeResultReviewState = {
  packet?: OpenCodeResultReviewPacketSummary | null
  summary?: OpenCodeResultReviewSummary | null
  records: OpenCodeResultReviewPacketRecordSummary[]
  commandError?: string
}

export type OpenCodeSessionCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeSessionTimeoutPolicySummary = {
  max_wall_time_ms: number
  max_no_progress_ms: number
  heartbeat_interval_ms: number
  max_tool_idle_ms?: number
  forced_pause_enabled: boolean
  report_required_on_timeout: boolean
  timeout_policy_hash: string
}

export type OpenCodeSessionQuestionPolicySummary = {
  allow_opencode_questions: boolean
  commander_answer_required_for_blockers: boolean
  human_escalation_allowed: boolean
  max_pending_questions: number
  question_policy_hash: string
}

export type OpenCodeSessionHumanControlPolicySummary = {
  allow_human_pause: boolean
  allow_human_override: boolean
  allow_human_stop: boolean
  allow_human_guidance_note: boolean
  require_reason_for_stop: boolean
  human_policy_hash: string
}

export type OpenCodeSessionPreviewSummary = {
  preview_id: string
  can_create: boolean
  source_kind: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  title_preview: string
  objective_preview: string
  commander_context_summary_preview: string
  opencode_context_seed_preview: string
  max_context_bytes: number
  success_criteria: string[]
  constraints: string[]
  timeout_policy: OpenCodeSessionTimeoutPolicySummary
  question_policy: OpenCodeSessionQuestionPolicySummary
  human_control_policy: OpenCodeSessionHumanControlPolicySummary
  existing_session_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeSessionCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type OpenCodeSessionPlanSummary = {
  session_id: string
  status: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  source_kind: string
  objective: string
  title: string
  commander_context_summary: string
  opencode_context_seed: string
  shared_context_summary: string
  max_context_bytes: number
  success_criteria: string[]
  constraints: string[]
  artifact_expectations: string[]
  timeout_policy: OpenCodeSessionTimeoutPolicySummary
  question_policy: OpenCodeSessionQuestionPolicySummary
  human_control_policy: OpenCodeSessionHumanControlPolicySummary
  created_at: string
  created_by: string
  session_hash: string
}

export type OpenCodeSessionRecordSummary = {
  session_id: string
  status: string
  title: string
  mission_id?: string
  proposal_id?: string
  source_kind: string
  created_at: string
  updated_at?: string
  summary_preview: string
  session_hash: string
}

export type OpenCodeSessionSummary = {
  total_sessions: number
  planned_count: number
  running_count: number
  paused_count: number
  blocked_count: number
  completed_count: number
  failed_count: number
  cancelled_count: number
  generated_at: string
}

export type OpenCodeSessionsState = {
  preview?: OpenCodeSessionPreviewSummary | null
  latestPlan?: OpenCodeSessionPlanSummary | null
  records: OpenCodeSessionRecordSummary[]
  selected?: OpenCodeSessionPlanSummary | null
  summary?: OpenCodeSessionSummary | null
  commandError?: string
}

export type ModelCapabilitySummary = {
  capability_id: string
  provider_kind: string
  provider_id?: string
  model_id: string
  display_name: string
  role_support: string[]
  max_context_tokens?: number
  max_output_tokens?: number
  max_context_bytes?: number
  supports_tools: boolean | "unknown"
  supports_json_schema: boolean | "unknown"
  supports_mcp: boolean | "unknown"
  supports_long_context: boolean | "unknown"
  supports_streaming: boolean | "unknown"
  supports_local_execution: boolean | "unknown"
  default_temperature?: number
  safety_margin_ratio: number
  source: string
  warnings: string[]
  created_at?: string
}

export type ContextBudgetCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ContextBudgetAllocationSummary = {
  section: string
  max_tokens?: number
  max_bytes?: number
  priority: "required" | "high" | "medium" | "low" | "excluded"
  inclusion_policy: "always" | "if_relevant" | "pointer_only" | "excluded_by_default"
  notes?: string
}

export type ContextBudgetProfileSummary = {
  budget_id: string
  purpose: string
  provider_kind: string
  model_id: string
  session_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  max_output_tokens?: number
  safety_margin_tokens?: number
  safety_margin_bytes?: number
  allocations: ContextBudgetAllocationSummary[]
  warnings: string[]
  generated_at: string
}

export type ContextBudgetPreviewSummary = {
  preview_id: string
  purpose: string
  role: string
  capability?: ModelCapabilitySummary
  session_id?: string
  session_max_context_bytes?: number
  budget: ContextBudgetProfileSummary
  blockers: string[]
  warnings: string[]
  recommended_commands: ContextBudgetCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ContextBudgetSummaryState = {
  total_capabilities: number
  known_context_count: number
  unknown_context_count: number
  local_model_count: number
  cloud_model_count: number
  long_context_count: number
  generated_at: string
}

export type ContextBudgetsState = {
  capabilities: ModelCapabilitySummary[]
  selectedCapability?: ModelCapabilitySummary | null
  preview?: ContextBudgetPreviewSummary | null
  summary?: ContextBudgetSummaryState | null
  commandError?: string
}

export type ContextPacketSourceRefSummary = {
  source_kind: string
  source_id: string
  label?: string
  summary_preview?: string
  event_kind?: string
  pointer_only: boolean
}

export type ContextPacketSectionSummary = {
  section: string
  status: "included" | "pointer_only" | "omitted" | "missing" | "excluded" | string
  priority: "required" | "high" | "medium" | "low" | "excluded" | string
  inclusion_policy: "always" | "if_relevant" | "pointer_only" | "excluded_by_default" | string
  max_tokens?: number
  max_bytes?: number
  estimated_tokens?: number
  estimated_bytes?: number
  summary_preview: string
  source_refs: ContextPacketSourceRefSummary[]
  omitted_reason?: string
  warnings: string[]
}

export type ContextPacketBudgetSummaryState = {
  max_context_tokens?: number
  max_context_bytes?: number
  max_output_tokens?: number
  safety_margin_tokens?: number
  safety_margin_bytes?: number
  estimated_input_tokens?: number
  estimated_input_bytes?: number
  over_budget: boolean
}

export type ContextPacketCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ContextPacketPreviewSummary = {
  packet_id: string
  role: string
  purpose: string
  budget_id: string
  provider_kind?: string
  model_id?: string
  session_id?: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  packet_status: "ready" | "blocked" | "partial" | "unknown" | string
  can_compile_final_prompt: false
  sections: ContextPacketSectionSummary[]
  included_source_refs: ContextPacketSourceRefSummary[]
  omitted_source_refs: ContextPacketSourceRefSummary[]
  budget_summary: ContextPacketBudgetSummaryState
  blockers: string[]
  warnings: string[]
  recommended_commands: ContextPacketCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type ContextPacketSummaryState = {
  supported_purposes: string[]
  supported_roles: string[]
  generated_at: string
}

export type ContextPacketsState = {
  preview?: ContextPacketPreviewSummary | null
  summary?: ContextPacketSummaryState | null
  commandError?: string
}

export type OpenCodeSessionInstructionPackCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeSessionInstructionPackFilePreviewSummary = {
  file_kind: string
  relative_path: string
  would_write: boolean
  size_bytes: number
  sha256: string
  summary_preview: string
  sections_used: string[]
  source_refs: string[]
  warnings: string[]
}

export type OpenCodeSessionInstructionPackPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | "written" | "failed" | "dry_run" | string
  can_write: boolean
  session_id: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  source_kind?: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  target_dir: string
  files: OpenCodeSessionInstructionPackFilePreviewSummary[]
  total_size_bytes: number
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeSessionInstructionPackCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  pack_hash: string
}

export type OpenCodeSessionInstructionPackResultSummary = {
  pack_id: string
  status: "written" | "blocked" | "failed" | "dry_run" | string
  session_id: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  target_dir: string
  files: OpenCodeSessionInstructionPackFilePreviewSummary[]
  total_size_bytes: number
  written_at: string
  written_by: string
  error?: string
  pack_hash: string
  recommended_commands: OpenCodeSessionInstructionPackCommandSummary[]
}

export type OpenCodeSessionInstructionPackRecordSummary = {
  pack_id: string
  status: string
  session_id: string
  packet_id?: string
  target_dir: string
  file_count: number
  total_size_bytes: number
  written_at: string
  summary_preview: string
  pack_hash: string
}

export type OpenCodeSessionInstructionPacksState = {
  preview?: OpenCodeSessionInstructionPackPreviewSummary | null
  latestResult?: OpenCodeSessionInstructionPackResultSummary | null
  records: OpenCodeSessionInstructionPackRecordSummary[]
  selected?: OpenCodeSessionInstructionPackResultSummary | null
  commandError?: string
}

export type OpenCodeLaunchReadinessSourceRefSummary = {
  source_kind: string
  source_id: string
  label?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeLaunchReadinessCheckSummary = {
  check_id: string
  label: string
  status: "pass" | "warn" | "fail" | "unknown" | string
  summary_preview: string
  blockers: string[]
  warnings: string[]
  source_refs: OpenCodeLaunchReadinessSourceRefSummary[]
}

export type OpenCodeLaunchReadinessCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeLaunchReadinessPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | "partial" | "unknown" | string
  can_launch_in_future: boolean
  launch_performed: false
  session_id: string
  pack_id?: string
  packet_id?: string
  budget_id?: string
  source_kind?: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  target_dir?: string
  instruction_files_verified: boolean
  manifest_verified: boolean
  config_verified: boolean
  context_packet_status?: string
  context_budget_status?: string
  research_memory_status?: string
  novelty_risk?: string
  selected_launch_surface: string
  checks: OpenCodeLaunchReadinessCheckSummary[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeLaunchReadinessCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  readiness_hash: string
}

export type OpenCodeLaunchReadinessSummaryState = {
  total_planned_sessions: number
  ready_count: number
  blocked_count: number
  partial_count: number
  generated_at: string
}

export type OpenCodeLaunchReadinessState = {
  preview?: OpenCodeLaunchReadinessPreviewSummary | null
  summary?: OpenCodeLaunchReadinessSummaryState | null
  commandError?: string
}

export type OpenCodeLaunchCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeLaunchPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_launch: boolean
  launch_performed: false
  adapter_kind: string
  launch_mode: "fresh" | string
  session_id: string
  pack_id?: string
  readiness_hash?: string
  readiness_status?: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  target_dir?: string
  command_preview?: string
  env_preview?: string
  instruction_files: string[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeLaunchCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  launch_hash: string
}

export type OpenCodeLaunchResultSummary = {
  launch_id: string
  status: "dry_run" | "launched" | "launch_started" | "launch_failed" | "blocked" | string
  adapter_kind: string
  launch_mode: "fresh" | string
  session_id: string
  pack_id?: string
  readiness_hash?: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  target_dir?: string
  process_id?: number
  native_session_id?: string
  command_preview?: string
  started_at?: string
  completed_at?: string
  exit_code?: number
  error?: string
  launch_performed: boolean
  output_summary_preview?: string
  event_count?: number
  launch_hash: string
  recommended_commands: OpenCodeLaunchCommandSummary[]
}

export type OpenCodeLaunchRecordSummary = {
  launch_id: string
  status: string
  adapter_kind: string
  launch_mode: string
  session_id: string
  pack_id?: string
  native_session_id?: string
  process_id?: number
  started_at: string
  completed_at?: string
  exit_code?: number
  summary_preview: string
  launch_hash: string
}

export type OpenCodeLaunchesState = {
  preview?: OpenCodeLaunchPreviewSummary | null
  latestResult?: OpenCodeLaunchResultSummary | null
  records: OpenCodeLaunchRecordSummary[]
  selected?: OpenCodeLaunchResultSummary | null
  commandError?: string
}

export type OpenCodeProgressCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeProgressPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_record: boolean
  session_id: string
  launch_id?: string
  launch_status?: string
  launch_started_at?: string
  kind: string
  execution_state: string
  report_summary_preview: string
  current_step_preview?: string
  files_touched_preview: string[]
  commands_run_preview: string[]
  tests_run_preview: string[]
  artifacts_preview: string[]
  blockers_preview: string[]
  question_preview?: string
  confidence?: number | string
  next_action_preview?: string
  source_kind: string
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeProgressCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  progress_hash: string
}

export type OpenCodeProgressResultSummary = {
  progress_id: string
  status: "recorded" | "blocked" | "failed" | "dry_run" | string
  session_id: string
  launch_id?: string
  kind: string
  execution_state: string
  report_summary_preview: string
  current_step_preview?: string
  files_touched_preview: string[]
  commands_run_preview: string[]
  tests_run_preview: string[]
  artifacts_preview: string[]
  blockers_preview: string[]
  question_preview?: string
  confidence?: number | string
  next_action_preview?: string
  recorded_at: string
  recorded_by: string
  source_kind: string
  error?: string
  progress_hash: string
  recommended_commands: OpenCodeProgressCommandSummary[]
}

export type OpenCodeProgressRecordSummary = {
  progress_id: string
  session_id: string
  launch_id?: string
  kind: string
  execution_state: string
  report_summary_preview: string
  recorded_at: string
  recorded_by: string
  source_kind: string
  confidence?: number | string
  has_blockers: boolean
  has_question: boolean
  progress_hash: string
}

export type OpenCodeProgressSummaryState = {
  total_records: number
  session_count: number
  launched_session_count: number
  latest_records: OpenCodeProgressRecordSummary[]
  blocked_count: number
  question_count: number
  heartbeat_count: number
  generated_at: string
}

export type OpenCodeProgressState = {
  preview?: OpenCodeProgressPreviewSummary | null
  latestResult?: OpenCodeProgressResultSummary | null
  records: OpenCodeProgressRecordSummary[]
  selected?: OpenCodeProgressResultSummary | null
  latest?: OpenCodeProgressResultSummary | null
  summary?: OpenCodeProgressSummaryState | null
  commandError?: string
}

export type OpenCodeWatchdogCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWatchdogPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_record: boolean
  session_id: string
  launch_id?: string
  launch_status?: string
  watchdog_status: string
  recommended_action: string
  wall_clock_elapsed_ms?: number
  no_progress_elapsed_ms?: number
  heartbeat_elapsed_ms?: number
  max_wall_time_ms?: number
  max_no_progress_ms?: number
  heartbeat_interval_ms?: number
  forced_pause_enabled?: boolean
  report_required_on_timeout?: boolean
  latest_progress_id?: string
  latest_progress_kind?: string
  latest_progress_state?: string
  latest_progress_at?: string
  latest_report_summary_preview?: string
  has_blockers: boolean
  has_question: boolean
  blockers_preview: string[]
  question_preview?: string
  report_required: boolean
  forced_report_already_requested: boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeWatchdogCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  watchdog_hash: string
}

export type OpenCodeWatchdogRecordSummary = {
  watchdog_id: string
  session_id: string
  launch_id?: string
  watchdog_status: string
  recommended_action: string
  report_required: boolean
  recorded_at: string
  recorded_by: string
  latest_progress_id?: string
  watchdog_hash: string
}

export type OpenCodeWatchdogResultSummary = {
  watchdog_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  session_id: string
  launch_id?: string
  watchdog_status: string
  recommended_action: string
  report_required: boolean
  forced_report_requested: boolean
  forced_report_request_id?: string
  latest_progress_id?: string
  latest_progress_kind?: string
  latest_progress_state?: string
  latest_progress_at?: string
  wall_clock_elapsed_ms?: number
  no_progress_elapsed_ms?: number
  heartbeat_elapsed_ms?: number
  recorded_at: string
  recorded_by: string
  error?: string
  watchdog_hash: string
  recommended_commands: OpenCodeWatchdogCommandSummary[]
}

export type OpenCodeForcedReportRequestSummary = {
  request_id: string
  session_id: string
  launch_id?: string
  watchdog_id?: string
  reason: string
  requested_at: string
  requested_by: string
  latest_progress_id?: string
  report_due_after_ms?: number
  forced_pause_recommended: boolean
  process_paused: false
  command_to_operator_preview?: string
  request_hash: string
}

export type OpenCodeWatchdogSummaryState = {
  total_launched_sessions: number
  healthy_count: number
  stale_count: number
  timed_out_count: number
  needs_report_count: number
  blocked_count: number
  latest_records: OpenCodeWatchdogRecordSummary[]
  generated_at: string
}

export type OpenCodeWatchdogState = {
  preview?: OpenCodeWatchdogPreviewSummary | null
  latestResult?: OpenCodeWatchdogResultSummary | null
  forcedReportResult?: OpenCodeForcedReportRequestSummary | null
  records: OpenCodeWatchdogRecordSummary[]
  forcedReportRequests: OpenCodeForcedReportRequestSummary[]
  selected?: OpenCodeWatchdogResultSummary | null
  selectedRequest?: OpenCodeForcedReportRequestSummary | null
  summary?: OpenCodeWatchdogSummaryState | null
  commandError?: string
}

export type OpenCodeCommanderQuestionCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeCommanderQuestionPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_create: boolean
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  question_type: string
  urgency: string
  question_preview: string
  context_summary_preview: string
  options_considered_preview: string[]
  executor_recommendation_preview?: string
  evidence_summary_preview?: string
  source_kind: string
  duplicate_question_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeCommanderQuestionCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  question_hash: string
}

export type OpenCodeCommanderQuestionRecordSummary = {
  question_id: string
  status: string
  session_id: string
  launch_id?: string
  question_type: string
  urgency: string
  question_preview: string
  source_kind: string
  created_at: string
  created_by: string
  has_options: boolean
  has_recommendation: boolean
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  question_hash: string
}

export type OpenCodeCommanderQuestionResultSummary = {
  question_id: string
  status: "created" | "blocked" | "dry_run" | "failed" | string
  question_status: string
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  question_type: string
  urgency: string
  question_preview: string
  context_summary_preview: string
  options_considered_preview: string[]
  executor_recommendation_preview?: string
  evidence_summary_preview?: string
  created_at: string
  created_by: string
  source_kind: string
  error?: string
  question_hash: string
  recommended_commands: OpenCodeCommanderQuestionCommandSummary[]
}

export type OpenCodeCommanderQuestionSummaryState = {
  total_questions: number
  pending_commander_count: number
  pending_human_count: number
  withdrawn_count: number
  superseded_count: number
  answered_count: number
  urgent_count: number
  blocked_type_count: number
  latest_questions: OpenCodeCommanderQuestionRecordSummary[]
  generated_at: string
}

export type OpenCodeCommanderQuestionsState = {
  preview?: OpenCodeCommanderQuestionPreviewSummary | null
  latestResult?: OpenCodeCommanderQuestionResultSummary | null
  records: OpenCodeCommanderQuestionRecordSummary[]
  selected?: OpenCodeCommanderQuestionResultSummary | null
  latest?: OpenCodeCommanderQuestionResultSummary | null
  summary?: OpenCodeCommanderQuestionSummaryState | null
  commandError?: string
}

export type CommanderGuidanceCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderGuidancePreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_create: boolean
  question_id: string
  question_status?: string
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  guidance_scope: string
  author_kind: string
  answer_preview: string
  rationale_preview?: string
  constraints_preview: string[]
  spec_refs_preview: string[]
  research_refs_preview: string[]
  artifact_refs_preview: string[]
  delivery_status: string
  delivery_note_preview: string
  duplicate_guidance_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: CommanderGuidanceCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  guidance_hash: string
}

export type CommanderGuidanceRecordSummary = {
  guidance_id: string
  status: string
  delivery_status: string
  question_id: string
  session_id: string
  launch_id?: string
  guidance_scope: string
  author_kind: string
  answer_preview: string
  created_at: string
  created_by: string
  has_constraints: boolean
  has_refs: boolean
  guidance_hash: string
}

export type CommanderGuidanceResultSummary = {
  guidance_id: string
  status: "created" | "blocked" | "dry_run" | "failed" | string
  guidance_status: string
  delivery_status: string
  question_id: string
  question_status_after?: string
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  guidance_scope: string
  author_kind: string
  answer_preview: string
  rationale_preview?: string
  constraints_preview: string[]
  spec_refs_preview: string[]
  research_refs_preview: string[]
  artifact_refs_preview: string[]
  delivery_note_preview: string
  created_at: string
  created_by: string
  error?: string
  guidance_hash: string
  recommended_commands: CommanderGuidanceCommandSummary[]
}

export type CommanderGuidanceSummaryState = {
  total_guidance: number
  created_count: number
  not_delivered_count: number
  pending_delivery_count: number
  delivered_count: number
  cancelled_count: number
  by_scope_counts: Record<string, number>
  latest_guidance: CommanderGuidanceRecordSummary[]
  generated_at: string
}

export type CommanderGuidanceState = {
  preview?: CommanderGuidancePreviewSummary | null
  latestResult?: CommanderGuidanceResultSummary | null
  records: CommanderGuidanceRecordSummary[]
  selected?: CommanderGuidanceResultSummary | null
  latest?: CommanderGuidanceResultSummary | null
  summary?: CommanderGuidanceSummaryState | null
  commandError?: string
}

export type CommanderGuidanceDeliveryCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderGuidanceDeliveryPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_deliver: boolean
  guidance_id: string
  question_id: string
  session_id: string
  launch_id?: string
  guidance_status?: string
  current_delivery_status?: string
  delivery_mode: string
  delivery_payload_preview: string
  answer_preview: string
  constraints_preview: string[]
  rationale_preview?: string
  refs_preview: string[]
  target_summary_preview: string
  adapter_capability: string
  blockers: string[]
  warnings: string[]
  recommended_commands: CommanderGuidanceDeliveryCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  delivery_hash: string
}

export type CommanderGuidanceDeliveryResultSummary = {
  delivery_id: string
  status: "dry_run" | "delivery_requested" | "delivered" | "delivery_failed" | "blocked" | string
  guidance_id: string
  question_id: string
  session_id: string
  launch_id?: string
  delivery_mode: string
  delivery_status_after: string
  adapter_capability: string
  delivery_payload_preview: string
  target_summary_preview: string
  adapter_ack_preview?: string
  operator_handoff_preview?: string
  created_at: string
  delivered_by: string
  error?: string
  delivery_hash: string
  recommended_commands: CommanderGuidanceDeliveryCommandSummary[]
}

export type CommanderGuidanceDeliveryRecordSummary = {
  delivery_id: string
  status: string
  guidance_id: string
  question_id: string
  session_id: string
  launch_id?: string
  delivery_mode: string
  delivery_status_after: string
  created_at: string
  delivered_by: string
  summary_preview: string
  delivery_hash: string
}

export type CommanderGuidanceDeliverySummaryState = {
  total_deliveries: number
  requested_count: number
  delivered_count: number
  failed_count: number
  by_mode_counts: Record<string, number>
  latest_deliveries: CommanderGuidanceDeliveryRecordSummary[]
  generated_at: string
}

export type CommanderGuidanceDeliveryState = {
  preview?: CommanderGuidanceDeliveryPreviewSummary | null
  latestResult?: CommanderGuidanceDeliveryResultSummary | null
  records: CommanderGuidanceDeliveryRecordSummary[]
  selected?: CommanderGuidanceDeliveryResultSummary | null
  latest?: CommanderGuidanceDeliveryResultSummary | null
  summary?: CommanderGuidanceDeliverySummaryState | null
  commandError?: string
}

export type OpenCodeHumanControlCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeHumanControlPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_record: boolean
  session_id: string
  launch_id?: string
  control_kind: string
  projected_state_after: string
  urgency: string
  human_note_preview?: string
  correction_preview?: string
  override_preview?: string
  reason_preview?: string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  process_control_performed: false
  open_code_prompt_sent: false
  mission_mutated: false
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeHumanControlCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  control_hash: string
}

export type OpenCodeHumanControlResultSummary = {
  control_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  session_id: string
  launch_id?: string
  control_kind: string
  projected_state_after: string
  urgency: string
  human_note_preview?: string
  correction_preview?: string
  override_preview?: string
  reason_preview?: string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  process_control_performed: false
  open_code_prompt_sent: false
  mission_mutated: false
  recorded_at: string
  recorded_by: string
  error?: string
  control_hash: string
  recommended_commands: OpenCodeHumanControlCommandSummary[]
}

export type OpenCodeHumanControlRecordSummary = {
  control_id: string
  session_id: string
  launch_id?: string
  control_kind: string
  projected_state_after: string
  urgency: string
  human_note_preview?: string
  recorded_at: string
  recorded_by: string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  process_control_performed: false
  open_code_prompt_sent: false
  mission_mutated: false
  control_hash: string
}

export type OpenCodeHumanControlSummaryState = {
  total_controls: number
  session_count: number
  pause_requested_count: number
  stop_requested_count: number
  correction_pending_count: number
  override_pending_count: number
  report_requested_count: number
  escalation_count: number
  urgent_count: number
  latest_controls: OpenCodeHumanControlRecordSummary[]
  generated_at: string
}

export type OpenCodeHumanControlState = {
  preview?: OpenCodeHumanControlPreviewSummary | null
  latestResult?: OpenCodeHumanControlResultSummary | null
  records: OpenCodeHumanControlRecordSummary[]
  selected?: OpenCodeHumanControlResultSummary | null
  latest?: OpenCodeHumanControlResultSummary | null
  summary?: OpenCodeHumanControlSummaryState | null
  commandError?: string
}

export type OpenCodeWakeSupervisorCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWakeSupervisorEvidenceRefSummary = {
  evidence_kind: string
  evidence_id: string
  status?: string
  summary_preview?: string
  recorded_at?: string
  pointer_only: true
}

export type OpenCodeWakeSupervisorCheckSummary = {
  check_id: string
  label: string
  status: "pass" | "warn" | "fail" | "unknown" | string
  summary_preview: string
  evidence_refs: OpenCodeWakeSupervisorEvidenceRefSummary[]
  recommended_commands: OpenCodeWakeSupervisorCommandSummary[]
}

export type OpenCodeWakeSupervisorContextSectionSummary = {
  section: string
  status: "included" | "pointer_only" | "missing" | "excluded" | string
  summary_preview: string
  evidence_refs: OpenCodeWakeSupervisorEvidenceRefSummary[]
  warnings: string[]
}

export type OpenCodeWakeSupervisorPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | "partial" | string
  session_id: string
  launch_id?: string
  supervisor_status: string
  recommended_action: string
  active_launch_status?: string
  latest_progress_id?: string
  latest_progress_kind?: string
  latest_progress_state?: string
  latest_watchdog_id?: string
  latest_watchdog_status?: string
  latest_forced_report_request_id?: string
  pending_question_id?: string
  pending_question_count: number
  unanswered_question_count: number
  latest_guidance_id?: string
  latest_guidance_delivery_status?: string
  pending_delivery_count: number
  latest_human_control_id?: string
  latest_human_projected_state?: string
  human_pause_requested: boolean
  human_stop_requested: boolean
  human_correction_pending: boolean
  human_override_pending: boolean
  report_required: boolean
  timed_out: boolean
  stale: boolean
  blocked_by_human: boolean
  checks: OpenCodeWakeSupervisorCheckSummary[]
  context_sections: OpenCodeWakeSupervisorContextSectionSummary[]
  evidence_refs: OpenCodeWakeSupervisorEvidenceRefSummary[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeWakeSupervisorCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  supervisor_hash: string
}

export type OpenCodeWakeSupervisorSessionCardSummary = {
  session_id: string
  launch_id?: string
  supervisor_status: string
  recommended_action: string
  latest_progress_at?: string
  latest_watchdog_status?: string
  pending_question_count: number
  pending_delivery_count: number
  latest_human_projected_state?: string
  summary_preview: string
  supervisor_hash: string
}

export type OpenCodeWakeSupervisorSummaryState = {
  total_launched_sessions: number
  status_counts: Record<string, number>
  healthy_count: number
  watch_count: number
  stale_count: number
  timed_out_count: number
  needs_report_count: number
  needs_commander_answer_count: number
  guidance_pending_delivery_count: number
  human_attention_count: number
  stop_requested_count: number
  session_cards: OpenCodeWakeSupervisorSessionCardSummary[]
  generated_at: string
}

export type OpenCodeWakeSupervisorState = {
  preview?: OpenCodeWakeSupervisorPreviewSummary | null
  summary?: OpenCodeWakeSupervisorSummaryState | null
  cards: OpenCodeWakeSupervisorSessionCardSummary[]
  commandError?: string
}

export type OpenCodeWakeSupervisorExecutionCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWakeSupervisorExecutionEvidenceRefSummary = {
  evidence_kind: string
  evidence_id: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeWakeSupervisorExecutionPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | "partial" | string
  can_record: boolean
  execution_mode: "single_session" | "batch_active_sessions" | string
  session_id?: string
  launch_id?: string
  supervisor_preview_id?: string
  supervisor_hash?: string
  supervisor_status?: string
  recommended_action?: string
  action_execution_status: "not_executed" | string
  recommended_commands_preview: OpenCodeWakeSupervisorExecutionCommandSummary[]
  evidence_refs: OpenCodeWakeSupervisorExecutionEvidenceRefSummary[]
  context_section_count: number
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  execution_hash: string
}

export type OpenCodeWakeSupervisorExecutionResultSummary = {
  execution_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  execution_mode: "single_session" | "batch_active_sessions" | string
  session_id?: string
  launch_id?: string
  supervisor_preview_id?: string
  supervisor_hash?: string
  supervisor_status?: string
  recommended_action?: string
  action_execution_status: "not_executed" | string
  recommended_commands_preview: OpenCodeWakeSupervisorExecutionCommandSummary[]
  evidence_refs: OpenCodeWakeSupervisorExecutionEvidenceRefSummary[]
  context_section_count: number
  recorded_at: string
  recorded_by: string
  error?: string
  execution_hash: string
  recommended_commands: OpenCodeWakeSupervisorExecutionCommandSummary[]
}

export type OpenCodeWakeSupervisorExecutionRecordSummary = {
  execution_id: string
  execution_mode: "single_session" | "batch_active_sessions" | string
  session_id?: string
  launch_id?: string
  supervisor_status?: string
  recommended_action?: string
  action_execution_status: "not_executed" | string
  recorded_at: string
  recorded_by: string
  summary_preview: string
  execution_hash: string
}

export type OpenCodeWakeSupervisorBatchPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | "partial" | string
  can_record: boolean
  execution_mode: "batch_active_sessions" | string
  total_candidate_sessions: number
  included_session_count: number
  skipped_session_count: number
  session_previews: OpenCodeWakeSupervisorExecutionPreviewSummary[]
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  execution_hash: string
}

export type OpenCodeWakeSupervisorBatchResultSummary = {
  batch_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  execution_mode: "batch_active_sessions" | string
  total_candidate_sessions: number
  recorded_execution_count: number
  skipped_session_count: number
  execution_records: OpenCodeWakeSupervisorExecutionRecordSummary[]
  action_execution_status: "not_executed" | string
  recorded_at: string
  recorded_by: string
  error?: string
  batch_hash: string
  recommended_commands: OpenCodeWakeSupervisorExecutionCommandSummary[]
}

export type OpenCodeWakeSupervisorExecutionSummaryState = {
  total_executions: number
  session_count: number
  batch_count: number
  healthy_count: number
  watch_count: number
  needs_report_count: number
  needs_commander_answer_count: number
  guidance_pending_delivery_count: number
  human_attention_count: number
  timed_out_count: number
  stale_count: number
  blocked_count: number
  action_executed_count: 0 | number
  latest_executions: OpenCodeWakeSupervisorExecutionRecordSummary[]
  generated_at: string
}

export type OpenCodeWakeSupervisorExecutionsState = {
  preview?: OpenCodeWakeSupervisorExecutionPreviewSummary | null
  latestResult?: OpenCodeWakeSupervisorExecutionResultSummary | null
  batchPreview?: OpenCodeWakeSupervisorBatchPreviewSummary | null
  batchResult?: OpenCodeWakeSupervisorBatchResultSummary | null
  records: OpenCodeWakeSupervisorExecutionRecordSummary[]
  selected?: OpenCodeWakeSupervisorExecutionResultSummary | null
  latest?: OpenCodeWakeSupervisorExecutionResultSummary | null
  summary?: OpenCodeWakeSupervisorExecutionSummaryState | null
  commandError?: string
}

export type OpenCodeWakeActionExecutionCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWakeActionExecutionEvidenceRefSummary = {
  evidence_kind: string
  evidence_id: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeWakeActionExecutionPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_execute: boolean
  execution_id: string
  session_id?: string
  launch_id?: string
  supervisor_status?: string
  recommended_action?: string
  action_kind: string
  effect_kind: string
  action_execution_status_before: "not_executed" | string
  will_execute_metadata_write: boolean
  will_call_provider: false | boolean
  will_send_opencode_prompt: false | boolean
  will_control_process: false | boolean
  will_mutate_mission: false | boolean
  expected_event_kinds: string[]
  blocked_reason_preview?: string
  manual_action_preview?: string
  source_supervisor_hash?: string
  evidence_refs: OpenCodeWakeActionExecutionEvidenceRefSummary[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeWakeActionExecutionCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  action_hash: string
}

export type OpenCodeWakeActionExecutionResultSummary = {
  action_execution_id: string
  status: "executed" | "skipped" | "blocked" | "dry_run" | "failed" | string
  execution_id: string
  session_id?: string
  launch_id?: string
  supervisor_status?: string
  recommended_action?: string
  action_kind: string
  effect_kind: string
  action_execution_status_before: "not_executed" | string
  metadata_event_kind?: string
  metadata_record_id?: string
  metadata_result_preview?: string
  manual_action_preview?: string
  will_call_provider: false | boolean
  will_send_opencode_prompt: false | boolean
  will_control_process: false | boolean
  will_mutate_mission: false | boolean
  recorded_at: string
  recorded_by: string
  error?: string
  action_hash: string
  recommended_commands: OpenCodeWakeActionExecutionCommandSummary[]
}

export type OpenCodeWakeActionExecutionRecordSummary = {
  action_execution_id: string
  execution_id: string
  session_id?: string
  launch_id?: string
  recommended_action?: string
  action_kind: string
  status: string
  effect_kind: string
  metadata_event_kind?: string
  metadata_record_id?: string
  recorded_at: string
  recorded_by: string
  summary_preview: string
  action_hash: string
}

export type OpenCodeWakeActionExecutionSummaryState = {
  total_actions: number
  executed_count: number
  skipped_count: number
  blocked_count: number
  failed_count: number
  metadata_event_count: number
  manual_action_required_count: number
  by_action_kind_counts: Record<string, number>
  latest_actions: OpenCodeWakeActionExecutionRecordSummary[]
  generated_at: string
}

export type OpenCodeWakeActionExecutionState = {
  preview?: OpenCodeWakeActionExecutionPreviewSummary | null
  latestResult?: OpenCodeWakeActionExecutionResultSummary | null
  records: OpenCodeWakeActionExecutionRecordSummary[]
  selected?: OpenCodeWakeActionExecutionResultSummary | null
  latest?: OpenCodeWakeActionExecutionResultSummary | null
  summary?: OpenCodeWakeActionExecutionSummaryState | null
  commandError?: string
}

export type OpenCodeResultReportCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeResultReportPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_record: boolean
  session_id: string
  launch_id?: string
  result_kind: string
  result_disposition: string
  review_state: string
  summary_preview: string
  outcome_preview?: string
  changed_files_preview: string[]
  tests_run_preview: string[]
  test_results_preview: string[]
  artifacts_preview: string[]
  metrics_preview: string[]
  claims_preview: string[]
  known_failures_preview: string[]
  followups_preview: string[]
  confidence?: number | string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  linked_wake_execution_id?: string
  linked_wake_action_execution_id?: string
  mission_mutated: false | boolean
  research_db_written: false | boolean
  checkpoint_created: false | boolean
  commander_review_created: false | boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeResultReportCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  report_hash: string
}

export type OpenCodeResultReportResultSummary = {
  report_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  session_id: string
  launch_id?: string
  result_kind: string
  result_disposition: string
  review_state: string
  summary_preview: string
  outcome_preview?: string
  changed_files_preview: string[]
  tests_run_preview: string[]
  test_results_preview: string[]
  artifacts_preview: string[]
  metrics_preview: string[]
  claims_preview: string[]
  known_failures_preview: string[]
  followups_preview: string[]
  confidence?: number | string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  linked_wake_execution_id?: string
  linked_wake_action_execution_id?: string
  mission_mutated: false | boolean
  research_db_written: false | boolean
  checkpoint_created: false | boolean
  commander_review_created: false | boolean
  recorded_at: string
  recorded_by: string
  error?: string
  report_hash: string
  recommended_commands: OpenCodeResultReportCommandSummary[]
}

export type OpenCodeResultReportRecordSummary = {
  report_id: string
  session_id: string
  launch_id?: string
  result_kind: string
  result_disposition: string
  review_state: string
  summary_preview: string
  recorded_at: string
  recorded_by: string
  confidence?: number | string
  has_failures: boolean
  has_artifacts: boolean
  has_metrics: boolean
  report_hash: string
}

export type OpenCodeResultReportSummaryState = {
  total_reports: number
  session_count: number
  completion_count: number
  partial_count: number
  failure_count: number
  inconclusive_count: number
  blocked_count: number
  needs_commander_review_count: number
  needs_human_review_count: number
  latest_reports: OpenCodeResultReportRecordSummary[]
  generated_at: string
}

export type OpenCodeResultReportState = {
  preview?: OpenCodeResultReportPreviewSummary | null
  latestResult?: OpenCodeResultReportResultSummary | null
  records: OpenCodeResultReportRecordSummary[]
  selected?: OpenCodeResultReportResultSummary | null
  latest?: OpenCodeResultReportResultSummary | null
  summary?: OpenCodeResultReportSummaryState | null
  commandError?: string
}

export type OpenCodeResultReviewGateCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeResultReviewGatePreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_record: boolean
  report_id: string
  session_id: string
  launch_id?: string
  result_kind?: string
  result_disposition?: string
  report_review_state?: string
  decision: string
  review_disposition: string
  projection_state_after: string
  next_step: string
  author_kind: string
  rationale_preview: string
  evidence_summary_preview?: string
  accepted_claims_preview: string[]
  rejected_claims_preview: string[]
  revision_requests_preview: string[]
  followup_requests_preview: string[]
  risk_flags_preview: string[]
  artifact_refs_preview: string[]
  test_refs_preview: string[]
  confidence?: number | string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  linked_wake_execution_id?: string
  linked_wake_action_execution_id?: string
  mission_mutated: false | boolean
  research_db_written: false | boolean
  checkpoint_created: false | boolean
  followup_mission_created: false | boolean
  provider_called: false | boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeResultReviewGateCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  review_hash: string
}

export type OpenCodeResultReviewGateResultSummary = {
  review_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  report_id: string
  session_id: string
  launch_id?: string
  result_kind?: string
  result_disposition?: string
  report_review_state?: string
  decision: string
  review_disposition: string
  projection_state_after: string
  next_step: string
  author_kind: string
  rationale_preview: string
  evidence_summary_preview?: string
  accepted_claims_preview: string[]
  rejected_claims_preview: string[]
  revision_requests_preview: string[]
  followup_requests_preview: string[]
  risk_flags_preview: string[]
  artifact_refs_preview: string[]
  test_refs_preview: string[]
  confidence?: number | string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  linked_wake_execution_id?: string
  linked_wake_action_execution_id?: string
  mission_mutated: false | boolean
  research_db_written: false | boolean
  checkpoint_created: false | boolean
  followup_mission_created: false | boolean
  provider_called: false | boolean
  recorded_at: string
  recorded_by: string
  error?: string
  review_hash: string
  recommended_commands: OpenCodeResultReviewGateCommandSummary[]
}

export type OpenCodeResultReviewGateRecordSummary = {
  review_id: string
  report_id: string
  session_id: string
  launch_id?: string
  decision: string
  review_disposition: string
  projection_state_after: string
  next_step: string
  author_kind: string
  rationale_preview: string
  recorded_at: string
  recorded_by: string
  confidence?: number | string
  has_revision_requests: boolean
  has_followup_requests: boolean
  review_hash: string
}

export type OpenCodeResultReviewGateSummaryState = {
  total_reviews: number
  reviewed_report_count: number
  accepted_count: number
  rejected_count: number
  needs_revision_count: number
  needs_followup_count: number
  inconclusive_count: number
  needs_human_count: number
  deferred_count: number
  research_ingestion_recommended_count: number
  latest_reviews: OpenCodeResultReviewGateRecordSummary[]
  generated_at: string
}

export type OpenCodeResultReviewGateState = {
  preview?: OpenCodeResultReviewGatePreviewSummary | null
  latestResult?: OpenCodeResultReviewGateResultSummary | null
  records: OpenCodeResultReviewGateRecordSummary[]
  selected?: OpenCodeResultReviewGateResultSummary | null
  latest?: OpenCodeResultReviewGateResultSummary | null
  summary?: OpenCodeResultReviewGateSummaryState | null
  commandError?: string
}

export type ResearchIngestionCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type ResearchIngestionProvenanceRefSummary = {
  source_kind: string
  source_id: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type ResearchIngestionPreviewSummary = {
  preview_id: string
  status: "ready" | "blocked" | string
  can_ingest: boolean
  review_id: string
  report_id: string
  session_id: string
  launch_id?: string
  source_kind: string
  evidence_kind: string
  ingestion_decision: string
  review_decision?: string
  review_disposition?: string
  review_projection_state?: string
  report_kind?: string
  report_disposition?: string
  research_title_preview: string
  research_question_preview?: string
  hypothesis_preview?: string
  method_preview?: string
  outcome_preview?: string
  evidence_summary_preview: string
  claims_preview: string[]
  metrics_preview: string[]
  artifacts_preview: string[]
  tests_preview: string[]
  failures_preview: string[]
  followups_preview: string[]
  tags_preview: string[]
  confidence?: number | string
  novelty_key_preview?: string
  provenance_refs: ResearchIngestionProvenanceRefSummary[]
  research_db_write_status: string
  research_db_written: false | boolean
  mission_mutated: false | boolean
  checkpoint_created: false | boolean
  followup_mission_created: false | boolean
  provider_called: false | boolean
  mcp_called: false | boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchIngestionCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  ingestion_hash: string
}

export type ResearchIngestionResultSummary = Omit<ResearchIngestionPreviewSummary, "preview_id" | "status" | "can_ingest" | "generated_at" | "blockers" | "warnings" | "redacted_summary_preview"> & {
  ingestion_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed" | string
  research_memory_id?: string
  research_db_row_id?: string
  recorded_at: string
  recorded_by: string
  error?: string
}

export type ResearchIngestionRecordSummary = {
  ingestion_id: string
  research_memory_id?: string
  review_id: string
  report_id: string
  session_id: string
  launch_id?: string
  evidence_kind: string
  ingestion_decision: string
  research_title_preview: string
  evidence_summary_preview: string
  research_db_written: boolean
  recorded_at: string
  recorded_by: string
  confidence?: number | string
  ingestion_hash: string
}

export type ResearchIngestionSummaryState = {
  total_ingestions: number
  research_memory_count: number
  session_count: number
  positive_finding_count: number
  negative_result_count: number
  inconclusive_result_count: number
  partial_result_count: number
  blocked_result_count: number
  db_written_count: number
  failed_count: number
  latest_ingestions: ResearchIngestionRecordSummary[]
  generated_at: string
}

export type ResearchIngestionState = {
  preview?: ResearchIngestionPreviewSummary | null
  latestResult?: ResearchIngestionResultSummary | null
  records: ResearchIngestionRecordSummary[]
  selected?: ResearchIngestionResultSummary | null
  latest?: ResearchIngestionResultSummary | null
  summary?: ResearchIngestionSummaryState | null
  commandError?: string
}

export type ResearchMemoryCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ResearchMemorySourceRefSummary = {
  source_kind: string
  source_id: string
  label?: string
  summary_preview?: string
  pointer_only: true
}

export type ResearchMemoryCandidateSummary = {
  result_id: string
  label: string
  source_kind: string
  question_preview: string
  hypothesis_preview?: string
  method_preview?: string
  config_preview?: string
  outcome_preview?: string
  metric_preview?: string
  confidence?: number
  status?: string
  source_session_id?: string
  source_mission_id?: string
  artifact_ids: string[]
  citation_ids: string[]
  related_event_ids: string[]
  relevance_score: number
  duplicate_similarity_score: number
  rank_source?: string
  fts_score?: number
  lexical_score?: number
  filter_explanation_preview?: string
  search_engine_used?: string
  matched_terms: string[]
  unmatched_query_terms: string[]
  matched_fields: string[]
  scoring_explanation_preview: string
  difference_preview?: string
  evidence_kind_preview?: string
  created_at_preview?: string
  updated_at_preview?: string
  warning_flags: string[]
  source_refs: ResearchMemorySourceRefSummary[]
  pointer_only: true
}

export type ResearchMemoryRetrievalPreviewSummary = {
  preview_id: string
  status: "ready" | "empty" | "partial" | "blocked" | string
  query_preview: string
  labels: string[]
  limit: number
  candidates: ResearchMemoryCandidateSummary[]
  omitted_count: number
  retrieval_policy: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchMemoryCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  retrieval_hash: string
}

export type ResearchNoveltyPreviewSummary = {
  preview_id: string
  status: "ready" | "partial" | "blocked" | string
  proposed_question_preview: string
  proposed_method_preview?: string
  proposed_config_preview?: string
  nearest_prior_results: ResearchMemoryCandidateSummary[]
  duplicate_risk: "low" | "medium" | "high" | "unknown" | string
  novelty_score: number
  difference_summary_preview: string
  repetition_requires_justification: boolean
  acceptable_repetition_reasons: string[]
  suggested_reason_not_duplicate?: string
  missing_memory_warning: boolean
  external_research_recommended: boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchMemoryCommandSummary[]
  generated_at: string
  novelty_hash: string
}

export type ResearchMemorySummaryState = {
  total_candidates_available: number
  label_counts: Record<string, number>
  source_counts: Record<string, number>
  has_research_db_projection: boolean
  retrieval_policy: string
  generated_at: string
}

export type ResearchMemoryInspectionPreviewSummary = {
  inspection_id: string
  status: "ready" | "blocked" | string
  memory_id: string
  source_kind: string
  label: string
  title_preview?: string
  summary_preview?: string
  question_preview?: string
  hypothesis_preview?: string
  method_preview?: string
  outcome_preview?: string
  metric_preview?: string
  config_preview?: string
  confidence?: string
  status_preview?: string
  source_mission_id?: string
  source_session_id?: string
  artifact_refs: ResearchMemorySourceRefSummary[]
  citation_refs: ResearchMemorySourceRefSummary[]
  provenance_refs: ResearchMemorySourceRefSummary[]
  related_event_ids: string[]
  warning_flags: string[]
  recommended_commands: ResearchMemoryCommandSummary[]
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  inspection_hash: string
}

export type ResearchMemoryNearDuplicatePreviewSummary = {
  preview_id: string
  status: "ready" | "empty" | "blocked" | string
  query_preview: string
  objective_preview?: string
  labels: string[]
  limit: number
  duplicate_threshold: number
  candidates: ResearchMemoryCandidateSummary[]
  likely_duplicate_count: number
  warning_duplicate_count: number
  strongest_duplicate_score?: number
  novelty_risk: "low" | "medium" | "high" | "unknown" | string
  blockers: string[]
  warnings: string[]
  recommended_commands: ResearchMemoryCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
  near_duplicate_hash: string
}

export type ResearchMemorySearchProfileState = {
  profile_id: string
  status: "ready" | "degraded" | "blocked" | string
  retrieval_policy: string
  has_research_db_projection: boolean
  search_engine: string
  semantic_search_enabled: boolean
  vector_index_enabled: boolean
  fts_index_enabled: boolean
  fts_available?: boolean
  fts_fallback_reason?: string
  embedding_search_enabled?: boolean
  provider_rerank_enabled?: boolean
  scan_limit: number
  default_limit: number
  max_limit: number
  indexed_field_count?: number
  indexed_result_count?: number
  supported_filters: string[]
  unsupported_filters: string[]
  source_counts: Record<string, number>
  label_counts: Record<string, number>
  accepted_result_count?: number
  candidate_count?: number
  trial_count?: number
  training_run_count?: number
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
}

export type ResearchMemoryState = {
  summary?: ResearchMemorySummaryState | null
  retrievalPreview?: ResearchMemoryRetrievalPreviewSummary | null
  noveltyPreview?: ResearchNoveltyPreviewSummary | null
  selected?: ResearchMemoryInspectionPreviewSummary | null
  nearDuplicates?: ResearchMemoryNearDuplicatePreviewSummary | null
  searchProfile?: ResearchMemorySearchProfileState | null
  commandError?: string
}

export type CommanderContinuitySourceRefSummary = {
  source_kind: string
  source_id: string
  label?: string
  summary_preview?: string
  status?: string
  pointer_only: true
}

export type CommanderContinuityCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderContinuityOpenLoopSummary = {
  loop_id: string
  loop_kind: string
  severity: string
  blocking: boolean
  session_id?: string
  launch_id?: string
  source_ref: CommanderContinuitySourceRefSummary
  summary_preview: string
  recommended_command?: string
  created_at?: string
}

export type CommanderContinuitySectionSummary = {
  section_id: string
  section_kind: string
  status: string
  title: string
  summary_preview: string
  source_refs: CommanderContinuitySourceRefSummary[]
  item_count: number
  omitted_count: number
  warnings: string[]
}

export type CommanderContinuityBudgetSummary = {
  target_token_budget: number
  estimated_token_count: number
  section_budgets: Record<string, number>
  omitted_sections: string[]
  truncation_warnings: string[]
}

export type CommanderProposalContinuityPacketSummary = {
  packet_id: string
  packet_kind: "proposal" | string
  status: string
  objective_preview: string
  normalized_objective_preview: string
  readiness: string
  authority_summary: string
  project_direction_summary: string
  proposal_lineage_summary: string
  recent_execution_summary: string
  research_memory_summary: string
  research_search_profile_summary: string
  research_queries_executed: string[]
  research_candidates_summary: string
  near_duplicate_summary: string
  inspected_memory_refs: CommanderContinuitySourceRefSummary[]
  novelty_risk?: string
  missing_memory_warning: boolean
  why_not_duplicate_required: boolean
  open_loops: CommanderContinuityOpenLoopSummary[]
  blockers: string[]
  warnings: string[]
  sections: CommanderContinuitySectionSummary[]
  source_refs: CommanderContinuitySourceRefSummary[]
  recommended_commands: CommanderContinuityCommandSummary[]
  budget: CommanderContinuityBudgetSummary
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type CommanderMidMissionContinuityPacketSummary = {
  packet_id: string
  packet_kind: "mid_mission" | string
  status: string
  session_id: string
  launch_id?: string
  objective_preview: string
  readiness: string
  active_session_summary: string
  latest_progress_summary: string
  watchdog_summary: string
  commander_dialogue_summary: string
  guidance_delivery_summary: string
  human_control_summary: string
  wake_supervision_summary: string
  result_state_summary: string
  local_session_working_memory_summary: string
  research_memory_summary?: string
  open_loops: CommanderContinuityOpenLoopSummary[]
  blockers: string[]
  warnings: string[]
  sections: CommanderContinuitySectionSummary[]
  source_refs: CommanderContinuitySourceRefSummary[]
  recommended_commands: CommanderContinuityCommandSummary[]
  budget: CommanderContinuityBudgetSummary
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type CommanderContinuityThreadCardSummary = {
  thread_id: string
  session_id?: string
  launch_id?: string
  mission_id?: string
  objective_preview: string
  latest_status: string
  latest_result_report_id?: string
  latest_result_review_id?: string
  latest_research_ingestion_id?: string
  open_loop_count: number
  last_updated_at?: string
  summary_preview: string
}

export type CommanderContinuitySummaryState = {
  total_recent_sessions: number
  active_session_count: number
  stale_or_timed_out_count: number
  pending_question_count: number
  pending_guidance_delivery_count: number
  human_attention_count: number
  result_reports_needing_review_count: number
  accepted_reviews_not_ingested_count: number
  open_loop_count: number
  latest_threads: CommanderContinuityThreadCardSummary[]
  generated_at: string
}

export type CommanderContinuityState = {
  proposalPacket?: CommanderProposalContinuityPacketSummary | null
  midMissionPacket?: CommanderMidMissionContinuityPacketSummary | null
  summary?: CommanderContinuitySummaryState | null
  openLoops: CommanderContinuityOpenLoopSummary[]
  selectedThread?: CommanderContinuityThreadCardSummary | null
  commandError?: string
}

export type OpenCodeContinuityState = {
  sessionPacket?: Record<string, any> | null
  continuationPacket?: Record<string, any> | null
  refreshPreview?: Record<string, any> | null
  latestResult?: Record<string, any> | null
  records: Array<Record<string, any>>
  selected?: Record<string, any> | null
  latest?: Record<string, any> | null
  summary?: Record<string, any> | null
  commandError?: string
}

export type CommanderExecutorReviewCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderExecutorReviewFindingSummary = {
  finding_id: string
  severity: string
  title: string
  summary: string
  evidence_ids: string[]
  recommended_commands: CommanderExecutorReviewCommandSummary[]
}

export type CommanderExecutorReviewPreviewSummary = {
  review_id?: string
  packet_id?: string
  packet_status?: string
  can_execute: boolean
  provider_kind: string
  provider_ready: boolean
  blockers: string[]
  warnings: string[]
  packet_summary_preview?: string
  prompt_preview?: string
  recommended_commands: CommanderExecutorReviewCommandSummary[]
  generated_at: string
}

export type CommanderExecutorReviewResultSummary = {
  review_id: string
  packet_id: string
  packet_status: string
  status: string
  provider_kind: string
  decision: string
  confidence: number
  summary: string
  findings: CommanderExecutorReviewFindingSummary[]
  evidence_ids: string[]
  recommended_commands: CommanderExecutorReviewCommandSummary[]
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  review_hash: string
  handoff_id?: string
  mission_id?: string
  result_id?: string
  proposal_id?: string
}

export type CommanderExecutorReviewRecordSummary = {
  review_id: string
  packet_id: string
  status: string
  decision: string
  confidence: number
  completed_at: string
  summary_preview: string
  review_hash: string
  handoff_id?: string
  mission_id?: string
  result_id?: string
}

export type CommanderExecutorReviewState = {
  preview?: CommanderExecutorReviewPreviewSummary | null
  latestResult?: CommanderExecutorReviewResultSummary | null
  records: CommanderExecutorReviewRecordSummary[]
  selected?: CommanderExecutorReviewResultSummary | null
  commandError?: string
}

export type ExecutorReviewProposalDraftCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalDraftCandidateSummary = {
  draft_id: string
  draft_kind: string
  title: string
  summary: string
  rationale: string
  source_review_id: string
  source_packet_id: string
  mission_id?: string
  result_id?: string
  handoff_id?: string
  proposal_id?: string
  evidence_ids: string[]
  finding_ids: string[]
  confidence: number
  risk: string
  would_create_proposal: boolean
  would_mutate_mission: boolean
  recommended_commands: ExecutorReviewProposalDraftCommandSummary[]
}

export type ExecutorReviewProposalDraftPreviewSummary = {
  preview_id: string
  status: string
  review_id?: string
  packet_id?: string
  review_decision?: string
  review_confidence?: number
  can_create_proposals_now: boolean
  candidates: ExecutorReviewProposalDraftCandidateSummary[]
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalDraftCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalDraftSummary = {
  total_reviews_considered: number
  draftable_review_count: number
  blocked_review_count: number
  candidate_count: number
  latest_review_id?: string
  generated_at: string
}

export type ExecutorReviewProposalDraftState = {
  preview?: ExecutorReviewProposalDraftPreviewSummary | null
  summary?: ExecutorReviewProposalDraftSummary | null
  commandError?: string
}

export type ExecutorReviewProposalCreateCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalCreatePreviewSummary = {
  preview_id: string
  status: string
  can_create: boolean
  review_id: string
  draft_id: string
  source_packet_id?: string
  draft_kind: string
  title_preview: string
  summary_preview: string
  proposed_action_kind: string
  target_mission_id?: string
  target_result_id?: string
  target_handoff_id?: string
  target_proposal_id?: string
  evidence_ids: string[]
  finding_ids: string[]
  source_confidence: number
  risk: string
  existing_proposal_id?: string
  existing_proposal_status?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalCreateCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalCreateResultSummary = {
  create_id: string
  status: string
  proposal_id?: string
  review_id: string
  draft_id: string
  source_packet_id?: string
  draft_kind: string
  proposed_action_kind: string
  title_preview: string
  summary_preview: string
  evidence_ids: string[]
  finding_ids: string[]
  created_at: string
  requested_by: string
  error?: string
  create_hash: string
  recommended_commands: ExecutorReviewProposalCreateCommandSummary[]
}

export type ExecutorReviewProposalCreateRecordSummary = {
  create_id: string
  status: string
  proposal_id?: string
  review_id: string
  draft_id: string
  draft_kind: string
  created_at: string
  summary_preview: string
  create_hash: string
}

export type ExecutorReviewProposalCreateState = {
  preview?: ExecutorReviewProposalCreatePreviewSummary | null
  latestResult?: ExecutorReviewProposalCreateResultSummary | null
  records: ExecutorReviewProposalCreateRecordSummary[]
  selected?: ExecutorReviewProposalCreateResultSummary | null
  commandError?: string
}

export type ExecutorReviewProposalReviewRequestCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalReviewRequestPreviewSummary = {
  preview_id: string
  status: string
  can_request: boolean
  proposal_id: string
  create_id?: string
  review_id?: string
  draft_id?: string
  source_packet_id?: string
  proposal_status?: string
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  risk?: string
  existing_review_request_id?: string
  existing_review_request_status?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalReviewRequestCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalReviewRequestResultSummary = {
  request_gate_id: string
  status: string
  review_request_id?: string
  proposal_id: string
  create_id?: string
  review_id?: string
  draft_id?: string
  source_packet_id?: string
  mission_id?: string
  result_id?: string
  requested_at: string
  requested_by: string
  error?: string
  request_hash: string
  recommended_commands: ExecutorReviewProposalReviewRequestCommandSummary[]
}

export type ExecutorReviewProposalReviewRequestRecordSummary = {
  request_gate_id: string
  status: string
  review_request_id?: string
  proposal_id: string
  create_id?: string
  review_id?: string
  draft_id?: string
  requested_at: string
  summary_preview: string
  request_hash: string
}

export type ExecutorReviewProposalReviewRequestState = {
  preview?: ExecutorReviewProposalReviewRequestPreviewSummary | null
  latestResult?: ExecutorReviewProposalReviewRequestResultSummary | null
  records: ExecutorReviewProposalReviewRequestRecordSummary[]
  selected?: ExecutorReviewProposalReviewRequestResultSummary | null
  commandError?: string
}

export type ExecutorReviewProposalReviewDecisionCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalReviewDecisionPreviewSummary = {
  preview_id: string
  status: string
  can_decide: boolean
  decision: "approve" | "reject"
  review_request_id: string
  proposal_id?: string
  request_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  review_request_status?: string
  proposal_status?: string
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  risk?: string
  existing_decision?: string
  existing_decision_at?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalReviewDecisionCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalReviewDecisionResultSummary = {
  decision_gate_id: string
  status: string
  decision: "approve" | "reject"
  review_request_id: string
  proposal_id?: string
  request_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  mission_id?: string
  result_id?: string
  decided_at: string
  decided_by: string
  reason_preview?: string
  error?: string
  decision_hash: string
  recommended_commands: ExecutorReviewProposalReviewDecisionCommandSummary[]
}

export type ExecutorReviewProposalReviewDecisionRecordSummary = {
  decision_gate_id: string
  status: string
  decision: "approve" | "reject"
  review_request_id: string
  proposal_id?: string
  request_gate_id?: string
  create_id?: string
  decided_at: string
  summary_preview: string
  decision_hash: string
}

export type ExecutorReviewProposalReviewDecisionState = {
  preview?: ExecutorReviewProposalReviewDecisionPreviewSummary | null
  latestResult?: ExecutorReviewProposalReviewDecisionResultSummary | null
  records: ExecutorReviewProposalReviewDecisionRecordSummary[]
  selected?: ExecutorReviewProposalReviewDecisionResultSummary | null
  commandError?: string
}

export type ExecutorReviewProposalApplyReadinessCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalApplyReadinessPreviewSummary = {
  readiness_id: string
  status: string
  can_apply_in_future: boolean
  proposal_id: string
  review_request_id?: string
  request_gate_id?: string
  decision_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  proposal_status?: string
  review_request_status?: string
  review_decision?: string
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  candidate_kind: string
  candidate_risk: string
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalApplyReadinessCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalApplyReadinessRecordSummary = {
  readiness_id: string
  status: string
  proposal_id: string
  review_request_id?: string
  decision_gate_id?: string
  create_id?: string
  candidate_kind: string
  candidate_risk: string
  generated_at: string
  summary_preview: string
}

export type ExecutorReviewProposalApplyReadinessSummary = {
  total_considered: number
  ready_count: number
  blocked_count: number
  needs_review_count: number
  rejected_count: number
  generic_count: number
  high_risk_count: number
  generated_at: string
}

export type ExecutorReviewProposalApplyReadinessState = {
  preview?: ExecutorReviewProposalApplyReadinessPreviewSummary | null
  summary?: ExecutorReviewProposalApplyReadinessSummary | null
  records: ExecutorReviewProposalApplyReadinessRecordSummary[]
  selected?: ExecutorReviewProposalApplyReadinessPreviewSummary | null
  commandError?: string
}

export type ExecutorReviewProposalNarrowApplyCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalNarrowApplyPreviewSummary = {
  preview_id: string
  status: string
  can_apply: boolean
  proposal_id: string
  readiness_id?: string
  review_request_id?: string
  request_gate_id?: string
  decision_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  proposal_status?: string
  readiness_status?: string
  candidate_kind: string
  candidate_risk: string
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  existing_apply_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalNarrowApplyCommandSummary[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalNarrowApplyResultSummary = {
  apply_id: string
  status: string
  proposal_id: string
  readiness_id?: string
  review_request_id?: string
  request_gate_id?: string
  decision_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  candidate_kind: string
  candidate_risk: string
  applied_at: string
  applied_by: string
  reason_preview?: string
  error?: string
  apply_hash: string
  recommended_commands: ExecutorReviewProposalNarrowApplyCommandSummary[]
}

export type ExecutorReviewProposalNarrowApplyRecordSummary = {
  apply_id: string
  status: string
  proposal_id: string
  readiness_id?: string
  candidate_kind: string
  candidate_risk: string
  applied_at: string
  summary_preview: string
  apply_hash: string
}

export type ExecutorReviewProposalNarrowApplyState = {
  preview?: ExecutorReviewProposalNarrowApplyPreviewSummary | null
  latestResult?: ExecutorReviewProposalNarrowApplyResultSummary | null
  records: ExecutorReviewProposalNarrowApplyRecordSummary[]
  selected?: ExecutorReviewProposalNarrowApplyResultSummary | null
  commandError?: string
}

export type OpenCodeHandoffFollowupStatus =
  | "sent"
  | "claimed"
  | "running"
  | "result_submitted"
  | "completed"
  | "failed"
  | "cancelled"
  | "handoff_failed"
  | "blocked"
  | "unknown"

export type OpenCodeHandoffFollowupQueueKind =
  | "active"
  | "needs_result_review"
  | "completed"
  | "failed"
  | "blocked"
  | "stale"

export type OpenCodeHandoffFollowupCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  requires_review?: boolean
}

export type OpenCodeHandoffFollowupSummary = {
  handoff_id: string
  proposal_id: string
  review_id?: string
  mission_id?: string
  intent_id?: string
  followup_status: OpenCodeHandoffFollowupStatus
  handoff_sent: boolean
  proposal_status?: string
  review_status?: string
  mission_status?: string
  active_claim_id?: string
  latest_progress_id?: string
  latest_result_id?: string
  result_count: number
  progress_count: number
  blockers: string[]
  suggested_commands: OpenCodeHandoffFollowupCommandSummary[]
  source_cycle_id?: string
  source_synthesis_id?: string
  evidence_ids: string[]
  updated_at?: string
}

export type OpenCodeHandoffFollowupCounts = {
  sent_count: number
  running_count: number
  result_submitted_count: number
  completed_count: number
  failed_count: number
  blocked_count: number
  stale_count: number
  last_handoff_id?: string
}

export type OpenCodeHandoffFollowupState = {
  selected?: OpenCodeHandoffFollowupSummary | null
  summary?: OpenCodeHandoffFollowupCounts | null
  selectedQueue?: OpenCodeHandoffFollowupQueueKind
  queueItems: OpenCodeHandoffFollowupSummary[]
  commandError?: string
}

export type RuntimeCheckpointScope = "full" | "commander" | "executor" | "research" | "handoff"

export type RuntimeCheckpointSectionSummary = {
  name: string
  included: boolean
  item_count: number
  bytes: number
  truncated: boolean
}

export type RuntimeCheckpointSuggestedCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
}

export type RuntimeCheckpointPreviewSummary = {
  checkpoint_id?: string
  scope: RuntimeCheckpointScope
  reason?: string
  event_count: number
  last_event_id?: string
  sections: RuntimeCheckpointSectionSummary[]
  estimated_bytes: number
  max_bytes: number
  blockers: string[]
  redacted_summary_preview: string
}

export type RuntimeCheckpointSummary = {
  checkpoint_id: string
  scope: RuntimeCheckpointScope
  reason?: string
  created_at: string
  created_by: string
  event_count: number
  last_event_id?: string
  checkpoint_hash: string
  sections: Record<string, unknown>
  section_summaries: RuntimeCheckpointSectionSummary[]
  restore_supported: false
  warnings: string[]
}

export type RuntimeCheckpointRecordSummary = {
  checkpoint_id: string
  scope: RuntimeCheckpointScope
  reason?: string
  created_at: string
  created_by: string
  event_count: number
  last_event_id?: string
  checkpoint_hash: string
  section_names: string[]
  summary_preview: string
}

export type RuntimeCheckpointsState = {
  preview?: RuntimeCheckpointPreviewSummary | null
  selected?: RuntimeCheckpointSummary | null
  recent: RuntimeCheckpointRecordSummary[]
  commandError?: string
}

export type RuntimeCheckpointDriftStatus = "none" | "advanced" | "forked" | "unknown"

export type RuntimeCheckpointVerificationSummary = {
  checkpoint_id: string
  exists: boolean
  hash_ok: boolean
  cursor_ok: boolean
  event_count_at_checkpoint: number
  current_event_count: number
  checkpoint_last_event_id?: string
  current_last_event_id?: string
  new_event_count: number
  drift_status: RuntimeCheckpointDriftStatus | string
  blockers: string[]
  warnings: string[]
}

export type RuntimeRestoreContextSummary = {
  recent_cycle_ids?: string[]
  recent_synthesis_ids?: string[]
  proposal_ids?: string[]
  review_ids?: string[]
  bundle_ids?: string[]
  mission_ids?: string[]
  active_mission_ids?: string[]
  active_claim_ids?: string[]
  result_ids?: string[]
  progress_ids?: string[]
  handoff_ids?: string[]
  active_handoff_ids?: string[]
  needs_result_review_ids?: string[]
  failed_handoff_ids?: string[]
  provider_id?: string
  provider_kind?: string
  health_status?: string
  warnings: string[]
}

export type RuntimeRestoreSuggestedCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
}

export type RuntimeRestorePreviewSummary = {
  checkpoint_id: string
  can_mark_resume: boolean
  verification: RuntimeCheckpointVerificationSummary
  commander_context: RuntimeRestoreContextSummary
  executor_context: RuntimeRestoreContextSummary
  handoff_context: RuntimeRestoreContextSummary
  reasoning_context: RuntimeRestoreContextSummary
  suggested_commands: RuntimeRestoreSuggestedCommandSummary[]
  redacted_summary_preview: string
  created_at: string
}

export type RuntimeResumeAnchorSummary = {
  resume_id: string
  checkpoint_id: string
  checkpoint_hash: string
  marked_at: string
  marked_by: string
  event_count_at_checkpoint: number
  current_event_count: number
  checkpoint_last_event_id?: string
  current_last_event_id?: string
  drift_status: RuntimeCheckpointDriftStatus | string
  summary_preview: string
}

export type RuntimeRestoreState = {
  preview?: RuntimeRestorePreviewSummary | null
  selectedAnchor?: RuntimeResumeAnchorSummary | null
  recentAnchors: RuntimeResumeAnchorSummary[]
  commandError?: string
}

export type WakeTriggerKindSummary = "manual" | "startup_preview" | "external_signal" | string

export type WakeSuggestedCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  requires_review?: boolean
}

export type WakeAssessmentSectionsSummary = {
  resume?: Record<string, unknown>
  commander?: RuntimeRestoreContextSummary
  executor?: RuntimeRestoreContextSummary
  handoff?: RuntimeRestoreContextSummary
  reasoning?: RuntimeRestoreContextSummary
  checkpoint?: Record<string, unknown>
}

export type WakeAssessmentPreviewSummary = {
  wake_id?: string
  trigger_kind: WakeTriggerKindSummary
  resume_id?: string
  checkpoint_id?: string
  allowed: boolean
  blockers: string[]
  warnings: string[]
  drift_status?: RuntimeCheckpointDriftStatus | string
  current_event_count: number
  checkpoint_event_count?: number
  new_event_count?: number
  reasoning_health_status?: string
  handoff_summary?: Record<string, unknown>
  commander_summary?: Record<string, unknown>
  executor_summary?: Record<string, unknown>
  suggested_commands: WakeSuggestedCommandSummary[]
  redacted_summary_preview: string
}

export type WakeAssessmentSummary = {
  wake_id: string
  trigger_kind: WakeTriggerKindSummary
  resume_id?: string
  checkpoint_id?: string
  checkpoint_hash?: string
  created_at: string
  requested_by: string
  allowed: boolean
  blockers: string[]
  warnings: string[]
  drift_status?: RuntimeCheckpointDriftStatus | string
  current_event_count: number
  checkpoint_event_count?: number
  new_event_count?: number
  sections: WakeAssessmentSectionsSummary
  suggested_commands: WakeSuggestedCommandSummary[]
  assessment_hash: string
}

export type WakeAssessmentRecordSummary = {
  wake_id: string
  trigger_kind: WakeTriggerKindSummary
  resume_id?: string
  checkpoint_id?: string
  allowed: boolean
  drift_status?: RuntimeCheckpointDriftStatus | string
  created_at: string
  requested_by: string
  summary_preview: string
  assessment_hash: string
}

export type WakeAssessmentState = {
  preview?: WakeAssessmentPreviewSummary | null
  selected?: WakeAssessmentSummary | null
  recent: WakeAssessmentRecordSummary[]
  commandError?: string
}

export type ContinuationPlanStatusSummary = "proposed" | "active" | "paused" | "completed" | "cancelled" | "blocked" | "failed" | string

export type ContinuationStepStatusSummary = "pending" | "running" | "succeeded" | "failed" | "skipped" | "blocked" | string

export type ContinuationStepKindSummary = "read_command" | "write_command" | "operator_checkpoint" | string

export type ContinuationStepPreviewSummary = {
  index: number
  label: string
  command: string
  command_type: "read" | "write"
  step_kind: ContinuationStepKindSummary
  requires_active_runtime?: boolean
  requires_review?: boolean
  allowed_by_default: boolean
  blockers: string[]
}

export type ContinuationPlanPreviewSummary = {
  wake_id: string
  resume_id?: string
  checkpoint_id?: string
  can_create: boolean
  blockers: string[]
  warnings: string[]
  step_count: number
  read_step_count: number
  write_step_count: number
  operator_checkpoint_count: number
  redacted_summary_preview: string
  steps: ContinuationStepPreviewSummary[]
}

export type ContinuationStepSummary = ContinuationStepPreviewSummary & {
  step_id: string
  status: ContinuationStepStatusSummary
  created_from_suggestion?: boolean
  result_summary?: string
  error?: string
  started_at?: string
  completed_at?: string
}

export type ContinuationPlanSummary = {
  plan_id: string
  wake_id: string
  resume_id?: string
  checkpoint_id?: string
  status: ContinuationPlanStatusSummary
  created_at: string
  created_by: string
  updated_at: string
  plan_hash: string
  steps: ContinuationStepSummary[]
  current_step_index?: number
  completed_step_count: number
  failed_step_count: number
  blockers: string[]
  warnings: string[]
}

export type ContinuationStepResultSummary = {
  plan_id: string
  step_id: string
  index: number
  status: ContinuationStepStatusSummary
  command: string
  result_summary?: string
  error?: string
  dry_run?: boolean
  started_at: string
  completed_at: string
}

export type ContinuationPlanRecordSummary = {
  plan_id: string
  wake_id: string
  status: ContinuationPlanStatusSummary
  created_at: string
  updated_at: string
  step_count: number
  completed_step_count: number
  failed_step_count: number
  summary_preview: string
  plan_hash: string
}

export type ContinuationState = {
  preview?: ContinuationPlanPreviewSummary | null
  selected?: ContinuationPlanSummary | null
  lastStepResult?: ContinuationStepResultSummary | null
  recent: ContinuationPlanRecordSummary[]
  commandError?: string
}

export type WakeScheduleStatusSummary = "active" | "paused" | "cancelled" | string

export type WakeSchedulePolicySummary = {
  create_wake_assessment: boolean
  create_continuation_plan: boolean
  include_write_steps: boolean
  max_wake_assessments_per_tick: number
  max_continuation_plans_per_tick: number
}

export type WakeScheduleSummary = {
  schedule_id: string
  resume_id: string
  checkpoint_id?: string
  status: WakeScheduleStatusSummary
  title: string
  interval_ms: number
  next_due_at: string
  last_tick_at?: string
  last_wake_id?: string
  last_plan_id?: string
  created_at: string
  created_by: string
  updated_at: string
  policy: WakeSchedulePolicySummary
  reason?: string
  schedule_hash: string
  warnings: string[]
}

export type WakeScheduleRecordSummary = {
  schedule_id: string
  resume_id: string
  status: WakeScheduleStatusSummary
  title: string
  next_due_at: string
  last_tick_at?: string
  last_wake_id?: string
  last_plan_id?: string
  summary_preview: string
}

export type WakeSchedulePreviewSummary = {
  resume_id: string
  checkpoint_id?: string
  title: string
  interval_ms: number
  next_due_at: string
  policy: WakeSchedulePolicySummary
  can_create: boolean
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type WakeScheduleDueItemSummary = {
  schedule_id: string
  resume_id: string
  checkpoint_id?: string
  due: boolean
  status: WakeScheduleStatusSummary
  next_due_at: string
  last_tick_at?: string
  blockers: string[]
  warnings: string[]
  would_create_wake: boolean
  would_create_continuation_plan: boolean
}

export type WakeScheduleTickPreviewSummary = {
  now: string
  due_count: number
  eligible_count: number
  blocked_count: number
  items: WakeScheduleDueItemSummary[]
  max_items: number
  blockers: string[]
  warnings: string[]
}

export type WakeScheduleTickResultSummary = {
  tick_id: string
  now: string
  processed_count: number
  wake_ids: string[]
  plan_ids: string[]
  skipped: WakeScheduleDueItemSummary[]
  created_at: string
  requested_by: string
  dry_run: boolean
}

export type WakeSchedulesState = {
  preview?: WakeSchedulePreviewSummary | null
  selected?: WakeScheduleSummary | null
  recent: WakeScheduleRecordSummary[]
  tickPreview?: WakeScheduleTickPreviewSummary | null
  lastTick?: WakeScheduleTickResultSummary | null
  recentTicks: WakeScheduleTickResultSummary[]
  commandError?: string
}

export type WakeSchedulerStatusSummary = "stopped" | "starting" | "running" | "stopping" | "failed" | string

export type WakeSchedulerConfigSummary = {
  enabled: boolean
  interval_ms: number
  max_due_items: number
  dry_run: boolean
  started_by?: string
  heartbeat_interval_ms?: number
  max_ticks_per_run?: number
  stop_on_error: boolean
}

export type WakeSchedulerPreviewSummary = {
  can_start: boolean
  status: WakeSchedulerStatusSummary
  config: WakeSchedulerConfigSummary
  blockers: string[]
  warnings: string[]
  due_preview?: WakeScheduleTickPreviewSummary
  redacted_summary_preview: string
}

export type WakeSchedulerStaleRunSummary = {
  detected: boolean
  prior_started_at?: string
  prior_status?: WakeSchedulerStatusSummary
  prior_tick_id?: string
  prior_event_id?: string
  reason?: string
}

export type WakeSchedulerBootstrapStatusSummary = {
  autostart_enabled: boolean
  configured: boolean
  can_bootstrap: boolean
  scheduler_status: WakeSchedulerStatusSummary
  config: WakeSchedulerConfigSummary & {
    require_due_schedule?: boolean
    requested_by?: string
  }
  blockers: string[]
  warnings: string[]
  last_bootstrap_event_id?: string
  last_bootstrap_at?: string
  stale_prior_run?: WakeSchedulerStaleRunSummary
  due_preview?: WakeScheduleTickPreviewSummary
  redacted_summary_preview: string
}

export type WakeSchedulerStateSummary = {
  status: WakeSchedulerStatusSummary
  config: WakeSchedulerConfigSummary
  started_at?: string
  stopped_at?: string
  last_tick_id?: string
  last_tick_at?: string
  last_error?: string
  tick_count: number
  heartbeat_count: number
  next_tick_at?: string
  started_by?: string
  stopped_by?: string
}

export type WakeSchedulerEventRecordSummary = {
  event_id?: string
  kind: string
  scheduler_status: WakeSchedulerStatusSummary
  tick_id?: string
  message?: string
  created_at: string
  requested_by?: string
}

export type WakeSchedulerRecoveryCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerRecoveryStatusSummary = "none" | "detected" | "acknowledged" | "resolved" | "dismissed" | string

export type WakeSchedulerRecoveryPreviewSummary = {
  recovery_id?: string
  stale_detected: boolean
  status: WakeSchedulerRecoveryStatusSummary
  prior_started_at?: string
  prior_event_id?: string
  prior_tick_id?: string
  scheduler_status: WakeSchedulerStatusSummary
  current_event_count: number
  due_schedule_count: number
  eligible_due_schedule_count: number
  blocked_due_schedule_count: number
  missed_window_estimate_count?: number
  warnings: string[]
  blockers: string[]
  recommended_commands: WakeSchedulerRecoveryCommandSummary[]
  redacted_summary_preview: string
}

export type WakeSchedulerRecoverySummary = WakeSchedulerRecoveryPreviewSummary & {
  recovery_id: string
  acknowledged_at?: string
  acknowledged_by?: string
  resolution_reason?: string
  created_at: string
  updated_at: string
  recovery_hash: string
}

export type WakeSchedulerRecoveryRecordSummary = {
  recovery_id: string
  status: WakeSchedulerRecoveryStatusSummary
  stale_detected: boolean
  prior_started_at?: string
  acknowledged_at?: string
  updated_at: string
  summary_preview: string
  recovery_hash: string
}

export type WakeSchedulerRecoveryWorkflowStatusSummary = "proposed" | "active" | "completed" | "cancelled" | "blocked" | string

export type WakeSchedulerRecoveryWorkflowStepStatusSummary = "pending" | "manually_done" | "verified" | "skipped" | "blocked" | string

export type WakeSchedulerRecoveryWorkflowStepSummary = {
  step_id?: string
  index: number
  label: string
  command: string
  command_type: "read" | "write" | string
  step_kind: string
  allowed_to_execute_here: false
  requires_active_runtime?: boolean
  verification_hint?: string
  status?: WakeSchedulerRecoveryWorkflowStepStatusSummary
  note?: string
  marked_at?: string
  marked_by?: string
  verification_summary?: string
  blockers: string[]
}

export type WakeSchedulerRecoveryWorkflowPreviewSummary = {
  recovery_id: string
  can_create: boolean
  blockers: string[]
  warnings: string[]
  recovery_status: WakeSchedulerRecoveryStatusSummary
  stale_detected: boolean
  step_count: number
  read_step_count: number
  write_step_count: number
  dry_run_step_count: number
  resolution_step_count: number
  steps: WakeSchedulerRecoveryWorkflowStepSummary[]
  redacted_summary_preview: string
}

export type WakeSchedulerRecoveryWorkflowSummary = {
  workflow_id: string
  recovery_id: string
  recovery_hash?: string
  status: WakeSchedulerRecoveryWorkflowStatusSummary
  created_at: string
  created_by: string
  updated_at: string
  workflow_hash: string
  steps: WakeSchedulerRecoveryWorkflowStepSummary[]
  completed_step_count: number
  skipped_step_count: number
  blocked_step_count: number
  warnings: string[]
  blockers: string[]
}

export type WakeSchedulerRecoveryWorkflowRecordSummary = {
  workflow_id: string
  recovery_id: string
  status: WakeSchedulerRecoveryWorkflowStatusSummary
  created_at: string
  updated_at: string
  step_count: number
  completed_step_count: number
  skipped_step_count: number
  blocked_step_count: number
  summary_preview: string
  workflow_hash: string
}

export type WakeSchedulerRecoveryWorkflowVerificationSummary = {
  workflow_id: string
  recovery_id: string
  checked_at: string
  observable_events: Array<{ kind: string; event_id?: string; created_at?: string; command_match?: string; summary_preview: string }>
  step_updates: Array<{ step_id: string; index: number; suggested_status: WakeSchedulerRecoveryWorkflowStepStatusSummary; verification_summary: string }>
  warnings: string[]
}

export type WakeSchedulerAuditEventKindSummary =
  | "checkpoint"
  | "resume_anchor"
  | "wake_assessment"
  | "continuation_plan"
  | "continuation_step"
  | "wake_schedule"
  | "wake_tick"
  | "scheduler_lifecycle"
  | "scheduler_bootstrap"
  | "scheduler_recovery"
  | "scheduler_recovery_workflow"
  | "incident"
  | "other"
  | string

export type WakeSchedulerAuditSeveritySummary = "info" | "warning" | "error" | string

export type WakeSchedulerAuditCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerAuditTimelineEntrySummary = {
  audit_id: string
  event_id?: string
  source_kind: WakeSchedulerAuditEventKindSummary
  source_event_kind: string
  severity: WakeSchedulerAuditSeveritySummary
  created_at: string
  title: string
  summary: string
  related_ids: Record<string, string[]>
  recommended_commands: WakeSchedulerAuditCommandSummary[]
}

export type WakeSchedulerAuditSummarySummary = {
  event_count: number
  checkpoint_count: number
  resume_anchor_count: number
  wake_assessment_count: number
  continuation_plan_count: number
  continuation_step_count: number
  schedule_count: number
  tick_count: number
  scheduler_start_count: number
  scheduler_stop_count: number
  scheduler_failure_count: number
  bootstrap_blocked_count: number
  stale_recovery_count: number
  recovery_workflow_count: number
  unresolved_incident_count: number
  last_event_at?: string
  latest_scheduler_status?: string
  latest_bootstrap_status?: string
  latest_recovery_status?: string
}

export type WakeSchedulerAuditGapSummary = {
  severity: WakeSchedulerAuditSeveritySummary
  message: string
  related_ids?: Record<string, string[]>
}

export type WakeSchedulerAuditChainSummary = {
  chain_id: string
  root_kind: WakeSchedulerAuditEventKindSummary
  root_id: string
  entries: WakeSchedulerAuditTimelineEntrySummary[]
  related_ids: Record<string, string[]>
  gaps: WakeSchedulerAuditGapSummary[]
  recommended_commands: WakeSchedulerAuditCommandSummary[]
}

export type WakeSchedulerAuditIncidentSummary = {
  incident_id: string
  severity: WakeSchedulerAuditSeveritySummary
  status: "open" | "acknowledged" | "resolved" | "unknown" | string
  title: string
  summary: string
  first_seen_at?: string
  last_seen_at?: string
  related_entries: WakeSchedulerAuditTimelineEntrySummary[]
  recommended_commands: WakeSchedulerAuditCommandSummary[]
}

export type WakeSchedulerNavigationRiskSummary = "safe_read" | "write_requires_operator" | "high_impact_write" | "unsupported" | string

export type WakeSchedulerNavigationTargetKindSummary =
  | "scheduler_status"
  | "scheduler_bootstrap"
  | "scheduler_recovery"
  | "scheduler_recovery_workflow"
  | "scheduler_audit"
  | "wake_schedule"
  | "wake_tick"
  | "wake_assessment"
  | "continuation_plan"
  | "checkpoint"
  | "resume_anchor"
  | "handoff_followup"
  | "mission"
  | "unknown"
  | string

export type WakeSchedulerNavigationCardSummary = {
  card_id: string
  label: string
  command: string
  command_type: "read" | "write" | string
  risk: WakeSchedulerNavigationRiskSummary
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  supported: boolean
  blockers: string[]
  notes: string[]
  recommended_order: number
}

export type WakeSchedulerNavigationBoardSummary = {
  board_id: string
  source: {
    kind: "summary" | "timeline" | "chain" | "incident" | "related_id" | "command" | string
    related_id?: string
    incident_id?: string
    audit_id?: string
  }
  title: string
  summary: string
  cards: WakeSchedulerNavigationCardSummary[]
  related_ids: Record<string, string[]>
  warnings: string[]
  blockers: string[]
  generated_at: string
}

export type WakeSchedulerNavigationCommandPreviewSummary = {
  command: string
  command_type: "read" | "write" | string
  risk: WakeSchedulerNavigationRiskSummary
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  supported: boolean
  blockers: string[]
  notes: string[]
  equivalent_runtime_command?: string
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationTargetSummary = {
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id: string
  title: string
  related_commands: WakeSchedulerNavigationCardSummary[]
  related_ids: Record<string, string[]>
  audit_entries: WakeSchedulerAuditTimelineEntrySummary[]
  warnings: string[]
}

export type WakeSchedulerNavigationStageEligibilitySummary = {
  can_stage: boolean
  command: string
  command_type: "read" | "write" | string
  risk: WakeSchedulerNavigationRiskSummary
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationStagePreviewSummary = {
  command: string
  source_card_id?: string
  source_board_id?: string
  eligibility: WakeSchedulerNavigationStageEligibilitySummary
  existing_staged_id?: string
  blockers: string[]
  warnings: string[]
}

export type WakeSchedulerNavigationStagedCommandSummary = {
  staged_id: string
  command: string
  command_type: "read" | "write" | string
  risk: WakeSchedulerNavigationRiskSummary
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  source_board_id?: string
  source_card_id?: string
  source_audit_id?: string
  source_incident_id?: string
  source_related_id?: string
  label: string
  notes: string[]
  staged_at: string
  staged_by: string
  status: "staged" | string
  stage_hash: string
}

export type WakeSchedulerNavigationStagedCommandRecordSummary = {
  staged_id: string
  command: string
  risk: WakeSchedulerNavigationRiskSummary
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  staged_at: string
  staged_by: string
  summary_preview: string
  stage_hash: string
}

export type WakeSchedulerNavigationStagedRunPreviewSummary = {
  staged_id: string
  command: string
  can_execute: boolean
  command_type: "read" | "write" | string
  risk: WakeSchedulerNavigationRiskSummary
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationStagedRunResultSummary = {
  run_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  status: "succeeded" | "failed" | "blocked" | string
  result_summary?: string
  result_kind?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash?: string
}

export type WakeSchedulerNavigationStagedRunRecordSummary = {
  run_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationTargetKindSummary
  status: "succeeded" | "failed" | "blocked" | string
  completed_at: string
  summary_preview: string
}

export type WakeSchedulerNavigationStagedReadCompareCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerNavigationStagedReadComparisonStatusSummary = "unchanged" | "changed" | "first_run" | "failed" | "blocked" | "unknown" | string

export type WakeSchedulerNavigationStagedReadGroupSummary = {
  group_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  run_count: number
  succeeded_count: number
  failed_count: number
  blocked_count: number
  latest_run_id?: string
  latest_completed_at?: string
  latest_status?: "succeeded" | "failed" | "blocked" | string
  latest_comparison_hash?: string
  previous_run_id?: string
  previous_comparison_hash?: string
  comparison_status: WakeSchedulerNavigationStagedReadComparisonStatusSummary
  summary_preview: string
  recommended_commands: WakeSchedulerNavigationStagedReadCompareCommandSummary[]
}

export type WakeSchedulerNavigationStagedReadPairComparisonSummary = {
  comparison_id: string
  staged_id: string
  command: string
  left_run_id: string
  right_run_id: string
  left_completed_at?: string
  right_completed_at?: string
  left_status: "succeeded" | "failed" | "blocked" | string
  right_status: "succeeded" | "failed" | "blocked" | string
  left_comparison_hash: string
  right_comparison_hash: string
  comparison_status: WakeSchedulerNavigationStagedReadComparisonStatusSummary
  summary_delta: string
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationStagedReadCompareCommandSummary[]
}

export type WakeSchedulerNavigationStagedReadHistorySummary = {
  staged_id?: string
  command?: string
  groups: WakeSchedulerNavigationStagedReadGroupSummary[]
  total_runs: number
  total_groups: number
  changed_groups: number
  failed_groups: number
  stale_groups: number
  generated_at: string
}

export type WakeSchedulerNavigationStagedReadStaleItemSummary = {
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationTargetKindSummary
  target_id?: string
  latest_run_id?: string
  latest_completed_at?: string
  age_ms?: number
  stale_after_ms: number
  stale: boolean
  recommended_commands: WakeSchedulerNavigationStagedReadCompareCommandSummary[]
}

export type WakeSchedulerNavigationWriteRiskSummary = "low_risk_write" | "medium_risk_write" | "high_impact_write" | "unsupported" | string
export type WakeSchedulerNavigationWriteAuthorityGateSummary =
  | "wake_scheduler_runtime"
  | "wake_schedule_tick"
  | "checkpoint_runtime"
  | "recovery_runtime"
  | "recovery_workflow_runtime"
  | "continuation_runtime"
  | "handoff_runtime"
  | "mission_runtime"
  | "proposal_review_runtime"
  | "reasoning_provider_runtime"
  | "unknown"
  | string
export type WakeSchedulerNavigationWriteEligibilityStatusSummary = "eligible_for_future_staging" | "blocked" | "unsupported" | "requires_human_approval" | "high_impact_blocked" | string

export type WakeSchedulerNavigationWritePrerequisiteSummary = {
  name: string
  satisfied: boolean
  severity: "info" | "warning" | "error" | string
  summary: string
}

export type WakeSchedulerNavigationWriteCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  risk?: string
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerNavigationFutureStagePolicySummary = {
  would_require_active_runtime: boolean
  would_require_run_lock: boolean
  would_require_confirmation: boolean
  would_require_approval_record: boolean
  would_require_dry_run_first: boolean
  would_require_recent_read_evidence: boolean
  allowed_in_7t: false
}

export type WakeSchedulerNavigationWritePreviewSummary = {
  command: string
  command_name: string
  command_type: "write" | string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  equivalent_runtime_command?: string
  status: WakeSchedulerNavigationWriteEligibilityStatusSummary
  can_stage_now: false
  can_execute_now: false
  target_kind: string
  target_id?: string
  parsed_args: Record<string, string>
  prerequisites: WakeSchedulerNavigationWritePrerequisiteSummary[]
  blockers: string[]
  warnings: string[]
  safer_read_commands: WakeSchedulerNavigationWriteCommandSummary[]
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicySummary
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationWriteBoardSummary = {
  board_id: string
  source: {
    kind: "command" | "navigation_board" | "related_id" | "incident" | "staged_read_group" | string
    related_id?: string
    incident_id?: string
    staged_id?: string
  }
  previews: WakeSchedulerNavigationWritePreviewSummary[]
  omitted_read_count: number
  unsupported_count: number
  high_impact_count: number
  blockers: string[]
  warnings: string[]
  generated_at: string
}

export type WakeSchedulerNavigationWriteStageEligibilitySummary = {
  can_stage: boolean
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  status: WakeSchedulerNavigationWriteEligibilityStatusSummary
  target_kind: string
  target_id?: string
  blockers: string[]
  warnings: string[]
  prerequisites: WakeSchedulerNavigationWritePrerequisiteSummary[]
  safer_read_commands: WakeSchedulerNavigationWriteCommandSummary[]
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicySummary
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationWriteStagePreviewSummary = {
  command: string
  eligibility: WakeSchedulerNavigationWriteStageEligibilitySummary
  existing_staged_id?: string
  blockers: string[]
  warnings: string[]
}

export type WakeSchedulerNavigationStagedWriteCommandSummary = {
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  equivalent_runtime_command?: string
  prerequisites: WakeSchedulerNavigationWritePrerequisiteSummary[]
  safer_read_commands: WakeSchedulerNavigationWriteCommandSummary[]
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicySummary
  source_preview_hash: string
  source_related_id?: string
  source_incident_id?: string
  source_staged_id?: string
  source_board_id?: string
  staged_at: string
  staged_by: string
  status: "staged" | string
  stage_hash: string
  summary_preview: string
}

export type WakeSchedulerNavigationStagedWriteCommandRecordSummary = {
  staged_write_id: string
  command: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  staged_at: string
  staged_by: string
  summary_preview: string
  stage_hash: string
}

export type WakeSchedulerNavigationWriteRunPreviewSummary = {
  staged_write_id: string
  command: string
  command_name: string
  can_execute: boolean
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  execution_kind: "wake_tick_dry_run" | "staged_safe_read" | "blocked" | string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationWriteRunResultSummary = {
  run_id: string
  staged_write_id: string
  command: string
  command_name: string
  execution_kind: "wake_tick_dry_run" | "staged_safe_read" | "blocked" | string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  status: "succeeded" | "failed" | "blocked" | string
  result_kind?: string
  result_summary?: string
  downstream_run_id?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash: string
}

export type WakeSchedulerNavigationWriteRunRecordSummary = {
  run_id: string
  staged_write_id: string
  command: string
  execution_kind: "wake_tick_dry_run" | "staged_safe_read" | "blocked" | string
  status: "succeeded" | "failed" | "blocked" | string
  completed_at: string
  summary_preview: string
}

export type WakeSchedulerNavigationWriteRunCompareCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerNavigationWriteRunComparisonStatusSummary = "unchanged" | "changed" | "first_run" | "failed" | "blocked" | "unknown" | string

export type WakeSchedulerNavigationWriteRunGroupSummary = {
  group_id: string
  staged_write_id: string
  command: string
  command_name: string
  execution_kind: "wake_tick_dry_run" | "staged_safe_read" | "blocked" | string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  run_count: number
  succeeded_count: number
  failed_count: number
  blocked_count: number
  latest_run_id?: string
  latest_completed_at?: string
  latest_status?: "succeeded" | "failed" | "blocked" | string
  latest_outcome_hash?: string
  previous_run_id?: string
  previous_outcome_hash?: string
  downstream_run_ids: string[]
  comparison_status: WakeSchedulerNavigationWriteRunComparisonStatusSummary
  summary_preview: string
  recommended_commands: WakeSchedulerNavigationWriteRunCompareCommandSummary[]
}

export type WakeSchedulerNavigationWriteRunPairComparisonSummary = {
  comparison_id: string
  staged_write_id: string
  command: string
  left_run_id: string
  right_run_id: string
  left_completed_at?: string
  right_completed_at?: string
  left_status: "succeeded" | "failed" | "blocked" | string
  right_status: "succeeded" | "failed" | "blocked" | string
  left_outcome_hash: string
  right_outcome_hash: string
  comparison_status: WakeSchedulerNavigationWriteRunComparisonStatusSummary
  summary_delta: string
  downstream_delta?: string
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationWriteRunCompareCommandSummary[]
}

export type WakeSchedulerNavigationWriteRunHistorySummary = {
  staged_write_id?: string
  command?: string
  groups: WakeSchedulerNavigationWriteRunGroupSummary[]
  total_runs: number
  total_groups: number
  changed_groups: number
  failed_groups: number
  stale_groups: number
  generated_at: string
}

export type WakeSchedulerNavigationWriteRunStaleItemSummary = {
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  latest_run_id?: string
  latest_completed_at?: string
  age_ms?: number
  stale_after_ms: number
  stale: boolean
  recommended_commands: WakeSchedulerNavigationWriteRunCompareCommandSummary[]
}

export type WakeSchedulerNavigationWriteApprovalStatusSummary = "pending" | "approved" | "rejected" | "revoked" | "expired" | string

export type WakeSchedulerNavigationWriteReadinessStatusSummary = "ready_for_approval" | "blocked" | "needs_evidence" | "unsupported" | "high_impact_blocked" | string

export type WakeSchedulerNavigationWriteEvidenceSummary = {
  evidence_id: string
  kind: "safe_read_run" | "safe_read_comparison" | "low_risk_write_run" | "low_risk_write_comparison" | "audit_chain" | "manual_note" | string
  related_id?: string
  command?: string
  status?: string
  completed_at?: string
  fresh: boolean
  age_ms?: number
  summary_preview: string
  blockers: string[]
  warnings: string[]
}

export type WakeSchedulerNavigationWriteReadinessPreviewSummary = {
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  readiness_status: WakeSchedulerNavigationWriteReadinessStatusSummary
  can_approve: boolean
  can_execute_now: false
  blockers: string[]
  warnings: string[]
  required_evidence: WakeSchedulerNavigationWriteEvidenceSummary[]
  optional_evidence: WakeSchedulerNavigationWriteEvidenceSummary[]
  existing_approval?: WakeSchedulerNavigationWriteApprovalRecordSummary
  recommended_commands: WakeSchedulerNavigationWriteCommandSummary[]
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationWriteApprovalSummary = {
  approval_id: string
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  status: WakeSchedulerNavigationWriteApprovalStatusSummary
  approved_at?: string
  rejected_at?: string
  revoked_at?: string
  updated_at: string
  requested_by: string
  reason?: string
  evidence: WakeSchedulerNavigationWriteEvidenceSummary[]
  approval_hash: string
  expires_at?: string
  summary_preview: string
}

export type WakeSchedulerNavigationWriteApprovalRecordSummary = {
  approval_id: string
  staged_write_id: string
  command: string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  status: WakeSchedulerNavigationWriteApprovalStatusSummary
  updated_at: string
  summary_preview: string
  approval_hash: string
}

export type WakeSchedulerNavigationCheckpointWriteRunPreviewSummary = {
  staged_write_id: string
  approval_id?: string
  command: string
  command_name: string
  can_execute: boolean
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  target_kind: string
  target_id?: string
  execution_kind: "checkpoint_create" | "blocked" | string
  checkpoint_scope?: string
  checkpoint_reason_preview?: string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export type WakeSchedulerNavigationCheckpointWriteRunResultSummary = {
  run_id: string
  staged_write_id: string
  approval_id?: string
  command: string
  command_name: string
  execution_kind: "checkpoint_create" | "blocked" | string
  risk: WakeSchedulerNavigationWriteRiskSummary
  authority_gate: WakeSchedulerNavigationWriteAuthorityGateSummary
  status: "succeeded" | "failed" | "blocked" | string
  checkpoint_id?: string
  checkpoint_hash?: string
  event_count?: number
  result_kind?: string
  result_summary?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash: string
}

export type WakeSchedulerNavigationCheckpointWriteRunRecordSummary = {
  run_id: string
  staged_write_id: string
  approval_id?: string
  command: string
  status: "succeeded" | "failed" | "blocked" | string
  checkpoint_id?: string
  completed_at: string
  summary_preview: string
}

export type WakeSchedulerNavigationCheckpointWriteComparisonStatusSummary = "unchanged" | "changed" | "first_run" | "failed" | "blocked" | "unknown" | string

export type WakeSchedulerNavigationCheckpointWriteCompareCommandSummary = {
  label: string
  command: string
  command_type: "read" | "write" | string
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerNavigationCheckpointWriteGroupSummary = {
  group_id: string
  staged_write_id: string
  command: string
  command_name: string
  approval_ids: string[]
  run_count: number
  succeeded_count: number
  failed_count: number
  blocked_count: number
  latest_run_id?: string
  latest_approval_id?: string
  latest_checkpoint_id?: string
  latest_checkpoint_hash?: string
  latest_event_count?: number
  latest_completed_at?: string
  latest_status?: "succeeded" | "failed" | "blocked" | string
  latest_outcome_hash?: string
  previous_run_id?: string
  previous_outcome_hash?: string
  comparison_status: WakeSchedulerNavigationCheckpointWriteComparisonStatusSummary
  checkpoint_artifact_changed?: boolean
  summary_preview: string
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommandSummary[]
}

export type WakeSchedulerNavigationCheckpointWritePairComparisonSummary = {
  comparison_id: string
  staged_write_id: string
  command: string
  left_run_id: string
  right_run_id: string
  left_approval_id?: string
  right_approval_id?: string
  left_checkpoint_id?: string
  right_checkpoint_id?: string
  left_checkpoint_hash?: string
  right_checkpoint_hash?: string
  left_event_count?: number
  right_event_count?: number
  left_completed_at?: string
  right_completed_at?: string
  left_status: "succeeded" | "failed" | "blocked" | string
  right_status: "succeeded" | "failed" | "blocked" | string
  left_outcome_hash: string
  right_outcome_hash: string
  comparison_status: WakeSchedulerNavigationCheckpointWriteComparisonStatusSummary
  checkpoint_artifact_delta?: string
  approval_delta?: string
  summary_delta: string
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommandSummary[]
}

export type WakeSchedulerNavigationCheckpointWriteHistorySummary = {
  staged_write_id?: string
  approval_id?: string
  command?: string
  groups: WakeSchedulerNavigationCheckpointWriteGroupSummary[]
  total_runs: number
  total_groups: number
  changed_groups: number
  failed_groups: number
  artifact_changed_groups: number
  unused_approval_count: number
  stale_approval_count: number
  generated_at: string
}

export type WakeSchedulerNavigationCheckpointApprovalUsageSummary = {
  approval_id: string
  staged_write_id: string
  command: string
  approval_status: WakeSchedulerNavigationWriteApprovalStatusSummary
  approved_at?: string
  expires_at?: string
  revoked_at?: string
  used: boolean
  run_ids: string[]
  latest_run_id?: string
  latest_run_status?: "succeeded" | "failed" | "blocked" | string
  latest_run_at?: string
  stale: boolean
  expired_before_use: boolean
  revoked_before_use: boolean
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommandSummary[]
}

export type WakeSchedulerNavigationCheckpointApprovalUsageSummaryState = {
  approvals: WakeSchedulerNavigationCheckpointApprovalUsageSummary[]
  total_approvals: number
  used_count: number
  unused_count: number
  stale_count: number
  expired_unused_count: number
  revoked_unused_count: number
  generated_at: string
}

export type WakeSchedulerNavigationCheckpointWriteStaleItemSummary = {
  staged_write_id: string
  approval_id?: string
  command: string
  latest_run_id?: string
  latest_completed_at?: string
  checkpoint_id?: string
  age_ms?: number
  stale_after_ms: number
  stale: boolean
  reason: string
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommandSummary[]
}

export type WakeSchedulerUiState = {
  preview?: WakeSchedulerPreviewSummary | null
  status?: WakeSchedulerStateSummary | null
  bootstrapStatus?: WakeSchedulerBootstrapStatusSummary | null
  bootstrapPreview?: WakeSchedulerBootstrapStatusSummary | null
  recoveryPreview?: WakeSchedulerRecoveryPreviewSummary | null
  selectedRecovery?: WakeSchedulerRecoverySummary | null
  recoveries: WakeSchedulerRecoveryRecordSummary[]
  recoveryWorkflowPreview?: WakeSchedulerRecoveryWorkflowPreviewSummary | null
  selectedRecoveryWorkflow?: WakeSchedulerRecoveryWorkflowSummary | null
  recoveryWorkflowVerification?: WakeSchedulerRecoveryWorkflowVerificationSummary | null
  recoveryWorkflows: WakeSchedulerRecoveryWorkflowRecordSummary[]
  auditSummary?: WakeSchedulerAuditSummarySummary | null
  auditTimeline: WakeSchedulerAuditTimelineEntrySummary[]
  selectedAuditChain?: WakeSchedulerAuditChainSummary | null
  auditIncidents: WakeSchedulerAuditIncidentSummary[]
  navigationBoard?: WakeSchedulerNavigationBoardSummary | null
  navigationCommandPreview?: WakeSchedulerNavigationCommandPreviewSummary | null
  navigationTarget?: WakeSchedulerNavigationTargetSummary | null
  navigationStagePreview?: WakeSchedulerNavigationStagePreviewSummary | null
  stagedNavigationCommands: WakeSchedulerNavigationStagedCommandRecordSummary[]
  selectedStagedNavigationCommand?: WakeSchedulerNavigationStagedCommandSummary | null
  stagedReadPreview?: WakeSchedulerNavigationStagedRunPreviewSummary | null
  latestStagedReadResult?: WakeSchedulerNavigationStagedRunResultSummary | null
  stagedReadRuns: WakeSchedulerNavigationStagedRunRecordSummary[]
  stagedReadHistory?: WakeSchedulerNavigationStagedReadHistorySummary | null
  stagedReadComparison?: WakeSchedulerNavigationStagedReadPairComparisonSummary | null
  stagedReadStaleItems: WakeSchedulerNavigationStagedReadStaleItemSummary[]
  selectedStagedReadGroup?: WakeSchedulerNavigationStagedReadGroupSummary | null
  writePreview?: WakeSchedulerNavigationWritePreviewSummary | null
  writeBoard?: WakeSchedulerNavigationWriteBoardSummary | null
  writeStagePreview?: WakeSchedulerNavigationWriteStagePreviewSummary | null
  selectedStagedWriteCommand?: WakeSchedulerNavigationStagedWriteCommandSummary | null
  stagedWriteCommands: WakeSchedulerNavigationStagedWriteCommandRecordSummary[]
  writeRunPreview?: WakeSchedulerNavigationWriteRunPreviewSummary | null
  latestWriteRunResult?: WakeSchedulerNavigationWriteRunResultSummary | null
  writeRunRecords: WakeSchedulerNavigationWriteRunRecordSummary[]
  writeRunHistory?: WakeSchedulerNavigationWriteRunHistorySummary | null
  writeRunComparison?: WakeSchedulerNavigationWriteRunPairComparisonSummary | null
  writeRunStaleItems: WakeSchedulerNavigationWriteRunStaleItemSummary[]
  selectedWriteRunGroup?: WakeSchedulerNavigationWriteRunGroupSummary | null
  writeReadinessPreview?: WakeSchedulerNavigationWriteReadinessPreviewSummary | null
  selectedWriteApproval?: WakeSchedulerNavigationWriteApprovalSummary | null
  writeApprovalRecords: WakeSchedulerNavigationWriteApprovalRecordSummary[]
  checkpointWriteRunPreview?: WakeSchedulerNavigationCheckpointWriteRunPreviewSummary | null
  latestCheckpointWriteRunResult?: WakeSchedulerNavigationCheckpointWriteRunResultSummary | null
  checkpointWriteRunRecords: WakeSchedulerNavigationCheckpointWriteRunRecordSummary[]
  checkpointWriteHistory?: WakeSchedulerNavigationCheckpointWriteHistorySummary | null
  checkpointWriteComparison?: WakeSchedulerNavigationCheckpointWritePairComparisonSummary | null
  checkpointWriteStaleItems: WakeSchedulerNavigationCheckpointWriteStaleItemSummary[]
  selectedCheckpointWriteGroup?: WakeSchedulerNavigationCheckpointWriteGroupSummary | null
  checkpointApprovalUsage?: WakeSchedulerNavigationCheckpointApprovalUsageSummaryState | null
  events: WakeSchedulerEventRecordSummary[]
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

export type CommandAuthorityValidationProfileSummary = {
  unit_runtime: boolean
  unit_tui: boolean
  typecheck_runtime: boolean
  typecheck_tui: boolean
  integration_cli: boolean
  targeted_e2e: string[]
  optional_regression_e2e: string[]
  full_e2e_required_when: string[]
  live_provider_required: false
  real_opencode_required: false
}

export type CommandAuthorityRecordSummary = {
  authority_id: string
  slash_command: string
  runtime_command?: string
  aliases: string[]
  risk: string
  gate: string
  owner: string
  mutates_events: boolean
  creates_external_process: boolean
  calls_provider: boolean
  requires_active_runtime: boolean
  requires_run_lock: boolean
  requires_approval: boolean
  approval_surface?: string
  execution_surface?: string
  expected_event_kinds: string[]
  blocked_by_default: boolean
  current_phase_status: string
  recommended_reads: string[]
  validation_profile: CommandAuthorityValidationProfileSummary
  notes: string[]
  out_of_scope: string[]
}

export type CommandAuthoritySummaryState = {
  total_records: number
  risks: Record<string, number>
  gates: Record<string, number>
  owners: Record<string, number>
  mutating_count: number
  high_impact_count: number
  approval_required_count: number
  generated_at: string
}

export type CommandAuthorityState = {
  summary?: CommandAuthoritySummaryState | null
  records: CommandAuthorityRecordSummary[]
  selected?: CommandAuthorityRecordSummary | null
  validationProfile?: CommandAuthorityValidationProfileSummary | null
  commandError?: string
}

export type CommanderRecoveryUiState = {
  records: Array<Record<string, unknown>>
  selected?: Record<string, unknown> | null
  preview?: Record<string, unknown> | null
  approval?: Record<string, unknown> | null
  pendingConfirmation?: "approval" | "execution"
  operation?: Record<string, unknown> | null
  cancellation?: Record<string, unknown> | null
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
  modelSetup: ModelSetupState
  projectOnboarding: ProjectOnboardingState
  messageDraft: string
  submittedMessages: string[]
  lastCommand?: string
  runtimeStatus?: RuntimeStatusSummary
  adapterStatus?: Record<string, unknown>
  reasoningProvider?: ReasoningProviderState
  researchProjection?: ResearchProjectionSummary
  missions?: MissionSummaryState
  missionExecution?: MissionExecutionState
  runtimeCommandError?: string
  commandAuthority?: CommandAuthorityState
  commanderRecovery?: CommanderRecoveryUiState
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
  opencodeHandoff?: OpenCodeHandoffState
  opencodeProcessSmoke?: OpenCodeProcessSmokeState
  opencodeHandoffReadiness?: OpenCodeHandoffReadinessState
  opencodeResultReview?: OpenCodeResultReviewState
  opencodeSessions?: OpenCodeSessionsState
  contextBudgets?: ContextBudgetsState
  contextPackets?: ContextPacketsState
  opencodeSessionInstructionPacks?: OpenCodeSessionInstructionPacksState
  opencodeLaunchReadiness?: OpenCodeLaunchReadinessState
  opencodeLaunches?: OpenCodeLaunchesState
  opencodeProgress?: OpenCodeProgressState
  opencodeWatchdog?: OpenCodeWatchdogState
  opencodeCommanderQuestions?: OpenCodeCommanderQuestionsState
  commanderGuidance?: CommanderGuidanceState
  commanderGuidanceDelivery?: CommanderGuidanceDeliveryState
  opencodeHumanControls?: OpenCodeHumanControlState
  opencodeWakeSupervisor?: OpenCodeWakeSupervisorState
  opencodeWakeSupervisorExecutions?: OpenCodeWakeSupervisorExecutionsState
  opencodeWakeActions?: OpenCodeWakeActionExecutionState
  opencodeResultReports?: OpenCodeResultReportState
  opencodeResultReviews?: OpenCodeResultReviewGateState
  researchIngestions?: ResearchIngestionState
  researchMemory?: ResearchMemoryState
  commanderContinuity?: CommanderContinuityState
  commanderTools?: CommanderToolsState
  commanderInternalReads?: CommanderInternalReadsState
  opencodeContinuity?: OpenCodeContinuityState
  commanderExecutorReview?: CommanderExecutorReviewState
  executorReviewProposalDrafts?: ExecutorReviewProposalDraftState
  executorReviewProposalCreate?: ExecutorReviewProposalCreateState
  executorReviewProposalReviewRequest?: ExecutorReviewProposalReviewRequestState
  executorReviewProposalReviewDecision?: ExecutorReviewProposalReviewDecisionState
  executorReviewProposalApplyReadiness?: ExecutorReviewProposalApplyReadinessState
  executorReviewProposalNarrowApply?: ExecutorReviewProposalNarrowApplyState
  minimaxLiveValidation?: MiniMaxLiveValidationState
  opencodeFollowup?: OpenCodeHandoffFollowupState
  runtimeCheckpoints?: RuntimeCheckpointsState
  runtimeRestore?: RuntimeRestoreState
  wakeAssessment?: WakeAssessmentState
  continuation?: ContinuationState
  wakeSchedules?: WakeSchedulesState
  wakeScheduler?: WakeSchedulerUiState
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
    modelSetup: {
      origin: "init",
      stage: "loading",
      commanderChoices: [{ id: "", label: "Leave Commander unconfigured" }],
      executorChoices: [{ id: "", label: "Leave Executor unconfigured" }],
      commanderSelection: 0,
      executorSelection: 0,
      activeCommanderLabel: "Unconfigured",
      activeExecutorLabel: "Unconfigured",
      pendingCommanderLabel: "Unconfigured",
      pendingExecutorLabel: "Unconfigured",
      pendingRestart: false,
      commanderReadiness: "unconfigured",
      executorReadiness: "unconfigured",
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
    commanderRecovery: {
      records: [],
      selected: null,
      preview: null,
      approval: null,
      operation: null,
      cancellation: null,
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
    opencodeHandoff: {
      preview: null,
      lastResult: null,
      recent: [],
    },
    opencodeProcessSmoke: {
      preview: null,
      latestResult: null,
      records: [],
      selected: null,
    },
    opencodeHandoffReadiness: {
      preview: null,
      summary: null,
    },
    opencodeResultReview: {
      packet: null,
      summary: null,
      records: [],
    },
    commanderExecutorReview: {
      preview: null,
      latestResult: null,
      records: [],
      selected: null,
    },
  }
}
