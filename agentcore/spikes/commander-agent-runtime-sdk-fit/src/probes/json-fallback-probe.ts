import { makeToolCall, type CommanderModelStepRequest } from "../contracts"

export function runJsonFallbackProbe(request: CommanderModelStepRequest, raw: string) {
  if (raw.length > 4096) return { status: "blocked" as const, reason: "oversized fallback text" }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "malformed" as const, reason: "fallback envelope must be an object" }
    if (Object.keys(parsed).some((key) => !["type", "tool_id", "arguments", "final"].includes(key))) return { status: "malformed" as const, reason: "unknown keys" }
    if (parsed.type === "tool_call") {
      const tool = request.tools.find((item) => item.tool_id === parsed.tool_id)
      const call = makeToolCall(tool, String(parsed.tool_id ?? ""), JSON.stringify(parsed.arguments ?? {}), "json_fallback")
      return { status: call.arguments_valid ? "tool_call" as const : "malformed" as const, call }
    }
    if (parsed.type === "final") {
      const final = parsed.final
      if (!final || typeof final !== "object" || Array.isArray(final)) return { status: "malformed" as const, reason: "final payload required" }
      if (Object.keys(final).some((key) => !["summary"].includes(key))) return { status: "malformed" as const, reason: "unknown final keys" }
      if (typeof final.summary !== "string" || final.summary.length === 0 || final.summary.length > 1000) return { status: "malformed" as const, reason: "final summary required" }
      return { status: "final" as const, final }
    }
    return { status: "malformed" as const, reason: "unsupported type" }
  } catch {
    return { status: "malformed" as const, reason: "invalid JSON" }
  }
}
