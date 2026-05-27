export type RuntimeMode = "active" | "status" | "view-records"

export type RuntimeEvent =
  | {
      type: "RuntimeReady"
      event_id?: string
      timestamp?: string
      projectName: string
      runtimeStatus: string
      providerLabel?: string
      modelLabel?: string
    }
  | { type: "ProjectInitialized"; event_id?: string; timestamp?: string; projectDir: string }
  | {
      type: "ResumeSummaryLoaded"
      event_id?: string
      timestamp?: string
      lastRunId?: string
      activeMissionId?: string
      recordsCount?: number
    }
  | { type: "ExecutorLifecycle"; event_id?: string; timestamp?: string; phase: string; message: string }
  | {
      type:
        | "ResearchProjectionChecked"
        | "ResearchProjectionStale"
        | "ResearchProjectionRebuildStarted"
        | "ResearchProjectionRebuilt"
        | "ResearchProjectionRebuildFailed"
        | "ResearchProjectionCorrupt"
      event_id?: string
      timestamp?: string
      mode: RuntimeResearchProjectionMode
      ok: boolean
      stale: boolean
      reason?: string
      last_event_id?: string
      pending_count?: number
      rebuilt_at?: string
      checked_at: string
    }
  | { type: "RuntimeShutdown"; event_id?: string; timestamp?: string; reason: string }

export type RuntimeResearchProjectionMode = "auto_rebuild" | "check_only" | "disabled"

export interface RuntimeResearchProjectionHealth {
  mode: RuntimeResearchProjectionMode
  ok: boolean
  stale: boolean
  reason?: string
  last_event_id?: string
  pending_count: number
  rebuilt_at?: string
  checked_at?: string
}

export interface JsonlEvent {
  event_id?: string
  timestamp?: string
  kind?: string
  type?: string
  [key: string]: unknown
}

export interface RuntimeStatus {
  projectDir: string
  projectName: string
  mode: RuntimeMode
  specApproved: boolean
  runtimeStatus: string
  lockHeld: boolean
  fakeOpenCode: string
  adapterStatus?: Record<string, unknown>
  executorStreamError?: string
  missions?: {
    pending_count: number
    failed_count: number
    active_claim_count: number
    completed_count: number
    cancelled_count: number
    last_mission_id?: string
  }
  reviews?: {
    pending_count: number
    approved_count: number
    rejected_count: number
    cancelled_count: number
    last_review_id?: string
  }
  proposals?: {
    proposed_count: number
    review_requested_count: number
    approved_count: number
    rejected_count: number
    cancelled_count: number
    applied_count: number
    last_proposal_id?: string
  }
  proposalBundles?: {
    open_count: number
    review_requested_count: number
    approved_count: number
    partially_approved_count: number
    applied_count: number
    partially_applied_count: number
    cancelled_count: number
    last_bundle_id?: string
  }
  playbookDrafts?: {
    drafted_count: number
    review_requested_count: number
    partially_review_requested_count: number
    cancelled_count: number
    last_draft_id?: string
  }
  reasoningProvider?: {
    kind: "fake" | "minimax"
    provider_id: string
    connector_id?: string
    model?: string
    max_input_bytes: number
    max_output_bytes: number
    timeout_ms?: number
    system_prompt_version?: string
    enabled_for: Array<"research_synthesis" | "commander_cycle">
  }
  researchProjection: RuntimeResearchProjectionHealth
  policy: Record<string, unknown>
}
