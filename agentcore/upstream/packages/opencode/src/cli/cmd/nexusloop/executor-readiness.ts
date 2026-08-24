import { createHash } from "node:crypto"
import { types as nodeUtilTypes } from "node:util"
import { parse, visit, type ParseError } from "jsonc-parser"
import { isCodexOAuthModelAllowed } from "../../../plugin/codex-model-authority"
import { isBundledProviderPackage } from "../../../provider/bundled-provider-authority"

export const EXECUTOR_READINESS_REQUEST_VERSION = "nexusloop_opencode_executor_readiness_request_v1" as const
export const EXECUTOR_READINESS_OBSERVATION_VERSION = 1 as const
export const EXECUTOR_READINESS_POLICY_VERSION = "nexusloop_opencode_executor_readiness_policy_v1" as const

const COMPLEX_CREDENTIAL_PROVIDERS = new Set([
  "amazon-bedrock",
  "azure",
  "azure-cognitive-services",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "gitlab",
  "google-vertex",
  "google-vertex-anthropic",
  "sap-ai-core",
])
const OFFLINE_OAUTH_CREDENTIAL_PROVIDERS = new Set(["openai"])

const MAX_REQUEST_BYTES = 4096
const HASH = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/
const REQUEST_KEYS = [
  "request_version",
  "selection_projection_hash",
  "provider_id",
  "model_id",
  "credential_binding_id",
] as const

export type ExecutorReadinessRequest = Readonly<{
  request_version: typeof EXECUTOR_READINESS_REQUEST_VERSION
  selection_projection_hash: string
  provider_id: string
  model_id: string
  credential_binding_id: string
}>

export type ExecutorReadinessObservation = Readonly<{
  observation_version: 1
  selection_projection_hash: string
  provider_id: string
  model_id: string
  credential_binding_id: string
  provider_availability_status: "available" | "unavailable" | "unknown"
  credential_connection_status: "connected" | "disconnected" | "unknown"
  evidence_id: string
}>

export type ExecutorReadinessSource = Readonly<{
  catalog: unknown
  config_fragments: readonly unknown[]
  auth: unknown
  env: unknown
  observation_complete: boolean
}>

type ConfiguredModelAuthority = {
  order: number
  id?: string
  status?: unknown
  packageID?: string
  inputCost?: number
}

export function parseExecutorReadinessRequestText(text: string): ExecutorReadinessRequest {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) fail()
  const errors: ParseError[] = []
  const objectKeys: Set<string>[] = []
  let duplicate = false
  visit(
    text,
    {
      onObjectBegin() {
        objectKeys.push(new Set())
      },
      onObjectProperty(property) {
        const keys = objectKeys[objectKeys.length - 1]
        if (!keys || keys.has(property)) duplicate = true
        keys?.add(property)
      },
      onObjectEnd() {
        objectKeys.pop()
      },
      onError(code, offset, length) {
        errors.push({ error: code, offset, length })
      },
    },
    { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false },
  )
  const value = parse(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  if (errors.length || duplicate) fail()
  return parseExecutorReadinessRequestValue(value)
}

export function parseExecutorReadinessRequestValue(value: unknown): ExecutorReadinessRequest {
  const input = strictRecord(value, REQUEST_KEYS)
  if (input.request_version !== EXECUTOR_READINESS_REQUEST_VERSION) fail()
  return Object.freeze({
    request_version: EXECUTOR_READINESS_REQUEST_VERSION,
    selection_projection_hash: hash(input.selection_projection_hash),
    provider_id: identifier(input.provider_id, 160),
    model_id: inertModelID(input.model_id),
    credential_binding_id: identifier(input.credential_binding_id, 160),
  })
}

export function observeExecutorReadiness(
  requestValue: unknown,
  sourceValue: unknown,
): ExecutorReadinessObservation {
  const request = parseExecutorReadinessRequestValue(requestValue)
  const source = parseSource(sourceValue)
  const configs = denseArray(source.config_fragments)
  const catalog = optionalRecord(source.catalog)
  const auth = optionalRecord(source.auth)
  const env = optionalRecord(source.env)
  const pureMode = truthy(ownValue(env, "OPENCODE_PURE"))

  let complete = source.observation_complete
  let ambiguous = false
  let enabledProviders: string[] | undefined
  let disabledProviders: string[] | undefined
  let whitelist: string[] | undefined
  let blacklist: string[] | undefined
  const configuredModels = Object.create(null) as Record<string, ConfiguredModelAuthority>
  let configuredModelOrder = 0
  let configuredProviderPackage: string | undefined
  let catalogModelStatus: unknown
  let catalogModelApiID: string | undefined
  let catalogModelPackage: string | undefined
  let catalogModelInputCost: number | undefined
  let catalogProviderPackage: string | undefined
  let catalogModels: Record<string, unknown> = Object.create(null)
  let catalogModel = false
  let configuredApiKey = false
  let credentialKeys: string[] = []
  let credentialSemanticsKnown = true

  const catalogProviderValue = ownValue(catalog, request.provider_id)
  if (catalogProviderValue !== undefined) {
    const provider = optionalRecord(catalogProviderValue)
    const id = ownValue(provider, "id")
    const models = optionalRecord(ownValue(provider, "models"))
    catalogModels = models
    const providerPackage = ownValue(provider, "npm")
    if (providerPackage !== undefined) {
      if (typeof providerPackage === "string" && providerPackage.length > 0) catalogProviderPackage = providerPackage
      else complete = false
    }
    if (id !== request.provider_id) complete = false
    else {
      const modelValue = ownValue(models, request.model_id)
      if (modelValue !== undefined) {
        const model = optionalRecord(modelValue)
        const status = ownValue(model, "status")
        const apiID = ownValue(model, "id")
        if (typeof apiID !== "string" || apiID.length === 0) complete = false
        else catalogModelApiID = apiID
        const modelProvider = optionalRecord(ownValue(model, "provider"))
        const modelPackage = ownValue(modelProvider, "npm")
        if (modelPackage === undefined) catalogModelPackage = catalogProviderPackage ?? "@ai-sdk/openai-compatible"
        else if (typeof modelPackage === "string" && modelPackage.length > 0) catalogModelPackage = modelPackage
        else complete = false
        catalogModelStatus = status
        catalogModel = true
        if (request.provider_id === "opencode") {
          const cost = optionalRecord(ownValue(model, "cost"))
          const inputCost = ownValue(cost, "input")
          if (typeof inputCost === "number" && Number.isFinite(inputCost)) catalogModelInputCost = inputCost
          else credentialSemanticsKnown = false
        }
      }
    }
    const catalogEnv = parseStringArray(ownValue(provider, "env"), false)
    if (!catalogEnv) complete = false
    else {
      credentialKeys = catalogEnv
      credentialSemanticsKnown = !COMPLEX_CREDENTIAL_PROVIDERS.has(request.provider_id)
    }
  }

  for (let index = 0; index < configs.length; index += 1) {
    const config = optionalRecord(configs[index])
    const plugins = ownValue(config, "plugin")
    const pluginOrigins = ownValue(config, "plugin_origins")
    if (!pureMode && ((Array.isArray(plugins) && plugins.length > 0) ||
      (Array.isArray(pluginOrigins) && pluginOrigins.length > 0))) {
      ambiguous = true
    }

    const enabled = parseStringArray(ownValue(config, "enabled_providers"), false)
    const disabled = parseStringArray(ownValue(config, "disabled_providers"), false)
    if (ownValue(config, "enabled_providers") !== undefined && !enabled) complete = false
    if (ownValue(config, "disabled_providers") !== undefined && !disabled) complete = false
    if (enabled) enabledProviders = enabled
    if (disabled) disabledProviders = disabled

    const providers = optionalRecord(ownValue(config, "provider"))
    const selectedValue = ownValue(providers, request.provider_id)
    if (selectedValue === undefined) continue
    const selected = optionalRecord(selectedValue)
    const selectedPackage = ownValue(selected, "npm")
    if (selectedPackage !== undefined) {
      if (typeof selectedPackage === "string" && selectedPackage.length > 0) configuredProviderPackage = selectedPackage
      else complete = false
    }
    const models = optionalRecord(ownValue(selected, "models"))
    if (ownValue(selected, "models") !== undefined) {
      for (const modelID of Object.keys(models)) {
        const configuredModelValue = ownValue(models, modelID)
        const configured = optionalRecord(configuredModelValue)
        const previous = configuredModels[modelID]
        const authority: ConfiguredModelAuthority = previous
          ? { ...previous }
          : { order: configuredModelOrder++ }
        const status = ownValue(configured, "status")
        const apiID = ownValue(configured, "id")
        if (apiID !== undefined) {
          if (typeof apiID === "string" && apiID.length > 0) authority.id = apiID
          else complete = false
        }
        const modelProvider = optionalRecord(ownValue(configured, "provider"))
        const modelPackage = ownValue(modelProvider, "npm")
        if (modelPackage !== undefined) {
          if (typeof modelPackage === "string" && modelPackage.length > 0) authority.packageID = modelPackage
          else complete = false
        }
        if (status !== undefined) authority.status = status
        const cost = optionalRecord(ownValue(configured, "cost"))
        const inputCost = ownValue(cost, "input")
        if (ownValue(configured, "cost") !== undefined) {
          if (typeof inputCost === "number" && Number.isFinite(inputCost)) authority.inputCost = inputCost
          else complete = false
        }
        configuredModels[modelID] = authority
      }
    }
    const selectedEnv = parseStringArray(ownValue(selected, "env"), false)
    if (ownValue(selected, "env") !== undefined) {
      if (!selectedEnv) complete = false
      else {
        credentialKeys = selectedEnv
        credentialSemanticsKnown &&= !COMPLEX_CREDENTIAL_PROVIDERS.has(request.provider_id)
      }
    }
    const options = optionalRecord(ownValue(selected, "options"))
    const apiKey = ownValue(options, "apiKey")
    if (typeof apiKey === "string" && apiKey.length > 0) configuredApiKey = true
    else if (apiKey !== undefined) complete = false

    const selectedWhitelist = parseStringArray(ownValue(selected, "whitelist"), false)
    const selectedBlacklist = parseStringArray(ownValue(selected, "blacklist"), false)
    if (ownValue(selected, "whitelist") !== undefined && !selectedWhitelist) complete = false
    if (ownValue(selected, "blacklist") !== undefined && !selectedBlacklist) complete = false
    if (selectedWhitelist) whitelist = selectedWhitelist
    if (selectedBlacklist) blacklist = selectedBlacklist
  }

  const authValue = ownValue(auth, request.provider_id)
  const experimental = ownValue(env, "OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
  const enabledExperimental = typeof experimental === "string" && ["true", "1"].includes(experimental.toLowerCase())
  const openAiOAuth = request.provider_id === "openai" && ownValue(optionalRecord(authValue), "type") === "oauth"
  const configuredModel = configuredModels[request.model_id]
  const effectiveConfigured = configuredModel
    ? resolveConfiguredModelAuthority(
        request.model_id,
        configuredModels,
        catalogModels,
        configuredProviderPackage,
        catalogProviderPackage,
      )
    : undefined
  const effectiveModelApiID = effectiveConfigured?.apiID ?? catalogModelApiID ?? request.model_id
  const effectiveModelStatus = effectiveConfigured?.status ?? catalogModelStatus
  const effectiveModelPackage = effectiveConfigured?.packageID ?? catalogModelPackage ?? "@ai-sdk/openai-compatible"
  const effectiveInputCost = effectiveConfigured?.inputCost ?? catalogModelInputCost
  const credential = credentialStatus(
    request.provider_id,
    authValue,
    env,
    credentialKeys,
    configuredApiKey,
    credentialSemanticsKnown,
    request.provider_id === "opencode" && effectiveInputCost === 0,
  )
  if ((catalogModel || configuredModel) && !isBundledProviderPackage(effectiveModelPackage)) ambiguous = true
  const modelAvailable = (catalogModel || configuredModel) && modelAllowed(
    request.provider_id,
    request.model_id,
    effectiveModelApiID,
    effectiveModelStatus,
    enabledExperimental,
    openAiOAuth,
  )
  const providerEnabled = (enabledProviders === undefined || enabledProviders.includes(request.provider_id)) &&
    !disabledProviders?.includes(request.provider_id) &&
    (whitelist === undefined || whitelist.includes(request.model_id)) &&
    !blacklist?.includes(request.model_id)
  const availability = !complete || ambiguous
    ? "unknown"
    : providerEnabled && modelAvailable
      ? "available"
      : "unavailable"
  const credentialConnection = complete ? credential : "unknown"
  const semantic = {
    policy_version: EXECUTOR_READINESS_POLICY_VERSION,
    selection_projection_hash: request.selection_projection_hash,
    provider_id: request.provider_id,
    model_id: request.model_id,
    credential_binding_id: request.credential_binding_id,
    provider_availability_status: availability,
    credential_connection_status: credentialConnection,
  }
  return Object.freeze({
    observation_version: EXECUTOR_READINESS_OBSERVATION_VERSION,
    selection_projection_hash: request.selection_projection_hash,
    provider_id: request.provider_id,
    model_id: request.model_id,
    credential_binding_id: request.credential_binding_id,
    provider_availability_status: availability,
    credential_connection_status: credentialConnection,
    evidence_id: `opencode-readiness-v1-${createHash("sha256").update(JSON.stringify(semantic)).digest("hex")}`,
  })
}

function resolveConfiguredModelAuthority(
  modelID: string,
  configuredModels: Readonly<Record<string, ConfiguredModelAuthority>>,
  catalogModels: Record<string, unknown>,
  configuredProviderPackage: string | undefined,
  catalogProviderPackage: string | undefined,
  seen = new Set<string>(),
): { apiID?: string; status?: unknown; packageID?: string; inputCost?: number } {
  const configured = configuredModels[modelID]
  if (!configured || seen.has(modelID)) return catalogModelAuthority(modelID, catalogModels, catalogProviderPackage)
  seen.add(modelID)
  const targetID = configured.id ?? modelID
  const configuredTarget = configuredModels[targetID]
  const inherited = targetID !== modelID && configuredTarget && configuredTarget.order < configured.order
    ? resolveConfiguredModelAuthority(targetID, configuredModels, catalogModels, configuredProviderPackage, catalogProviderPackage, seen)
    : catalogModelAuthority(targetID, catalogModels, catalogProviderPackage)
  return {
    apiID: configured.id ?? inherited.apiID ?? modelID,
    status: configured.status ?? inherited.status ?? "active",
    packageID: configured.packageID ?? configuredProviderPackage ?? inherited.packageID ??
      catalogProviderPackage ?? "@ai-sdk/openai-compatible",
    inputCost: configured.inputCost ?? inherited.inputCost,
  }
}

function catalogModelAuthority(
  modelID: string,
  catalogModels: Record<string, unknown>,
  catalogProviderPackage: string | undefined,
): { apiID?: string; status?: unknown; packageID?: string; inputCost?: number } {
  const value = ownValue(catalogModels, modelID)
  if (value === undefined) return {}
  const model = optionalRecord(value)
  const apiID = ownValue(model, "id")
  if (apiID !== undefined && (typeof apiID !== "string" || apiID.length === 0)) fail()
  const provider = optionalRecord(ownValue(model, "provider"))
  const packageID = ownValue(provider, "npm")
  if (packageID !== undefined && (typeof packageID !== "string" || packageID.length === 0)) fail()
  const cost = optionalRecord(ownValue(model, "cost"))
  const inputCost = ownValue(cost, "input")
  if (inputCost !== undefined && (typeof inputCost !== "number" || !Number.isFinite(inputCost))) fail()
  return {
    apiID: typeof apiID === "string" ? apiID : undefined,
    status: ownValue(model, "status"),
    packageID: typeof packageID === "string" ? packageID : catalogProviderPackage ?? "@ai-sdk/openai-compatible",
    inputCost: typeof inputCost === "number" ? inputCost : undefined,
  }
}

function modelAllowed(
  providerID: string,
  modelID: string,
  apiModelID: string,
  status: unknown,
  experimental: boolean,
  openAiOAuth: boolean,
): boolean {
  if (modelID === "gpt-5-chat-latest") return false
  if (providerID === "openrouter" && modelID === "openai/gpt-5-chat") return false
  if (status === "deprecated") return false
  if (status === "alpha" && !experimental) return false
  return !openAiOAuth || isCodexOAuthModelAllowed(modelID, apiModelID)
}

function truthy(value: unknown): boolean {
  return typeof value === "string" && ["true", "1"].includes(value.toLowerCase())
}

function parseSource(value: unknown): ExecutorReadinessSource {
  const source = strictRecord(value, ["catalog", "config_fragments", "auth", "env", "observation_complete"])
  if (source.observation_complete !== true && source.observation_complete !== false) fail()
  denseArray(source.config_fragments)
  return source as unknown as ExecutorReadinessSource
}

function credentialStatus(
  providerID: string,
  authValue: unknown,
  env: Record<string, unknown>,
  credentialKeys: readonly string[],
  configuredApiKey: boolean,
  credentialSemanticsKnown: boolean,
  publicCredentialConnection: boolean,
): "connected" | "disconnected" | "unknown" {
  if (!credentialSemanticsKnown) return "unknown"
  if (publicCredentialConnection) return "connected"
  if (configuredApiKey) return "connected"
  for (let index = 0; index < credentialKeys.length; index += 1) {
    const value = ownValue(env, credentialKeys[index]!)
    if (typeof value === "string" && value.length > 0) return "connected"
  }
  if (authValue === undefined) return "disconnected"
  const info = optionalRecord(authValue)
  const type = ownValue(info, "type")
  if (type === "api") return typeof ownValue(info, "key") === "string" && ownValue(info, "key") !== ""
    ? "connected"
    : "unknown"
  if (type === "oauth" && OFFLINE_OAUTH_CREDENTIAL_PROVIDERS.has(providerID)) {
    return typeof ownValue(info, "refresh") === "string" && ownValue(info, "refresh") !== ""
      ? "connected"
      : "unknown"
  }
  return "unknown"
}

function parseStringArray(value: unknown, missingAsEmpty: boolean): string[] | undefined {
  if (value === undefined) return missingAsEmpty ? [] : undefined
  if (!Array.isArray(value) || nodeUtilTypes.isProxy(value)) return undefined
  const result: string[] = []
  const keys = Reflect.ownKeys(value)
  const allowed = new Set(["length"])
  for (let index = 0; index < value.length; index += 1) {
    allowed.add(String(index))
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return undefined
    }
    result.push(descriptor.value)
  }
  if (keys.some((key) => typeof key === "symbol" || !allowed.has(key))) return undefined
  return result
}

function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || nodeUtilTypes.isProxy(value)) fail()
  const result: unknown[] = []
  const allowed = new Set(["length"])
  for (let index = 0; index < value.length; index += 1) {
    allowed.add(String(index))
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail()
    result.push(descriptor.value)
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol" || !allowed.has(key))) fail()
  return result
}

function strictRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (nodeUtilTypes.isProxy(value) || typeof value !== "object" || value === null || Array.isArray(value)) fail()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const keys = Reflect.ownKeys(value)
  const expected = new Set(expectedKeys)
  if (keys.length !== expected.size || keys.some((key) => typeof key !== "string" || !expected.has(key))) fail()
  const result = Object.create(null) as Record<string, unknown>
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail()
    result[key] = descriptor.value
  }
  return result
}

function optionalRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return Object.create(null)
  if (nodeUtilTypes.isProxy(value) || typeof value !== "object" || value === null || Array.isArray(value)) fail()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") fail()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail()
    result[key] = descriptor.value
  }
  return result
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}

function identifier(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value !== value.trim() || !SAFE_ID.test(value)) fail()
  return value
}

function inertModelID(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 240 || value !== value.trim()) fail()
  if (/\p{Cc}|\p{Cf}/u.test(value)) fail()
  return value
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail()
  return value
}

function fail(): never {
  throw new Error("Invalid NexusLoop Executor readiness input")
}
