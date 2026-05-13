import type { RuntimeEvent } from "../events/event-types"
import type { ExecutorToolCall, ExecutorToolResult } from "../missions/mission-tool-types"
import type { MissionPacket } from "../missions/mission-types"

export interface SessionSpec {
  projectDir: string
  objective: string
}

export interface MissionUpdate {
  reason: string
  message?: string
}

export interface OpenCodeRuntimeAdapter {
  startSession(sessionSpec: SessionSpec): Promise<void>
  sendMissionPacket(packet: MissionPacket): Promise<void>
  pauseAtSafeBoundary(reason: string): Promise<void>
  resumeWithMissionUpdate(update: MissionUpdate): Promise<void>
  streamExecutorEvents(): AsyncIterable<RuntimeEvent>
  shutdown(): Promise<void>
  getStatus(): Promise<Record<string, unknown>>
}

export type ExecutorToolHandler = (call: ExecutorToolCall) => Promise<ExecutorToolResult>

export interface ExecutorToolHandlerAdapter {
  setExecutorToolHandler(handler: ExecutorToolHandler): void
}
