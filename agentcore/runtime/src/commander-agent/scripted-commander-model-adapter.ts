import { stableHash } from "./commander-model-schema"
import type { CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStepResult, CommanderModelStreamEvent } from "./commander-model-types"

export type ScriptedCommanderModelStep = Partial<CommanderModelStepResult> & {
  delay_ms?: number
  assert_request?: (request: CommanderModelStepRequest) => void
}

export class ScriptedCommanderModelStepAdapter implements CommanderModelStepAdapter {
  readonly adapter_id = "scripted"
  readonly adapter_version = "scripted-9w2a"
  readonly supports_streaming = true as const
  readonly supports_native_tools = true as const
  readonly supports_json_fallback = true as const
  readonly supports_structured_output = true as const
  readonly supports_abort_signal = true as const
  readonly supports_usage = true as const
  readonly supports_openai_compatible = true as const
  readonly request_summaries: Array<{ request_id: string; tool_ids: string[]; message_count: number; protocol: string }> = []

  private index = 0

  constructor(private readonly steps: ScriptedCommanderModelStep[]) {}

  async executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult> {
    const step = this.steps[this.index++]
    this.request_summaries.push({ request_id: request.request_id, tool_ids: request.tools.map((tool) => tool.tool_id), message_count: request.messages.length, protocol: request.tool_protocol })
    if (!step) return this.result(request, { status: "failed", error: "scripted model step exhausted" })
    step.assert_request?.(request)
    if (request.abort_signal?.aborted) return this.result(request, { status: "cancelled", request_count: 0, error: "request was cancelled before scripted model step" })
    if (step.delay_ms) await delay(step.delay_ms, request.abort_signal)
    if (request.abort_signal?.aborted) return this.result(request, { status: "cancelled", error: "request was cancelled" })
    return this.result(request, step)
  }

  async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
    const result = await this.executeOneStep(request)
    if (result.status === "cancelled") {
      yield { type: "cancelled", error: result.error }
      return
    }
    if (result.text) yield { type: "text_delta", text: result.text }
    for (const call of result.tool_calls) {
      yield { type: "tool_call_start", tool_call_id: call.tool_call_id, tool_id: call.tool_id }
      if (call.raw_arguments) yield { type: "tool_call_arguments_delta", tool_call_id: call.tool_call_id, delta: call.raw_arguments }
      yield { type: "tool_call_complete", tool_call: call }
    }
    yield { type: "usage", usage: result.usage }
    yield { type: "completed", result }
  }

  private result(request: CommanderModelStepRequest, step: ScriptedCommanderModelStep): CommanderModelStepResult {
    const toolCalls = step.tool_calls ?? []
    const text = step.text
    const status = step.status ?? (toolCalls.length ? "tool_call" : "final")
    const result: CommanderModelStepResult = {
      request_id: request.request_id,
      provider_id: request.provider_id,
      adapter_id: "scripted",
      status,
      assistant_message: step.assistant_message ?? (status === "failed" || status === "cancelled" ? undefined : { role: "assistant", content: [...(text ? [{ type: "text" as const, text }] : []), ...toolCalls] }),
      text,
      tool_calls: toolCalls,
      finish_reason: step.finish_reason ?? (toolCalls.length ? "tool_calls" : "stop"),
      usage: step.usage ?? { provider_reported: false },
      provider_metadata: step.provider_metadata ?? { scripted: true },
      request_count: step.request_count ?? 1,
      raw_provider_payload_included: false,
      duration_ms: step.duration_ms ?? 0,
      warnings: step.warnings ?? [],
      error: step.error,
      result_hash: "",
    }
    result.result_hash = step.result_hash ?? stableHash({ ...result, duration_ms: 0 })
    return result
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, Math.max(0, ms))
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
  })
}
