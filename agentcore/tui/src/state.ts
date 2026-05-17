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
  researchProjection?: ResearchProjectionSummary
  missions?: MissionSummaryState
  missionExecution?: MissionExecutionState
  runtimeCommandError?: string
  research?: ResearchRecordsState
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
  }
}
