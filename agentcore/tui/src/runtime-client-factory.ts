import { lstatSync, readFileSync } from "fs"
import { basename, join } from "path"
import {
  createRuntimeServerFromLaunchConfig,
  RuntimeServer,
  RuntimeServerClient,
  type OpenCodeAdapterFactoryOptions,
} from "../../runtime/src/index"
import { supportedRuntimeEventTypes, type RuntimeEvent } from "./events"
import { FakeRuntimeClient, type RuntimeClient, type SubmitUserMessageResult } from "./runtime"

export type TuiRuntimeClientKind = "auto" | "fake" | "real"

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
  if (options.server) {
    return new TuiRuntimeServerClient(new RuntimeServerClient({
      server: options.server,
      autoStart: true,
      ownsServer: false,
    }))
  }
  const env = options.env ?? {}
  const kind = readRuntimeClientKind(env)
  if (kind === "fake" || (kind === "auto" && !hasApprovedSpec(options.projectDir))) {
    return new FakeRuntimeClient(options.projectDir, options.projectName ?? basename(options.projectDir))
  }
  const server = createRuntimeServerFromLaunchConfig({
    projectDir: options.projectDir,
    env,
    openCodeAdapterFactoryOptions: options.openCodeAdapterFactoryOptions,
  })
  return new TuiRuntimeServerClient(new RuntimeServerClient({
    server,
    autoStart: true,
    ownsServer: true,
  }))
}

export function readRuntimeClientKind(env: Record<string, string | undefined>): TuiRuntimeClientKind {
  const raw = env.NXL_RUNTIME_CLIENT
  if (raw === undefined || raw.trim() === "") return "auto"
  if (raw === "fake" || raw === "real") return raw
  throw new Error(`unknown runtime client kind in NXL_RUNTIME_CLIENT: ${raw}`)
}

function hasApprovedSpec(projectDir: string): boolean {
  const file = join(projectDir, ".nxl", "spec", "current.json")
  try {
    const entry = lstatSync(file)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 65_536) return false
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown
    return parsed !== null
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && Object.getPrototypeOf(parsed) === Object.prototype
      && Object.hasOwn(parsed, "status")
      && (parsed as { status?: unknown }).status === "approved"
  } catch {
    return false
  }
}

export function isTuiRuntimeEvent(event: unknown): event is RuntimeEvent {
  if (typeof event !== "object" || event === null) return false
  const type = (event as { type?: unknown }).type
  return typeof type === "string" && supportedRuntimeEventTypes.includes(type as RuntimeEvent["type"])
}

export class TuiRuntimeServerClient implements RuntimeClient {
  readonly streamMode = "long-lived" as const

  constructor(readonly runtime: RuntimeServerClient) {}

  async *stream(): AsyncIterable<RuntimeEvent> {
    for await (const event of this.runtime.stream()) {
      if (!isTuiRuntimeEvent(event)) continue
      yield event
      if (event.type === "RuntimeReady") {
        const status = await this.runtime.server.status()
        if (!status.specApproved && status.runtimeStatus !== "started") {
          yield { type: "ProjectUninitialized", projectDir: status.projectDir }
        }
      }
    }
  }

  async sendUserMessage(message: string): Promise<SubmitUserMessageResult> {
    return await this.runtime.submitUserMessage(message)
  }

  async sendCommand(command: string): Promise<unknown> {
    switch (command) {
      case "status":
        return await this.runtime.command("runtime.status")
      case "missions":
        return await this.runtime.command("runtime.list_recent_missions", { limit: 5 })
      case "resume":
        return await this.runtime.command("runtime.resume")
      case "new-session":
        return await this.runtime.command("runtime.start_new_session")
      case "records":
        return await this.runtime.command("runtime.view_records")
      case "shutdown":
        return await this.runtime.shutdown({ force: true })
      default:
        throw new Error(`unknown TUI command: ${command}`)
    }
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return await this.runtime.command(name as never, payload as never)
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown()
  }
}
