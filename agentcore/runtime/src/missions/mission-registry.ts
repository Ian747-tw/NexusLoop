import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import { MISSION_PROTOCOL_VERSION, type MissionCreatedResult, type MissionPacket, type MissionRecord, type MissionStatusSummary, type WorkIntent } from "./mission-types"

export interface MissionRegistryOptions {
  eventStore: EventStore
  projectDir: string
  idFactory?: (prefix: "intent" | "mission") => string
  now?: () => Date
}

type MissionEvent =
  | { kind: "work_intent_created"; intent: WorkIntent }
  | { kind: "mission_created"; mission: MissionRecord }
  | { kind: "mission_sent"; mission_id: string; intent_id: string; sent_at: string }
  | { kind: "mission_failed"; mission_id: string; intent_id: string; failed_at: string; failure_reason: string }

export class MissionRegistry {
  private readonly eventStore: EventStore
  private readonly projectDir: string
  private readonly idFactory: (prefix: "intent" | "mission") => string
  private readonly now: () => Date
  private hydrated = false
  private generatedIds = 0
  private readonly intents = new Map<string, WorkIntent>()
  private readonly missions = new Map<string, MissionRecord>()
  private readonly missionOrder: string[] = []
  private hydrateTask: Promise<void> | null = null

  constructor(options: MissionRegistryOptions) {
    this.eventStore = options.eventStore
    this.projectDir = options.projectDir
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async createUserMessageMission(message: string): Promise<MissionCreatedResult> {
    await this.hydrate()
    const createdAt = this.isoNow()
    const intent: WorkIntent = {
      intent_id: this.idFactory("intent"),
      kind: "user_message",
      message: redactText(message),
      created_at: createdAt,
      status: "created",
    }
    const mission: MissionRecord = {
      mission_id: this.idFactory("mission"),
      intent_id: intent.intent_id,
      project_dir: this.projectDir,
      objective: redactText(message),
      status: "created",
      created_at: createdAt,
      updated_at: createdAt,
    }

    await this.appendAndApply({ kind: "work_intent_created", intent })
    await this.appendAndApply({ kind: "mission_created", mission })
    return redactValue({ intent, mission })
  }

  createPacket(mission: MissionRecord, message: string): MissionPacket {
    return {
      missionId: mission.mission_id,
      intentId: mission.intent_id,
      message,
      objective: message,
      createdAt: mission.created_at,
      protocolVersion: MISSION_PROTOCOL_VERSION,
    }
  }

  async markMissionSent(missionId: string): Promise<MissionRecord> {
    await this.hydrate()
    const mission = this.requireMission(missionId)
    const sentAt = this.isoNow()
    await this.appendAndApply({ kind: "mission_sent", mission_id: mission.mission_id, intent_id: mission.intent_id, sent_at: sentAt })
    return redactValue(this.requireMission(missionId))
  }

  async markMissionFailed(missionId: string, reason: string): Promise<MissionRecord> {
    await this.hydrate()
    const mission = this.requireMission(missionId)
    await this.appendAndApply({
      kind: "mission_failed",
      mission_id: mission.mission_id,
      intent_id: mission.intent_id,
      failed_at: this.isoNow(),
      failure_reason: redactText(reason),
    })
    return redactValue(this.requireMission(missionId))
  }

  async getMission(missionId: string): Promise<MissionRecord | null> {
    await this.hydrate()
    return redactValue(this.missions.get(missionId) ?? null)
  }

  async listRecentMissions(limit = 10): Promise<MissionRecord[]> {
    await this.hydrate()
    if (!Number.isInteger(limit) || limit < 1) throw new Error("mission list limit must be a positive integer")
    return redactValue(
      this.missionOrder
        .slice(-limit)
        .reverse()
        .map((missionId) => this.missions.get(missionId))
        .filter((mission): mission is MissionRecord => mission !== undefined),
    )
  }

  async statusSummary(): Promise<MissionStatusSummary> {
    await this.hydrate()
    const missions = [...this.missions.values()]
    const lastMissionId = this.missionOrder.at(-1)
    return {
      pending_count: missions.filter((mission) => mission.status === "created").length,
      failed_count: missions.filter((mission) => mission.status === "failed").length,
      last_mission_id: lastMissionId,
    }
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return
    if (this.hydrateTask) return this.hydrateTask
    this.hydrateTask = (async () => {
      for (const event of await this.eventStore.readAll()) this.applyEvent(event)
      this.hydrated = true
    })()
    try {
      await this.hydrateTask
    } finally {
      this.hydrateTask = null
    }
  }

  private async appendAndApply(event: MissionEvent): Promise<void> {
    const safeEvent = redactValue(event)
    await this.eventStore.append(safeEvent)
    this.applyEvent(safeEvent)
  }

  private applyEvent(event: JsonlEvent | MissionEvent): void {
    switch (event.kind) {
      case "work_intent_created":
        this.applyIntent(event.intent as WorkIntent)
        break
      case "mission_created":
        this.applyMission(event.mission as MissionRecord)
        break
      case "mission_sent":
        this.applyMissionSent(String(event.mission_id), String(event.sent_at))
        break
      case "mission_failed":
        this.applyMissionFailed(String(event.mission_id), String(event.failed_at), String(event.failure_reason))
        break
    }
  }

  private applyIntent(intent: WorkIntent): void {
    this.intents.set(intent.intent_id, redactValue(intent))
  }

  private applyMission(mission: MissionRecord): void {
    if (!this.missions.has(mission.mission_id)) this.missionOrder.push(mission.mission_id)
    this.missions.set(mission.mission_id, redactValue(mission))
  }

  private applyMissionSent(missionId: string, sentAt: string): void {
    const mission = this.requireMission(missionId)
    this.missions.set(missionId, redactValue({ ...mission, status: "sent", sent_at: sentAt, updated_at: sentAt }))
    this.updateIntentStatus(mission.intent_id, "sent")
  }

  private applyMissionFailed(missionId: string, failedAt: string, failureReason: string): void {
    const mission = this.requireMission(missionId)
    this.missions.set(missionId, redactValue({ ...mission, status: "failed", updated_at: failedAt, failure_reason: failureReason }))
    this.updateIntentStatus(mission.intent_id, "failed")
  }

  private updateIntentStatus(intentId: string, status: WorkIntent["status"]): void {
    const intent = this.intents.get(intentId)
    if (intent) this.intents.set(intentId, { ...intent, status })
  }

  private requireMission(missionId: string): MissionRecord {
    const mission = this.missions.get(missionId)
    if (!mission) throw new Error(`mission not found: ${missionId}`)
    return mission
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}
