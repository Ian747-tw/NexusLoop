import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import {
  OpenCodeExecutorModelReadinessResolver,
  createPackagedOpenCodeExecutorReadinessResolver,
} from "./opencode-executor-readiness-resolver"
import type { ExecutorModelSelectionProjection } from "./model-configuration-types"
import type { OpenCodeSpawn, OpenCodeSpawnedProcess } from "../opencode/process-adapter"

const selection = Object.freeze({
  projection_version: 1,
  role: "executor",
  selection_status: "selected",
  availability_status: "role_readiness_unknown",
  connection_status: "role_readiness_unknown",
  profile_id: "profile-executor-anthropic",
  connection_id: "connection-executor-anthropic",
  provider_kind: "anthropic",
  provider_id: "anthropic",
  model_id: "claude-sonnet-4-5-20250929",
  credential_binding_id: "credential-executor-anthropic-primary",
  provider_mapping_id: "executor-anthropic-v1",
  connection_authority_hash: "1".repeat(64),
  profile_hash: "2".repeat(64),
  binding_hash: "5".repeat(64),
  provider_mapping_hash: "6".repeat(64),
  provider_mapping_policy_hash: "7".repeat(64),
  projection_hash: "3".repeat(64),
}) satisfies ExecutorModelSelectionProjection

function observation(overrides: Record<string, unknown> = {}) {
  const value = {
    observation_version: 1 as const,
    selection_projection_hash: selection.projection_hash,
    provider_id: selection.provider_id,
    model_id: selection.model_id,
    credential_binding_id: selection.credential_binding_id,
    provider_availability_status: "available" as const,
    credential_connection_status: "connected" as const,
    ...overrides,
  }
  const semantic = {
    policy_version: "nexusloop_opencode_executor_readiness_policy_v1",
    selection_projection_hash: value.selection_projection_hash,
    provider_id: value.provider_id,
    model_id: value.model_id,
    credential_binding_id: value.credential_binding_id,
    provider_availability_status: value.provider_availability_status,
    credential_connection_status: value.credential_connection_status,
  }
  return {
    ...value,
    evidence_id: "opencode-readiness-v1-" + createHash("sha256").update(JSON.stringify(semantic)).digest("hex"),
  }
}

function spawnFixture(response: string, options: { code?: number | null; delayMs?: number; signal?: NodeJS.Signals | null } = {}) {
  const calls: Array<{ command: string; args: string[]; input: string; cwd: string }> = []
  const spawn: OpenCodeSpawn = (command, args, spawnOptions) => {
    const child = new EventEmitter() as EventEmitter & OpenCodeSpawnedProcess
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    let input = ""
    child.stdout = stdout
    child.stderr = stderr
    child.stdin = {
      write(data: string, callback?: (error?: Error | null) => void) { input += data; callback?.(null); return true },
      end() {
        calls.push({ command, args, input, cwd: spawnOptions.cwd })
        setTimeout(() => {
          stdout.emit("data", Buffer.from(response))
          child.emit("close", options.code === undefined ? 0 : options.code, options.signal ?? null)
        }, options.delayMs ?? 0)
      },
      on() { return child.stdin },
    }
    child.kill = () => { child.emit("close", null, "SIGTERM"); return true }
    queueMicrotask(() => child.emit("spawn"))
    return child
  }
  return { spawn, calls }
}

describe("packaged OpenCode Executor readiness resolver", () => {
  test("production construction uses the exact launch executable and fixed packaged subcommand", async () => {
    const fixture = spawnFixture(JSON.stringify(observation()) + "\n")
    const resolver = createPackagedOpenCodeExecutorReadinessResolver({
      projectDir: "/tmp/project",
      openCodeAdapterConfig: {
        kind: "process",
        command: "/opt/nexusloop/opencode",
        args: ["run", "--format", "json"],
        cwd: "/tmp/project",
      },
      spawn: fixture.spawn,
    })
    expect(await resolver.observe(selection)).toEqual(observation())
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]).toMatchObject({
      command: "/opt/nexusloop/opencode",
      args: ["nexusloop", "executor-readiness-v1"],
      cwd: "/tmp/project",
    })
    expect(JSON.parse(fixture.calls[0]!.input)).toEqual({
      request_version: "nexusloop_opencode_executor_readiness_request_v1",
      selection_projection_hash: selection.projection_hash,
      provider_id: selection.provider_id,
      model_id: selection.model_id,
      credential_binding_id: selection.credential_binding_id,
    })
  })

  test("caller mutation cannot redirect the snapshotted executable authority", async () => {
    const fixture = spawnFixture(JSON.stringify(observation()) + "\n")
    const config = {
      kind: "process" as const,
      command: "/opt/nexusloop/opencode",
      args: ["run"],
      env: { SAFE_MODE: "1" },
    }
    const resolver = createPackagedOpenCodeExecutorReadinessResolver({
      projectDir: "/tmp/project",
      openCodeAdapterConfig: config,
      spawn: fixture.spawn,
    })
    config.command = "/tmp/forged"
    config.args[0] = "forged"
    config.env.SAFE_MODE = "0"
    await resolver.observe(selection)
    expect(fixture.calls[0]).toMatchObject({ command: "/opt/nexusloop/opencode", args: ["nexusloop", "executor-readiness-v1"] })
  })

  test("fake adapters and alternate readiness authority fail closed", () => {
    expect(() => createPackagedOpenCodeExecutorReadinessResolver({
      projectDir: "/tmp/project",
      openCodeAdapterConfig: { kind: "fake" },
    })).toThrow("process")
    expect(() => createPackagedOpenCodeExecutorReadinessResolver({
      projectDir: "/tmp/project",
      openCodeAdapterConfig: {
        kind: "process",
        command: "/opt/opencode",
        args: [],
        readinessCommand: "/tmp/forged",
      } as never,
    })).toThrow()
  })

  test("identity, protocol, extra fields, multiple records, and trailing output fail closed", async () => {
    for (const response of [
      JSON.stringify(observation({ provider_id: "google" })) + "\n",
      JSON.stringify(observation({ model_id: "gemini-2.5-flash" })) + "\n",
      JSON.stringify(observation({ selection_projection_hash: "4".repeat(64) })) + "\n",
      JSON.stringify(observation({ credential_binding_id: "credential-executor-other" })) + "\n",
      JSON.stringify(observation({ observation_version: 2 })) + "\n",
      JSON.stringify(observation({ extra: true })) + "\n",
      "{\"observation_version\":1,\"observation_version\":1}\n",
      "not-json\n",
      JSON.stringify(observation()) + "\n" + JSON.stringify(observation()) + "\n",
      JSON.stringify(observation()) + " trailing",
    ]) {
      const fixture = spawnFixture(response)
      const resolver = new OpenCodeExecutorModelReadinessResolver({
        command: "/opt/opencode", cwd: "/tmp/project", spawn: fixture.spawn,
      })
      await expect(resolver.observe(selection)).rejects.toThrow()
    }
  })

  test("availability and credential observations remain independent tri-state evidence", async () => {
    for (const [providerStatus, credentialStatus] of [
      ["available", "disconnected"],
      ["unavailable", "connected"],
      ["unknown", "unknown"],
    ] as const) {
      const expected = observation({
        provider_availability_status: providerStatus,
        credential_connection_status: credentialStatus,
      })
      const fixture = spawnFixture(JSON.stringify(expected) + "\n")
      const resolver = new OpenCodeExecutorModelReadinessResolver({
        command: "/opt/opencode", cwd: "/tmp/project", spawn: fixture.spawn,
      })
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: providerStatus,
        credential_connection_status: credentialStatus,
      })
      expect(fixture.calls).toHaveLength(1)
    }
  })

  test("oversized output, timeout, nonzero exit, and shutdown settle without retry", async () => {
    const oversized = spawnFixture("x".repeat(4097))
    const oversizedResolver = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: oversized.spawn,
    })
    await expect(oversizedResolver.observe(selection)).rejects.toThrow()
    expect(oversized.calls).toHaveLength(1)

    const failed = spawnFixture("", { code: 2 })
    const failedResolver = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: failed.spawn,
    })
    await expect(failedResolver.observe(selection)).rejects.toThrow()
    expect(failed.calls).toHaveLength(1)

    const delayed = spawnFixture(JSON.stringify(observation()) + "\n", { delayMs: 50 })
    const resolver = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: delayed.spawn, timeoutMs: 10,
    })
    await expect(resolver.observe(selection)).rejects.toThrow()
    await resolver.shutdown()
    expect(resolver.activeCount()).toBe(0)
  })

  test("synchronous spawn failure and signal termination are bounded and do not retry", async () => {
    let spawnCalls = 0
    const throwingSpawn: OpenCodeSpawn = () => {
      spawnCalls += 1
      throw new Error("https://secret.example Authorization NXL_PRIVATE_KEY")
    }
    const throwing = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: throwingSpawn,
    })
    await expect(throwing.observe(selection)).rejects.toThrow("Executor readiness observation failed")
    await expect(throwing.observe(selection)).rejects.not.toThrow("secret.example")
    expect(spawnCalls).toBe(2)
    expect(throwing.activeCount()).toBe(0)

    const signalled = spawnFixture("", { code: null, signal: "SIGTERM" })
    const signalledResolver = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: signalled.spawn,
    })
    await expect(signalledResolver.observe(selection)).rejects.toThrow("did not complete")
    expect(signalled.calls).toHaveLength(1)
  })

  test("concurrency is capped at two and shutdown owns both active children", async () => {
    const fixture = spawnFixture(JSON.stringify(observation()) + "\n", { delayMs: 100 })
    const resolver = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: fixture.spawn,
    })
    const first = resolver.observe(selection)
    const second = resolver.observe(selection)
    await expect(resolver.observe(selection)).rejects.toThrow("capacity")
    expect(resolver.activeCount()).toBe(2)
    await resolver.shutdown()
    await expect(first).rejects.toThrow("shutdown")
    await expect(second).rejects.toThrow("shutdown")
    expect(fixture.calls).toHaveLength(2)
    expect(resolver.activeCount()).toBe(0)
  })

  test("startup waits for an owned pre-start observation without cancelling it", async () => {
    const fixture = spawnFixture(JSON.stringify(observation()) + "\n", { delayMs: 50 })
    const resolver = new OpenCodeExecutorModelReadinessResolver({
      command: "/opt/opencode", cwd: "/tmp/project", spawn: fixture.spawn,
    })
    const pending = resolver.observe(selection)
    const starting = resolver.start()
    await expect(Promise.race([
      starting.then(() => "started" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 10)),
    ])).resolves.toBe("waiting")
    await expect(resolver.observe(selection)).rejects.toThrow("startup is in progress")
    await expect(pending).resolves.toEqual(observation())
    await expect(starting).resolves.toBeUndefined()
    await expect(resolver.observe(selection)).resolves.toEqual(observation())
    expect(fixture.calls).toHaveLength(2)
    await resolver.shutdown()
  })

  test("production factory rejects proxy and accessor authority without executing caller code", () => {
    let traps = 0
    const proxied = new Proxy({
      projectDir: "/tmp/project",
      openCodeAdapterConfig: { kind: "process", command: "/opt/opencode" },
    }, {
      get() { traps += 1; return undefined },
      ownKeys() { traps += 1; return [] },
      getOwnPropertyDescriptor() { traps += 1; return undefined },
    })
    expect(() => createPackagedOpenCodeExecutorReadinessResolver(proxied as never)).toThrow("Proxy")
    expect(traps).toBe(0)

    let getterCalls = 0
    const accessor = Object.defineProperty({
      projectDir: "/tmp/project",
    }, "openCodeAdapterConfig", {
      enumerable: true,
      get() { getterCalls += 1; return { kind: "process", command: "/opt/opencode" } },
    })
    expect(() => createPackagedOpenCodeExecutorReadinessResolver(accessor as never)).toThrow("own data")
    expect(getterCalls).toBe(0)
  })
})
