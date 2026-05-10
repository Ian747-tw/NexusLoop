import { join } from "node:path"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeMode, RuntimeStatus } from "./events/event-types"
import { modeRequiresApprovedSpec } from "./project/project-status"
import { locateProjectRoot, projectName } from "./project/project-root"
import { RunLock } from "./project/run-lock"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import type { OpenCodeRuntimeAdapter } from "./opencode/adapter"
import { PolicyService } from "./spec/policy-service"
import { SpecService, type SpecSummary } from "./spec/spec-service"
import { redactValue } from "./security/redaction"

export interface RuntimeServerOptions {
  projectDir?: string
  mode?: RuntimeMode
  adapter?: OpenCodeRuntimeAdapter
}

export class RuntimeServer {
  readonly projectDir: string
  readonly mode: RuntimeMode
  readonly eventStore: EventStore
  readonly eventBus = new RuntimeEventBus()
  readonly specService: SpecService
  readonly policyService: PolicyService
  readonly adapter: OpenCodeRuntimeAdapter
  private readonly runLock: RunLock
  private specSummary: SpecSummary | null = null
  private started = false

  constructor(options: RuntimeServerOptions = {}) {
    this.projectDir = locateProjectRoot(options.projectDir)
    this.mode = options.mode ?? "active"
    this.eventStore = new EventStore(join(this.projectDir, ".nxl", "events.jsonl"))
    this.specService = new SpecService(this.projectDir)
    this.policyService = new PolicyService(this.projectDir)
    this.runLock = new RunLock(join(this.projectDir, ".nxl", "run.lock"))
    this.adapter = options.adapter ?? new FakeOpenCodeAdapter()
  }

  async start(): Promise<void> {
    if (modeRequiresApprovedSpec(this.mode)) {
      this.specSummary = await this.specService.requireApproved()
    } else {
      const current = await this.specService.readCurrent()
      this.specSummary = current?.status === "approved" ? this.specService.toSummary(current) : null
    }
    await this.runLock.acquire()
    this.started = true
    await this.eventStore.append({ kind: "runtime_started", mode: this.mode })
    this.eventBus.emit({
      type: "RuntimeReady",
      projectName: projectName(this.projectDir),
      runtimeStatus: this.mode === "active" ? "ready" : `${this.mode} ready`,
      providerLabel: this.specSummary?.approvedBy,
      modelLabel: "fake-opencode-adapter",
    })
    this.eventBus.emit({ type: "ProjectInitialized", projectDir: this.projectDir })
    const records = await this.eventStore.readAll()
    this.eventBus.emit({ type: "ResumeSummaryLoaded", recordsCount: records.length, lastRunId: await this.eventStore.latestEventId() ?? undefined })
    if (this.mode === "active") {
      await this.adapter.startSession({
        projectDir: this.projectDir,
        objective: this.specSummary?.objective ?? "",
      })
      for await (const event of this.adapter.streamExecutorEvents()) this.eventBus.emit(event)
    }
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "runtime.status":
        return this.status()
      case "runtime.resume":
        return this.resume()
      case "runtime.start_new_session":
        return this.startNewSession()
      case "runtime.view_records":
        return this.viewRecords()
      case "runtime.submit_user_message":
        return this.submitUserMessage(String(payload.message ?? ""))
      case "runtime.shutdown":
        return this.shutdown(String(payload.reason ?? "command"))
      default:
        throw new Error(`unknown runtime command: ${name}`)
    }
  }

  async status(): Promise<RuntimeStatus> {
    const policy = await this.policyService.metadata()
    return redactValue({
      projectDir: this.projectDir,
      projectName: projectName(this.projectDir),
      mode: this.mode,
      specApproved: this.specSummary?.status === "approved",
      runtimeStatus: this.started ? "started" : "created",
      lockHeld: this.runLock.isHeld(),
      fakeOpenCode: String((await this.adapter.getStatus()).message ?? ""),
      policy,
    })
  }

  async resume(): Promise<{ events: number }> {
    const events = await this.eventStore.readAll()
    this.eventBus.emit({ type: "ResumeSummaryLoaded", recordsCount: events.length, lastRunId: await this.eventStore.latestEventId() ?? undefined })
    return { events: events.length }
  }

  async startNewSession(): Promise<{ adapter: Record<string, unknown> }> {
    await this.adapter.startSession({ projectDir: this.projectDir, objective: this.specSummary?.objective ?? "" })
    for await (const event of this.adapter.streamExecutorEvents()) this.eventBus.emit(event)
    return { adapter: await this.adapter.getStatus() }
  }

  async viewRecords(): Promise<{ events: unknown[] }> {
    return { events: redactValue(await this.eventStore.readAll()) }
  }

  async submitUserMessage(message: string): Promise<{ accepted: true }> {
    await this.adapter.sendMissionPacket({ missionId: "runtime-message", message })
    this.eventBus.emit({ type: "ExecutorLifecycle", phase: "fake-user-message", message })
    return { accepted: true }
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    if (!this.started && !this.runLock.isHeld()) return
    this.eventBus.emit({ type: "RuntimeShutdown", reason })
    await this.adapter.shutdown()
    await this.eventStore.append({ kind: "runtime_shutdown", reason })
    await this.runLock.release()
    this.started = false
  }
}
