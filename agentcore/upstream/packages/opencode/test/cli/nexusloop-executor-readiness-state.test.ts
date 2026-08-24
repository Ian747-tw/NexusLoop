import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { loadExecutorReadinessSource } from "../../src/cli/cmd/nexusloop/executor-readiness-state"
import { observeExecutorReadiness } from "../../src/cli/cmd/nexusloop/executor-readiness"

const roots: string[] = []
const request = {
  request_version: "nexusloop_opencode_executor_readiness_request_v1",
  selection_projection_hash: "b".repeat(64),
  provider_id: "openai",
  model_id: "gpt-5",
  credential_binding_id: "executor-primary",
}
const catalog = {
  openai: { id: "openai", env: ["OPENAI_API_KEY"], models: { "gpt-5": { id: "gpt-5" } } },
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-readiness-"))
  roots.push(root)
  const cwd = path.join(root, "project")
  const configHome = path.join(root, "config")
  const dataHome = path.join(root, "data")
  await fs.mkdir(cwd, { recursive: true })
  return { root, cwd, configHome, dataHome }
}

async function tree(root: string) {
  const output: string[] = []
  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      output.push(path.relative(root, file))
      if (entry.isDirectory()) await scan(file)
    }
  }
  await scan(root)
  return output
}

describe("NexusLoop Executor readiness local state", () => {
  test("reads exact OpenCode config and auth without writing or requesting a provider", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    await fs.mkdir(path.join(item.dataHome, "opencode"), { recursive: true })
    await fs.writeFile(
      path.join(item.configHome, "opencode", "opencode.json"),
      JSON.stringify({ enabled_providers: ["openai"] }),
    )
    await fs.writeFile(
      path.join(item.dataHome, "opencode", "auth.json"),
      JSON.stringify({ openai: { type: "api", key: "sk-secret-material" } }),
    )
    const before = await tree(item.root)
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (() => {
      fetches += 1
      throw new Error("network forbidden")
    }) as unknown as typeof fetch
    try {
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: {},
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
      })
      const result = observeExecutorReadiness(request, source)
      expect(result.provider_availability_status).toBe("available")
      expect(result.credential_connection_status).toBe("connected")
      expect(JSON.stringify(result)).not.toContain("sk-secret-material")
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(fetches).toBe(0)
    expect(await tree(item.root)).toEqual(before)
  })

  test("reports unknown for partial dynamic remote malformed and oversized state", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    await fs.mkdir(path.join(item.dataHome, "opencode"), { recursive: true })
    await fs.writeFile(
      path.join(item.configHome, "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["example-plugin"], provider: { openai: { models: { "gpt-5": {} } } } }),
    )
    await fs.writeFile(
      path.join(item.dataHome, "opencode", "auth.json"),
      JSON.stringify({ "https://auth.example": { type: "wellknown", key: "AUTH_TOKEN", token: "secret" } }),
    )
    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_MODELS_URL: "https://untrusted.example" },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
    })
    const result = observeExecutorReadiness(request, source)
    expect(result.provider_availability_status).toBe("unknown")
    expect(result.credential_connection_status).toBe("unknown")
    expect(JSON.stringify(result)).not.toMatch(/auth\.example|AUTH_TOKEN|untrusted|secret|example-plugin/)
  })

  test("duplicate malformed substitutions and excessive config fail closed", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    const file = path.join(item.configHome, "opencode", "opencode.json")
    for (const value of [
      '{"provider":{},"provider":{}}',
      '{"provider":',
      '{"provider":{"openai":{"options":{"apiKey":"{env:OPENAI_API_KEY}"}}}}',
      JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
    ]) {
      await fs.writeFile(file, value)
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: {},
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
      })
      expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unknown")
    }
  })

  test("malformed account state is unknown rather than absent", async () => {
    const item = await fixture()
    const databaseDirectory = path.join(item.dataHome, "opencode")
    await fs.mkdir(databaseDirectory, { recursive: true })
    await fs.writeFile(path.join(databaseDirectory, "opencode.db"), "not a database")
    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
  })

  test("provider availability and credential connection remain independent", async () => {
    const item = await fixture()
    const available = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
    })
    expect(observeExecutorReadiness(request, available)).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })

    await fs.mkdir(path.join(item.dataHome, "opencode"), { recursive: true })
    await fs.writeFile(
      path.join(item.dataHome, "opencode", "auth.json"),
      JSON.stringify({ openai: { type: "api", key: "secret" } }),
    )
    const connected = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog: {},
      configHome: item.configHome,
      dataHome: item.dataHome,
    })
    expect(observeExecutorReadiness(request, connected)).toMatchObject({
      provider_availability_status: "unavailable",
      credential_connection_status: "connected",
    })
  })
})
