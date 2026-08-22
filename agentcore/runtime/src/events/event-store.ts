import { mkdir, open, readFile, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { redactValue } from "../security/redaction"
import type { JsonlEvent } from "./event-types"

function makeEventId(): string {
  const time = Date.now().toString(36).padStart(10, "0")
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0")
  return `rt_${time}_${random}`
}

export class EventStore {
  private appendQueue: Promise<unknown> = Promise.resolve()
  private pendingAppends = 0
  private appendGeneration = 0

  constructor(readonly eventsPath: string) {}

  async append(event: JsonlEvent): Promise<string> {
    this.appendGeneration += 1
    this.pendingAppends += 1
    const operation = this.appendQueue.then(async () => {
      await mkdir(dirname(this.eventsPath), { recursive: true })
      const safeEvent = redactValue({
        ...event,
        event_id: event.event_id ?? makeEventId(),
        timestamp: event.timestamp ?? new Date().toISOString(),
      })
      const handle = await open(this.eventsPath, "a")
      try {
        await handle.write(JSON.stringify(safeEvent) + "\n")
        await handle.sync()
      } finally {
        await handle.close()
      }
      return String(safeEvent.event_id)
    })
    this.appendQueue = operation.catch(() => undefined)
    return operation.finally(() => { this.pendingAppends -= 1 })
  }

  async appendIfLatest(
    event: JsonlEvent,
    expectedLatestEventId: string | null,
    operational: { before_write?: () => void } = {},
  ): Promise<string> {
    this.appendGeneration += 1
    this.pendingAppends += 1
    const operation = this.appendQueue.then(async () => {
      await mkdir(dirname(this.eventsPath), { recursive: true })
      const events = await this.readAllSnapshot()
      const latest = events.at(-1)?.event_id ? String(events.at(-1)?.event_id) : null
      if (latest !== expectedLatestEventId) {
        throw new Error("event log changed before append")
      }
      const safeEvent = redactValue({
        ...event,
        event_id: event.event_id ?? makeEventId(),
        timestamp: event.timestamp ?? new Date().toISOString(),
      })
      const handle = await open(this.eventsPath, "a")
      try {
        operational.before_write?.()
        await handle.write(JSON.stringify(safeEvent) + "\n")
        await handle.sync()
      } finally {
        await handle.close()
      }
      return String(safeEvent.event_id)
    })
    this.appendQueue = operation.catch(() => undefined)
    return operation.finally(() => { this.pendingAppends -= 1 })
  }

  async appendIfLatestKind(
    event: JsonlEvent,
    kind: string,
    expectedLatestEventId: string | null,
    operational: { before_write?: () => void } = {},
  ): Promise<string> {
    if (event.kind !== kind) throw new Error("event kind does not match append authority")
    this.appendGeneration += 1
    this.pendingAppends += 1
    const operation = this.appendQueue.then(async () => {
      await mkdir(dirname(this.eventsPath), { recursive: true })
      const events = await this.readAllSnapshot()
      let latest: JsonlEvent | undefined
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.kind === kind) {
          latest = events[index]
          break
        }
      }
      const latestEventId = latest?.event_id ? String(latest.event_id) : null
      if (latestEventId !== expectedLatestEventId) {
        throw new Error("event kind changed before append")
      }
      const safeEvent = redactValue({
        ...event,
        event_id: event.event_id ?? makeEventId(),
        timestamp: event.timestamp ?? new Date().toISOString(),
      })
      const handle = await open(this.eventsPath, "a")
      try {
        operational.before_write?.()
        await handle.write(JSON.stringify(safeEvent) + "\n")
        await handle.sync()
      } finally {
        await handle.close()
      }
      return String(safeEvent.event_id)
    })
    this.appendQueue = operation.catch(() => undefined)
    return operation.finally(() => { this.pendingAppends -= 1 })
  }

  async readAll(): Promise<JsonlEvent[]> {
    while (true) {
      const generationBefore = this.appendGeneration
      const appendPendingBefore = this.pendingAppends > 0
      try {
        return await this.readAllSnapshot()
      } catch (error) {
        const appendOverlapped = appendPendingBefore
          || this.pendingAppends > 0
          || this.appendGeneration !== generationBefore
        if (!(error instanceof SyntaxError) || !appendOverlapped) throw error
        await this.appendQueue
      }
    }
  }

  async readText(): Promise<string> {
    while (true) {
      const generationBefore = this.appendGeneration
      const appendPendingBefore = this.pendingAppends > 0
      const text = await this.readTextSnapshot()
      const appendOverlapped = appendPendingBefore
        || this.pendingAppends > 0
        || this.appendGeneration !== generationBefore
      if (!(appendOverlapped && text.length > 0 && !/\r?\n$/.test(text))) return text
      await this.appendQueue
    }
  }

  private async readAllSnapshot(): Promise<JsonlEvent[]> {
    const text = await this.readTextSnapshot()
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonlEvent)
  }

  private async readTextSnapshot(): Promise<string> {
    try {
      return await readFile(this.eventsPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
      throw error
    }
  }

  async readSince(cursor: string | null | undefined): Promise<JsonlEvent[]> {
    if (!cursor) return this.readAll()
    const events = await this.readAll()
    const index = events.findIndex((event) => event.event_id === cursor)
    return index < 0 ? [] : events.slice(index + 1)
  }

  async latestEventId(): Promise<string | null> {
    const events = await this.readAll()
    const last = events.at(-1)
    return last?.event_id ? String(last.event_id) : null
  }

  async exists(): Promise<boolean> {
    try {
      await stat(this.eventsPath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
      throw error
    }
  }
}
