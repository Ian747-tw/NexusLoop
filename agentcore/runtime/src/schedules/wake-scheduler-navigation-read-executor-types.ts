import type { WakeSchedulerNavigationStageTargetKind } from "./wake-scheduler-navigation-staging-types"

export interface WakeSchedulerNavigationReadExecution {
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  result_kind: string
  result_summary: string
  raw_result?: unknown
  warnings?: string[]
}

export interface WakeSchedulerNavigationReadExecutorContext {
  wakeSchedulerStatus(): Promise<unknown>
  listWakeSchedulerEvents(limit?: number): Promise<unknown>
  wakeSchedulerBootstrapStatus(): Promise<unknown>
  previewWakeSchedulerBootstrap(): Promise<unknown>
  previewWakeSchedulerRecovery(): Promise<unknown>
  listWakeSchedulerRecoveries(limit?: number): Promise<unknown>
  getWakeSchedulerRecovery(recoveryId: string): Promise<unknown>
  listWakeSchedulerRecoveryWorkflows(limit?: number): Promise<unknown>
  getWakeSchedulerRecoveryWorkflow(workflowId: string): Promise<unknown>
  verifyWakeSchedulerRecoveryWorkflow(workflowId: string): Promise<unknown>
  wakeSchedulerAuditSummary(): Promise<unknown>
  wakeSchedulerAuditTimeline(query?: { limit?: number; kind?: string; kinds?: string[]; severity?: string; related_id?: string; relatedId?: string }): Promise<unknown>
  wakeSchedulerAuditChain(relatedId: string, limit?: number): Promise<unknown>
  wakeSchedulerAuditIncidents(query?: { limit?: number; status?: string; severity?: string }): Promise<unknown>
  listWakeSchedulerNavigationStagedCommands(limit?: number): Promise<unknown>
  previewWakeScheduleTick(input?: { max_due_items?: number; requested_by?: string }): Promise<unknown>
  listWakeSchedules(limit?: number): Promise<unknown>
  getWakeSchedule(scheduleId: string): Promise<unknown>
  listWakeScheduleTicks(limit?: number): Promise<unknown>
  getWakeScheduleTick(tickId: string): Promise<unknown>
  previewWakeAssessment(input: { resume_id: string; requested_by?: string }): Promise<unknown>
  getWakeAssessment(wakeId: string): Promise<unknown>
  listContinuationPlans(limit?: number): Promise<unknown>
  getContinuationPlan(planId: string): Promise<unknown>
  listRuntimeCheckpoints(limit?: number): Promise<unknown>
  getRuntimeCheckpoint(checkpointId: string): Promise<unknown>
  listCheckpointResumeAnchors(limit?: number): Promise<unknown>
  getCheckpointResumeAnchor(resumeId: string): Promise<unknown>
  listOpenCodeHandoffFollowups(options?: { limit?: number }): Promise<unknown>
  getOpenCodeHandoffFollowup(handoffId: string): Promise<unknown>
  listRecentMissions(limit?: number): Promise<unknown>
  getMission(missionId: string): Promise<unknown>
  reasoningProviderStatus(): unknown
  reasoningProviderHealth(): unknown
}
