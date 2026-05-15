import { basename } from "path"
import {
  createRuntimeServerFromLaunchConfig,
  RuntimeServer,
  RuntimeServerClient,
  type OpenCodeAdapterFactoryOptions,
} from "../../runtime/src/index"
import { FakeRuntimeClient, type RuntimeClient } from "./runtime"

export type TuiRuntimeClientKind = "fake" | "real"

export interface TuiRuntimeClientFactoryOptions {
  projectDir: string
  projectName?: string
  env?: Record<string, string | undefined>
  client?: RuntimeClient
  server?: RuntimeServer
  openCodeAdapterFactoryOptions?: Omit<OpenCodeAdapterFactoryOptions, "projectDir">
}

export function createTuiRuntimeClient(options: TuiRuntimeClientFactoryOptions): RuntimeClient {
  if (options.client) return options.client
  const env = options.env ?? {}
  const kind = readRuntimeClientKind(env)
  if (kind === "fake") return new FakeRuntimeClient(options.projectDir, options.projectName ?? basename(options.projectDir))
  const server = options.server ?? createRuntimeServerFromLaunchConfig({
    projectDir: options.projectDir,
    env,
    openCodeAdapterFactoryOptions: options.openCodeAdapterFactoryOptions,
  })
  return new TuiRuntimeServerClient(new RuntimeServerClient({
    server,
    autoStart: true,
    ownsServer: options.server === undefined,
  }))
}

export function readRuntimeClientKind(env: Record<string, string | undefined>): TuiRuntimeClientKind {
  const raw = env.NXL_RUNTIME_CLIENT
  if (raw === undefined || raw.trim() === "") return "fake"
  if (raw === "fake" || raw === "real") return raw
  throw new Error(`unknown runtime client kind in NXL_RUNTIME_CLIENT: ${raw}`)
}

export class TuiRuntimeServerClient implements RuntimeClient {
  constructor(readonly runtime: RuntimeServerClient) {}

  stream(): AsyncIterable<import("./events").RuntimeEvent> {
    return this.runtime.stream() as AsyncIterable<import("./events").RuntimeEvent>
  }

  async sendUserMessage(message: string): Promise<void> {
    await this.runtime.submitUserMessage(message)
  }

  async sendCommand(command: string): Promise<void> {
    switch (command) {
      case "resume":
        await this.runtime.command("runtime.resume")
        return
      case "start-new":
        await this.runtime.command("runtime.start_new_session")
        return
      case "shutdown":
        await this.runtime.shutdown({ force: true })
        return
      default:
        return
    }
  }
}
