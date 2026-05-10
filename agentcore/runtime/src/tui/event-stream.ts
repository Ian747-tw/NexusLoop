import type { RuntimeEvent } from "../events/event-types"
import { RuntimeEventBus } from "../events/event-bus"

export class RuntimeEventStream {
  constructor(private readonly bus: RuntimeEventBus) {}

  history(): RuntimeEvent[] {
    return this.bus.snapshot()
  }

  stream(): AsyncIterable<RuntimeEvent> {
    return this.bus.streamFromNow()
  }
}
