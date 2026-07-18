import { fixtureCase, fixtureStream, normalizeFixtureResult } from "../fixture-model"
import type { CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStreamEvent } from "../contracts"

export function createMinimalCustomAdapter(): CommanderModelStepAdapter {
  return {
    candidate_id: "minimal_custom_adapter",
    candidate_version: "0.1.0-spike",
    supports_streaming: true,
    supports_native_tools: true,
    supports_json_fallback: true,
    supports_structured_output: true,
    supports_abort_signal: true,
    supports_usage: true,
    supports_openai_compatible: true,
    async executeOneStep(request: CommanderModelStepRequest) {
      if (request.abort_signal?.aborted) return normalizeFixtureResult("minimal_custom_adapter", request)
      await maybeWaitForAbort(request)
      return normalizeFixtureResult("minimal_custom_adapter", request, fixtureCase(request), 1)
    },
    executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
      return fixtureStream("minimal_custom_adapter", request, fixtureCase(request))
    },
  }
}

async function maybeWaitForAbort(request: CommanderModelStepRequest): Promise<void> {
  if (!request.messages.some((message) => message.content.toLowerCase().includes("slow"))) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50)
    request.abort_signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
