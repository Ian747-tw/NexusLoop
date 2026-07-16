import type { CommanderModelStepAdapter } from "../contracts"
import { baseRequest } from "../contracts"

export async function runCancellationProbe(adapter: CommanderModelStepAdapter) {
  const controller = new AbortController()
  controller.abort()
  const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "slow" }], abort_signal: controller.signal }))
  return { status: result.status === "cancelled" ? "pass" as const : "fail" as const, result }
}
