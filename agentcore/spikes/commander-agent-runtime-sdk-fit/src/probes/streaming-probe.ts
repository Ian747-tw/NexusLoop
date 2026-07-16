import type { CommanderModelStepAdapter } from "../contracts"
import { baseRequest } from "../contracts"

export async function runStreamingProbe(adapter: CommanderModelStepAdapter) {
  const events = []
  for await (const event of adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "stream tool" }] }))) events.push(event)
  return { status: events.some((event) => event.type === "tool_call_complete") && events.some((event) => event.type === "completed") ? "pass" as const : "fail" as const, events }
}
