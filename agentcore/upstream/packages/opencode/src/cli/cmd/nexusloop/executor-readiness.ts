import { createHash } from "node:crypto"
import { types as nodeUtilTypes } from "node:util"
import { parse, visit, type ParseError } from "jsonc-parser"

export const EXECUTOR_READINESS_REQUEST_VERSION = "nexusloop_opencode_executor_readiness_request_v1" as const
export const EXECUTOR_READINESS_OBSERVATION_VERSION = 1 as const
export const EXECUTOR_READINESS_POLICY_VERSION = "nexusloop_opencode_executor_readiness_policy_v1" as const

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

  let complete = source.observation_complete
  let ambiguous = false
  let enabledProviders: string[] | undefined
  let disabledProviders: string[] | undefined
  let whitelist: string[] | undefined
  let blacklist: string[] | undefined
  let configuredModel = false
  let configuredModelStatus: unknown
  let catalogModel = false
  let configuredApiKey = false
  let credentialKeys: string[] = []

  const catalogProviderValue = ownValue(catalog, request.provider_id)
  if (catalogProviderValue !== undefined) {
    const provider = optionalRecord(catalogProviderValue)
    const id = ownValue(provider, "id")
    const models = optionalRecord(ownValue(provider, "models"))
    if (id !== request.provider_id) complete = false
    else {
      const modelValue = ownValue(models, request.model_id)
      if (modelValue !== undefined) {
        const model = optionalRecord(modelValue)
        const status = ownValue(model, "status")
        const experimental = ownValue(env, "OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
        const enabledExperimental = typeof experimental === "string" && ["true", "1"].includes(experimental.toLowerCase())
        catalogModel = modelAllowed(request.provider_id, request.model_id, status, enabledExperimental)
      }
    }
    credentialKeys = parseStringArray(ownValue(provider, "env"), true) ?? []
    if (ownValue(provider, "env") !== undefined && !parseStringArray(ownValue(provider, "env"), true)) complete = false
  }

  for (let index = 0; index < configs.length; index += 1) {
    const config = optionalRecord(configs[index])
    const plugins = ownValue(config, "plugin")
    const pluginOrigins = ownValue(config, "plugin_origins")
    if ((Array.isArray(plugins) && plugins.length > 0) || (Array.isArray(pluginOrigins) && pluginOrigins.length > 0)) {
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
    const models = optionalRecord(ownValue(selected, "models"))
    if (ownValue(selected, "models") !== undefined) {
      const configuredModelValue = ownValue(models, request.model_id)
      if (configuredModelValue !== undefined) {
        configuredModel = true
        configuredModelStatus = ownValue(optionalRecord(configuredModelValue), "status")
      }
    }
    const selectedEnv = parseStringArray(ownValue(selected, "env"), false)
    if (ownValue(selected, "env") !== undefined) {
      if (!selectedEnv) complete = false
      else credentialKeys = selectedEnv
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
  const credential = credentialStatus(authValue, env, credentialKeys, configuredApiKey)
  const experimental = ownValue(env, "OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
  const enabledExperimental = typeof experimental === "string" && ["true", "1"].includes(experimental.toLowerCase())
  configuredModel &&= modelAllowed(request.provider_id, request.model_id, configuredModelStatus, enabledExperimental)
  const providerEnabled = (enabledProviders === undefined || enabledProviders.includes(request.provider_id)) &&
    !disabledProviders?.includes(request.provider_id) &&
    (whitelist === undefined || whitelist.includes(request.model_id)) &&
    !blacklist?.includes(request.model_id)
  const availability = !complete || ambiguous
    ? "unknown"
    : providerEnabled && (catalogModel || configuredModel)
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

function modelAllowed(providerID: string, modelID: string, status: unknown, experimental: boolean): boolean {
  if (modelID === "gpt-5-chat-latest") return false
  if (providerID === "openrouter" && modelID === "openai/gpt-5-chat") return false
  if (status === "deprecated") return false
  return status !== "alpha" || experimental
}

function parseSource(value: unknown): ExecutorReadinessSource {
  const source = strictRecord(value, ["catalog", "config_fragments", "auth", "env", "observation_complete"])
  if (source.observation_complete !== true && source.observation_complete !== false) fail()
  denseArray(source.config_fragments)
  return source as unknown as ExecutorReadinessSource
}

function credentialStatus(
  authValue: unknown,
  env: Record<string, unknown>,
  credentialKeys: readonly string[],
  configuredApiKey: boolean,
): "connected" | "disconnected" | "unknown" {
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
