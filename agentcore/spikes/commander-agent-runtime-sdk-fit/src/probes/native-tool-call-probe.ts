import type { CommanderModelStepAdapter } from "../contracts"
import { baseRequest } from "../contracts"

export async function runNativeToolCallProbe(adapter: CommanderModelStepAdapter) {
  const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "tool" }] }))
  return { status: result.status === "tool_call" && result.tool_calls.length === 1 ? "pass" as const : "fail" as const, result }
}
