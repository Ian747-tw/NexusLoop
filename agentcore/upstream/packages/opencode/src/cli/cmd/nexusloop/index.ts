import { loadExecutorReadinessSource } from "./executor-readiness-state"
import {
  observeExecutorReadiness,
  parseExecutorReadinessRequestText,
} from "./executor-readiness"

const MAX_REQUEST_BYTES = 4096
const INPUT_TIMEOUT_MS = 5000

export function isNexusLoopExecutorReadinessInvocation(args: readonly string[]): boolean {
  return args.length === 2 && args[0] === "nexusloop" && args[1] === "executor-readiness-v1"
}

export async function runNexusLoopExecutorReadinessCommand(): Promise<number> {
  try {
    const request = parseExecutorReadinessRequestText(await readBoundedStdin())
    // Generated from the pinned catalog fixture by the supported NexusLoop build.
    // @ts-ignore generated module is absent before the build step
    const snapshot = await import("../../../provider/models-snapshot.js")
    const result = await loadExecutorReadinessSource({
      cwd: process.cwd(),
      env: process.env,
      catalog: snapshot.snapshot,
    })
      .then((source) => observeExecutorReadiness(request, source))
      .catch(() =>
        observeExecutorReadiness(request, {
          catalog: {},
          config_fragments: [],
          auth: {},
          env: {},
          observation_complete: false,
        }),
      )
    process.stdout.write(JSON.stringify(result) + "\n")
    return 0
  } catch {
    process.stderr.write("NexusLoop Executor readiness observation failed\n")
    return 2
  }
}

async function readBoundedStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const timeout = setTimeout(() => void reader.cancel(), INPUT_TIMEOUT_MS)
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_REQUEST_BYTES) throw new Error("oversized")
      chunks.push(part.value)
    }
  } finally {
    clearTimeout(timeout)
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (let index = 0; index < chunks.length; index += 1) {
    output.set(chunks[index]!, offset)
    offset += chunks[index]!.byteLength
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(output)
}
