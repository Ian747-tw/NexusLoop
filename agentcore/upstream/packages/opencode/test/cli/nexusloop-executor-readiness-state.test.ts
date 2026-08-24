import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { Database } from "bun:sqlite"
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

  test("honors project disable while retaining explicit configuration", async () => {
    const item = await fixture()
    const projectConfig = path.join(item.cwd, "opencode.json")
    const projectPlugin = path.join(item.cwd, ".opencode", "plugin")
    const explicitDir = path.join(item.root, "explicit")
    await fs.mkdir(projectPlugin, { recursive: true })
    await fs.mkdir(explicitDir, { recursive: true })
    await fs.writeFile(projectConfig, JSON.stringify({ disabled_providers: ["openai"] }))
    await fs.writeFile(path.join(projectPlugin, "ignored.ts"), "throw new Error('must not load')")
    await fs.writeFile(
      path.join(explicitDir, "opencode.json"),
      JSON.stringify({ enabled_providers: ["openai"] }),
    )
    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_CONFIG_DIR: explicitDir },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("available")
  })

  test("matches project and managed configuration precedence", async () => {
    const item = await fixture()
    const dotConfig = path.join(item.cwd, ".opencode")
    const managed = path.join(item.root, "managed")
    await fs.mkdir(dotConfig, { recursive: true })
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(item.cwd, "opencode.json"), JSON.stringify({ disabled_providers: ["openai"] }))
    await fs.writeFile(path.join(dotConfig, "opencode.json"), JSON.stringify({ enabled_providers: ["openai"] }))
    await fs.writeFile(path.join(managed, "opencode.json"), JSON.stringify({ disabled_providers: [] }))
    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      managedConfigDir: managed,
    })
    expect(source.config_fragments).toEqual([
      { disabled_providers: ["openai"] },
      { enabled_providers: ["openai"] },
      { disabled_providers: [] },
    ])
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("available")
  })

  test("stops project configuration discovery at the nearest git boundary", async () => {
    const item = await fixture()
    const repository = path.join(item.root, "repository")
    const cwd = path.join(repository, "nested")
    await fs.mkdir(path.join(repository, ".git"), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })
    await fs.writeFile(
      path.join(item.root, "opencode.json"),
      JSON.stringify({ provider: { custom: { env: ["CUSTOM_KEY"], models: { exact: {} } } } }),
    )
    const source = await loadExecutorReadinessSource({
      cwd,
      env: { CUSTOM_KEY: "secret" },
      catalog: {},
      configHome: item.configHome,
      dataHome: item.dataHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness({ ...request, provider_id: "custom", model_id: "exact" }, source)).toMatchObject({
      provider_availability_status: "unavailable",
      credential_connection_status: "disconnected",
    })
  })

  test("active remote organization state uses the real singleton key and is unknown", async () => {
    const item = await fixture()
    const directory = path.join(item.dataHome, "opencode")
    await fs.mkdir(directory, { recursive: true })
    using database = new Database(path.join(directory, "opencode.db"), { create: true, strict: true })
    database.run("CREATE TABLE account_state (id INTEGER PRIMARY KEY, active_org_id TEXT)")
    database.run("INSERT INTO account_state (id, active_org_id) VALUES (1, 'org-current')")
    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
  })

  test("invalid OpenCode schema and unreadable managed authority fail closed", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    await fs.writeFile(path.join(item.configHome, "opencode", "opencode.json"), JSON.stringify({ share: "invalid" }))
    const invalid = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, invalid).provider_availability_status).toBe("unknown")

    await fs.writeFile(
      path.join(item.configHome, "opencode", "opencode.json"),
      JSON.stringify({ provider: { openai: { options: { timeout: 0 } } } }),
    )
    const invalidProviderOption = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, invalidProviderOption).provider_availability_status).toBe("unknown")

    const managedFile = path.join(item.root, "managed-file")
    await fs.writeFile(managedFile, "not a directory")
    const uncertain = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: path.join(item.root, "clean-config"),
      dataHome: item.dataHome,
      managedConfigDir: managedFile,
    })
    expect(observeExecutorReadiness(request, uncertain).provider_availability_status).toBe("unknown")
  })
})
