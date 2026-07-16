import type { CommanderModelStepAdapter } from "../contracts"
import { baseRequest } from "../contracts"

export async function runCancellationProbe(adapter: CommanderModelStepAdapter) {
  const stepController = new AbortController()
  const stepPromise = adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "slow" }], abort_signal: stepController.signal }))
  setTimeout(() => stepController.abort(), 5)
  const result = await stepPromise

  const streamController = new AbortController()
  const stream = adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "slow stream" }], abort_signal: streamController.signal }))[Symbol.asyncIterator]()
  const firstEvent = stream.next()
  setTimeout(() => streamController.abort(), 5)
  const streamed = await firstEvent
  if (stream.return) await stream.return()

  const stepRequestCount = typeof result.provider_metadata.request_count === "number" ? result.provider_metadata.request_count : 1
  const streamCancelled = !streamed.done && streamed.value.type === "error" && streamed.value.error.toLowerCase().includes("cancel")
  const oneStepCancelled = result.status === "cancelled" && stepRequestCount <= 1

  return { status: oneStepCancelled && streamCancelled ? "pass" as const : "fail" as const, result, stream_event: streamed.value }
}
