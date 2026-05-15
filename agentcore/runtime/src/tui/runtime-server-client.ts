import type { RuntimeEvent } from "../events/event-types"
import { redactText } from "../security/redaction"
import { RuntimeServer } from "../server"
import type { RuntimeClient, SubmitUserMessageResult } from "./runtime-client"

export interface RuntimeServerClientOptions {
  server: RuntimeServer
  autoStart?: boolean
  ownsServer?: boolean
}

export class RuntimeServerClient implements RuntimeClient {
  readonly server: RuntimeServer
  private readonly autoStart: boolean
  private readonly ownsServer: boolean
  private startTask: Promise<void> | null = null
  private shutdownTask: Promise<void> | null = null
  private started = false
  private shutdownRequested = false

  constructor(options: RuntimeServerClientOptions) {
    this.server = options.server
    this.autoStart = options.autoStart ?? false
    this.ownsServer = options.ownsServer ?? false
  }

  async start(): Promise<void> {
    if (this.shutdownRequested) throw new Error("runtime client has been shut down")
    if (this.started) return
    this.startTask ??= this.server.start()
      .then(() => {
        this.started = true
      })
      .catch((error) => {
        this.startTask = null
        throw redactError(error)
      })
    await this.startTask
  }

  command = (async (name: string, payload: Record<string, unknown> = {}): Promise<unknown> => {
    await this.ensureStarted()
    try {
      return await this.server.command(name, payload)
    } catch (error) {
      throw redactError(error)
    }
  }) as RuntimeClient["command"]

  async submitUserMessage(message: string): Promise<SubmitUserMessageResult> {
    await this.ensureStarted()
    try {
      return await this.server.submitUserMessage(message)
    } catch (error) {
      throw redactError(error)
    }
  }

  async *stream(): AsyncIterable<RuntimeEvent> {
    const iterator = this.server.eventBus.streamFromNow()[Symbol.asyncIterator]()
    const first = iterator.next()
    try {
      await this.ensureStarted()
      let next = await first
      while (!next.done) {
        yield next.value
        next = await iterator.next()
      }
    } finally {
      await iterator.return?.()
    }
  }

  async shutdown(options: { force?: boolean } = {}): Promise<void> {
    if (!this.ownsServer && !options.force) {
      this.shutdownRequested = true
      return
    }
    this.shutdownRequested = true
    this.shutdownTask ??= this.server.shutdown().catch((error) => {
      this.shutdownTask = null
      throw redactError(error)
    })
    await this.shutdownTask
  }

  private async ensureStarted(): Promise<void> {
    if (!this.autoStart) return
    await this.start()
  }
}

function redactError(error: unknown): Error {
  return new Error(redactText(error instanceof Error ? error.message : String(error)))
}
