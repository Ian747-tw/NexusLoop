import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { FakeRuntimeClient } from "../src/runtime"
import { reduceRuntimeEvent } from "../src/reducer"
import { initialState } from "../src/state"
import { createTuiRuntimeClient, isTuiRuntimeEvent, readRuntimeClientKind, TuiRuntimeServerClient } from "../src/runtime-client-factory"
import { FakeOpenCodeAdapter, RuntimeServer, type OpenCodeProcessEventSource, type OpenCodeSpawnedProcess } from "../../runtime/src/index"

const cleanup: string[] = []
const TEST_TIMEOUT_MS = 1000

afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nxl-tui-runtime-"))
  cleanup.push(dir)
  return dir
}

async function makeApprovedProject(dir: string): Promise<void> {
  await mkdir(join(dir, ".nxl", "spec"), { recursive: true })
  await writeFile(
    join(dir, ".nxl", "spec", "current.json"),
    JSON.stringify(
      {
        spec_id: "spec_test",
        version: 1,
        status: "approved",
        objective: "TUI runtime bridge test objective",
        project_mode: "build",
        domain: "test",
        success_metrics: ["tests pass"],
        evaluation_protocol: "run tests",
        approved_by: "tester",
        approved_at: "2026-05-10T00:00:00Z",
      },
      null,
      2,
    ),
  )
}

class FakeProcessEventSource implements OpenCodeProcessEventSource {
  private readonly listeners: Array<(data: unknown) => void> = []

  on(_event: "data", listener: (data: unknown) => void): void {
    this.listeners.push(listener)
  }
}

class FakeSpawnedProcess implements OpenCodeSpawnedProcess {
  readonly stdout = new FakeProcessEventSource()
  readonly stderr = new FakeProcessEventSource()
  readonly stdinWrites: string[] = []
  private readonly spawnListeners: Array<() => void> = []
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly closeListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly errorListeners: Array<(error: Error) => void> = []

  stdin: OpenCodeSpawnedProcess["stdin"] = {
    write: (data: string, callback?: (error?: Error | null) => void) => {
      this.stdinWrites.push(data)
      queueMicrotask(() => callback?.())
      return true
    },
    end: () => {},
    writable: true,
    destroyed: false,
  }

  on(event: "spawn", listener: () => void): void
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "error", listener: (error: Error) => void): void
  on(event: "spawn" | "exit" | "close" | "error", listener: unknown): void {
    if (event === "spawn") {
      this.spawnListeners.push(listener as () => void)
      queueMicrotask(listener as () => void)
    } else if (event === "exit") this.exitListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else if (event === "close") this.closeListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else this.errorListeners.push(listener as (error: Error) => void)
  }

  kill(): void {}

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal)
    for (const listener of this.closeListeners) listener(code, signal)
  }
}

async function waitForJsonlWrite(process: FakeSpawnedProcess, type: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + TEST_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const line of process.stdinWrites) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type === type) return parsed
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${type}`)
}

async function readFirst<T>(stream: AsyncIterable<T>): Promise<T> {
  const deadline = Date.now() + TEST_TIMEOUT_MS
  const iterator = stream[Symbol.asyncIterator]()
  while (Date.now() < deadline) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((resolve) => setTimeout(() => resolve({ done: true, value: undefined as T }), 10)),
    ])
    if (!result.done) return result.value
  }
  throw new Error("timed out waiting for stream event")
}

describe("TUI runtime client factory", () => {
  test("no env keeps fake default behavior", async () => {
    const dir = await tempProject()
    const client = createTuiRuntimeClient({ projectDir: dir, env: {} })

    expect(client).toBeInstanceOf(FakeRuntimeClient)
  })

  test("NXL_RUNTIME_CLIENT=fake explicitly selects fake", async () => {
    const dir = await tempProject()
    const client = createTuiRuntimeClient({ projectDir: dir, env: { NXL_RUNTIME_CLIENT: "fake" } })

    expect(readRuntimeClientKind({ NXL_RUNTIME_CLIENT: "fake" })).toBe("fake")
    expect(client).toBeInstanceOf(FakeRuntimeClient)
  })

  test("NXL_RUNTIME_CLIENT=real creates RuntimeServer-backed client", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    })

    expect(client).toBeInstanceOf(TuiRuntimeServerClient)
    await (client as TuiRuntimeServerClient).runtime.shutdown()
  })

  test("real runtime client with fake OpenCode adapter starts safely", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    await expect(client.runtime.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })
    await client.runtime.shutdown()
  })

  test("real runtime client with process config fake spawn writes session and mission envelopes", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const process = new FakeSpawnedProcess()
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    }) as TuiRuntimeServerClient

    await client.runtime.command("runtime.status")
    expect(await waitForJsonlWrite(process, "nxl.session_start")).toMatchObject({ type: "nxl.session_start" })

    await client.sendUserMessage("hello from TUI real client")
    expect(await waitForJsonlWrite(process, "nxl.mission_packet")).toMatchObject({
      type: "nxl.mission_packet",
      message: "hello from TUI real client",
    })

    const shutdown = client.runtime.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("invalid runtime client kind fails clearly", async () => {
    const dir = await tempProject()
    expect(() => createTuiRuntimeClient({ projectDir: dir, env: { NXL_RUNTIME_CLIENT: "server" } })).toThrow("unknown runtime client kind")
  })

  test("invalid OpenCode env fails before runtime start", async () => {
    const dir = await tempProject()
    expect(() => createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
        NXL_OPENCODE_ARGS_JSON: "not-json",
      },
    })).toThrow("NXL_OPENCODE_ARGS_JSON must be valid JSON")
  })

  test("direct injected client wins over env", async () => {
    const dir = await tempProject()
    const injected = new FakeRuntimeClient(dir, "injected")
    const client = createTuiRuntimeClient({
      projectDir: dir,
      client: injected,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "process", NXL_OPENCODE_COMMAND: "" },
    })

    expect(client).toBe(injected)
  })

  test("direct injected server selects real runtime client without env", async () => {
    const dir = await tempProject()
    const server = new RuntimeServer({ projectDir: dir, adapter: new FakeOpenCodeAdapter() })
    const client = createTuiRuntimeClient({ projectDir: dir, server, env: {} })

    expect(client).toBeInstanceOf(TuiRuntimeServerClient)
    expect((client as TuiRuntimeServerClient).runtime.server).toBe(server)
  })

  test("filters runtime events unsupported by the TUI reducer", () => {
    expect(isTuiRuntimeEvent({ type: "ResearchProjectionChecked", status: "ok" })).toBe(false)
    expect(isTuiRuntimeEvent({ type: "RuntimeReady", projectName: "proj", runtimeStatus: "started" })).toBe(true)
  })

  test("real runtime stream only yields reducer-safe TUI events", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const event = await readFirst(client.stream())
    expect(isTuiRuntimeEvent(event)).toBe(true)
    const state = reduceRuntimeEvent(initialState(dir), event)
    expect(state).toBeDefined()

    await client.runtime.shutdown()
  })

  test("real runtime client maps resume menu commands to runtime commands", async () => {
    const commands: string[] = []
    const shutdownOptions: unknown[] = []
    const runtime = {
      command: async (command: string) => {
        commands.push(command)
      },
      shutdown: async (options?: unknown) => {
        shutdownOptions.push(options)
      },
    }
    const client = new TuiRuntimeServerClient(runtime as unknown as TuiRuntimeServerClient["runtime"])

    await client.sendCommand("resume")
    await client.sendCommand("new-session")
    await client.sendCommand("records")
    await client.sendCommand("shutdown")

    expect(commands).toEqual(["runtime.resume", "runtime.start_new_session", "runtime.view_records"])
    expect(shutdownOptions).toEqual([{ force: true }])
  })

  test("secret-looking env values do not leak through runtime status or event snapshots", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const process = new FakeSpawnedProcess()
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "/tmp/token=command-secret/opencode",
        NXL_OPENCODE_ARGS_JSON: "[\"--api-key=arg-secret\"]",
        NXL_TOKEN: "env-secret",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    }) as TuiRuntimeServerClient

    const status = await client.runtime.command("runtime.status")
    const serialized = JSON.stringify({ status, events: client.runtime.server.eventBus.snapshot() })

    expect(serialized).not.toContain("command-secret")
    expect(serialized).not.toContain("arg-secret")
    expect(serialized).not.toContain("env-secret")

    const shutdown = client.runtime.shutdown()
    process.emitExit(0, null)
    await shutdown
  })
})
