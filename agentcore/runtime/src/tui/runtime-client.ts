import type { RuntimeEvent, RuntimeStatus } from "../events/event-types"

export interface RuntimeClient {
  command(name: "runtime.status"): Promise<RuntimeStatus>
  command(name: "runtime.resume" | "runtime.start_new_session" | "runtime.view_records" | "runtime.shutdown"): Promise<unknown>
  submitUserMessage(message: string): Promise<unknown>
  stream(): AsyncIterable<RuntimeEvent>
}

export interface RuntimeCommandEnvelope {
  command:
    | "runtime.status"
    | "runtime.resume"
    | "runtime.start_new_session"
    | "runtime.view_records"
    | "runtime.submit_user_message"
    | "runtime.shutdown"
  payload?: Record<string, unknown>
}
