import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildModelSetupCandidate } from "./model-setup"
import {
  OpenCodeExecutorModelReadinessResolver,
  createProductionOpenCodeExecutorReadinessResolver,
} from "./opencode-executor-readiness-resolver"

const selection = buildModelSetupCandidate({
  commander_recipe_id: null,
  executor_recipe_id: "executor-google-gemini-2-5-flash",
}).executor_selection!
const openAiSelection = buildModelSetupCandidate({
  commander_recipe_id: null,
  executor_recipe_id: "executor-openai-gpt-4-1-mini",
}).executor_selection!

function catalogModel(id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name,
    release_date: "2025-01-01",
    attachment: false,
    reasoning: false,
    temperature: true,
    tool_call: true,
    limit: { context: 128_000, output: 8_192 },
    ...extra,
  }
}

async function fixture(source: string): Promise<{ command: string; args: string[]; cwd: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-observer-"))
  const file = join(cwd, "observer.ts")
  await writeFile(file, source, "utf8")
  await chmod(file, 0o700)
  return { command: process.execPath, args: [file], cwd }
}

const echoFixture = `
let body = "";
for await (const chunk of Bun.stdin.stream()) body += new TextDecoder().decode(chunk);
const input = JSON.parse(body);
console.log(JSON.stringify({
  protocol_version: 1,
  selection_projection_hash: input.selection_projection_hash,
  provider_id: input.provider_id,
  model_id: input.model_id,
  credential_binding_id: input.credential_binding_id,
  provider_availability_status: "available",
  credential_connection_status: "connected"
}));
`

describe("9W4E OpenCode-owned Executor readiness resolver", () => {
  test("production observation ignores project Bun preloads", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-bunfig-observer-"))
    const marker = join(cwd, "forged-preload-ran")
    const preload = join(cwd, "forged-preload.ts")
    const modelsPath = join(cwd, "models.json")
    await writeFile(preload, `await Bun.write(${JSON.stringify(marker)}, "ran"); process.exit(0);`, "utf8")
    await writeFile(join(cwd, "bunfig.toml"), `preload = [${JSON.stringify(preload)}]\n`, "utf8")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
      },
    })

    await expect(resolver.observe(selection)).resolves.toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })
    expect(await Bun.file(marker).exists()).toBe(false)
    await resolver.shutdown()
  })

  test("mirrors pinned OpenAI OAuth model filtering before reporting availability", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-oauth-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      openai: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        models: { "gpt-4.1-mini": catalogModel("gpt-4.1-mini", "GPT-4.1 mini") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: { type: "oauth", refresh: "fixture-refresh-secret", access: "fixture-access-secret", expires: 4_102_444_800_000 },
        }),
      },
    })
    const observed = await resolver.observe(openAiSelection)
    expect(observed).toMatchObject({
      provider_id: "openai",
      model_id: "gpt-4.1-mini",
      provider_availability_status: "unavailable",
      credential_connection_status: "connected",
    })
    expect(JSON.stringify(observed)).not.toMatch(/oauth|fixture|refresh|access|auth\.json|OPENAI_API_KEY/i)
    await resolver.shutdown()
  })

  test("uses the pinned OpenCode child to observe exact model and credential-source presence", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-production-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret-never-returned" } }),
      },
    })
    const observed = await resolver.observe(selection)
    expect(observed).toMatchObject({
      provider_id: "google",
      model_id: "gemini-2.5-flash",
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })
    expect(JSON.stringify(observed)).not.toContain("fixture-secret-never-returned")
    expect(JSON.stringify(observed)).not.toMatch(/OPENCODE_AUTH_CONTENT|XDG_|auth\.json|https?:|authorization/i)
    await resolver.shutdown()
  })

  test("reports exact model availability independently from credential connection", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-disconnected-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const disconnected = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: join(cwd, "disconnected-home"),
        XDG_CONFIG_HOME: join(cwd, "disconnected-config"),
        XDG_DATA_HOME: join(cwd, "disconnected-data"),
        OPENCODE_MODELS_PATH: modelsPath,
      },
    })
    await expect(disconnected.observe(selection)).resolves.toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })
    await disconnected.shutdown()
  })

  test("reports exact model absence independently from credential connection", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-absent-model-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const absentSelection = Object.freeze({ ...selection, model_id: "missing-exact-model" })
    const absent = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: join(cwd, "absent-home"),
        XDG_CONFIG_HOME: join(cwd, "absent-config"),
        XDG_DATA_HOME: join(cwd, "absent-data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "another-secret" } }),
      },
    })
    await expect(absent.observe(absentSelection)).resolves.toMatchObject({
      provider_availability_status: "unavailable",
      credential_connection_status: "connected",
    })
    await absent.shutdown()
  })

  test("keeps credential evidence connected when malformed catalog evidence makes availability unknown", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-malformed-catalog-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, "{", "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret-never-returned" } }),
      },
    })

    const observed = await resolver.observe(selection)
    expect(observed).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "connected",
    })
    expect(JSON.stringify(observed)).not.toMatch(/fixture|secret|auth|models\.json|OPENCODE_/i)
    await resolver.shutdown()
  })

  test("rejects parseable catalog entries that pinned OpenCode cannot initialize", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-incomplete-catalog-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" } },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
      },
    })
    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "connected",
      })
    } finally {
      await resolver.shutdown()
    }
  })

  test("rejects well-known auth before OpenCode config can perform a remote fetch", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-wellknown-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1
        return Response.json({ config: {} })
      },
    })
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          google: { type: "api", key: "fixture-secret" },
          [`http://127.0.0.1:${server.port}`]: { type: "wellknown", key: "REMOTE_TOKEN", token: "remote-secret" },
        }),
      },
    })

    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "unknown",
      })
      expect(requestCount).toBe(0)
    } finally {
      await resolver.shutdown()
      server.stop(true)
    }
  })

  test("rejects active organization accounts before OpenCode config can perform a remote fetch", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-active-account-observer-"))
    const dataHome = join(cwd, "data")
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1
        return Response.json({ config: {} })
      },
    })
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: dataHome,
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
      },
    })

    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "connected",
      })
      const db = new Database(join(dataHome, "opencode", "opencode-local.db"))
      try {
        db.run(
          "INSERT INTO account (id, email, url, access_token, refresh_token, token_expiry, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ["account-fixture", "fixture@example.test", `http://127.0.0.1:${server.port}`, "access-secret", "refresh-secret", Date.now() + 60_000, Date.now(), Date.now()],
        )
        db.run(
          "INSERT INTO account_state (id, active_account_id, active_org_id) VALUES (?, ?, ?)",
          [1, "account-fixture", "organization-fixture"],
        )
      } finally {
        db.close()
      }

      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "unknown",
      })
      expect(requestCount).toBe(0)
    } finally {
      await resolver.shutdown()
      server.stop(true)
    }
  })

  test("projects local config without package installation or the OpenCode config service", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-local-config-observer-"))
    const configDir = join(cwd, ".opencode")
    const modelsPath = join(cwd, "models.json")
    await mkdir(configDir)
    await writeFile(join(configDir, "opencode.json"), JSON.stringify({
      provider: { google: { blacklist: ["gemini-2.5-flash"] } },
    }), "utf8")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
      },
    })

    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "unavailable",
        credential_connection_status: "connected",
      })
      expect(existsSync(join(configDir, "package.json"))).toBe(false)
      expect(existsSync(join(configDir, "package-lock.json"))).toBe(false)
      expect(existsSync(join(configDir, "node_modules"))).toBe(false)
      const observerSource = await Bun.file(join(import.meta.dir, "../../../opencode-side/executor-model-readiness-observer.ts")).text()
      expect(observerSource).not.toContain("Config.Service")
    } finally {
      await resolver.shutdown()
    }
  })

  test("ignores root project config when pinned OpenCode project config is disabled", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-disabled-project-config-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(join(cwd, "opencode.json"), JSON.stringify({
      provider: { google: { blacklist: ["gemini-2.5-flash"] } },
    }), "utf8")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
      },
    })

    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "connected",
      })
    } finally {
      await resolver.shutdown()
    }
  })

  test("retains earlier plugin authority when a later config source declares an empty list", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-plugin-precedence-observer-"))
    const globalConfigDir = join(cwd, "config", "opencode")
    const modelsPath = join(cwd, "models.json")
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(join(globalConfigDir, "opencode.json"), JSON.stringify({ plugin: ["fixture-provider-plugin"] }), "utf8")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }),
      },
    })

    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "unknown",
      })
    } finally {
      await resolver.shutdown()
    }
  })

  test("fails closed when external plugin authority can change selected provider models", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-plugin-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ["fixture-provider-plugin"] }),
      },
    })
    const observed = await resolver.observe(selection)
    expect(observed).toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
    expect(JSON.stringify(observed)).not.toMatch(/fixture|plugin|secret|auth/i)
    await resolver.shutdown()
  })

  test("pure mode ignores configured and auto-discovered external plugins like pinned OpenCode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-pure-plugin-observer-"))
    const modelsPath = join(cwd, "models.json")
    await mkdir(join(cwd, ".opencode", "plugin"), { recursive: true })
    await writeFile(join(cwd, "opencode.json"), JSON.stringify({ plugin: ["fixture-provider-plugin"] }), "utf8")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
        OPENCODE_PURE: "1",
      },
    })
    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "connected",
      })
    } finally {
      await resolver.shutdown()
    }
  })

  test("pure mode still fails closed on pinned OpenCode legacy global configuration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-pure-legacy-config-observer-"))
    const globalConfigDir = join(cwd, "config", "opencode")
    const modelsPath = join(cwd, "models.json")
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(join(globalConfigDir, "config"), "disabled_providers = [\"google\"]\n", "utf8")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
        OPENCODE_PURE: "1",
      },
    })
    try {
      await expect(resolver.observe(selection)).resolves.toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "unknown",
      })
    } finally {
      await resolver.shutdown()
    }
  })

  test("accepts only stored credential types the pinned provider path can load", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-auth-type-observer-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: { "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash") },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, "config"),
        XDG_DATA_HOME: join(cwd, "data"),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          google: { type: "oauth", refresh: "stale-refresh", access: "stale-access", expires: 4_102_444_800_000 },
        }),
      },
    })
    const observed = await resolver.observe(selection)
    expect(observed).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })
    expect(JSON.stringify(observed)).not.toMatch(/oauth|stale|refresh|access|auth/i)
    await resolver.shutdown()
  })

  const productionFilterCases = [
    {
      name: "configured model blacklist",
      model_id: "gemini-2.5-flash",
      provider: { blacklist: ["gemini-2.5-flash"] },
      experimental: false,
      expected: "unavailable",
    },
    {
      name: "configured model whitelist",
      model_id: "gemini-2.5-flash",
      provider: { whitelist: ["another-model"] },
      experimental: false,
      expected: "unavailable",
    },
    { name: "experimental model default", model_id: "alpha", provider: {}, experimental: false, expected: "unavailable" },
    {
      name: "catalog status retained by configured model override",
      model_id: "alpha",
      provider: { models: { alpha: { options: { temperature: 0 } } } },
      experimental: false,
      expected: "unavailable",
    },
    {
      name: "catalog status retained through configured model id alias",
      model_id: "gemini-2.5-flash",
      provider: { models: { "gemini-2.5-flash": { id: "alpha" } } },
      experimental: false,
      expected: "unavailable",
    },
    {
      name: "unmatched configured model id defaults active",
      model_id: "alpha",
      provider: { models: { alpha: { id: "custom-google-api-model" } } },
      experimental: false,
      expected: "available",
    },
    { name: "explicit experimental model enablement", model_id: "alpha", provider: {}, experimental: true, expected: "available" },
    { name: "deprecated model", model_id: "deprecated", provider: {}, experimental: false, expected: "unavailable" },
  ] as const

  for (const filterCase of productionFilterCases) test(`matches OpenCode ${filterCase.name} filtering`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nxl-opencode-production-filters-"))
    const modelsPath = join(cwd, "models.json")
    await writeFile(modelsPath, JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        models: {
          "gemini-2.5-flash": catalogModel("gemini-2.5-flash", "Gemini 2.5 Flash"),
          alpha: catalogModel("alpha", "Alpha", { status: "alpha" }),
          deprecated: catalogModel("deprecated", "Deprecated", { status: "deprecated" }),
        },
      },
    }), "utf8")
    const resolver = createProductionOpenCodeExecutorReadinessResolver({
      projectDir: cwd,
      env: {
        HOME: cwd,
        XDG_CONFIG_HOME: join(cwd, `config-${filterCase.model_id}`),
        XDG_DATA_HOME: join(cwd, `data-${filterCase.model_id}`),
        OPENCODE_MODELS_PATH: modelsPath,
        OPENCODE_AUTH_CONTENT: JSON.stringify({ google: { type: "api", key: "fixture-secret" } }),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { google: filterCase.provider } }),
        ...(filterCase.experimental ? { OPENCODE_ENABLE_EXPERIMENTAL_MODELS: "1" } : {}),
      },
    })
    try {
      await expect(resolver.observe(Object.freeze({ ...selection, model_id: filterCase.model_id }))).resolves.toMatchObject({
        provider_availability_status: filterCase.expected,
      })
    } finally {
      await resolver.shutdown()
    }
  })

  test("returns exact bounded evidence and derives its evidence identity", async () => {
    const config = await fixture(echoFixture)
    const resolver = new OpenCodeExecutorModelReadinessResolver(config)
    const observed = await resolver.observe(selection)
    expect(observed).toMatchObject({
      observation_version: 1,
      selection_projection_hash: selection.projection_hash,
      provider_id: "google",
      model_id: "gemini-2.5-flash",
      credential_binding_id: "credential-executor-google-primary",
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })
    expect(observed.evidence_id).toMatch(/^executor-readiness-v1-[a-f0-9]{32}$/)
    expect(JSON.stringify(observed)).not.toMatch(/auth|environment|header|url|path|plugin|catalog/i)
    await resolver.shutdown()
  })

  test("fails closed on every exact identity mismatch", async () => {
    for (const field of ["selection_projection_hash", "provider_id", "model_id", "credential_binding_id"] as const) {
      const config = await fixture(echoFixture.replace(`input.${field}`, `"wrong"`))
      const resolver = new OpenCodeExecutorModelReadinessResolver(config)
      await expect(resolver.observe(selection)).rejects.toThrow("identity")
      await resolver.shutdown()
    }
  })

  test("preserves unknown partial evidence and never infers readiness", async () => {
    const source = echoFixture
      .replace('"available"', '"unknown"')
      .replace('"connected"', '"unknown"')
    const resolver = new OpenCodeExecutorModelReadinessResolver(await fixture(source))
    await expect(resolver.observe(selection)).resolves.toMatchObject({
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
    })
    await resolver.shutdown()
  })

  test("rejects malformed, duplicate, oversized, unknown-key, and nonzero observations", async () => {
    const sources = [
      `console.log("not-json")`,
      `${echoFixture}\nconsole.log("duplicate")`,
      `console.log("x".repeat(5000))`,
      echoFixture.replace('credential_connection_status: "connected"', 'credential_connection_status: "connected", extra: true'),
      `console.log('{"protocol_version":1,"protocol_version":1,"selection_projection_hash":"${selection.projection_hash}","provider_id":"google","model_id":"gemini-2.5-flash","credential_binding_id":"credential-executor-google-primary","provider_availability_status":"available","credential_connection_status":"connected"}')`,
      `process.exit(7)`,
      `process.kill(process.pid, "SIGTERM")`,
    ]
    for (const source of sources) {
      const resolver = new OpenCodeExecutorModelReadinessResolver({ ...(await fixture(source)), maxOutputBytes: 2048 })
      await expect(resolver.observe(selection)).rejects.toThrow("Executor readiness observation failed")
      await resolver.shutdown()
    }
  })

  test("never publishes child errors, stderr, paths, headers, environment names, or auth material", async () => {
    const leaked = "https://observer.invalid/path NXL_SECRET_TOKEN Authorization auth.json plugin catalog raw-secret"
    const resolver = new OpenCodeExecutorModelReadinessResolver(await fixture(`
process.stderr.write(${JSON.stringify(leaked)});
throw new Error(${JSON.stringify(leaked)});
`))
    let message = ""
    try {
      await resolver.observe(selection)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe("Executor readiness observation failed: observer process did not complete")
    expect(message).not.toContain("NXL_SECRET_TOKEN")
    expect(message).not.toMatch(/https?:|authorization|auth\.json|plugin|catalog|raw-secret/i)
    await resolver.shutdown()
  })

  test("bounds timeout and shutdown without orphaning an observation", async () => {
    const slow = `setInterval(() => {}, 1000)`
    const timed = new OpenCodeExecutorModelReadinessResolver({ ...(await fixture(slow)), timeoutMs: 20 })
    await expect(timed.observe(selection)).rejects.toThrow("timed out")
    await timed.shutdown()

    const draining = new OpenCodeExecutorModelReadinessResolver({ ...(await fixture(slow)), timeoutMs: 10_000 })
    const pending = draining.observe(selection)
    await Bun.sleep(20)
    await draining.shutdown()
    await expect(pending).rejects.toThrow("shutdown")
    expect(draining.activeCount()).toBe(0)
  })

  test("reactivates only through the explicit lifecycle start hook after shutdown", async () => {
    const resolver = new OpenCodeExecutorModelReadinessResolver(await fixture(echoFixture))
    await expect(resolver.observe(selection)).resolves.toMatchObject({ provider_availability_status: "available" })
    await resolver.shutdown()
    await expect(resolver.observe(selection)).rejects.toThrow("shutdown")
    await resolver.start()
    await expect(resolver.observe(selection)).resolves.toMatchObject({ provider_availability_status: "available" })
    await resolver.shutdown()
  })

  test("bounds concurrency and keeps observations identity-isolated", async () => {
    const resolver = new OpenCodeExecutorModelReadinessResolver({ ...(await fixture(echoFixture)), maxConcurrency: 1 })
    const first = resolver.observe(selection)
    await expect(resolver.observe(selection)).rejects.toThrow("capacity")
    await expect(first).resolves.toMatchObject({ provider_id: "google", model_id: "gemini-2.5-flash" })
    await resolver.shutdown()
  })

  test("rejects proxies, accessors, symbols, sparse arrays, and caller mutation without executing them", async () => {
    let traps = 0
    const proxy = new Proxy({ command: process.execPath, args: [], cwd: "/tmp" }, {
      ownKeys() { traps += 1; return [] },
      getOwnPropertyDescriptor() { traps += 1; return undefined },
      get() { traps += 1; return undefined },
    })
    expect(() => new OpenCodeExecutorModelReadinessResolver(proxy)).toThrow("Proxy")
    expect(traps).toBe(0)

    let getters = 0
    const accessor = Object.defineProperty({ args: [], cwd: "/tmp" }, "command", {
      enumerable: true,
      get() { getters += 1; return process.execPath },
    })
    expect(() => new OpenCodeExecutorModelReadinessResolver(accessor as never)).toThrow("data fields")
    expect(getters).toBe(0)
    const symbolic = { command: process.execPath, args: [], cwd: "/tmp", [Symbol("hidden")]: true }
    expect(() => new OpenCodeExecutorModelReadinessResolver(symbolic as never)).toThrow("unknown")
    expect(() => new OpenCodeExecutorModelReadinessResolver({ command: process.execPath, args: new Array(1), cwd: "/tmp" })).toThrow("dense")

    const config = await fixture(echoFixture)
    const args = [...config.args]
    const env = { OBSERVER_FIXTURE: "before" }
    const resolver = new OpenCodeExecutorModelReadinessResolver({ ...config, args, env })
    args[0] = "/does/not/exist"
    env.OBSERVER_FIXTURE = "after"
    await expect(resolver.observe(selection)).resolves.toMatchObject({ provider_id: "google" })
    await resolver.shutdown()

    const runtimeEnv = Object.create(Object.prototype) as Record<string, string>
    runtimeEnv.VISIBLE = "accepted"
    Object.defineProperty(runtimeEnv, "RUNTIME_INTERNAL", { enumerable: false, get: () => "ignored" })
    const runtimeResolver = new OpenCodeExecutorModelReadinessResolver({ ...config, env: runtimeEnv })
    await expect(runtimeResolver.observe(selection)).resolves.toMatchObject({ provider_id: "google" })
    await runtimeResolver.shutdown()
  })
})
