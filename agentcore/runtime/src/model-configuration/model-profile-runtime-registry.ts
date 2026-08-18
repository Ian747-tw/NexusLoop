import { createHash } from "node:crypto"
import { types as nodeUtilTypes } from "node:util"
import { redactText } from "../security/redaction"
import { projectCommanderModelSelection, projectExecutorModelSelection } from "./model-configuration-kernel"
import type {
  CommanderModelConformanceRegistry,
  CommanderModelSelectionProjection,
  ExecutorModelSelectionProjection,
  ExecutorProviderMappingRegistry,
  ModelConfiguration,
} from "./model-configuration-types"
import {
  MODEL_PROFILE_RUNTIME_REGISTRY_POLICY_VERSION,
  MODEL_PROFILE_RUNTIME_REGISTRY_VERSION,
  MODEL_ROLE_READINESS_POLICY_VERSION,
  MODEL_ROLE_READINESS_VERSION,
  type CommanderModelReadinessInput,
  type ExecutorModelReadinessObservation,
  type ExecutorModelReadinessResolver,
  type ModelProfileRuntimeAuthoritySource,
  type ModelProfileRuntimeRegistrySnapshot,
  type ModelRoleReadinessEvidence,
} from "./model-profile-runtime-registry-types"

const HASH = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/
const MAX_ERROR = 500

type RuntimeRegistryInput = Readonly<{
  authority_source: ModelProfileRuntimeAuthoritySource
  configuration: ModelConfiguration
  commander_conformance: CommanderModelConformanceRegistry
  executor_provider_mapping: ExecutorProviderMappingRegistry
}>

export class ModelProfileRuntimeRegistry {
  readonly #snapshot: ModelProfileRuntimeRegistrySnapshot

  constructor(value: unknown) {
    const input = strictRecord(value, "runtime model-profile registry input", [
      "authority_source", "configuration", "commander_conformance", "executor_provider_mapping",
    ]) as unknown as RuntimeRegistryInput
    if (input.authority_source !== "explicit" && input.authority_source !== "legacy_commander_environment") fail("runtime model-profile authority_source is invalid")
    assertDeeplyFrozen(input.configuration, "validated model configuration snapshot")
    assertDeeplyFrozen(input.commander_conformance, "validated Commander conformance snapshot")
    assertDeeplyFrozen(input.executor_provider_mapping, "validated Executor provider mapping snapshot")

    const commander = hasRole(input.configuration, "commander")
      ? projectCommanderModelSelection(input.configuration, input.commander_conformance)
      : undefined
    const executor = hasRole(input.configuration, "executor")
      ? projectExecutorModelSelection(input.configuration, input.executor_provider_mapping)
      : undefined
    const stable = {
      registry_version: MODEL_PROFILE_RUNTIME_REGISTRY_VERSION,
      policy_version: MODEL_PROFILE_RUNTIME_REGISTRY_POLICY_VERSION,
      authority_source: input.authority_source,
      configuration_hash: input.configuration.configuration_hash,
      commander_conformance_registry_hash: input.commander_conformance.registry_hash,
      executor_provider_mapping_registry_hash: input.executor_provider_mapping.registry_hash,
      ...(commander ? { commander_selection: detachedJson(commander) } : {}),
      ...(executor ? { executor_selection: detachedJson(executor) } : {}),
    }
    this.#snapshot = deepFreeze({ ...stable, registry_hash: semanticHash(stable) })
  }

  snapshot(): ModelProfileRuntimeRegistrySnapshot { return this.#snapshot }
  commanderSelection(): CommanderModelSelectionProjection | undefined { return this.#snapshot.commander_selection }
  executorSelection(): ExecutorModelSelectionProjection | undefined { return this.#snapshot.executor_selection }
}

export function evaluateCommanderModelRoleReadiness(
  registry: ModelProfileRuntimeRegistry,
  providerReadiness?: CommanderModelReadinessInput,
  now: () => Date = () => new Date(),
): ModelRoleReadinessEvidence {
  const selection = registry.commanderSelection()
  if (!selection) return readiness("commander", now, { selection_status: "unconfigured", static_support_status: "incomplete", blockers: ["Commander role binding is not configured"] })
  if (!providerReadiness) return readiness("commander", now, { selection_projection_hash: selection.projection_hash, blockers: ["Commander configured-provider readiness evidence is unavailable"] })
  const exact = providerReadiness.provider_source === "configured_connector"
    && providerReadiness.provider_id === selection.provider_id
    && providerReadiness.provider_kind === selection.provider_kind
    && providerReadiness.connector_id === selection.connector_id
    && providerReadiness.model_id === selection.model_id
  const configurationReady = exact && providerReadiness.configuration_ready === true
  const executionReady = configurationReady && providerReadiness.execution_ready === true && providerReadiness.status === "ready"
  return readiness("commander", now, {
    selection_projection_hash: selection.projection_hash,
    provider_availability_status: exact ? "available" : "unknown",
    credential_connection_status: configurationReady ? "connected" : "unknown",
    configuration_status: configurationReady ? "complete" : "incomplete",
    lifecycle_status: executionReady ? "ready" : providerReadiness.execution_ready === false ? "blocked" : "unknown",
    ready: executionReady,
    evidence_id: exact && HASH.test(providerReadiness.readiness_hash) ? `commander-readiness-${providerReadiness.readiness_hash}` : undefined,
    blockers: exact ? boundedMessages(providerReadiness.blockers) : ["Commander configured-provider readiness identity does not match selected authority"],
    warnings: exact ? boundedMessages(providerReadiness.warnings) : [],
  })
}

export async function evaluateExecutorModelRoleReadiness(
  registry: ModelProfileRuntimeRegistry,
  resolver?: ExecutorModelReadinessResolver,
  now: () => Date = () => new Date(),
): Promise<ModelRoleReadinessEvidence> {
  const selection = registry.executorSelection()
  if (!selection) return readiness("executor", now, { selection_status: "unconfigured", static_support_status: "incomplete", blockers: ["Executor role binding is not configured"] })
  if (!resolver) return readiness("executor", now, { selection_projection_hash: selection.projection_hash, blockers: ["Executor readiness observation is unavailable"] })
  let observation: ExecutorModelReadinessObservation
  try {
    const pending = resolver.observe(selection)
    rejectProxy(pending, "Executor readiness observation")
    observation = parseExecutorObservation(await pending)
  } catch (error) {
    return readiness("executor", now, { selection_projection_hash: selection.projection_hash, blockers: [boundedError(error)] })
  }
  const exact = observation.selection_projection_hash === selection.projection_hash
    && observation.provider_id === selection.provider_id
    && observation.model_id === selection.model_id
    && observation.credential_binding_id === selection.credential_binding_id
  if (!exact) return readiness("executor", now, {
    selection_projection_hash: selection.projection_hash,
    evidence_id: observation.evidence_id,
    blockers: ["Executor readiness observation identity does not match selected authority"],
  })
  const ready = observation.provider_availability_status === "available" && observation.credential_connection_status === "connected"
  return readiness("executor", now, {
    selection_projection_hash: selection.projection_hash,
    provider_availability_status: observation.provider_availability_status,
    credential_connection_status: observation.credential_connection_status,
    configuration_status: ready ? "complete" : "unknown",
    lifecycle_status: ready ? "ready" : "unknown",
    ready,
    evidence_id: observation.evidence_id,
    blockers: ready ? [] : ["Executor provider availability and credential connection are not both ready"],
  })
}

function parseExecutorObservation(value: unknown): ExecutorModelReadinessObservation {
  const input = strictRecord(value, "Executor readiness observation", [
    "observation_version", "selection_projection_hash", "provider_id", "model_id", "credential_binding_id",
    "provider_availability_status", "credential_connection_status", "evidence_id",
  ])
  if (input.observation_version !== 1) fail("Executor readiness observation_version must be 1")
  const evidenceId = identifier(input.evidence_id, "evidence_id", 200)
  if (/sk-|api[_-]?key|token|secret|credential/i.test(evidenceId)) fail("Executor readiness evidence_id is credential-shaped")
  return deepFreeze({
    observation_version: 1,
    selection_projection_hash: hash(input.selection_projection_hash, "selection_projection_hash"),
    provider_id: identifier(input.provider_id, "provider_id", 160),
    model_id: inertString(input.model_id, "model_id", 240),
    credential_binding_id: identifier(input.credential_binding_id, "credential_binding_id", 160),
    provider_availability_status: enumValue(input.provider_availability_status, "provider_availability_status", ["available", "unavailable", "unknown"] as const),
    credential_connection_status: enumValue(input.credential_connection_status, "credential_connection_status", ["connected", "disconnected", "unknown"] as const),
    evidence_id: evidenceId,
  })
}

function readiness(role: "commander" | "executor", now: () => Date, overrides: Partial<ModelRoleReadinessEvidence>): ModelRoleReadinessEvidence {
  const stable = {
    readiness_version: MODEL_ROLE_READINESS_VERSION,
    policy_version: MODEL_ROLE_READINESS_POLICY_VERSION,
    role,
    selection_status: "selected" as const,
    static_support_status: "verified" as const,
    provider_availability_status: "unknown" as const,
    credential_connection_status: "unknown" as const,
    configuration_status: "unknown" as const,
    lifecycle_status: "unknown" as const,
    ready: false,
    blockers: [] as readonly string[],
    warnings: [] as readonly string[],
    ...overrides,
    generated_at: now().toISOString(),
  }
  const semantic = withoutUndefined({ ...stable, generated_at: "" })
  return deepFreeze(withoutUndefined({ ...stable, readiness_hash: semanticHash(semantic) })) as ModelRoleReadinessEvidence
}

function hasRole(configuration: ModelConfiguration, role: "commander" | "executor"): boolean {
  for (let index = 0; index < configuration.role_bindings.length; index += 1) if (configuration.role_bindings[index]?.role === role) return true
  return false
}

function strictRecord(value: unknown, label: string, expectedKeys: readonly string[]): Record<string, unknown> {
  rejectProxy(value, label)
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be a plain object`)
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(`${label} must be a plain object`)
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key === "symbol")) fail(`${label} must not contain symbol fields`)
  const expected = new Set(expectedKeys)
  if (keys.length !== expected.size || keys.some((key) => typeof key !== "string" || !expected.has(key))) fail(`${label} contains unknown or missing fields`)
  const output = Object.create(null) as Record<string, unknown>
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(`${label} must contain own enumerable data fields`)
    output[key] = descriptor.value
  }
  return output
}

function assertDeeplyFrozen(value: unknown, label: string): void {
  rejectProxy(value, label)
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) fail(`${label} must be deeply frozen`)
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key === "symbol")) fail(`${label} must not contain symbol fields`)
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(`${label} arrays must be dense own-index data`)
      if (typeof descriptor.value === "object" && descriptor.value !== null) assertDeeplyFrozen(descriptor.value, `${label}[${index}]`)
    }
    const allowed = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))])
    if (keys.some((key) => typeof key === "string" && !allowed.has(key))) fail(`${label} arrays must not contain non-index properties`)
    return
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(`${label} must contain plain objects`)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") fail(`${label} must not contain symbol fields`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(`${label} must contain own enumerable data fields`)
    if (typeof descriptor.value === "object" && descriptor.value !== null) assertDeeplyFrozen(descriptor.value, `${label}.${key}`)
  }
}

function detachedJson<T>(value: T): T {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value
  rejectProxy(value, "runtime registry detached value")
  if (Array.isArray(value)) {
    const output: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !("value" in descriptor)) fail("runtime registry detached array must contain own data fields")
      output.push(detachedJson(descriptor.value))
    }
    return output as T
  }
  if (typeof value !== "object") fail("runtime registry detached value must be JSON data")
  const output = Object.create(null) as Record<string, unknown>
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") fail("runtime registry detached value must not contain symbols")
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !("value" in descriptor)) fail("runtime registry detached value must contain own data fields")
    output[key] = detachedJson(descriptor.value)
  }
  return output as T
}
function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  const output = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value)) if (value[key] !== undefined) output[key] = value[key]
  return output as T
}
function semanticHash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex") }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value !== "object" || value === null) fail("runtime registry hash input is not canonical JSON")
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`
}
function identifier(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value !== value.trim() || !SAFE_ID.test(value)) fail(`Executor readiness ${label} is invalid`)
  return value
}
function inertString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail(`Executor readiness ${label} is invalid`)
  return value
}
function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(`Executor readiness ${label} is invalid`)
  return value
}
function enumValue<const T extends readonly string[]>(value: unknown, label: string, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) fail(`Executor readiness ${label} is invalid`)
  return value
}
function boundedMessages(value: readonly string[]): readonly string[] {
  const output: string[] = []
  for (let index = 0; index < Math.min(value.length, 16); index += 1) output.push(redactText(String(value[index])).slice(0, MAX_ERROR))
  return output
}
function boundedError(error: unknown): string { return redactText(error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR) || "Executor readiness observation failed" }
function rejectProxy(value: unknown, label: string): void {
  if ((typeof value === "object" && value !== null || typeof value === "function") && nodeUtilTypes.isProxy(value)) fail(`${label} must not be a Proxy`)
}
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}
function fail(message: string): never { throw new Error(message) }
