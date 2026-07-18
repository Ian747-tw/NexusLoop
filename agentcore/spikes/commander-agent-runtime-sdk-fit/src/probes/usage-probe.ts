import type { CommanderModelStepAdapter } from "../contracts"
import { baseRequest } from "../contracts"

export async function runUsageProbe(adapter: CommanderModelStepAdapter) {
  const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "usage" }] }))
  return { status: result.usage.provider_reported ? "pass" as const : "fail" as const, usage: result.usage }
}
