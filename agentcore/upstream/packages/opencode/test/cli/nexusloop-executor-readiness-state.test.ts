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
  const cacheHome = path.join(root, "cache")
  await fs.mkdir(cwd, { recursive: true })
  return { root, cwd, configHome, dataHome, cacheHome }
}

function cachedCatalog(status?: "alpha" | "beta" | "deprecated") {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      npm: "@ai-sdk/openai",
      models: {
        "gpt-5": {
          id: "gpt-5",
          name: "GPT-5",
          release_date: "2025-01-01",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          limit: { context: 128000, output: 16384 },
          ...(status ? { status } : {}),
        },
      },
    },
  }
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
        cacheHome: item.cacheHome,
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
      cacheHome: item.cacheHome,
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
      '{"plugin":[[5,{}]]}',
      '{"plugin":[["package-only"]]}',
      JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
    ]) {
      await fs.writeFile(file, value)
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: {},
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
      })
      expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unknown")
    }
  })

  test("inline configuration substitutions cannot produce false-ready evidence", async () => {
    const item = await fixture()
    for (const token of ["{env:BLOCKED_PROVIDER}", "{file:provider-name}"]) {
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: {
          BLOCKED_PROVIDER: "openai",
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ disabled_providers: [token] }),
        },
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
        managedConfigDir: path.join(item.root, "managed-missing"),
      })
      expect(source.config_fragments).toEqual([])
      expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unknown")
    }
  })

  test("managed configuration substitutions cannot produce false-ready evidence", async () => {
    const item = await fixture()
    const managed = path.join(item.root, "managed")
    await fs.mkdir(managed, { recursive: true })
    for (const [file, token] of [
      ["opencode.json", "{env:BLOCKED_PROVIDER}"],
      ["opencode.jsonc", "{file:provider-name}"],
    ] as const) {
      await fs.rm(path.join(managed, "opencode.json"), { force: true })
      await fs.rm(path.join(managed, "opencode.jsonc"), { force: true })
      await fs.writeFile(path.join(managed, file), JSON.stringify({ disabled_providers: [token] }))
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: { BLOCKED_PROVIDER: "openai" },
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
        managedConfigDir: managed,
      })
      expect(source.config_fragments).toEqual([])
      expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unknown")
    }

    await fs.writeFile(
      path.join(managed, "opencode.jsonc"),
      '// documentation: {file:credentials.txt}\n{"disabled_providers": []}',
    )
    const commented = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: managed,
    })
    expect(observeExecutorReadiness(request, commented).provider_availability_status).toBe("available")
  })

  test("rejects malformed plugin tuples before readiness projection", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    const file = path.join(item.configHome, "opencode", "opencode.json")
    for (const value of ['{"plugin":[[5,{}]]}', '{"plugin":[["package-only"]]}']) {
      await fs.writeFile(file, value)
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: {},
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
        managedConfigDir: path.join(item.root, "managed-missing"),
      })
      expect(source.config_fragments).toEqual([])
      expect(source.observation_complete).toBe(false)
    }
  })

  test("malformed account state is unknown rather than absent", async () => {
    const item = await fixture()
    const databaseDirectory = path.join(item.dataHome, "opencode")
    await fs.mkdir(databaseDirectory, { recursive: true })
    await fs.writeFile(path.join(databaseDirectory, "opencode.db"), "not a database")
    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_DISABLE_CHANNEL_DB: "true" },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
  })

  test("uses the bounded effective OpenCode model cache before the bundled snapshot", async () => {
    const item = await fixture()
    const cacheDirectory = path.join(item.cacheHome, "opencode")
    await fs.mkdir(cacheDirectory, { recursive: true })
    await fs.writeFile(path.join(cacheDirectory, "models.json"), JSON.stringify(cachedCatalog("deprecated")))
    const deprecated = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, deprecated).provider_availability_status).toBe("unavailable")

    await fs.writeFile(path.join(cacheDirectory, "models.json"), JSON.stringify({
      ...cachedCatalog(),
      openai: { ...cachedCatalog().openai, models: {} },
    }))
    const removed = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, removed).provider_availability_status).toBe("unavailable")

    await fs.writeFile(path.join(cacheDirectory, "models.json"), JSON.stringify(cachedCatalog()))
    const emptyOverride = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_MODELS_PATH: "" },
      catalog: { openai: { id: "openai", env: ["OPENAI_API_KEY"], models: {} } },
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, emptyOverride).provider_availability_status).toBe("unavailable")
  })

  test("provider availability and credential connection remain independent", async () => {
    const item = await fixture()
    const available = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
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
      cacheHome: item.cacheHome,
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
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("available")
  })

  test("only treats loadable JavaScript and TypeScript entries as discovered plugins", async () => {
    const item = await fixture()
    const pluginDirectory = path.join(item.cwd, ".opencode", "plugin")
    await fs.mkdir(pluginDirectory, { recursive: true })
    await fs.writeFile(path.join(pluginDirectory, "README.md"), "documentation only")
    await fs.mkdir(path.join(pluginDirectory, "cache"), { recursive: true })

    const documentationOnly = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, documentationOnly).provider_availability_status).toBe("available")

    await fs.writeFile(path.join(pluginDirectory, "provider.js"), "throw new Error('must not load')")
    const loadablePlugin = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, loadablePlugin).provider_availability_status).toBe("unknown")

    await fs.rm(path.join(pluginDirectory, "provider.js"))
    const target = path.join(item.root, "linked-provider.js")
    await fs.writeFile(target, "throw new Error('must not load')")
    await fs.symlink(target, path.join(pluginDirectory, "linked.js"))
    const linkedPlugin = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, linkedPlugin).provider_availability_status).toBe("unknown")

    const pure = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_PURE: "true" },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, pure).provider_availability_status).toBe("available")
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
      cacheHome: item.cacheHome,
      managedConfigDir: managed,
    })
    expect(source.config_fragments).toEqual([
      { disabled_providers: ["openai"] },
      { enabled_providers: ["openai"] },
      { disabled_providers: [] },
    ])
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("available")
  })

  test("matches project JSON, JSONC, and nested directory precedence", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.cwd, ".git"), { recursive: true })
    await fs.writeFile(path.join(item.cwd, "opencode.json"), JSON.stringify({ disabled_providers: [] }))
    await fs.writeFile(path.join(item.cwd, "opencode.jsonc"), JSON.stringify({ disabled_providers: ["openai"] }))
    const projectFiles = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, projectFiles).provider_availability_status).toBe("unavailable")

    await fs.rm(path.join(item.cwd, "opencode.json"))
    await fs.rm(path.join(item.cwd, "opencode.jsonc"))
    const nested = path.join(item.cwd, "nested")
    await fs.mkdir(path.join(item.cwd, ".opencode"), { recursive: true })
    await fs.mkdir(path.join(nested, ".opencode"), { recursive: true })
    await fs.writeFile(
      path.join(item.cwd, ".opencode", "opencode.json"),
      JSON.stringify({ disabled_providers: ["openai"] }),
    )
    await fs.writeFile(
      path.join(nested, ".opencode", "opencode.json"),
      JSON.stringify({ disabled_providers: [] }),
    )
    const directories = await loadExecutorReadinessSource({
      cwd: nested,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, directories).provider_availability_status).toBe("unavailable")
  })

  test("preserves repeated explicit and discovered project config precedence", async () => {
    const item = await fixture()
    const nested = path.join(item.cwd, "nested")
    const explicit = path.join(nested, "opencode.json")
    await fs.mkdir(path.join(item.cwd, ".git"), { recursive: true })
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(path.join(item.cwd, "opencode.json"), JSON.stringify({ disabled_providers: [] }))
    await fs.writeFile(explicit, JSON.stringify({ disabled_providers: ["openai"] }))

    const source = await loadExecutorReadinessSource({
      cwd: nested,
      env: { OPENCODE_CONFIG: explicit },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })

    expect(source.config_fragments).toEqual([
      { disabled_providers: ["openai"] },
      { disabled_providers: [] },
      { disabled_providers: ["openai"] },
    ])
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unavailable")
  })

  test("deduplicates explicit config directories already discovered in the project", async () => {
    const item = await fixture()
    const nested = path.join(item.cwd, "nested")
    const rootDirectory = path.join(item.cwd, ".opencode")
    const nestedDirectory = path.join(nested, ".opencode")
    await fs.mkdir(path.join(item.cwd, ".git"), { recursive: true })
    await fs.mkdir(rootDirectory, { recursive: true })
    await fs.mkdir(nestedDirectory, { recursive: true })
    await fs.writeFile(path.join(nestedDirectory, "opencode.json"), JSON.stringify({ disabled_providers: [] }))
    await fs.writeFile(path.join(rootDirectory, "opencode.json"), JSON.stringify({ disabled_providers: ["openai"] }))

    const source = await loadExecutorReadinessSource({
      cwd: nested,
      env: { OPENCODE_CONFIG_DIR: nestedDirectory },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(source.config_fragments).toEqual([
      { disabled_providers: [] },
      { disabled_providers: ["openai"] },
    ])
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unavailable")
  })

  test("preserves relative explicit config-directory reload precedence", async () => {
    const item = await fixture()
    const nested = path.join(item.cwd, "nested")
    const rootDirectory = path.join(item.cwd, ".opencode")
    const nestedDirectory = path.join(nested, ".opencode")
    await fs.mkdir(path.join(item.cwd, ".git"), { recursive: true })
    await fs.mkdir(rootDirectory, { recursive: true })
    await fs.mkdir(nestedDirectory, { recursive: true })
    await fs.writeFile(path.join(nestedDirectory, "opencode.json"), JSON.stringify({ disabled_providers: ["openai"] }))
    await fs.writeFile(path.join(rootDirectory, "opencode.json"), JSON.stringify({ disabled_providers: [] }))

    const source = await loadExecutorReadinessSource({
      cwd: nested,
      env: { OPENCODE_CONFIG_DIR: ".opencode" },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(source.config_fragments).toEqual([
      { disabled_providers: ["openai"] },
      { disabled_providers: [] },
      { disabled_providers: ["openai"] },
    ])
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unavailable")
  })

  test("empty XDG overrides retain standard home config and data authority", async () => {
    const item = await fixture()
    const home = path.join(item.root, "home")
    const config = path.join(home, ".config", "opencode")
    const data = path.join(home, ".local", "share", "opencode")
    await fs.mkdir(config, { recursive: true })
    await fs.mkdir(data, { recursive: true })
    await fs.writeFile(path.join(config, "opencode.json"), JSON.stringify({ disabled_providers: ["openai"] }))
    await fs.writeFile(path.join(data, "auth.json"), JSON.stringify({ openai: { type: "api", key: "secret" } }))

    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_TEST_HOME: home, XDG_CONFIG_HOME: "", XDG_DATA_HOME: "" },
      catalog,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "unavailable",
      credential_connection_status: "connected",
    })
  })

  test("matches linked-worktree project discovery through the git common directory", async () => {
    const item = await fixture()
    const main = path.join(item.root, "main")
    const linkedParent = path.join(item.root, "linked-parent")
    const linked = path.join(linkedParent, "worktree")
    await fs.mkdir(main, { recursive: true })
    await fs.mkdir(linkedParent, { recursive: true })
    const git = async (...args: string[]) => {
      const process = Bun.spawn({ cmd: ["git", ...args], cwd: main, stdout: "pipe", stderr: "pipe" })
      const code = await process.exited
      if (code !== 0) throw new Error(await new Response(process.stderr).text())
    }
    await git("init")
    await git("config", "user.email", "readiness@example.invalid")
    await git("config", "user.name", "Readiness Test")
    await fs.writeFile(path.join(main, "tracked"), "ready")
    await git("add", "tracked")
    await git("commit", "-m", "fixture")
    await git("worktree", "add", "-b", "linked-test", linked)
    await fs.writeFile(path.join(linkedParent, "opencode.json"), JSON.stringify({ disabled_providers: ["openai"] }))

    const source = await loadExecutorReadinessSource({
      cwd: linked,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unavailable")
  })

  test("matches project discovery for worktrees backed by a bare common repository", async () => {
    const item = await fixture()
    const seed = path.join(item.root, "seed")
    const repositories = path.join(item.root, "repositories")
    const bare = path.join(repositories, "repo.git")
    const linked = path.join(repositories, "worktrees", "linked")
    await fs.mkdir(seed, { recursive: true })
    await fs.mkdir(path.dirname(linked), { recursive: true })
    const git = async (cwd: string, ...args: string[]) => {
      const process = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
      const code = await process.exited
      if (code !== 0) throw new Error(await new Response(process.stderr).text())
    }
    await git(seed, "init")
    await git(seed, "config", "user.email", "readiness@example.invalid")
    await git(seed, "config", "user.name", "Readiness Test")
    await fs.writeFile(path.join(seed, "tracked"), "ready")
    await git(seed, "add", "tracked")
    await git(seed, "commit", "-m", "fixture")
    await git(item.root, "clone", "--bare", seed, bare)
    await git(item.root, `--git-dir=${bare}`, "worktree", "add", "-b", "linked-bare", linked)
    await fs.writeFile(path.join(item.root, "opencode.json"), JSON.stringify({ disabled_providers: ["openai"] }))

    const source = await loadExecutorReadinessSource({
      cwd: linked,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("unavailable")
  })

  test("normalizes accepted legacy TUI keys and fails closed for legacy global TOML", async () => {
    const item = await fixture()
    const globalDirectory = path.join(item.configHome, "opencode")
    await fs.mkdir(globalDirectory, { recursive: true })
    await fs.writeFile(
      path.join(globalDirectory, "opencode.json"),
      JSON.stringify({
        theme: "{env:THEME}",
        keybinds: { note: "{env:KEYBINDS}" },
        tui: { note: "{env:TUI}" },
        enabled_providers: ["openai"],
      }),
    )
    const normalized = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, normalized).provider_availability_status).toBe("available")

    await fs.writeFile(
      path.join(globalDirectory, "opencode.json"),
      JSON.stringify({ theme: "{file:missing-theme}", enabled_providers: ["openai"] }),
    )
    const unresolvedLegacyFile = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, unresolvedLegacyFile).provider_availability_status).toBe("unknown")

    await fs.writeFile(path.join(globalDirectory, "config"), 'disabled_providers = ["openai"]')
    const legacy = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, legacy).provider_availability_status).toBe("unknown")
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
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness({ ...request, provider_id: "custom", model_id: "exact" }, source)).toMatchObject({
      provider_availability_status: "unavailable",
      credential_connection_status: "disconnected",
    })
  })

  test("does not charge missing config candidates against the fragment ceiling", async () => {
    const item = await fixture()
    const repository = path.join(item.root, "repository")
    let cwd = repository
    await fs.mkdir(path.join(repository, ".git"), { recursive: true })
    for (let index = 0; index < 20; index += 1) cwd = path.join(cwd, `level-${index}`)
    await fs.mkdir(cwd, { recursive: true })

    const source = await loadExecutorReadinessSource({
      cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })
  })

  test("treats zero-byte ordinary and managed config files as absent", async () => {
    const item = await fixture()
    const managed = path.join(item.root, "managed")
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(item.configHome, "opencode", "opencode.json"), "")
    await fs.writeFile(path.join(item.cwd, "opencode.jsonc"), "")
    await fs.writeFile(path.join(managed, "opencode.json"), "")
    await fs.writeFile(path.join(managed, "opencode.jsonc"), "")

    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: managed,
    })
    expect(source.observation_complete).toBe(true)
    expect(source.config_fragments).toEqual([])
    expect(observeExecutorReadiness(request, source).provider_availability_status).toBe("available")
  })

  test("distinguishes unreadable config authority from missing files", async () => {
    const item = await fixture()
    const globalDirectory = path.join(item.configHome, "opencode")
    const globalFile = path.join(globalDirectory, "opencode.json")
    const explicitDirectory = path.join(item.root, "explicit")
    await fs.mkdir(globalDirectory, { recursive: true })
    await fs.mkdir(explicitDirectory, { recursive: true })
    await fs.writeFile(globalFile, JSON.stringify({ disabled_providers: [] }))
    await fs.writeFile(path.join(explicitDirectory, "opencode.json"), JSON.stringify({ disabled_providers: [] }))

    await fs.chmod(globalFile, 0)
    try {
      const unreadableFile = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: {},
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
        managedConfigDir: path.join(item.root, "managed-missing"),
      })
      expect(observeExecutorReadiness(request, unreadableFile).provider_availability_status).toBe("unknown")
    } finally {
      await fs.chmod(globalFile, 0o600)
    }

    await fs.chmod(explicitDirectory, 0)
    try {
      const unreadableDirectory = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: { OPENCODE_CONFIG_DIR: explicitDirectory },
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
        managedConfigDir: path.join(item.root, "managed-missing"),
      })
      expect(observeExecutorReadiness(request, unreadableDirectory).provider_availability_status).toBe("unknown")
    } finally {
      await fs.chmod(explicitDirectory, 0o700)
    }
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
      env: { OPENCODE_DISABLE_CHANNEL_DB: "true" },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
  })

  test("observes the exact OpenCode database override instead of the default path", async () => {
    const item = await fixture()
    const defaultDirectory = path.join(item.dataHome, "opencode")
    const selectedDatabase = path.join(item.root, "selected-opencode.db")
    await fs.mkdir(defaultDirectory, { recursive: true })

    using ignored = new Database(path.join(defaultDirectory, "opencode.db"), { create: true, strict: true })
    ignored.run("CREATE TABLE account_state (id INTEGER PRIMARY KEY, active_org_id TEXT)")

    using selected = new Database(selectedDatabase, { create: true, strict: true })
    selected.run("CREATE TABLE account_state (id INTEGER PRIMARY KEY, active_org_id TEXT)")
    selected.run("INSERT INTO account_state (id, active_org_id) VALUES (1, 'org-current')")

    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_DB: selectedDatabase },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
  })

  test("treats an inaccessible OpenCode database as unknown rather than missing", async () => {
    const item = await fixture()
    const databaseDirectory = path.join(item.root, "private-database")
    const databasePath = path.join(databaseDirectory, "opencode.db")
    await fs.mkdir(databaseDirectory, { recursive: true })
    await fs.writeFile(databasePath, "not a database")
    await fs.chmod(databaseDirectory, 0)
    try {
      const source = await loadExecutorReadinessSource({
        cwd: item.cwd,
        env: { OPENCODE_DB: databasePath },
        catalog,
        configHome: item.configHome,
        dataHome: item.dataHome,
        cacheHome: item.cacheHome,
        managedConfigDir: path.join(item.root, "managed-missing"),
      })
      expect(observeExecutorReadiness(request, source)).toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "unknown",
      })
    } finally {
      await fs.chmod(databaseDirectory, 0o700)
    }
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
      cacheHome: item.cacheHome,
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
      cacheHome: item.cacheHome,
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
      cacheHome: item.cacheHome,
      managedConfigDir: managedFile,
    })
    expect(observeExecutorReadiness(request, uncertain).provider_availability_status).toBe("unknown")
  })

  test("accepts complete OpenCode config schema outside the readiness projection", async () => {
    const item = await fixture()
    await fs.mkdir(path.join(item.configHome, "opencode"), { recursive: true })
    await fs.writeFile(
      path.join(item.configHome, "opencode", "opencode.json"),
      JSON.stringify({
        server: { port: 4096 },
        instructions: ["AGENTS.md"],
        permission: { read: "allow" },
        agent: { build: { model: "openai/gpt-5" } },
        mcp: { disabled: { enabled: false } },
        provider: {
          openai: {
            models: {
              "gpt-5": {
                limit: { context: 200_000, output: 16_384 },
                modalities: { input: ["text"], output: ["text"] },
                variants: { fast: { disabled: false } },
              },
            },
          },
        },
      }),
    )

    const source = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, source)).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })
  })

  test("validates file auth entries while preserving environment auth override semantics", async () => {
    const item = await fixture()
    const authDirectory = path.join(item.dataHome, "opencode")
    await fs.mkdir(authDirectory, { recursive: true })
    await fs.writeFile(
      path.join(authDirectory, "auth.json"),
      JSON.stringify({ openai: { type: "api", key: "secret", metadata: 5 } }),
    )

    const malformedFile = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    expect(observeExecutorReadiness(request, malformedFile)).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })

    await fs.writeFile(
      path.join(authDirectory, "auth.json"),
      JSON.stringify({
        openai: { type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: 0 },
      }),
    )
    const oauthFile = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {},
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    const oauthResult = observeExecutorReadiness(request, oauthFile)
    expect(oauthResult.credential_connection_status).toBe("connected")
    expect(JSON.stringify(oauthResult)).not.toMatch(/access-secret|refresh-secret/)

    const environmentOverride = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: { OPENCODE_AUTH_CONTENT: JSON.stringify({ openai: { type: "api", key: "secret", metadata: 5 } }) },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    const result = observeExecutorReadiness(request, environmentOverride)
    expect(result).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
    expect(JSON.stringify(result)).not.toContain("secret")

    const validEnvironmentOverride = await loadExecutorReadinessSource({
      cwd: item.cwd,
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: { type: "api", key: "secret", metadata: { account: "primary" } },
        }),
      },
      catalog,
      configHome: item.configHome,
      dataHome: item.dataHome,
      cacheHome: item.cacheHome,
      managedConfigDir: path.join(item.root, "managed-missing"),
    })
    const validResult = observeExecutorReadiness(request, validEnvironmentOverride)
    expect(validResult.credential_connection_status).toBe("connected")
    expect(JSON.stringify(validResult)).not.toMatch(/secret|account/)
  })
})
