import { existsSync } from "fs"
import { join } from "path"
import type { RuntimeEvent } from "./events"
import { redactText } from "./redaction"
import type { MissionRecord } from "./state"

export interface SubmitUserMessageResult {
  accepted: true
  missionId: string
  intentId: string
}

export interface RuntimeClient {
  readonly streamMode?: "finite" | "long-lived"
  stream(): AsyncIterable<RuntimeEvent>
  command(name: string, payload?: Record<string, unknown>): Promise<unknown>
  sendUserMessage(message: string): Promise<SubmitUserMessageResult | void>
  sendCommand(command: string): Promise<unknown>
  shutdown?(): Promise<void>
}

export class FakeRuntimeClient implements RuntimeClient {
  readonly sentMessages: string[] = []
  readonly sentCommands: string[] = []
  private readonly missions: MissionRecord[] = []
  private projectionRebuilds = 0
  private sequence = 0

  constructor(
    private readonly projectDir: string,
    private readonly projectName: string,
  ) {}

  async *stream(): AsyncIterable<RuntimeEvent> {
    yield {
      type: "RuntimeReady",
      projectName: this.projectName,
      runtimeStatus: "fake runtime connected",
      providerLabel: "placeholder only",
      modelLabel: "not configured",
    }

    if (!existsSync(join(this.projectDir, ".nxl"))) {
      yield { type: "ProjectUninitialized", projectDir: this.projectDir }
      return
    }

    yield { type: "ProjectInitialized", projectDir: this.projectDir }
    yield { type: "ResumeSummaryLoaded", lastRunId: "fake-last-run", activeMissionId: "mission-placeholder", recordsCount: 0 }
    if (process.env.NXL_TUI_FAKE_FULL_STREAM !== "1") return
    yield {
      type: "MissionStarted",
      missionId: "mission-placeholder",
      workIntent: "Awaiting user message",
      budget: "placeholder budget",
      programState: "ready",
    }
    yield { type: "WakeHookFired", hook: "resume-screen-opened" }
    yield { type: "ExecutorToolStarted", tool: "runtime.connect", target: "fake runtime stream" }
    yield { type: "ExecutorToolCompleted", tool: "runtime.connect", status: "completed", output: "connection skeleton active" }
    yield {
      type: "CommanderDecisionRecorded",
      decision: "standby",
      reason: "Commander intelligence is intentionally not implemented in this branch",
    }
  }

  async sendUserMessage(message: string): Promise<SubmitUserMessageResult> {
    this.sentMessages.push(message)
    const python = process.env.NXL_PYTHON_EXECUTABLE ?? "python"
    const onboarding = Bun.spawnSync({
      cmd: [
        python,
        "-m",
        "nxl_core.spec.tui_onboarding",
        "--project-dir",
        this.projectDir,
        "--message",
        message,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    if (onboarding.exitCode !== 0) {
      const stderr = new TextDecoder().decode(onboarding.stderr).trim()
      throw new Error(`spec onboarding failed: ${stderr}`)
    }
    return this.createMission(message)
  }

  async sendCommand(command: string): Promise<unknown> {
    this.sentCommands.push(command)
    switch (command) {
      case "status":
        return this.command("runtime.status")
      case "missions":
        return this.command("runtime.list_recent_missions", { limit: 5 })
      case "resume":
      case "new-session":
      case "records":
      case "shutdown":
      case "initialize":
      case "cancel":
        return { ok: true, command }
      default:
        throw new Error(`unknown TUI command: ${redactText(command)}`)
    }
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "runtime.status":
        return {
          runtimeStatus: "fake runtime connected",
          mode: "active",
          projectName: this.projectName,
          specApproved: existsSync(join(this.projectDir, ".nxl")),
          lockHeld: false,
          adapterStatus: { kind: "fake", phase: "idle" },
          missions: this.missionSummary(),
          researchProjection: { mode: "disabled", ok: true, stale: false, reason: "disabled", pending_count: 0 },
        }
      case "runtime.list_recent_missions":
        return this.missions.slice(0, readLimit(payload.limit, 5))
      case "runtime.submit_user_message":
        return this.createMission(String(payload.message ?? ""))
      case "runtime.resume":
      case "runtime.start_new_session":
      case "runtime.view_records":
      case "runtime.shutdown":
        return { ok: true }
      case "research.list_topics":
        return this.researchTopics()
      case "research.get_topic_snapshot":
        return this.topicSnapshot(String(payload.topicId ?? ""))
      case "research.search_notes":
        return this.searchNotes(String(payload.topicId ?? ""), String(payload.query ?? ""))
      case "research.list_events":
        return this.researchEvents(readLimit(isRecord(payload.options) ? payload.options.limit : undefined, 5))
      case "research.projection_status":
        return this.projectionStatus()
      case "research.rebuild_projection":
        this.projectionRebuilds += 1
        return this.projectionStatus()
      default:
        throw new Error(`unknown runtime command: ${redactText(name)}`)
    }
  }

  private createMission(message: string): SubmitUserMessageResult {
    this.sequence += 1
    const missionId = `fake-mission-${this.sequence}`
    const intentId = `fake-intent-${this.sequence}`
    const now = new Date(0).toISOString()
    this.missions.unshift({
      mission_id: missionId,
      intent_id: intentId,
      objective: redactText(message),
      status: "sent",
      created_at: now,
      updated_at: now,
    })
    return { accepted: true, missionId, intentId }
  }

  private missionSummary() {
    return {
      pending_count: this.missions.filter((mission) => mission.status === "created" || mission.status === "sent").length,
      failed_count: this.missions.filter((mission) => mission.status === "failed").length,
      active_claim_count: this.missions.filter((mission) => mission.status === "claimed" || mission.status === "running").length,
      completed_count: this.missions.filter((mission) => mission.status === "completed").length,
      cancelled_count: this.missions.filter((mission) => mission.status === "cancelled").length,
      last_mission_id: this.missions[0]?.mission_id,
    }
  }

  private researchTopics() {
    return [
      {
        id: "fake-topic-1",
        title: "Fake runtime research topic",
        status: "active",
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
      {
        id: "fake-topic-2",
        title: "Projection rebuild notes",
        status: "open",
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    ]
  }

  private topicSnapshot(topicId: string) {
    const topic = this.researchTopics().find((item) => item.id === topicId)
    if (!topic) return null
    return {
      topic,
      sources: [],
      notes: this.searchNotes(topicId, ""),
      artifacts: [],
      stats: {
        source_count: 1,
        note_count: 1,
        artifact_count: 0,
        report_count: 0,
        reviewed_source_count: 1,
        rejected_source_count: 0,
      },
      latest_event: this.researchEvents(1)[0],
    }
  }

  private searchNotes(topicId: string, query: string) {
    const note = {
      id: "fake-note-1",
      topic_id: topicId || "fake-topic-1",
      source_id: "fake-source-1",
      content: `Fake research note for ${query || "runtime projection"}`,
      tags: ["fake", "projection"],
      created_at: new Date(0).toISOString(),
    }
    return topicId && topicId !== "fake-topic-1" && topicId !== "fake-topic-2" ? [] : [note]
  }

  private researchEvents(limit: number) {
    return [
      {
        event_id: "fake-research-event-1",
        event_type: "topic_created",
        entity_type: "topic",
        entity_id: "fake-topic-1",
        payload: { title: "not rendered" },
        created_at: new Date(0).toISOString(),
      },
    ].slice(0, limit)
  }

  private projectionStatus() {
    return {
      mode: "disabled",
      ok: true,
      stale: false,
      reason: this.projectionRebuilds > 0 ? "rebuilt" : "disabled",
      pending_count: 0,
      last_event_id: "fake-research-event-1",
      checked_at: new Date(0).toISOString(),
    }
  }
}

function readLimit(value: unknown, fallback: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) return fallback
  return Math.min(Number(value), 100)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
