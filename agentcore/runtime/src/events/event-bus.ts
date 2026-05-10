import { redactValue } from "../security/redaction"
import type { RuntimeEvent } from "./event-types"

type Listener = (event: RuntimeEvent) => void

export class RuntimeEventBus {
  private readonly listeners = new Set<Listener>()
  private readonly history: RuntimeEvent[] = []

  emit(event: RuntimeEvent): RuntimeEvent {
    const safeEvent = redactValue(event)
    this.history.push(safeEvent)
    for (const listener of this.listeners) listener(safeEvent)
    return safeEvent
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): RuntimeEvent[] {
    return [...this.history]
  }

  async *streamFromNow(): AsyncIterable<RuntimeEvent> {
    const queue: RuntimeEvent[] = []
    let wake: (() => void) | null = null
    const unsubscribe = this.subscribe((event) => {
      queue.push(event)
      wake?.()
      wake = null
    })
    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve))
        while (queue.length) yield queue.shift()!
      }
    } finally {
      unsubscribe()
    }
  }
}
