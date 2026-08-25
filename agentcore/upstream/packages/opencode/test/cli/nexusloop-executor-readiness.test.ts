import { describe, expect, test } from "bun:test"
import {
  EXECUTOR_READINESS_REQUEST_VERSION,
  observeExecutorReadiness,
  parseExecutorReadinessRequestText,
  parseExecutorReadinessRequestValue,
} from "../../src/cli/cmd/nexusloop/executor-readiness"

const request = {
  request_version: EXECUTOR_READINESS_REQUEST_VERSION,
  selection_projection_hash: "a".repeat(64),
  provider_id: "openai",
  model_id: "gpt-5",
  credential_binding_id: "executor-primary",
}

const catalog = {
  openai: {
    id: "openai",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-5": { id: "gpt-5" },
    },
  },
}

describe("NexusLoop Executor readiness protocol", () => {
  test("reports one exact catalog model and credential source independently", () => {
    const connected = observeExecutorReadiness(request, {
      catalog,
      config_fragments: [],
      auth: {},
      env: { OPENAI_API_KEY: "secret-value" },
      observation_complete: true,
    })
    expect(connected).toMatchObject({
      observation_version: 1,
      selection_projection_hash: request.selection_projection_hash,
      provider_id: "openai",
      model_id: "gpt-5",
      credential_binding_id: "executor-primary",
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })
    expect(JSON.stringify(connected)).not.toContain("secret-value")

    const disconnected = observeExecutorReadiness(request, {
      catalog,
      config_fragments: [],
      auth: {},
      env: {},
      observation_complete: true,
    })
    expect(disconnected.credential_connection_status).toBe("disconnected")
  })

  test("treats only exact free built-in OpenCode models as publicly connected", () => {
    const opencodeRequest = { ...request, provider_id: "opencode", model_id: "gpt-5-nano" }
    const source = {
      catalog: {
        opencode: {
          id: "opencode",
          env: ["OPENCODE_API_KEY"],
          models: { "gpt-5-nano": { id: "gpt-5-nano", cost: { input: 0, output: 0 } } },
        },
      },
      config_fragments: [],
      auth: {},
      env: {},
      observation_complete: true,
    }
    expect(observeExecutorReadiness(opencodeRequest, source)).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })
    expect(observeExecutorReadiness(opencodeRequest, {
      ...source,
      catalog: {
        opencode: {
          id: "opencode",
          env: ["OPENCODE_API_KEY"],
          models: { "gpt-5-nano": { id: "gpt-5-nano", cost: { input: 1, output: 0 } } },
        },
      },
    }).credential_connection_status).toBe("disconnected")
    expect(observeExecutorReadiness(opencodeRequest, {
      ...source,
      config_fragments: [{ provider: { opencode: { models: { "gpt-5-nano": { cost: { input: 1, output: 0 } } } } } }],
    })).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "disconnected",
    })
    expect(observeExecutorReadiness(opencodeRequest, {
      ...source,
      config_fragments: [{ provider: { opencode: { models: { "gpt-5-nano": { cost: { output: 1 } } } } } }],
    }).credential_connection_status).toBe("connected")
    for (const [model_id, model] of [
      ["configured-only", {}],
      ["configured-alias", { id: "non-catalog-target" }],
    ] as const) {
      expect(observeExecutorReadiness({ ...opencodeRequest, model_id }, {
        ...source,
        config_fragments: [{ provider: { opencode: { models: { [model_id]: model } } } }],
      })).toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "connected",
      })
    }
  })

  test("distinguishes unavailable from incomplete or ambiguous observations", () => {
    expect(
      observeExecutorReadiness({ ...request, model_id: "missing" }, {
        catalog,
        config_fragments: [],
        auth: {},
        env: {},
        observation_complete: true,
      }).provider_availability_status,
    ).toBe("unavailable")
    expect(
      observeExecutorReadiness({ ...request, provider_id: "missing" }, {
        catalog,
        config_fragments: [],
        auth: {},
        env: {},
        observation_complete: true,
      }).provider_availability_status,
    ).toBe("unavailable")
    expect(
      observeExecutorReadiness(request, {
        catalog: {},
        config_fragments: [],
        auth: {},
        env: {},
        observation_complete: false,
      }).provider_availability_status,
    ).toBe("unknown")
    expect(
      observeExecutorReadiness(request, {
        catalog,
        config_fragments: [{ plugin: ["file:///tmp/provider.ts"] }],
        auth: {},
        env: {},
        observation_complete: true,
      }).provider_availability_status,
    ).toBe("unknown")
  })

  test("applies OpenCode hard-removal and model status filters", () => {
    const filteredCatalog = {
      openai: {
        id: "openai",
        env: [],
        models: {
          "gpt-5-chat-latest": { id: "gpt-5-chat-latest" },
          alpha: { id: "alpha", status: "alpha" },
          deprecated: { id: "deprecated", status: "deprecated" },
          beta: { id: "beta", status: "beta" },
        },
      },
      openrouter: {
        id: "openrouter",
        env: [],
        models: { "openai/gpt-5-chat": { id: "openai/gpt-5-chat" } },
      },
    }
    for (const [provider_id, model_id] of [
      ["openai", "gpt-5-chat-latest"],
      ["openai", "alpha"],
      ["openai", "deprecated"],
      ["openrouter", "openai/gpt-5-chat"],
    ] as const) {
      expect(observeExecutorReadiness({ ...request, provider_id, model_id }, {
        catalog: filteredCatalog,
        config_fragments: [],
        auth: {},
        env: {},
        observation_complete: true,
      }).provider_availability_status).toBe("unavailable")
    }
    expect(observeExecutorReadiness({ ...request, model_id: "alpha" }, {
      catalog: filteredCatalog,
      config_fragments: [],
      auth: {},
      env: { OPENCODE_ENABLE_EXPERIMENTAL_MODELS: "true" },
      observation_complete: true,
    }).provider_availability_status).toBe("available")
    expect(observeExecutorReadiness({ ...request, model_id: "beta" }, {
      catalog: filteredCatalog,
      config_fragments: [],
      auth: {},
      env: {},
      observation_complete: true,
    }).provider_availability_status).toBe("available")
    expect(observeExecutorReadiness({ ...request, model_id: "gpt-5-chat-latest" }, {
      catalog: {},
      config_fragments: [{ provider: { openai: { models: { "gpt-5-chat-latest": {} } } } }],
      auth: {},
      env: {},
      observation_complete: true,
    }).provider_availability_status).toBe("unavailable")
    expect(observeExecutorReadiness({ ...request, model_id: "deprecated" }, {
      catalog: filteredCatalog,
      config_fragments: [{ provider: { openai: { models: { deprecated: { name: "overlay" } } } } }],
      auth: {},
      env: {},
      observation_complete: true,
    }).provider_availability_status).toBe("unavailable")
    expect(observeExecutorReadiness(request, {
      catalog,
      config_fragments: [
        { provider: { openai: { models: { "gpt-5": { status: "deprecated" } } } } },
        { provider: { openai: { models: { "gpt-5": { name: "later overlay" } } } } },
      ],
      auth: {},
      env: {},
      observation_complete: true,
    }).provider_availability_status).toBe("unavailable")
  })

  test("inherits catalog status for configured aliases", () => {
    const aliasCatalog = {
      openai: {
        id: "openai",
        env: [],
        models: { old: { id: "old", status: "deprecated" } },
      },
    }
    expect(observeExecutorReadiness({ ...request, model_id: "alias" }, {
      catalog: aliasCatalog,
      config_fragments: [{ provider: { openai: { models: { alias: { id: "old" } } } } }],
      auth: {},
      env: {},
      observation_complete: true,
    }).provider_availability_status).toBe("unavailable")

    expect(observeExecutorReadiness({ ...request, model_id: "alias" }, {
      catalog: { openai: { id: "openai", env: [], models: {} } },
      config_fragments: [{
        provider: {
          openai: {
            models: {
              old: { status: "deprecated" },
              alias: { id: "old" },
            },
          },
        },
      }],
      auth: {},
      env: {},
      observation_complete: true,
    }).provider_availability_status).toBe("unavailable")
  })

  test("marks selected dynamic provider packages as unknown", () => {
    for (const selected of [
      { npm: "custom-provider", models: { exact: {} } },
      { models: { exact: { provider: { npm: "file:///tmp/provider.ts" } } } },
    ]) {
      expect(observeExecutorReadiness({ ...request, provider_id: "custom", model_id: "exact" }, {
        catalog: {},
        config_fragments: [{ provider: { custom: selected } }],
        auth: { custom: { type: "api", key: "secret" } },
        env: {},
        observation_complete: true,
      })).toMatchObject({
        provider_availability_status: "unknown",
        credential_connection_status: "connected",
      })
    }
  })

  test("ignores external plugin authority in OpenCode pure mode", () => {
    expect(observeExecutorReadiness(request, {
      catalog,
      config_fragments: [{ plugin: ["dynamic-provider"] }],
      auth: {},
      env: { OPENCODE_PURE: "true" },
      observation_complete: true,
    }).provider_availability_status).toBe("available")
  })

  test("does not infer connection for provider-specific multi-field credentials", () => {
    const cloudflare = {
      "cloudflare-ai-gateway": {
        id: "cloudflare-ai-gateway",
        env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID", "CLOUDFLARE_API_TOKEN"],
        models: { exact: { id: "exact" } },
      },
    }
    for (const env of [
      { CLOUDFLARE_ACCOUNT_ID: "account" },
      {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_GATEWAY_ID: "gateway",
        CLOUDFLARE_API_TOKEN: "token",
      },
    ]) {
      expect(observeExecutorReadiness({ ...request, provider_id: "cloudflare-ai-gateway", model_id: "exact" }, {
        catalog: cloudflare,
        config_fragments: [],
        auth: {},
        env,
        observation_complete: true,
      })).toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "unknown",
      })
    }

    expect(observeExecutorReadiness(
      { ...request, provider_id: "cloudflare-workers-ai", model_id: "exact" },
      {
        catalog: {
          "cloudflare-workers-ai": {
            id: "cloudflare-workers-ai",
            env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
            models: { exact: { id: "exact" } },
          },
        },
        config_fragments: [{
          provider: { "cloudflare-workers-ai": { options: { apiKey: "configured-secret" } } },
        }],
        auth: {},
        env: {},
        observation_complete: true,
      },
    )).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "unknown",
    })

    expect(observeExecutorReadiness(
      { ...request, provider_id: "cloudflare-workers-ai", model_id: "configured-only" },
      {
        catalog: {},
        config_fragments: [{
          provider: {
            "cloudflare-workers-ai": {
              options: { apiKey: "configured-secret" },
              models: { "configured-only": {} },
            },
          },
        }],
        auth: {},
        env: {},
        observation_complete: true,
      },
    )).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "unknown",
    })

    for (const provider of ["cloudflare-workers-ai", "cloudflare-ai-gateway"]) {
      const configuredEndpoint = observeExecutorReadiness(
        { ...request, provider_id: provider, model_id: "configured-endpoint" },
        {
          catalog: {},
          config_fragments: [{
            provider: {
              [provider]: {
                options: { apiKey: "configured-secret", baseURL: "https://configured.example.invalid" },
                models: { "configured-endpoint": {} },
              },
            },
          }],
          auth: {},
          env: {},
          observation_complete: true,
        },
      )
      expect(configuredEndpoint).toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "connected",
      })
      expect(JSON.stringify(configuredEndpoint)).not.toMatch(/configured-secret|configured\.example/)

      const storedEndpoint = observeExecutorReadiness(
        { ...request, provider_id: provider, model_id: "configured-endpoint" },
        {
          catalog: {},
          config_fragments: [{
            provider: {
              [provider]: {
                options: { baseURL: "https://configured.example.invalid" },
                models: { "configured-endpoint": {} },
              },
            },
          }],
          auth: { [provider]: { type: "api", key: "stored-secret" } },
          env: {},
          observation_complete: true,
        },
      )
      expect(storedEndpoint).toMatchObject({
        provider_availability_status: "available",
        credential_connection_status: "connected",
      })
      expect(JSON.stringify(storedEndpoint)).not.toMatch(/stored-secret|configured\.example/)

      const catalogEnv = provider === "cloudflare-workers-ai"
        ? ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"]
        : ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID", "CLOUDFLARE_API_TOKEN"]
      const ignoredAmbient = observeExecutorReadiness(
        { ...request, provider_id: provider, model_id: "configured-endpoint" },
        {
          catalog: {
            [provider]: {
              id: provider,
              env: catalogEnv,
              models: { "configured-endpoint": { id: "configured-endpoint" } },
            },
          },
          config_fragments: [{
            provider: { [provider]: { options: { baseURL: "https://configured.example.invalid" } } },
          }],
          auth: {},
          env: { [catalogEnv.at(-1)!]: "ambient-secret" },
          observation_complete: true,
        },
      )
      expect(ignoredAmbient.credential_connection_status).toBe("disconnected")

      const configuredEnvironment = observeExecutorReadiness(
        { ...request, provider_id: provider, model_id: "configured-endpoint" },
        {
          catalog: {},
          config_fragments: [{
            provider: {
              [provider]: {
                env: ["CUSTOM_PROVIDER_TOKEN"],
                options: { baseURL: "https://configured.example.invalid" },
                models: { "configured-endpoint": {} },
              },
            },
          }],
          auth: {},
          env: { CUSTOM_PROVIDER_TOKEN: "effective-secret" },
          observation_complete: true,
        },
      )
      expect(configuredEnvironment.credential_connection_status).toBe("connected")
      expect(JSON.stringify(configuredEnvironment)).not.toMatch(/effective-secret|configured\.example/)
    }

    const explicit = observeExecutorReadiness(
      { ...request, provider_id: "azure", model_id: "exact" },
      {
        catalog: {
          azure: {
            id: "azure",
            env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
            models: { exact: { id: "exact" } },
          },
        },
        config_fragments: [{ provider: { azure: { options: { apiKey: "configured-secret" } } } }],
        auth: {},
        env: {},
        observation_complete: true,
      },
    )
    expect(explicit).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })
    expect(JSON.stringify(explicit)).not.toContain("configured-secret")
  })

  test("recognizes the pinned GitLab token sources without exposing them", () => {
    const gitlabRequest = { ...request, provider_id: "gitlab", model_id: "duo-chat" }
    const gitlabCatalog = {
      gitlab: {
        id: "gitlab",
        env: ["GITLAB_TOKEN"],
        models: { "duo-chat": { id: "duo-chat" } },
      },
    }
    const stored = observeExecutorReadiness(gitlabRequest, {
      catalog: gitlabCatalog,
      config_fragments: [],
      auth: { gitlab: { type: "api", key: "stored-gitlab-secret" } },
      env: {},
      observation_complete: true,
    })
    expect(stored.credential_connection_status).toBe("connected")
    expect(JSON.stringify(stored)).not.toContain("stored-gitlab-secret")

    const oauth = observeExecutorReadiness(gitlabRequest, {
      catalog: gitlabCatalog,
      config_fragments: [],
      auth: { gitlab: { type: "oauth", access: "oauth-gitlab-secret" } },
      env: {},
      observation_complete: true,
    })
    expect(oauth.credential_connection_status).toBe("connected")
    expect(JSON.stringify(oauth)).not.toContain("oauth-gitlab-secret")

    const environment = observeExecutorReadiness(gitlabRequest, {
      catalog: gitlabCatalog,
      config_fragments: [],
      auth: {},
      env: { GITLAB_TOKEN: "environment-gitlab-secret" },
      observation_complete: true,
    })
    expect(environment.credential_connection_status).toBe("connected")
    expect(JSON.stringify(environment)).not.toContain("environment-gitlab-secret")
  })

  test("keeps multi-field generic environment credentials unknown", () => {
    const google = {
      google: {
        id: "google",
        env: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
        models: { gemini: { id: "gemini" } },
      },
    }
    expect(observeExecutorReadiness({ ...request, provider_id: "google", model_id: "gemini" }, {
      catalog: google,
      config_fragments: [],
      auth: {},
      env: { GEMINI_API_KEY: "secret" },
      observation_complete: true,
    })).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "unknown",
    })

    const privateMode = {
      "privatemode-ai": {
        id: "privatemode-ai",
        env: ["PRIVATEMODE_API_KEY", "PRIVATEMODE_ENDPOINT"],
        models: { exact: { id: "exact" } },
      },
    }
    expect(observeExecutorReadiness(
      { ...request, provider_id: "privatemode-ai", model_id: "exact" },
      {
        catalog: privateMode,
        config_fragments: [],
        auth: {},
        env: { PRIVATEMODE_ENDPOINT: "https://endpoint.example.invalid" },
        observation_complete: true,
      },
    ).credential_connection_status).toBe("unknown")
    const keyed = observeExecutorReadiness(
      { ...request, provider_id: "privatemode-ai", model_id: "exact" },
      {
        catalog: privateMode,
        config_fragments: [],
        auth: {},
        env: { PRIVATEMODE_API_KEY: "private-secret" },
        observation_complete: true,
      },
    )
    expect(keyed.credential_connection_status).toBe("unknown")
    expect(JSON.stringify(keyed)).not.toContain("private-secret")
  })

  test("requires provider and model identity to agree exactly", () => {
    const result = observeExecutorReadiness({ ...request, provider_id: "anthropic" }, {
      catalog,
      config_fragments: [],
      auth: { openai: { type: "api", key: "secret-value" } },
      env: {},
      observation_complete: true,
    })
    expect(result.provider_availability_status).toBe("unavailable")
    expect(result.credential_connection_status).toBe("disconnected")
  })

  test("uses exact local config authority without exposing it", () => {
    const result = observeExecutorReadiness(
      { ...request, provider_id: "custom", model_id: "Exact/Model" },
      {
        catalog: {},
        config_fragments: [
          {
            provider: {
              custom: {
                env: ["CUSTOM_EXECUTOR_KEY"],
                models: { "Exact/Model": { name: "Configured" } },
              },
            },
          },
        ],
        auth: { custom: { type: "api", key: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } },
        env: { CUSTOM_EXECUTOR_KEY: "header-value" },
        observation_complete: true,
      },
    )
    expect(result.provider_availability_status).toBe("available")
    expect(result.credential_connection_status).toBe("connected")
    expect(JSON.stringify(result)).not.toMatch(/CUSTOM_EXECUTOR_KEY|ghp_|header-value|Configured/)
  })

  test("fails closed for partial and unsupported credential semantics", () => {
    const oauth = observeExecutorReadiness(request, {
      catalog,
      config_fragments: [],
      auth: { openai: { type: "oauth", access: "secret", refresh: "secret", expires: 1 } },
      env: {},
      observation_complete: true,
    })
    expect(oauth.provider_availability_status).toBe("unavailable")
    expect(oauth.credential_connection_status).toBe("connected")

    const remote = observeExecutorReadiness(request, {
      catalog,
      config_fragments: [],
      auth: { "https://auth.example": { type: "wellknown", key: "TOKEN_ENV", token: "secret" } },
      env: {},
      observation_complete: false,
    })
    expect(remote.provider_availability_status).toBe("unknown")
    expect(remote.credential_connection_status).toBe("unknown")
    expect(JSON.stringify(remote)).not.toMatch(/auth\.example|TOKEN_ENV|secret/)
  })

  test("recognizes the built-in OpenAI OAuth credential path without broad OAuth inference", () => {
    const oauthCatalog = {
      openai: {
        id: "openai",
        env: ["OPENAI_API_KEY"],
        models: { "gpt-5.4": { id: "gpt-5.4" } },
      },
    }
    expect(observeExecutorReadiness({ ...request, model_id: "gpt-5.4" }, {
      catalog: oauthCatalog,
      config_fragments: [],
      auth: {
        openai: { type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: 0 },
      },
      env: {},
      observation_complete: true,
    })).toMatchObject({
      provider_availability_status: "available",
      credential_connection_status: "connected",
    })

    expect(observeExecutorReadiness({ ...request, provider_id: "custom" }, {
      catalog: { custom: { id: "custom", env: [], models: { "gpt-5": { id: "gpt-5" } } } },
      config_fragments: [],
      auth: {
        custom: { type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: 0 },
      },
      env: {},
      observation_complete: true,
    }).credential_connection_status).toBe("unknown")
  })

  test("applies the built-in OpenAI OAuth model allowlist before reporting availability", () => {
    const oauthCatalog = {
      openai: {
        id: "openai",
        env: ["OPENAI_API_KEY"],
        models: {
          "gpt-4o": { id: "gpt-4o" },
          "gpt-5.4": { id: "gpt-5.4" },
          alias: { id: "gpt-5.2-codex" },
        },
      },
    }
    const source = {
      catalog: oauthCatalog,
      config_fragments: [],
      auth: {
        openai: { type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: 0 },
      },
      env: {},
      observation_complete: true,
    }

    expect(observeExecutorReadiness({ ...request, model_id: "gpt-4o" }, source)).toMatchObject({
      provider_availability_status: "unavailable",
      credential_connection_status: "connected",
    })
    expect(observeExecutorReadiness({ ...request, model_id: "gpt-5.4" }, source).provider_availability_status)
      .toBe("available")
    expect(observeExecutorReadiness({ ...request, model_id: "alias" }, source).provider_availability_status)
      .toBe("available")
  })

  test("strict request parsing rejects malformed oversized duplicate and unknown authority", () => {
    const text = JSON.stringify(request)
    expect(parseExecutorReadinessRequestText(text)).toEqual(request)
    expect(() => parseExecutorReadinessRequestText("{")) .toThrow()
    expect(() => parseExecutorReadinessRequestText("x".repeat(5000))).toThrow()
    expect(() =>
      parseExecutorReadinessRequestText(
        `{"request_version":"${EXECUTOR_READINESS_REQUEST_VERSION}","selection_projection_hash":"${"a".repeat(64)}","provider_id":"openai","provider_id":"anthropic","model_id":"gpt-5","credential_binding_id":"executor-primary"}`,
      ),
    ).toThrow()
    expect(() => parseExecutorReadinessRequestText(JSON.stringify({ ...request, extra: true }))).toThrow()
  })

  test("value parsing rejects inherited accessors symbols sparse arrays and proxies without executing them", () => {
    let calls = 0
    const inherited = Object.create({ request_version: EXECUTOR_READINESS_REQUEST_VERSION })
    Object.assign(inherited, request)
    delete inherited.request_version
    expect(() => parseExecutorReadinessRequestValue(inherited)).toThrow()

    const accessor = { ...request }
    Object.defineProperty(accessor, "provider_id", { enumerable: true, get: () => { calls += 1; return "openai" } })
    expect(() => parseExecutorReadinessRequestValue(accessor)).toThrow()

    const symbol = { ...request, [Symbol("authority")]: "openai" }
    expect(() => parseExecutorReadinessRequestValue(symbol)).toThrow()

    const proxied = new Proxy({}, { ownKeys: () => { calls += 1; return [] } })
    expect(() => parseExecutorReadinessRequestValue(proxied)).toThrow()
    expect(calls).toBe(0)
  })

  test("output is deterministic and no callback, network, or write authority is accepted", () => {
    const source = {
      catalog,
      config_fragments: [],
      auth: {},
      env: { OPENAI_API_KEY: "secret-value" },
      observation_complete: true,
    }
    expect(observeExecutorReadiness(request, source)).toEqual(observeExecutorReadiness(request, source))
    expect(() => observeExecutorReadiness(request, { ...source, fetch: () => {} } as never)).toThrow()
    expect(() => observeExecutorReadiness(request, { ...source, write: () => {} } as never)).toThrow()
    expect(JSON.stringify(observeExecutorReadiness(request, source))).not.toMatch(/url|header|path|plugin|secret|OPENAI_API_KEY/i)
  })
})
