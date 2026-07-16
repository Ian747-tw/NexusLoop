import { setTracingDisabled } from "@openai/agents"
import { fixtureCase, fixtureStream, normalizeFixtureResult } from "../fixture-model"
import type { CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStreamEvent } from "../contracts"

setTracingDisabled(true)

export function createOpenAIAgentsCoreAdapter(): CommanderModelStepAdapter {
  return {
    candidate_id: "openai_agents_core",
    candidate_version: "0.13.4-controlled-lower-level",
    supports_streaming: true,
    supports_native_tools: true,
    supports_json_fallback: true,
    supports_structured_output: true,
    supports_abort_signal: true,
    supports_usage: true,
    supports_openai_compatible: false,
    async executeOneStep(request: CommanderModelStepRequest) {
      await maybeWaitForAbort(request)
      return normalizeFixtureResult("openai_agents_core", request, fixtureCase(request), 1)
    },
    executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
      return fixtureStream("openai_agents_core", request, fixtureCase(request))
    },
  }
}

export function runnerOwnershipProbe() {
  return {
    runner_can_be_one_turn: "partial",
    function_tools_can_auto_execute: true,
    tool_execution_interception_before_invocation: "not accepted as NexusLoop production path in 9W0",
    max_turns_behavior: "Runner exposes turn limiting, but Runner still represents an agent loop abstraction.",
    session_state_expectation: "SDK supports agent/session concepts that are not NexusLoop durable memory.",
    tracing_disabled_by_api: true,
    production_runner_suitable: false,
    reason: "Full Runner would compete with NexusLoop Commander run controller/tool executor/persistence authority.",
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
