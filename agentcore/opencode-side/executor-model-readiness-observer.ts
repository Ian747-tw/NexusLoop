import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { captureConfigAuthority, configAuthorityUnchanged, replayConfigAuthority } from "./executor-readiness-config-snapshot"
import { pluginAuthorityRemainedAbsent, snapshotPluginAuthority } from "./executor-readiness-plugin-snapshot"

const MAX_INPUT_BYTES = 2_048
const MAX_CONFIG_FILE_BYTES = 65_536
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

type LocalConfig = {
  plugin?: unknown[]
  enabled_providers?: string[]
  disabled_providers?: string[]
  provider?: Record<string, {
    env?: string[]
    whitelist?: string[]
    blacklist?: string[]
    options?: { apiKey?: string }
    models?: Record<string, { id?: string; status?: "alpha" | "beta" | "deprecated" }>
  }>
}

async function main(): Promise<void> {
  const input = await readRequest()
  let providerAvailability: "available" | "unavailable" | "unknown" = "unknown"
  let credentialConnection: "connected" | "disconnected" | "unknown" = "unknown"
  try {
    if (process.env.OPENCODE_DISABLE_MODELS_FETCH !== "1") throw new Error("models refresh is not disabled")
    const { AppRuntime } = await import("../upstream/packages/opencode/src/effect/app-runtime.ts")
    const [
      { Instance },
      { ModelsDev },
      { Config, ConfigManaged, ConfigParse, ConfigPaths },
      { Auth },
      { Flag },
      { Account },
      { Global },
      { Option },
      { mergeDeep },
      { Glob },
    ] = await Promise.all([
      import("../upstream/packages/opencode/src/project/instance.ts"),
      import("../upstream/packages/opencode/src/provider/index.ts"),
      import("../upstream/packages/opencode/src/config/index.ts"),
      import("../upstream/packages/opencode/src/auth/index.ts"),
      import("../upstream/packages/opencode/src/flag/flag.ts"),
      import("../upstream/packages/opencode/src/account/account.ts"),
      import("../upstream/packages/opencode/src/global/index.ts"),
      import("effect"),
      import("remeda"),
      import("../upstream/packages/shared/src/util/glob.ts"),
    ])
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const authEntries = await AppRuntime.runPromise(Auth.Service.use((service) => service.all()))
        if (Object.values(authEntries).some((entry) => entry.type === "wellknown")) return
        const activeAccount = await AppRuntime.runPromise(Account.Service.use((service) => service.active()))
        if (Option.isSome(activeAccount) && activeAccount.value.active_org_id) return
        const [catalog, projectFiles, directories] = await Promise.all([
          ModelsDev.get(),
          Flag.OPENCODE_DISABLE_PROJECT_CONFIG
            ? Promise.resolve([])
            : AppRuntime.runPromise(ConfigPaths.files("opencode", process.cwd(), Instance.worktree)),
          AppRuntime.runPromise(ConfigPaths.directories(process.cwd(), Instance.worktree)),
        ])
        const catalogValid = Object.values(catalog).every((provider) => ModelsDev.Provider.safeParse(provider).success)
        const configFiles = [
          path.join(Global.Path.config, "config.json"),
          path.join(Global.Path.config, "opencode.json"),
          path.join(Global.Path.config, "opencode.jsonc"),
          ...(Flag.OPENCODE_CONFIG ? [Flag.OPENCODE_CONFIG] : []),
          ...projectFiles,
          ...directories.flatMap((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR
            ? [path.join(dir, "opencode.json"), path.join(dir, "opencode.jsonc")]
            : []),
          path.join(ConfigManaged.managedConfigDir(), "opencode.json"),
          path.join(ConfigManaged.managedConfigDir(), "opencode.jsonc"),
        ]
        if (existsSync(path.join(Global.Path.config, "config"))) return
        const pluginAuthorityBefore = Flag.OPENCODE_PURE
          ? undefined
          : await snapshotPluginAuthority(directories, Glob)
        if (pluginAuthorityBefore && pluginAuthorityBefore.status !== "absent") return
        if (hasManagedPreference()) return
        const configAuthority = await captureConfigAuthority(configFiles)
        if (configAuthority === undefined) return
        const snapshots = replayConfigAuthority(configAuthority, configFiles)
        if (snapshots === undefined) return
        let config: LocalConfig = {}
        for (const snapshot of snapshots) {
          const next = parseLocalConfig(snapshot.text, snapshot.source, Config, ConfigParse)
          if (next === undefined) return
          if (!Flag.OPENCODE_PURE && (next.plugin?.length ?? 0) > 0) return
          config = mergeDeep(config, next) as LocalConfig
        }
        if (process.env.OPENCODE_CONFIG_CONTENT) {
          const next = parseLocalConfig(process.env.OPENCODE_CONFIG_CONTENT, "OPENCODE_CONFIG_CONTENT", Config, ConfigParse)
          if (next === undefined) return
          if (!Flag.OPENCODE_PURE && (next.plugin?.length ?? 0) > 0) return
          config = mergeDeep(config, next) as LocalConfig
        }
        if (pluginAuthorityBefore) {
          const pluginAuthorityAfter = await snapshotPluginAuthority(directories, Glob)
          if (!pluginAuthorityRemainedAbsent(pluginAuthorityBefore, pluginAuthorityAfter)) return
        }
        if (!await configAuthorityUnchanged(configAuthority)) return
        const auth = authEntries[input.provider_id]
        const externalPluginsEnabled = !Flag.OPENCODE_PURE
          && ((config.plugin?.length ?? 0) > 0 || (config.plugin_origins?.length ?? 0) > 0)
        if (externalPluginsEnabled) return
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
        const disabled = new Set(config.disabled_providers ?? [])
        const allowed = (enabled ? enabled.has(input.provider_id) : true) && !disabled.has(input.provider_id)
        const selectedCatalogProvider = Object.hasOwn(catalog, input.provider_id)
          && ModelsDev.Provider.safeParse(catalog[input.provider_id]).success
          ? catalog[input.provider_id]
          : undefined
        const selectedConfiguredProvider = config.provider && Object.hasOwn(config.provider, input.provider_id)
          ? config.provider[input.provider_id]
          : undefined
        const catalogProvider = allowed ? selectedCatalogProvider : undefined
        const configuredProvider = allowed ? selectedConfiguredProvider : undefined
        if (new Set(["anthropic", "google", "openai"]).has(input.provider_id)) {
          const envNames = selectedConfiguredProvider?.env ?? selectedCatalogProvider?.env ?? []
          const hasEnvironmentCredential = Array.isArray(envNames)
            && envNames.some((name) => typeof name === "string" && typeof process.env[name] === "string" && process.env[name]!.length > 0)
          const hasStoredCredential = hasUsableStoredCredential(input.provider_id, auth)
          const hasConfiguredCredential = typeof selectedConfiguredProvider?.options?.apiKey === "string"
            && selectedConfiguredProvider.options.apiKey.length > 0
          credentialConnection = hasEnvironmentCredential || hasStoredCredential || hasConfiguredCredential ? "connected" : "disconnected"
        }
        if (!catalogValid) return
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

function parseLocalConfig(
  text: string,
  source: string,
  configModule: { Info: { zod: { safeParse(value: unknown): { success: boolean; data?: unknown } } } },
  parser: { jsonc(text: string, source: string): unknown },
): LocalConfig | undefined {
  if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_FILE_BYTES) return
  if (text === "") return {}
  if (/\{(?:env|file):/u.test(text)) return
  try {
    const parsed = normalizeLegacyTuiConfig(parser.jsonc(text, source))
    const result = configModule.Info.zod.safeParse(parsed)
    if (!result.success) return
    return result.data as LocalConfig
  } catch {
    return
  }
}

function normalizeLegacyTuiConfig(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const normalized = { ...(value as Record<string, unknown>) }
  delete normalized.theme
  delete normalized.keybinds
  delete normalized.tui
  return normalized
}

function hasManagedPreference(): boolean {
  if (process.platform !== "darwin") return false
  const user = os.userInfo().username
  return [
    path.join("/Library/Managed Preferences", user, "ai.opencode.managed.plist"),
    path.join("/Library/Managed Preferences", "ai.opencode.managed.plist"),
  ].some((file) => existsSync(file))
}

function openAiOauthAllowsModel(modelId: string, apiModelId: string): boolean {
  if (modelId.includes("codex")) return true
  if (OPENAI_OAUTH_ALLOWED_MODELS.has(apiModelId)) return true
  const version = apiModelId.match(/^gpt-(\d+\.\d+)/)?.[1]
  return version !== undefined && Number.parseFloat(version) > 5.4
}

function hasUsableStoredCredential(providerId: string, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const auth = value as Record<string, unknown>
  if (auth.type === "api") return typeof auth.key === "string" && auth.key.length > 0
  if (providerId !== "openai" || auth.type !== "oauth") return false
  return (typeof auth.access === "string" && auth.access.length > 0)
    || (typeof auth.refresh === "string" && auth.refresh.length > 0)
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
