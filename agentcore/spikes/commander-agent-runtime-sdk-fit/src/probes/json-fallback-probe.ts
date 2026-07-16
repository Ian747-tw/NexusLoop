import { makeToolCall, type CommanderModelStepRequest } from "../contracts"

export function runJsonFallbackProbe(request: CommanderModelStepRequest, raw: string) {
  if (raw.length > 4096) return { status: "blocked" as const, reason: "oversized fallback text" }
  try {
    const parsed = JSON.parse(raw)
    if (Object.keys(parsed).some((key) => !["type", "tool_id", "arguments", "final"].includes(key))) return { status: "malformed" as const, reason: "unknown keys" }
    if (parsed.type === "tool_call") {
      const tool = request.tools.find((item) => item.tool_id === parsed.tool_id)
      const call = makeToolCall(tool, String(parsed.tool_id ?? ""), JSON.stringify(parsed.arguments ?? {}), "json_fallback")
      return { status: call.arguments_valid ? "tool_call" as const : "malformed" as const, call }
    }
    if (parsed.type === "final") return { status: "final" as const, final: parsed.final }
    return { status: "malformed" as const, reason: "unsupported type" }
  } catch {
    return { status: "malformed" as const, reason: "invalid JSON" }
  }
}
