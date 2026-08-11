import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { redactText } from "../security/redaction"
import {
  COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
  COMMANDER_MODEL_CONFORMANCE_REGISTRY_VERSION,
  EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
  EXECUTOR_PROVIDER_MAPPING_REGISTRY_VERSION,
  MODEL_CONFIGURATION_POLICY_VERSION,
  MODEL_CONFIGURATION_SCHEMA_VERSION,
} from "./model-configuration-types"
import type {
  CommanderConnectionMapping,
  CommanderModelConformanceEntry,
  CommanderModelConformanceRegistry,
  CommanderModelSelectionProjection,
  ExecutorConnectionMapping,
  ExecutorModelSelectionProjection,
  ExecutorProviderMappingEntry,
  ExecutorProviderMappingRegistry,
  ModelConfiguration,
  ModelConnection,
  ModelProfile,
  ModelRole,
  RoleModelBinding,
} from "./model-configuration-types"

export {
  COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
  COMMANDER_MODEL_CONFORMANCE_REGISTRY_VERSION,
  EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
  EXECUTOR_PROVIDER_MAPPING_REGISTRY_VERSION,
  MODEL_CONFIGURATION_POLICY_VERSION,
  MODEL_CONFIGURATION_SCHEMA_VERSION,
} from "./model-configuration-types"
export type * from "./model-configuration-types"

const CONFIGURATION_KEYS = new Set(["schema_version", "policy_version", "connections", "profiles", "role_bindings"])
const CONNECTION_KEYS = new Set(["connection_id", "provider_kind", "credential_binding_id", "commander", "executor"])
const COMMANDER_MAPPING_KEYS = new Set(["connector_id", "conformance_id"])
const EXECUTOR_MAPPING_KEYS = new Set(["provider_id"])
const PROFILE_KEYS = new Set(["profile_id", "connection_id", "model_id", "display_name"])
const BINDING_KEYS = new Set(["role", "profile_id"])
const CONFORMANCE_REGISTRY_KEYS = new Set(["registry_version", "policy_version", "entries"])
const CONFORMANCE_ENTRY_KEYS = new Set(["conformance_version", "conformance_id", "provider_kind", "transport_kind", "provider_id", "model_id"])
const EXECUTOR_PROVIDER_REGISTRY_KEYS = new Set(["registry_version", "policy_version", "entries"])
const EXECUTOR_PROVIDER_ENTRY_KEYS = new Set(["mapping_version", "mapping_id", "provider_kind", "provider_ids"])
const MODEL_ROLES: readonly ModelRole[] = ["commander", "executor"]
const MAX_CONNECTIONS = 64
const MAX_PROFILES = 128
const MAX_CONFORMANCE_ENTRIES = 128
const MAX_EXECUTOR_PROVIDER_MAPPINGS = 128
const MAX_EXECUTOR_PROVIDER_ALIASES = 32
const SINGLETON_ENVIRONMENT_NAMES = new Set(["HOME", "HOSTNAME", "LOGNAME", "OLDPWD", "PATH", "PWD", "SHELL", "TEMP", "TMP", "TMPDIR", "USER"])
const CONCRETE_CREDENTIAL_PATTERNS = [
  /sk-[A-Za-z0-9_-]{6,}/i,
  /gh[pousr]_[A-Za-z0-9_]{10,}/i,
  /github_pat_[A-Za-z0-9_]{10,}/i,
  /x(?:ox[a-z]|app)-[A-Za-z0-9-]{20,}/i,
  /(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}/,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /ya29\.[A-Za-z0-9_-]{20,}/i,
  /AIza[A-Za-z0-9_-]{35}/,
  /(?:glpat-|npm_|hf_)[A-Za-z0-9_-]{20,}/i,
] as const

export function validateModelConfiguration(value: unknown): ModelConfiguration {
  const input = record(value, "model configuration")
  exactKeys(input, CONFIGURATION_KEYS, "model configuration")
  if (input.schema_version !== MODEL_CONFIGURATION_SCHEMA_VERSION) fail("model configuration schema_version must be 1")
  if (input.policy_version !== MODEL_CONFIGURATION_POLICY_VERSION) fail(`model configuration policy_version must be ${MODEL_CONFIGURATION_POLICY_VERSION}`)

  const rawConnections = boundedArray(input.connections, "connections", MAX_CONNECTIONS)
  const rawProfiles = boundedArray(input.profiles, "profiles", MAX_PROFILES)
  const rawBindings = boundedArray(input.role_bindings, "role_bindings", 8)
  const connections: ModelConnection[] = []
  const profiles: ModelProfile[] = []
  const bindings: RoleModelBinding[] = []
  for (let index = 0; index < rawConnections.length; index += 1) connections.push(parseConnection(rawConnections[index], index))
  for (let index = 0; index < rawProfiles.length; index += 1) profiles.push(parseProfile(rawProfiles[index], index))
  for (let index = 0; index < rawBindings.length; index += 1) bindings.push(parseBinding(rawBindings[index], index))

  unique(connections, (item) => item.connection_id, "connection_id")
  unique(profiles, (item) => item.profile_id, "profile_id")
  unique(bindings, (item) => item.role, "role binding")

  const connectionIds = new Set<string>()
  for (let index = 0; index < connections.length; index += 1) connectionIds.add(connections[index]!.connection_id)
  for (const profile of profiles) {
    if (!connectionIds.has(profile.connection_id)) fail(`profile ${profile.profile_id} references unknown connection`)
  }
  const profileIds = new Set<string>()
  for (let index = 0; index < profiles.length; index += 1) profileIds.add(profiles[index]!.profile_id)
  for (const binding of bindings) {
    if (!profileIds.has(binding.profile_id)) fail(`${binding.role} role binding references unknown profile`)
  }

  connections.sort((left, right) => asciiCompare(left.connection_id, right.connection_id))
  profiles.sort((left, right) => asciiCompare(left.profile_id, right.profile_id))
  bindings.sort((left, right) => MODEL_ROLES.indexOf(left.role) - MODEL_ROLES.indexOf(right.role))
  const connectionHashes: string[] = []
  const profileHashes: string[] = []
  const bindingHashes: string[] = []
  for (let index = 0; index < connections.length; index += 1) connectionHashes.push(connections[index]!.semantic_hash)
  for (let index = 0; index < profiles.length; index += 1) profileHashes.push(profiles[index]!.semantic_hash)
  for (let index = 0; index < bindings.length; index += 1) bindingHashes.push(bindings[index]!.binding_hash)
  const connectionRegistryHash = semanticHash(connectionHashes)
  const profileRegistryHash = semanticHash(profileHashes)
  const roleBindingRegistryHash = semanticHash(bindingHashes)
  return deepFreeze({
    schema_version: MODEL_CONFIGURATION_SCHEMA_VERSION,
    policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
    connections,
    profiles,
    role_bindings: bindings,
    connection_registry_hash: connectionRegistryHash,
    profile_registry_hash: profileRegistryHash,
    role_binding_registry_hash: roleBindingRegistryHash,
    configuration_hash: semanticHash({
      schema_version: MODEL_CONFIGURATION_SCHEMA_VERSION,
      policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
      connection_registry_hash: connectionRegistryHash,
      profile_registry_hash: profileRegistryHash,
      role_binding_registry_hash: roleBindingRegistryHash,
    }),
  })
}

export function validateCommanderModelConformanceRegistry(value: unknown): CommanderModelConformanceRegistry {
  const input = record(value, "Commander conformance registry")
  exactKeys(input, CONFORMANCE_REGISTRY_KEYS, "Commander conformance registry")
  if (input.registry_version !== COMMANDER_MODEL_CONFORMANCE_REGISTRY_VERSION) fail("Commander conformance registry_version must be 1")
  if (input.policy_version !== COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION) fail(`Commander conformance policy_version must be ${COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION}`)
  const rawEntries = boundedArray(input.entries, "Commander conformance entries", MAX_CONFORMANCE_ENTRIES)
  const entries: CommanderModelConformanceEntry[] = []
  for (let index = 0; index < rawEntries.length; index += 1) entries.push(parseConformanceEntry(rawEntries[index], index))
  unique(entries, (item) => item.conformance_id, "conformance_id")
  entries.sort((left, right) => asciiCompare(left.conformance_id, right.conformance_id))
  const policyHash = semanticHash({
    registry_version: COMMANDER_MODEL_CONFORMANCE_REGISTRY_VERSION,
    policy_version: COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
  })
  return deepFreeze({
    registry_version: COMMANDER_MODEL_CONFORMANCE_REGISTRY_VERSION,
    policy_version: COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
    entries,
    policy_hash: policyHash,
    registry_hash: semanticHash({
      policy_hash: policyHash,
      entries: collectField(entries, "conformance_hash"),
    }),
  })
}

export function validateExecutorProviderMappingRegistry(value: unknown): ExecutorProviderMappingRegistry {
  const input = record(value, "Executor provider mapping registry")
  exactKeys(input, EXECUTOR_PROVIDER_REGISTRY_KEYS, "Executor provider mapping registry")
  if (input.registry_version !== EXECUTOR_PROVIDER_MAPPING_REGISTRY_VERSION) fail("Executor provider mapping registry_version must be 1")
  if (input.policy_version !== EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION) {
    fail(`Executor provider mapping policy_version must be ${EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION}`)
  }
  const rawEntries = boundedArray(input.entries, "Executor provider mapping entries", MAX_EXECUTOR_PROVIDER_MAPPINGS)
  const entries: ExecutorProviderMappingEntry[] = []
  for (let index = 0; index < rawEntries.length; index += 1) entries.push(parseExecutorProviderMappingEntry(rawEntries[index], index))
  unique(entries, (item) => item.mapping_id, "Executor provider mapping_id")
  const providerIds = new Set<string>()
  for (const entry of entries) {
    for (const providerId of entry.provider_ids) {
      if (providerIds.has(providerId)) fail("duplicate Executor provider ID authority")
      providerIds.add(providerId)
    }
  }
  entries.sort((left, right) => asciiCompare(left.mapping_id, right.mapping_id))
  const policyHash = semanticHash({
    registry_version: EXECUTOR_PROVIDER_MAPPING_REGISTRY_VERSION,
    policy_version: EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
  })
  return deepFreeze({
    registry_version: EXECUTOR_PROVIDER_MAPPING_REGISTRY_VERSION,
    policy_version: EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
    entries,
    policy_hash: policyHash,
    registry_hash: semanticHash({ policy_hash: policyHash, entries: collectField(entries, "mapping_hash") }),
  })
}

export function projectCommanderModelSelection(
  configuration: ModelConfiguration,
  registry: CommanderModelConformanceRegistry,
): CommanderModelSelectionProjection {
  configuration = authoritativeConfigurationSnapshot(configuration)
  registry = authoritativeConformanceSnapshot(registry)
  const binding = requiredBinding(configuration, "commander")
  const profile = requiredProfile(configuration, binding.profile_id)
  const connection = requiredConnection(configuration, profile.connection_id)
  const mapping = connection.commander
  if (!mapping) fail("Commander mapping is required for the selected connection")
  const conformance = registry.entries.find((item) => item.conformance_id === mapping.conformance_id)
  if (!conformance) fail("static Commander conformance entry is required for the selected connection")
  if (conformance.provider_kind !== connection.provider_kind) fail("Commander conformance provider kind disagrees with the selected connection")
  if (conformance.model_id !== profile.model_id) fail("Commander conformance model identity disagrees with the selected profile")
  if (!connection.commander_authority_hash) fail("Commander connection authority hash is missing")

  const projection = {
    projection_version: 1 as const,
    role: "commander" as const,
    selection_status: "selected" as const,
    support_status: "commander_verified" as const,
    readiness_status: "role_readiness_unknown" as const,
    connection_id: connection.connection_id,
    profile_id: profile.profile_id,
    provider_kind: connection.provider_kind,
    provider_id: conformance.provider_id,
    model_id: profile.model_id,
    credential_binding_id: connection.credential_binding_id,
    connector_id: mapping.connector_id,
    conformance_id: conformance.conformance_id,
    transport_kind: conformance.transport_kind,
    connection_authority_hash: connection.commander_authority_hash,
    profile_hash: profile.semantic_hash,
    binding_hash: binding.binding_hash,
    conformance_hash: conformance.conformance_hash,
    conformance_policy_hash: registry.policy_hash,
    projection_hash: "",
  }
  projection.projection_hash = semanticHash({ ...projection, projection_hash: "" })
  return deepFreeze(projection)
}

export function projectExecutorModelSelection(
  configuration: ModelConfiguration,
  registry: ExecutorProviderMappingRegistry,
): ExecutorModelSelectionProjection {
  configuration = authoritativeConfigurationSnapshot(configuration)
  registry = authoritativeExecutorProviderMappingSnapshot(registry)
  const binding = requiredBinding(configuration, "executor")
  const profile = requiredProfile(configuration, binding.profile_id)
  const connection = requiredConnection(configuration, profile.connection_id)
  const mapping = connection.executor
  if (!mapping) fail("Executor mapping is required for the selected connection")
  if (!connection.executor_authority_hash) fail("Executor connection authority hash is missing")
  const providerMapping = registry.entries.find((item) => item.provider_ids.includes(mapping.provider_id))
  if (!providerMapping) fail("static Executor provider mapping authority is required for the selected connection")
  if (providerMapping.provider_kind !== connection.provider_kind) fail("Executor provider mapping kind disagrees with the selected connection")

  const projection = {
    projection_version: 1 as const,
    role: "executor" as const,
    selection_status: "selected" as const,
    availability_status: "role_readiness_unknown" as const,
    connection_status: "role_readiness_unknown" as const,
    connection_id: connection.connection_id,
    profile_id: profile.profile_id,
    provider_kind: connection.provider_kind,
    provider_id: mapping.provider_id,
    model_id: profile.model_id,
    credential_binding_id: connection.credential_binding_id,
    connection_authority_hash: connection.executor_authority_hash,
    profile_hash: profile.semantic_hash,
    binding_hash: binding.binding_hash,
    provider_mapping_id: providerMapping.mapping_id,
    provider_mapping_hash: providerMapping.mapping_hash,
    provider_mapping_policy_hash: registry.policy_hash,
    projection_hash: "",
  }
  projection.projection_hash = semanticHash({ ...projection, projection_hash: "" })
  return deepFreeze(projection)
}

function parseConnection(value: unknown, index: number): ModelConnection {
  const input = record(value, `connections[${index}]`)
  exactKeys(input, CONNECTION_KEYS, `connections[${index}]`)
  const connectionId = identifier(input.connection_id, `connections[${index}].connection_id`, 160)
  const providerKind = identifier(input.provider_kind, `connections[${index}].provider_kind`, 80)
  const credentialBindingId = credentialBindingIdentifier(input.credential_binding_id, `connections[${index}].credential_binding_id`)
  const commander = input.commander === undefined ? undefined : parseCommanderMapping(input.commander, index)
  const executor = input.executor === undefined ? undefined : parseExecutorMapping(input.executor, index)
  if (!commander && !executor) fail(`connections[${index}] must define at least one role mapping`)
  const stable = {
    connection_version: 1 as const,
    connection_id: connectionId,
    provider_kind: providerKind,
    credential_binding_id: credentialBindingId,
    ...(commander ? { commander } : {}),
    ...(executor ? { executor } : {}),
  }
  const common = { connection_version: 1, connection_id: connectionId, provider_kind: providerKind, credential_binding_id: credentialBindingId }
  return deepFreeze({
    ...stable,
    semantic_hash: semanticHash(stable),
    ...(commander ? { commander_authority_hash: semanticHash({ ...common, commander }) } : {}),
    ...(executor ? { executor_authority_hash: semanticHash({ ...common, executor }) } : {}),
  })
}

function parseCommanderMapping(value: unknown, index: number): CommanderConnectionMapping {
  const input = record(value, `connections[${index}].commander`)
  exactKeys(input, COMMANDER_MAPPING_KEYS, `connections[${index}].commander`)
  return deepFreeze({
    connector_id: exactExternalIdentifier(input.connector_id, `connections[${index}].commander.connector_id`, 120),
    conformance_id: identifier(input.conformance_id, `connections[${index}].commander.conformance_id`, 160),
  })
}

function parseExecutorMapping(value: unknown, index: number): ExecutorConnectionMapping {
  const input = record(value, `connections[${index}].executor`)
  exactKeys(input, EXECUTOR_MAPPING_KEYS, `connections[${index}].executor`)
  return deepFreeze({ provider_id: exactExternalIdentifier(input.provider_id, `connections[${index}].executor.provider_id`, 120) })
}

function parseProfile(value: unknown, index: number): ModelProfile {
  const input = record(value, `profiles[${index}]`)
  exactKeys(input, PROFILE_KEYS, `profiles[${index}]`)
  const stable = {
    profile_version: 1 as const,
    profile_id: identifier(input.profile_id, `profiles[${index}].profile_id`, 160),
    connection_id: identifier(input.connection_id, `profiles[${index}].connection_id`, 160),
    model_id: modelIdentifier(input.model_id, `profiles[${index}].model_id`),
  }
  const displayName = input.display_name === undefined ? undefined : displayString(input.display_name, `profiles[${index}].display_name`, 160)
  return deepFreeze({ ...stable, ...(displayName ? { display_name: displayName } : {}), semantic_hash: semanticHash(stable) })
}

function parseBinding(value: unknown, index: number): RoleModelBinding {
  const input = record(value, `role_bindings[${index}]`)
  exactKeys(input, BINDING_KEYS, `role_bindings[${index}]`)
  if (input.role !== "commander" && input.role !== "executor") fail(`role_bindings[${index}].role must be commander or executor`)
  const role: ModelRole = input.role
  const stable = { binding_version: 1 as const, role, profile_id: identifier(input.profile_id, `role_bindings[${index}].profile_id`, 160) }
  return deepFreeze({ ...stable, binding_hash: semanticHash(stable) })
}

function parseConformanceEntry(value: unknown, index: number): CommanderModelConformanceEntry {
  const input = record(value, `Commander conformance entries[${index}]`)
  exactKeys(input, CONFORMANCE_ENTRY_KEYS, `Commander conformance entries[${index}]`)
  if (input.conformance_version !== 1) fail(`Commander conformance entries[${index}].conformance_version must be 1`)
  if (input.transport_kind !== "openai_compatible_connector" && input.transport_kind !== "anthropic_messages_connector") {
    fail(`Commander conformance entries[${index}].transport_kind is unsupported`)
  }
  const transportKind = input.transport_kind as CommanderModelConformanceEntry["transport_kind"]
  const providerKind = identifier(input.provider_kind, `Commander conformance entries[${index}].provider_kind`, 80)
  if (transportKind === "anthropic_messages_connector" && providerKind !== "anthropic") fail("anthropic_messages_connector conformance requires provider_kind anthropic")
  if (transportKind === "openai_compatible_connector" && providerKind === "anthropic") fail("provider_kind anthropic requires anthropic_messages_connector conformance")
  const stable = {
    conformance_version: 1 as const,
    conformance_id: identifier(input.conformance_id, `Commander conformance entries[${index}].conformance_id`, 160),
    provider_kind: providerKind,
    transport_kind: transportKind,
    provider_id: exactExternalIdentifier(input.provider_id, `Commander conformance entries[${index}].provider_id`, 120),
    model_id: modelIdentifier(input.model_id, `Commander conformance entries[${index}].model_id`),
  }
  return deepFreeze({ ...stable, conformance_hash: semanticHash(stable) })
}

function parseExecutorProviderMappingEntry(value: unknown, index: number): ExecutorProviderMappingEntry {
  const input = record(value, `Executor provider mapping entries[${index}]`)
  exactKeys(input, EXECUTOR_PROVIDER_ENTRY_KEYS, `Executor provider mapping entries[${index}]`)
  if (input.mapping_version !== 1) fail(`Executor provider mapping entries[${index}].mapping_version must be 1`)
  const rawProviderIds = boundedArray(input.provider_ids, `Executor provider mapping entries[${index}].provider_ids`, MAX_EXECUTOR_PROVIDER_ALIASES)
  const providerIds: string[] = []
  for (let aliasIndex = 0; aliasIndex < rawProviderIds.length; aliasIndex += 1) {
    providerIds.push(exactExternalIdentifier(rawProviderIds[aliasIndex], `Executor provider mapping entries[${index}].provider_ids[${aliasIndex}]`, 120))
  }
  if (providerIds.length === 0) fail(`Executor provider mapping entries[${index}].provider_ids must not be empty`)
  unique(providerIds, (providerId) => providerId, "Executor provider alias")
  providerIds.sort(asciiCompare)
  const stable = {
    mapping_version: 1 as const,
    mapping_id: identifier(input.mapping_id, `Executor provider mapping entries[${index}].mapping_id`, 160),
    provider_kind: identifier(input.provider_kind, `Executor provider mapping entries[${index}].provider_kind`, 80),
    provider_ids: providerIds,
  }
  return deepFreeze({ ...stable, mapping_hash: semanticHash(stable) })
}

function requiredBinding(configuration: ModelConfiguration, role: ModelRole): RoleModelBinding {
  const binding = configuration.role_bindings.find((item) => item.role === role)
  if (!binding) fail(`${role} role binding is required`)
  return binding
}

function requiredProfile(configuration: ModelConfiguration, profileId: string): ModelProfile {
  const profile = configuration.profiles.find((item) => item.profile_id === profileId)
  if (!profile) fail(`selected profile is unavailable`)
  return profile
}

function requiredConnection(configuration: ModelConfiguration, connectionId: string): ModelConnection {
  const connection = configuration.connections.find((item) => item.connection_id === connectionId)
  if (!connection) fail(`selected connection is unavailable`)
  return connection
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object`)
  if (Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`)
  const snapshot: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`${label} must not contain symbol keys`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${label} must contain enumerable data fields only`)
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function exactKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`unknown ${label} key`)
  }
}

function boundedArray(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be a plain array`)
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    fail(`${label} has an invalid array length`)
  }
  const length = lengthDescriptor.value
  if (length > max) fail(`${label} must contain at most ${max} entries`)
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue
    if (typeof key !== "string" || !isCanonicalArrayIndex(key, length)) fail(`${label} must not contain non-index properties`)
  }
  const snapshot: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${label} must be dense enumerable data`)
    snapshot.push(descriptor.value)
  }
  return snapshot
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key
}

function collectField<T extends Record<K, string>, K extends string>(items: readonly T[], key: K): string[] {
  const values: string[] = []
  for (let index = 0; index < items.length; index += 1) values.push(items[index]![key])
  return values
}

function identifier(value: unknown, label: string, max: number): string {
  const raw = requiredString(value, label, max)
  rejectForbiddenValue(raw, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(raw)) fail(`${label} must use bounded ASCII identifier characters`)
  return raw.toLowerCase()
}

function exactExternalIdentifier(value: unknown, label: string, max: number): string {
  const raw = requiredString(value, label, max)
  rejectForbiddenValue(raw, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(raw)) fail(`${label} must use bounded ASCII identifier characters`)
  return raw
}

function credentialBindingIdentifier(value: unknown, label: string): string {
  const raw = requiredString(value, label, 160)
  rejectForbiddenValue(raw, label)
  if (!/^credential-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(raw)) fail(`${label} must be an opaque NexusLoop credential authority identifier`)
  return raw.toLowerCase()
}

function modelIdentifier(value: unknown, label: string): string {
  const raw = requiredString(value, label, 200)
  rejectForbiddenValue(raw, label, { inert_external_identifier: true })
  if (!/^[A-Za-z0-9@][A-Za-z0-9@._:/+() -]*$/.test(raw) || raw.includes("..") || raw.includes("//") || raw.includes("\\") || raw.includes("*")) {
    fail(`${label} must be an exact bounded model identifier`)
  }
  return raw
}

function displayString(value: unknown, label: string, max: number): string {
  const raw = requiredString(value, label, max)
  rejectForbiddenValue(raw, label)
  if (containsEnvironmentReference(raw)) fail(`${label} must not be environment-shaped`)
  if (isPathShapedDisplay(raw)) fail(`${label} must not be path-shaped`)
  return redactText(raw).trim()
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required`)
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value) || /[\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) fail(`${label} must not contain control characters`)
  if (value !== value.trim()) fail(`${label} must not contain boundary whitespace`)
  const raw = value.trim()
  if (raw.length > max || Buffer.byteLength(raw, "utf8") > max * 4) fail(`${label} exceeds its maximum length`)
  return raw
}

function rejectForbiddenValue(value: string, label: string, options: { inert_external_identifier?: boolean } = {}): void {
  const environmentIdentifier = /^[A-Za-z][A-Za-z0-9_]{2,}$/.test(value)
  const uppercaseEnvironment = environmentIdentifier && (SINGLETON_ENVIRONMENT_NAMES.has(value.toUpperCase()) || value.includes("_") && value === value.toUpperCase())
  const credentialEnvironment = environmentIdentifier && /(?:^|_)(?:api_?key|access_?key|private_?key|auth|credential|password|secret|token)(?:_|$)/i.test(value)
  if (uppercaseEnvironment || credentialEnvironment) fail(`${label} must not be environment-shaped`)
  if (containsEnvironmentReference(value)) fail(`${label} must not be environment-shaped`)
  if (/(?:-----\s*)?BEGIN\s+(?:(?:RSA|EC|DSA|OPENSSH)\s+)?PRIVATE\s+KEY(?:\s*-----)?/i.test(value) || /(?:-----\s*)?END\s+(?:(?:RSA|EC|DSA|OPENSSH)\s+)?PRIVATE\s+KEY(?:\s*-----)?/i.test(value)) fail(`${label} must not be credential-shaped`)
  if (redactText(value) !== value || CONCRETE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))) fail(`${label} must not be credential-shaped`)
  if (containsEnvironmentIdentifierToken(value)) fail(`${label} must not be environment-shaped`)
  if (containsBasicAuthorization(value)) fail(`${label} must not be credential-shaped`)
  if (options.inert_external_identifier) return
  const schemeUrl = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+/i.test(value) || containsForbiddenUriScheme(value)
  const hostUrl = /(?:(?:\d{1,3}\.){3}\d{1,3}|\[[0-9A-Fa-f:]+\]|localhost|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:(?::[1-9]\d{0,4})(?:\/|$)|\/)/i.test(value)
  const bareDomain = /(?:^|[^A-Za-z0-9-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?=$|[^A-Za-z0-9-])/i.test(value)
  const endpointHost = bareDomain || /(?:^|\s|[("'])localhost(?=$|\s|[)"',;/:])/i.test(value) || containsIpAddress(value)
  const headerField = /(?:^|[\s("'])(?:[A-Za-z][A-Za-z0-9-]*):[ \t]+\S/.test(value)
  const compactHeaderField = /(?:^|[\s("'])(?:(?:accept|authorization|content-(?:encoding|length|type)|cookie|host|proxy-authorization|set-cookie|user-agent|www-authenticate)|x-[A-Za-z0-9-]+):\S/i.test(value)
  if (schemeUrl || hostUrl || endpointHost || headerField || compactHeaderField || /(?:npm:|plugin:|authorization\s*:|bearer\s+)/i.test(value)) fail(`${label} contains forbidden URL, package, plugin, or header material`)
  if (/(?:^|[\s("'=])@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?=$|[\s)"',;])/.test(value) || /\.(?:cjs|mjs|js|ts|tsx)$/.test(value)) fail(`${label} must not be package-shaped`)
}

function containsEnvironmentReference(value: string): boolean {
  return /\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?:[^}]*)\}|[A-Za-z_][A-Za-z0-9_]*)(?=$|[^A-Za-z0-9_])/.test(value)
    || /(?:^|[^A-Za-z0-9_])env\s*[:=]\s*[A-Za-z_][A-Za-z0-9_]*(?=$|[^A-Za-z0-9_])/i.test(value)
    || /%[A-Za-z_][A-Za-z0-9_]*%/.test(value)
}

function containsEnvironmentIdentifierToken(value: string): boolean {
  for (const token of value.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) {
    if (token.includes("_") && /(?:^|_)(?:api_?key|access_?key|private_?key|auth|credential|password|secret|token)(?:_|$)/i.test(token)) return true
  }
  for (const token of value.split(/[-_]/)) {
    if (SINGLETON_ENVIRONMENT_NAMES.has(token.toUpperCase())) return true
  }
  return false
}

function containsBasicAuthorization(value: string): boolean {
  for (const match of value.matchAll(/(?:^|[\s("'])Basic[ \t]+([A-Za-z0-9+/]{4,}={0,2})(?=$|[\s)"',;])/gi)) {
    const encoded = match[1]!
    try {
      const decoded = Buffer.from(encoded, "base64")
      if (decoded.toString("base64").replace(/=+$/, "") === encoded.replace(/=+$/, "") && decoded.toString("utf8").includes(":")) return true
    } catch {
      // Invalid base64 is not an authorization payload.
    }
  }
  return false
}

function isPathShapedDisplay(value: string): boolean {
  return /(?:^|[\s("'=:\[])(?:\.{1,2}\/|~\/|\/)[^\s]+/.test(value)
    || /(?:^|[\s("'=:\[])[A-Za-z]:[\\/][^\s]+/.test(value)
    || /(?:^|[\s("'=:\[])\\\\[^\s\\]+\\[^\s]+/.test(value)
}

function containsForbiddenUriScheme(value: string): boolean {
  for (const match of value.matchAll(/(?:^|[^A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*):/g)) {
    if (/^(?:bitcoin|data|file|ftp|git|http|https|ldap|ldaps|mailto|ssh|tel|urn|ws|wss)$/i.test(match[1]!)) return true
  }
  return false
}

function containsIpAddress(value: string): boolean {
  for (const candidate of value.match(/\[?[0-9A-Fa-f:.]+\]?/g) ?? []) {
    const normalized = candidate.startsWith("[") && candidate.endsWith("]") ? candidate.slice(1, -1) : candidate
    if (isIP(normalized) !== 0) return true
  }
  return false
}

function unique<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) fail(`duplicate ${label}: ${safeErrorText(value)}`)
    seen.add(value)
  }
}

function semanticHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function authoritativeConfigurationSnapshot(value: ModelConfiguration): ModelConfiguration {
  const source = record(value, "validated model configuration snapshot")
  const connections = boundedArray(source.connections, "validated model configuration connections", MAX_CONNECTIONS)
  const profiles = boundedArray(source.profiles, "validated model configuration profiles", MAX_PROFILES)
  const roleBindings = boundedArray(source.role_bindings, "validated model configuration role bindings", 8)
  const rawConnections: unknown[] = []
  const rawProfiles: unknown[] = []
  const rawRoleBindings: unknown[] = []
  for (let index = 0; index < connections.length; index += 1) {
    const item = record(connections[index], `validated model configuration connections[${index}]`)
    const commander = item.commander === undefined ? undefined : record(item.commander, `validated model configuration connections[${index}].commander`)
    const executor = item.executor === undefined ? undefined : record(item.executor, `validated model configuration connections[${index}].executor`)
    rawConnections.push({
      connection_id: item.connection_id,
      provider_kind: item.provider_kind,
      credential_binding_id: item.credential_binding_id,
      ...(commander ? { commander: { connector_id: commander.connector_id, conformance_id: commander.conformance_id } } : {}),
      ...(executor ? { executor: { provider_id: executor.provider_id } } : {}),
    })
  }
  for (let index = 0; index < profiles.length; index += 1) {
    const item = record(profiles[index], `validated model configuration profiles[${index}]`)
    rawProfiles.push({
      profile_id: item.profile_id,
      connection_id: item.connection_id,
      model_id: item.model_id,
      ...(item.display_name ? { display_name: item.display_name } : {}),
    })
  }
  for (let index = 0; index < roleBindings.length; index += 1) {
    const item = record(roleBindings[index], `validated model configuration role_bindings[${index}]`)
    rawRoleBindings.push({ role: item.role, profile_id: item.profile_id })
  }
  const raw = {
    schema_version: source.schema_version,
    policy_version: source.policy_version,
    connections: rawConnections,
    profiles: rawProfiles,
    role_bindings: rawRoleBindings,
  }
  const accepted = validateModelConfiguration(raw)
  if (semanticHash(accepted) !== semanticHash(value)) fail("Commander projection requires a validated model configuration snapshot")
  return accepted
}

function authoritativeConformanceSnapshot(value: CommanderModelConformanceRegistry): CommanderModelConformanceRegistry {
  const source = record(value, "validated Commander conformance snapshot")
  const entries = boundedArray(source.entries, "validated Commander conformance entries", MAX_CONFORMANCE_ENTRIES)
  const rawEntries: unknown[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const item = record(entries[index], `validated Commander conformance entries[${index}]`)
    rawEntries.push({
      conformance_version: item.conformance_version,
      conformance_id: item.conformance_id,
      provider_kind: item.provider_kind,
      transport_kind: item.transport_kind,
      provider_id: item.provider_id,
      model_id: item.model_id,
    })
  }
  const raw = {
    registry_version: source.registry_version,
    policy_version: source.policy_version,
    entries: rawEntries,
  }
  const accepted = validateCommanderModelConformanceRegistry(raw)
  if (semanticHash(accepted) !== semanticHash(value)) fail("Commander projection requires a validated Commander conformance snapshot")
  return accepted
}

function authoritativeExecutorProviderMappingSnapshot(value: ExecutorProviderMappingRegistry): ExecutorProviderMappingRegistry {
  const source = record(value, "validated Executor provider mapping snapshot")
  const entries = boundedArray(source.entries, "validated Executor provider mapping entries", MAX_EXECUTOR_PROVIDER_MAPPINGS)
  const rawEntries: unknown[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const item = record(entries[index], `validated Executor provider mapping entries[${index}]`)
    rawEntries.push({
      mapping_version: item.mapping_version,
      mapping_id: item.mapping_id,
      provider_kind: item.provider_kind,
      provider_ids: boundedArray(item.provider_ids, `validated Executor provider mapping entries[${index}].provider_ids`, MAX_EXECUTOR_PROVIDER_ALIASES),
    })
  }
  const raw = {
    registry_version: source.registry_version,
    policy_version: source.policy_version,
    entries: rawEntries,
  }
  const accepted = validateExecutorProviderMappingRegistry(raw)
  if (semanticHash(accepted) !== semanticHash(value)) fail("Executor projection requires a validated Executor provider mapping snapshot")
  return accepted
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("semantic hash input contains a non-finite number")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    const items = boundedArray(value, "semantic hash array", Number.MAX_SAFE_INTEGER)
    const parts: string[] = []
    for (let index = 0; index < items.length; index += 1) parts.push(canonicalJson(items[index]))
    return `[${parts.join(",")}]`
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("semantic hash input must contain plain JSON data")
  const object = record(value, "semantic hash object")
  const keys = Object.keys(object)
  keys.sort(asciiCompare)
  const parts: string[] = []
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!
    parts.push(`${JSON.stringify(key)}:${canonicalJson(object[key])}`)
  }
  return `{${parts.join(",")}}`
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function safeErrorText(value: string): string {
  return redactText(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160)
}

function fail(message: string): never {
  throw new Error(safeErrorText(message).slice(0, 500))
}
