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
  | { type: "RuntimeShutdown"; event_id?: string; timestamp?: string; reason: string }

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
  policy: Record<string, unknown>
}
