export type RuntimeEvent =
  | { type: "RuntimeReady"; projectName: string; runtimeStatus: string; providerLabel?: string; modelLabel?: string }
  | { type: "ProjectUninitialized"; projectDir: string }
  | { type: "ProjectInitialized"; projectDir: string }
  | { type: "ResumeSummaryLoaded"; lastRunId?: string; activeMissionId?: string; recordsCount?: number }
  | { type: "MissionStarted"; missionId: string; workIntent: string; budget: string; programState: string }
  | { type: "MissionBriefUpdated"; brief: string; obligations?: string[]; candidates?: string[] }
  | { type: "ExecutorToolStarted"; tool: string; command?: string; target?: string }
  | { type: "ExecutorToolCompleted"; tool: string; status: "completed" | "failed"; output?: string; editedFiles?: string[] }
  | { type: "CommanderDecisionRecorded"; decision: string; reason: string }
  | { type: "UserInterventionReceived"; route: string; message: string }
  | { type: "WakeHookFired"; hook: string }
  | { type: "TrainingProgressObserved"; activeCount: number; summary: string }
  | { type: "ResearchResultAccepted"; resultId: string; label: string; summary: string }
  | { type: "ApprovalRequested"; approvalId: string; kind: "spec" | "candidate"; prompt: string }
  | { type: "ClarificationRequested"; clarificationId: string; source: "commander" | "executor" | "runtime"; prompt: string }

export type RuntimeEventType = RuntimeEvent["type"]

export const supportedRuntimeEventTypes: RuntimeEventType[] = [
  "RuntimeReady",
  "ProjectUninitialized",
  "ProjectInitialized",
  "ResumeSummaryLoaded",
  "MissionStarted",
  "MissionBriefUpdated",
  "ExecutorToolStarted",
  "ExecutorToolCompleted",
  "CommanderDecisionRecorded",
  "UserInterventionReceived",
  "WakeHookFired",
  "TrainingProgressObserved",
  "ResearchResultAccepted",
  "ApprovalRequested",
  "ClarificationRequested",
]
