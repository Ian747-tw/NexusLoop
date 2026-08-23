const MAX_INPUT_BYTES = 2_048
const OPENAI_OAUTH_ALLOWED_MODELS = new Set([
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
])

type Request = {
  protocol_version: 1
  selection_projection_hash: string
  provider_id: string
  model_id: string
  credential_binding_id: string
}

async function main(): Promise<void> {
  const input = await readRequest()
  let providerAvailability: "available" | "unavailable" | "unknown" = "unknown"
  let credentialConnection: "connected" | "disconnected" | "unknown" = "unknown"
  try {
    if (process.env.OPENCODE_DISABLE_MODELS_FETCH !== "1") throw new Error("models refresh is not disabled")
    const { AppRuntime } = await import("../upstream/packages/opencode/src/effect/app-runtime.ts")
    const [{ Instance }, { ModelsDev }, { Config }, { Auth }, { Flag }] = await Promise.all([
      import("../upstream/packages/opencode/src/project/instance.ts"),
      import("../upstream/packages/opencode/src/provider/index.ts"),
      import("../upstream/packages/opencode/src/config/index.ts"),
      import("../upstream/packages/opencode/src/auth/index.ts"),
      import("../upstream/packages/opencode/src/flag/flag.ts"),
    ])
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const [catalog, config, auth] = await Promise.all([
          ModelsDev.get(),
          AppRuntime.runPromise(Config.Service.use((service) => service.get())),
          AppRuntime.runPromise(Auth.Service.use((service) => service.get(input.provider_id))),
        ])
        const externalPluginsEnabled = !Flag.OPENCODE_PURE
          && ((config.plugin?.length ?? 0) > 0 || (config.plugin_origins?.length ?? 0) > 0)
        if (externalPluginsEnabled) return
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
        const disabled = new Set(config.disabled_providers ?? [])
        const allowed = (enabled ? enabled.has(input.provider_id) : true) && !disabled.has(input.provider_id)
        const catalogProvider = allowed && Object.hasOwn(catalog, input.provider_id) ? catalog[input.provider_id] : undefined
        const configuredProvider = allowed && config.provider && Object.hasOwn(config.provider, input.provider_id)
          ? config.provider[input.provider_id]
          : undefined
        if (new Set(["anthropic", "google", "openai"]).has(input.provider_id)) {
          const envNames = configuredProvider?.env ?? catalogProvider?.env ?? []
          const hasEnvironmentCredential = Array.isArray(envNames)
            && envNames.some((name) => typeof name === "string" && typeof process.env[name] === "string" && process.env[name]!.length > 0)
          const hasStoredCredential = auth?.type === "api"
            || (input.provider_id === "openai" && auth?.type === "oauth")
          const hasConfiguredCredential = typeof configuredProvider?.options?.apiKey === "string"
            && configuredProvider.options.apiKey.length > 0
          credentialConnection = hasEnvironmentCredential || hasStoredCredential || hasConfiguredCredential ? "connected" : "disconnected"
        }
        if (Object.keys(catalog).length === 0 && !config.provider) return
        const configuredModel = configuredProvider?.models && Object.hasOwn(configuredProvider.models, input.model_id)
          ? configuredProvider.models[input.model_id]
          : undefined
        const catalogModel = catalogProvider?.models && Object.hasOwn(catalogProvider.models, input.model_id)
          ? catalogProvider.models[input.model_id]
          : undefined
        const configuredApiModelId = configuredModel?.id
        const catalogModelForConfiguredId = configuredApiModelId === undefined
          ? catalogModel
          : catalogProvider?.models && Object.hasOwn(catalogProvider.models, configuredApiModelId)
            ? catalogProvider.models[configuredApiModelId]
            : undefined
        const model = configuredModel ?? catalogModel
        const modelStatus = configuredModel?.status ?? catalogModelForConfiguredId?.status
        const apiModelId = configuredModel?.id ?? catalogModelForConfiguredId?.id ?? input.model_id
        const oauthModelFiltered = input.provider_id === "openai"
          && auth?.type === "oauth"
          && !openAiOauthAllowsModel(input.model_id, apiModelId)
        const filtered = input.model_id === "gpt-5-chat-latest"
          || (input.provider_id === "openrouter" && input.model_id === "openai/gpt-5-chat")
          || oauthModelFiltered
          || (modelStatus === "alpha" && !Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS)
          || modelStatus === "deprecated"
          || configuredProvider?.blacklist?.includes(input.model_id) === true
          || (configuredProvider?.whitelist !== undefined && !configuredProvider.whitelist.includes(input.model_id))
        providerAvailability = model && !filtered ? "available" : "unavailable"
      },
    })
  } catch {
    providerAvailability = "unknown"
    credentialConnection = "unknown"
  }
  writeResponse({
    protocol_version: 1,
    selection_projection_hash: input.selection_projection_hash,
    provider_id: input.provider_id,
    model_id: input.model_id,
    credential_binding_id: input.credential_binding_id,
    provider_availability_status: providerAvailability,
    credential_connection_status: credentialConnection,
  })
}

function openAiOauthAllowsModel(modelId: string, apiModelId: string): boolean {
  if (modelId.includes("codex")) return true
  if (OPENAI_OAUTH_ALLOWED_MODELS.has(apiModelId)) return true
  const version = apiModelId.match(/^gpt-(\d+\.\d+)/)?.[1]
  return version !== undefined && Number.parseFloat(version) > 5.4
}

async function readRequest(): Promise<Request> {
  let bytes = 0
  let text = ""
  for await (const chunk of Bun.stdin.stream()) {
    bytes += chunk.byteLength
    if (bytes > MAX_INPUT_BYTES) throw new Error("request too large")
    text += new TextDecoder().decode(chunk)
  }
  const value = JSON.parse(text)
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid request")
  const keys = ["protocol_version", "selection_projection_hash", "provider_id", "model_id", "credential_binding_id"]
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("invalid request")
  if (value.protocol_version !== 1 || typeof value.selection_projection_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.selection_projection_hash)) throw new Error("invalid request")
  if (typeof value.provider_id !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.provider_id)) throw new Error("invalid request")
  if (typeof value.model_id !== "string" || value.model_id.length < 1 || value.model_id.length > 240 || /[\u0000-\u001f\u007f]/.test(value.model_id)) throw new Error("invalid request")
  if (typeof value.credential_binding_id !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.credential_binding_id)) throw new Error("invalid request")
  return value as Request
}

function writeResponse(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`, () => process.exit(0))
}

void main().catch(() => process.exit(2))
