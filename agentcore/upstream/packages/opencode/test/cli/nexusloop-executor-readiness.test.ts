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
  })

  test("recognizes catalog-declared alternative credential keys for generic providers", () => {
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
      credential_connection_status: "connected",
    })
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
