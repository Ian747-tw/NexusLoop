import type { RuntimeEvent } from "../events/event-types"
import type { MissionPacket } from "../missions/mission-types"
import type { MissionUpdate, OpenCodeRuntimeAdapter, SessionSpec } from "./adapter"

export class FakeOpenCodeAdapter implements OpenCodeRuntimeAdapter {
  private phase = "new"
  private readonly events: RuntimeEvent[] = []
  private streamCursor = 0

  async startSession(sessionSpec: SessionSpec): Promise<void> {
    this.phase = "started"
    this.events.push({
      type: "ExecutorLifecycle",
      phase: "fake-session-started",
      message: `FakeOpenCodeAdapter started for ${sessionSpec.projectDir}. Real OpenCode session spawn is not implemented in R3.`,
    })
  }

  async sendMissionPacket(packet: MissionPacket): Promise<void> {
    this.events.push({
      type: "ExecutorLifecycle",
      phase: "fake-mission-packet",
      message: `Fake adapter received mission ${packet.missionId} protocol ${packet.protocolVersion}`,
    })
  }

  async pauseAtSafeBoundary(reason: string): Promise<void> {
    this.phase = "paused"
    this.events.push({ type: "ExecutorLifecycle", phase: "fake-paused", message: reason })
  }

  async resumeWithMissionUpdate(update: MissionUpdate): Promise<void> {
    this.phase = "started"
    this.events.push({ type: "ExecutorLifecycle", phase: "fake-resumed", message: update.message ?? update.reason })
  }

  async *streamExecutorEvents(): AsyncIterable<RuntimeEvent> {
    while (this.streamCursor < this.events.length) {
      yield this.events[this.streamCursor]
      this.streamCursor += 1
    }
  }

  async shutdown(): Promise<void> {
    this.phase = "shutdown"
    this.events.push({ type: "ExecutorLifecycle", phase: "fake-shutdown", message: "FakeOpenCodeAdapter shut down" })
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return {
      adapter: "fake",
      phase: this.phase,
      message: "Real OpenCode runtime integration is intentionally not implemented in R3.",
    }
  }
}
