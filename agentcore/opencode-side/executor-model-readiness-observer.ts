const MAX_INPUT_BYTES = 2_048

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
    const [{ Instance }, { ModelsDev }, { Config }, { Auth }] = await Promise.all([
      import("../upstream/packages/opencode/src/project/instance.ts"),
      import("../upstream/packages/opencode/src/provider/index.ts"),
      import("../upstream/packages/opencode/src/config/index.ts"),
      import("../upstream/packages/opencode/src/auth/index.ts"),
    ])
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const [catalog, config, auth] = await Promise.all([
          ModelsDev.get(),
          AppRuntime.runPromise(Config.Service.use((service) => service.get())),
          AppRuntime.runPromise(Auth.Service.use((service) => service.get(input.provider_id))),
        ])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
        const disabled = new Set(config.disabled_providers ?? [])
        const allowed = (enabled ? enabled.has(input.provider_id) : true) && !disabled.has(input.provider_id)
        if (Object.keys(catalog).length === 0 && !config.provider) return
        const catalogProvider = allowed && Object.hasOwn(catalog, input.provider_id) ? catalog[input.provider_id] : undefined
        const configuredProvider = allowed && config.provider && Object.hasOwn(config.provider, input.provider_id)
          ? config.provider[input.provider_id]
          : undefined
        const models = configuredProvider?.models && Object.hasOwn(configuredProvider.models, input.model_id)
          ? configuredProvider.models
          : catalogProvider?.models
        providerAvailability = models && Object.hasOwn(models, input.model_id) ? "available" : "unavailable"
        if (!new Set(["anthropic", "google", "openai"]).has(input.provider_id)) {
          credentialConnection = "unknown"
          return
        }
        const envNames = configuredProvider?.env ?? catalogProvider?.env ?? []
        const hasEnvironmentCredential = Array.isArray(envNames)
          && envNames.some((name) => typeof name === "string" && typeof process.env[name] === "string" && process.env[name]!.length > 0)
        const hasStoredCredential = auth !== undefined
        const hasConfiguredCredential = typeof configuredProvider?.options?.apiKey === "string"
          && configuredProvider.options.apiKey.length > 0
        credentialConnection = hasEnvironmentCredential || hasStoredCredential || hasConfiguredCredential ? "connected" : "disconnected"
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
