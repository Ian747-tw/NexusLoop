import type { CommanderModelStepAdapter } from "../contracts"
import { baseRequest } from "../contracts"

export async function runTextStepProbe(adapter: CommanderModelStepAdapter) {
  const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "plain final text" }] }))
  return { status: result.status === "final" ? "pass" as const : "fail" as const, result }
}
