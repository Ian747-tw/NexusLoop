import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { types as nodeUtilTypes } from "node:util"
import type { CommanderInvestigationProviderConfig } from "../commander-agent/commander-investigation-provider-types"
import { validateCommanderInvestigationProviderConfig } from "../commander-agent/commander-investigation-provider-config"
import type { JsonlEvent } from "../events/event-types"
import type { EventStore } from "../events/event-store"
import {
  COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION_V3,
  EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
  MODEL_CONFIGURATION_POLICY_VERSION,
  projectCommanderModelSelection,
  projectExecutorModelSelection,
  validateAuthoritySafeIdentifier,
  validateCommanderModelConformanceRegistry,
  validateExecutorProviderMappingRegistry,
  validateModelConfiguration,
} from "./model-configuration-kernel"
import type {
  CommanderModelSelectionProjection,
  ExecutorModelSelectionProjection,
  ModelConfiguration,
} from "./model-configuration-types"
import { ModelProfileRuntimeRegistry } from "./model-profile-runtime-registry"

export const MODEL_SETUP_CATALOG_SCHEMA_VERSION = 1 as const
export const MODEL_SETUP_CATALOG_POLICY_VERSION = "nexusloop_model_setup_catalog_v1" as const
export const MODEL_SETUP_EVENT_SCHEMA_VERSION = 1 as const
export const MODEL_SETUP_EVENT_POLICY_VERSION = "nexusloop_model_setup_event_v1" as const
export const MODEL_SETUP_EVENT_KIND = "runtime_model_setup_committed" as const

type SetupRole = "commander" | "executor"

export type ModelSetupRecipe = Readonly<{
  recipe_version: 1
  recipe_id: string
  role: SetupRole
  display_name: string
  provider_kind: "anthropic" | "google" | "openai"
  provider_id: string
  model_id: string
  credential_binding_id: string
  recipe_hash: string
}>

type CommanderRecipeInternal = ModelSetupRecipe & Readonly<{
  connector_id: string
  conformance_id: string
  transport_kind: CommanderInvestigationProviderConfig["transport_kind"]
}>

type ExecutorRecipeInternal = ModelSetupRecipe & Readonly<{ mapping_id: string }>

export type ModelSetupCatalog = Readonly<{
  schema_version: 1
  policy_version: typeof MODEL_SETUP_CATALOG_POLICY_VERSION
  commander_recipes: readonly ModelSetupRecipe[]
  executor_recipes: readonly ModelSetupRecipe[]
  catalog_hash: string
}>

export type ModelSetupChoices = Readonly<{
  commander_recipe_id: string | null
  executor_recipe_id: string | null
}>

export type ModelSetupCandidate = Readonly<{
  candidate_version: 1
  choices: ModelSetupChoices
  catalog_hash: string
  configuration: ModelConfiguration
  commander_selection?: CommanderModelSelectionProjection
  executor_selection?: ExecutorModelSelectionProjection
  candidate_hash: string
}>

export type ModelSetupPreview = Readonly<{
  preview_version: 1
  expected_revision: number
  current_setup_hash?: string
  candidate_hash: string
  catalog_hash: string
  configuration_hash: string
  commander_selection?: CommanderModelSelectionProjection
  executor_selection?: ExecutorModelSelectionProjection
  restart_required: true
}>

export type ModelSetupCommitInput = ModelSetupChoices & Readonly<{
  expected_revision: number
  candidate_hash: string
  confirmed_by: string
  confirmation: "CONFIRM_MODEL_SETUP"
}>

export type ModelSetupCommitResult = Readonly<{
  status: "committed" | "idempotent"
  revision: number
  setup_hash: string
  candidate_hash: string
  restart_required: true
}>

export type ModelSetupProjection = Readonly<{
  status: "missing" | "ready"
  revision: number
  latest_event_id: string | null
  setup_hash?: string
  candidate?: ModelSetupCandidate
  committed_at?: string
}>

export type PersistedModelSetupAuthority = Readonly<{
  revision: number
  setup_hash: string
  candidate: ModelSetupCandidate
  registry: ModelProfileRuntimeRegistry
  commander_provider_config?: CommanderInvestigationProviderConfig
}>

const COMMANDER_RECIPES: readonly CommanderRecipeInternal[] = freezeRecipes([
  commanderRecipe("commander-anthropic-claude-sonnet-4-5", "Anthropic Claude Sonnet 4.5", "anthropic", "anthropic-native", "claude-sonnet-4-5-20250929", "credential-commander-anthropic-primary", "anthropic-main", "anthropic-claude-sonnet-4-5-native-v1", "anthropic_messages_connector"),
  commanderRecipe("commander-google-gemini-2-5-flash", "Google Gemini 2.5 Flash", "google", "google-native", "gemini-2.5-flash", "credential-commander-google-primary", "google-main", "google-gemini-2-5-flash-native-v1", "google_generative_ai_connector"),
  commanderRecipe("commander-openai-gpt-4-1-mini-responses", "OpenAI GPT-4.1 mini Responses", "openai", "openai-native", "gpt-4.1-mini", "credential-commander-openai-primary", "openai-main", "openai-gpt-4-1-mini-responses-v1", "openai_responses_connector"),
])

const EXECUTOR_RECIPES: readonly ExecutorRecipeInternal[] = freezeRecipes([
  executorRecipe("executor-anthropic-claude-sonnet-4-5", "Anthropic Claude Sonnet 4.5", "anthropic", "anthropic", "claude-sonnet-4-5-20250929", "credential-executor-anthropic-primary", "executor-anthropic-v1"),
  executorRecipe("executor-google-gemini-2-5-flash", "Google Gemini 2.5 Flash", "google", "google", "gemini-2.5-flash", "credential-executor-google-primary", "executor-google-v1"),
  executorRecipe("executor-openai-gpt-4-1-mini", "OpenAI GPT-4.1 mini", "openai", "openai", "gpt-4.1-mini", "credential-executor-openai-primary", "executor-openai-v1"),
])

const CATALOG = (() => {
  const publicCommander = COMMANDER_RECIPES.map(publicRecipe)
  const publicExecutor = EXECUTOR_RECIPES.map(publicRecipe)
  const stable = {
    schema_version: MODEL_SETUP_CATALOG_SCHEMA_VERSION,
    policy_version: MODEL_SETUP_CATALOG_POLICY_VERSION,
    commander_recipes: publicCommander,
    executor_recipes: publicExecutor,
  }
  return deepFreeze({ ...stable, catalog_hash: hash(stable) })
})()

export function modelSetupCatalog(): ModelSetupCatalog { return CATALOG }

export function buildModelSetupCandidate(value: unknown): ModelSetupCandidate {
  const choices = parseChoices(value)
  const commander = choices.commander_recipe_id === null ? undefined : COMMANDER_RECIPES.find((item) => item.recipe_id === choices.commander_recipe_id)
  const executor = choices.executor_recipe_id === null ? undefined : EXECUTOR_RECIPES.find((item) => item.recipe_id === choices.executor_recipe_id)
  if (choices.commander_recipe_id !== null && !commander) throw new Error("unknown Commander setup recipe")
  if (choices.executor_recipe_id !== null && !executor) throw new Error("unknown Executor setup recipe")

  const connections: Record<string, unknown>[] = []
  const profiles: Record<string, unknown>[] = []
  const roleBindings: Record<string, unknown>[] = []
  if (commander) {
    connections.push({
      connection_id: `setup-${commander.recipe_id}`,
      provider_kind: commander.provider_kind,
      credential_binding_id: commander.credential_binding_id,
      commander: { connector_id: commander.connector_id, conformance_id: commander.conformance_id },
    })
    profiles.push({ profile_id: `profile-${commander.recipe_id}`, connection_id: `setup-${commander.recipe_id}`, model_id: commander.model_id, display_name: commander.display_name })
    roleBindings.push({ role: "commander", profile_id: `profile-${commander.recipe_id}` })
  }
  if (executor) {
    connections.push({
      connection_id: `setup-${executor.recipe_id}`,
      provider_kind: executor.provider_kind,
      credential_binding_id: executor.credential_binding_id,
      executor: { provider_id: executor.provider_id },
    })
    profiles.push({ profile_id: `profile-${executor.recipe_id}`, connection_id: `setup-${executor.recipe_id}`, model_id: executor.model_id, display_name: executor.display_name })
    roleBindings.push({ role: "executor", profile_id: `profile-${executor.recipe_id}` })
  }
  const configuration = validateModelConfiguration({
    schema_version: 1,
    policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
    connections,
    profiles,
    role_bindings: roleBindings,
  })
  const conformance = validateCommanderModelConformanceRegistry({
    registry_version: 1,
    policy_version: COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION_V3,
    entries: COMMANDER_RECIPES.map((item) => ({
      conformance_version: 1,
      conformance_id: item.conformance_id,
      provider_kind: item.provider_kind,
      transport_kind: item.transport_kind,
      provider_id: item.provider_id,
      model_id: item.model_id,
    })),
  })
  const executorMapping = validateExecutorProviderMappingRegistry({
    registry_version: 1,
    policy_version: EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
    entries: EXECUTOR_RECIPES.map((item) => ({
      mapping_version: 1,
      mapping_id: item.mapping_id,
      provider_kind: item.provider_kind,
      provider_ids: [item.provider_id],
    })),
  })
  const commanderSelection = commander ? projectCommanderModelSelection(configuration, conformance) : undefined
  const executorSelection = executor ? projectExecutorModelSelection(configuration, executorMapping) : undefined
  const stable = {
    candidate_version: 1 as const,
    choices,
    catalog_hash: CATALOG.catalog_hash,
    configuration,
    ...(commanderSelection ? { commander_selection: commanderSelection } : {}),
    ...(executorSelection ? { executor_selection: executorSelection } : {}),
  }
  return deepFreeze({
    ...stable,
    candidate_hash: hash({
      candidate_version: 1,
      choices,
      catalog_hash: CATALOG.catalog_hash,
      configuration_hash: configuration.configuration_hash,
      commander_projection_hash: commanderSelection?.projection_hash ?? null,
      executor_projection_hash: executorSelection?.projection_hash ?? null,
    }),
  })
}

export function buildPersistedModelSetupAuthority(candidate: ModelSetupCandidate, revision: number, setupHash: string): PersistedModelSetupAuthority {
  const conformance = validateCommanderModelConformanceRegistry({
    registry_version: 1,
    policy_version: COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION_V3,
    entries: COMMANDER_RECIPES.map((item) => ({ conformance_version: 1, conformance_id: item.conformance_id, provider_kind: item.provider_kind, transport_kind: item.transport_kind, provider_id: item.provider_id, model_id: item.model_id })),
  })
  const executorMapping = validateExecutorProviderMappingRegistry({
    registry_version: 1,
    policy_version: EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
    entries: EXECUTOR_RECIPES.map((item) => ({ mapping_version: 1, mapping_id: item.mapping_id, provider_kind: item.provider_kind, provider_ids: [item.provider_id] })),
  })
  const registry = new ModelProfileRuntimeRegistry({ authority_source: "explicit", configuration: candidate.configuration, commander_conformance: conformance, executor_provider_mapping: executorMapping })
  const commander = candidate.choices.commander_recipe_id === null ? undefined : COMMANDER_RECIPES.find((item) => item.recipe_id === candidate.choices.commander_recipe_id)
  return deepFreeze({
    revision,
    setup_hash: setupHash,
    candidate,
    registry,
    ...(commander ? { commander_provider_config: commanderProviderConfig(commander) } : {}),
  })
}

export class ModelSetupService {
  private readonly eventStore: EventStore
  private readonly now: () => Date

  constructor(options: { eventStore: EventStore; now?: () => Date }) {
    this.eventStore = options.eventStore
    this.now = options.now ?? (() => new Date())
  }

  catalog(): ModelSetupCatalog { return modelSetupCatalog() }

  async status(activeSetupHash?: string): Promise<ModelSetupProjection & { active_setup_hash?: string; pending_restart: boolean }> {
    const projection = projectModelSetupEvents(await this.eventStore.readAll())
    return deepFreeze({ ...projection, ...(activeSetupHash ? { active_setup_hash: activeSetupHash } : {}), pending_restart: projection.setup_hash !== activeSetupHash })
  }

  async preview(value: unknown): Promise<ModelSetupPreview> {
    const candidate = buildModelSetupCandidate(value)
    const projection = projectModelSetupEvents(await this.eventStore.readAll())
    return deepFreeze({
      preview_version: 1,
      expected_revision: projection.revision,
      ...(projection.setup_hash ? { current_setup_hash: projection.setup_hash } : {}),
      candidate_hash: candidate.candidate_hash,
      catalog_hash: candidate.catalog_hash,
      configuration_hash: candidate.configuration.configuration_hash,
      ...(candidate.commander_selection ? { commander_selection: candidate.commander_selection } : {}),
      ...(candidate.executor_selection ? { executor_selection: candidate.executor_selection } : {}),
      restart_required: true,
    })
  }

  async confirm(value: unknown): Promise<ModelSetupCommitResult> {
    const input = parseCommitInput(value)
    const candidate = buildModelSetupCandidate({
      commander_recipe_id: input.commander_recipe_id,
      executor_recipe_id: input.executor_recipe_id,
    })
    if (candidate.candidate_hash !== input.candidate_hash) throw new Error("model setup candidate hash does not match current authority")
    const events = await this.eventStore.readAll()
    const projection = projectModelSetupEvents(events)
    if (projection.candidate?.candidate_hash === candidate.candidate_hash
      && (input.expected_revision === projection.revision || input.expected_revision === projection.revision - 1)) {
      return result("idempotent", projection.revision, projection.setup_hash!, candidate.candidate_hash)
    }
    if (input.expected_revision !== projection.revision) throw new Error("model setup revision is stale")
    const revision = projection.revision + 1
    const committedAt = this.now().toISOString()
    const payload = {
      schema_version: MODEL_SETUP_EVENT_SCHEMA_VERSION,
      policy_version: MODEL_SETUP_EVENT_POLICY_VERSION,
      revision,
      previous_setup_hash: projection.setup_hash ?? null,
      commander_recipe_id: candidate.choices.commander_recipe_id,
      executor_recipe_id: candidate.choices.executor_recipe_id,
      catalog_hash: candidate.catalog_hash,
      candidate_hash: candidate.candidate_hash,
      configuration_hash: candidate.configuration.configuration_hash,
      commander_projection_hash: candidate.commander_selection?.projection_hash ?? null,
      executor_projection_hash: candidate.executor_selection?.projection_hash ?? null,
      confirmed_by: input.confirmed_by,
      committed_at: committedAt,
    }
    const eventPayloadHash = hash(payload)
    const event = { kind: MODEL_SETUP_EVENT_KIND, ...payload, event_payload_hash: eventPayloadHash }
    let expectedTail = events.at(-1)?.event_id ? String(events.at(-1)?.event_id) : null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.eventStore.appendIfLatest(event, expectedTail)
        return result("committed", revision, eventPayloadHash, candidate.candidate_hash)
      } catch (error) {
        const reconciledEvents = await this.eventStore.readAll()
        const reconciled = projectModelSetupEvents(reconciledEvents)
        if (reconciled.revision === input.expected_revision + 1
          && reconciled.setup_hash
          && reconciled.candidate?.candidate_hash === candidate.candidate_hash) {
          return result("idempotent", reconciled.revision, reconciled.setup_hash, candidate.candidate_hash)
        }
        if (reconciled.revision !== input.expected_revision || attempt === 2) throw error
        expectedTail = reconciledEvents.at(-1)?.event_id ? String(reconciledEvents.at(-1)?.event_id) : null
      }
    }
    throw new Error("model setup confirmation did not settle")
  }
}

export function projectModelSetupEvents(events: readonly JsonlEvent[]): ModelSetupProjection {
  let revision = 0
  let setupHash: string | undefined
  let candidate: ModelSetupCandidate | undefined
  let latestEventId: string | null = null
  let committedAt: string | undefined
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.kind !== MODEL_SETUP_EVENT_KIND) continue
    const input = strictRecord(event, "model setup event", [
      "kind", "schema_version", "policy_version", "revision", "previous_setup_hash",
      "commander_recipe_id", "executor_recipe_id", "catalog_hash", "candidate_hash", "configuration_hash",
      "commander_projection_hash", "executor_projection_hash", "confirmed_by", "committed_at", "event_payload_hash",
    ], ["event_id", "timestamp"])
    if (typeof input.event_id !== "string" || !/^rt_[a-z0-9]{10}_[a-z0-9]{8}$/.test(input.event_id)) {
      throw new Error("model setup EventStore envelope event_id is invalid")
    }
    canonicalIsoTimestamp(input.timestamp, "model setup EventStore envelope timestamp")
    if (input.schema_version !== MODEL_SETUP_EVENT_SCHEMA_VERSION || input.policy_version !== MODEL_SETUP_EVENT_POLICY_VERSION) throw new Error("model setup event version is unsupported")
    if (!Number.isInteger(input.revision) || input.revision !== revision + 1) throw new Error("model setup revision is not contiguous")
    if (input.previous_setup_hash !== (setupHash ?? null)) throw new Error("model setup previous hash does not match")
    const choices = parseChoices({ commander_recipe_id: input.commander_recipe_id, executor_recipe_id: input.executor_recipe_id })
    const rebuilt = buildModelSetupCandidate(choices)
    if (input.catalog_hash !== rebuilt.catalog_hash || input.candidate_hash !== rebuilt.candidate_hash || input.configuration_hash !== rebuilt.configuration.configuration_hash) throw new Error("model setup event authority hash is invalid")
    if (input.commander_projection_hash !== (rebuilt.commander_selection?.projection_hash ?? null) || input.executor_projection_hash !== (rebuilt.executor_selection?.projection_hash ?? null)) throw new Error("model setup role projection hash is invalid")
    setupOperatorIdentifier(input.confirmed_by)
    const canonicalCommittedAt = canonicalIsoTimestamp(input.committed_at, "model setup committed_at")
    const payload = {
      schema_version: input.schema_version,
      policy_version: input.policy_version,
      revision: input.revision,
      previous_setup_hash: input.previous_setup_hash,
      commander_recipe_id: input.commander_recipe_id,
      executor_recipe_id: input.executor_recipe_id,
      catalog_hash: input.catalog_hash,
      candidate_hash: input.candidate_hash,
      configuration_hash: input.configuration_hash,
      commander_projection_hash: input.commander_projection_hash,
      executor_projection_hash: input.executor_projection_hash,
      confirmed_by: input.confirmed_by,
      committed_at: canonicalCommittedAt,
    }
    if (input.event_payload_hash !== hash(payload)) throw new Error("model setup event payload hash is invalid")
    revision = input.revision
    setupHash = input.event_payload_hash as string
    candidate = rebuilt
    latestEventId = input.event_id
    committedAt = canonicalCommittedAt
  }
  return deepFreeze(revision === 0
    ? { status: "missing", revision: 0, latest_event_id: null }
    : { status: "ready", revision, latest_event_id: latestEventId, setup_hash: setupHash, candidate, committed_at: committedAt })
}

export function readPersistedModelSetupAuthority(projectDir: string): PersistedModelSetupAuthority | undefined {
  let text: string
  try {
    text = readFileSync(join(projectDir, ".nxl", "events.jsonl"), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  let events: JsonlEvent[]
  try {
    events = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as JsonlEvent)
  } catch {
    throw new Error("model setup journal is malformed")
  }
  const projection = projectModelSetupEvents(events)
  if (!projection.candidate || !projection.setup_hash) return undefined
  return buildPersistedModelSetupAuthority(projection.candidate, projection.revision, projection.setup_hash)
}

function commanderProviderConfig(recipe: CommanderRecipeInternal): CommanderInvestigationProviderConfig {
  return validateCommanderInvestigationProviderConfig({
    transport_kind: recipe.transport_kind,
    provider_id: recipe.provider_id,
    provider_kind: recipe.provider_kind,
    connector_id: recipe.connector_id,
    model_id: recipe.model_id,
    enabled_phases: ["proposal_investigation"],
    timeout_ms: 30_000,
    max_request_bytes: 65_536,
    max_response_bytes: 65_536,
    max_context_bytes: 65_536,
    max_context_tokens: 32_768,
    max_output_tokens: 4_096,
    supports_tools: true,
    supports_json_schema: false,
    supports_long_context: "unknown",
    supports_local_execution: false,
  })
}

function commanderRecipe(recipeId: string, displayName: string, providerKind: "anthropic" | "google" | "openai", providerId: string, modelId: string, credentialBindingId: string, connectorId: string, conformanceId: string, transportKind: CommanderRecipeInternal["transport_kind"]): CommanderRecipeInternal {
  const stable = { recipe_version: 1 as const, recipe_id: recipeId, role: "commander" as const, display_name: displayName, provider_kind: providerKind, provider_id: providerId, model_id: modelId, credential_binding_id: credentialBindingId, connector_id: connectorId, conformance_id: conformanceId, transport_kind: transportKind }
  return deepFreeze({ ...stable, recipe_hash: hash(stable) })
}

function executorRecipe(recipeId: string, displayName: string, providerKind: "anthropic" | "google" | "openai", providerId: string, modelId: string, credentialBindingId: string, mappingId: string): ExecutorRecipeInternal {
  const stable = { recipe_version: 1 as const, recipe_id: recipeId, role: "executor" as const, display_name: displayName, provider_kind: providerKind, provider_id: providerId, model_id: modelId, credential_binding_id: credentialBindingId, mapping_id: mappingId }
  return deepFreeze({ ...stable, recipe_hash: hash(stable) })
}

function publicRecipe(item: CommanderRecipeInternal | ExecutorRecipeInternal): ModelSetupRecipe {
  return deepFreeze({ recipe_version: 1, recipe_id: item.recipe_id, role: item.role, display_name: item.display_name, provider_kind: item.provider_kind, provider_id: item.provider_id, model_id: item.model_id, credential_binding_id: item.credential_binding_id, recipe_hash: item.recipe_hash })
}

function freezeRecipes<T extends ModelSetupRecipe>(items: T[]): readonly T[] { return deepFreeze(items) }

function parseChoices(value: unknown): ModelSetupChoices {
  const input = strictRecord(value, "model setup choices", ["commander_recipe_id", "executor_recipe_id"])
  return deepFreeze({
    commander_recipe_id: nullableIdentifier(input.commander_recipe_id, "commander_recipe_id"),
    executor_recipe_id: nullableIdentifier(input.executor_recipe_id, "executor_recipe_id"),
  })
}

function parseCommitInput(value: unknown): ModelSetupCommitInput {
  const input = strictRecord(value, "model setup confirmation", ["commander_recipe_id", "executor_recipe_id", "expected_revision", "candidate_hash", "confirmed_by", "confirmation"])
  if (!Number.isInteger(input.expected_revision) || Number(input.expected_revision) < 0 || Number(input.expected_revision) > 1_000_000) throw new Error("model setup expected revision is invalid")
  if (typeof input.candidate_hash !== "string" || !/^[a-f0-9]{64}$/.test(input.candidate_hash)) throw new Error("model setup candidate hash is invalid")
  if (input.confirmation !== "CONFIRM_MODEL_SETUP") throw new Error("explicit model setup confirmation is required")
  return deepFreeze({
    ...parseChoices({ commander_recipe_id: input.commander_recipe_id, executor_recipe_id: input.executor_recipe_id }),
    expected_revision: Number(input.expected_revision),
    candidate_hash: input.candidate_hash,
    confirmed_by: setupOperatorIdentifier(input.confirmed_by),
    confirmation: "CONFIRM_MODEL_SETUP",
  })
}

function setupOperatorIdentifier(value: unknown): string {
  const identifier = validateAuthoritySafeIdentifier(value, "model setup confirmed_by", 160)
  if (/^(?:authorization|cookie|host|x-api-key|x-goog-api-key|anthropic-version|content-type)$/i.test(identifier)) {
    throw new Error("model setup confirmed_by must not be header-shaped")
  }
  return identifier
}

function strictRecord(value: unknown, label: string, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  rejectProxy(value, label)
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be a plain object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`)
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key === "symbol")) throw new Error(`${label} contains symbol fields`)
  for (const key of keys) if (typeof key !== "string" || !allowed.has(key)) throw new Error(`${label} contains unknown fields`)
  const output = Object.create(null) as Record<string, unknown>
  for (const key of requiredKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} requires own enumerable data fields`)
    output[key] = descriptor.value
  }
  for (const key of optionalKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} requires own enumerable data fields`)
    output[key] = descriptor.value
  }
  return output
}

function rejectProxy(value: unknown, label: string): void {
  try {
    if (typeof value === "object" && value !== null && nodeUtilTypes.isProxy(value)) throw new Error(`${label} must not be a Proxy`)
  } catch {
    throw new Error(`${label} must not be a Proxy`)
  }
}

function nullableIdentifier(value: unknown, label: string): string | null {
  return value === null ? null : validateAuthoritySafeIdentifier(value, label, 160)
}

function canonicalIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 40) throw new Error(`${label} is invalid`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} is invalid`)
  return value
}

function result(status: "committed" | "idempotent", revision: number, setupHash: string, candidateHash: string): ModelSetupCommitResult {
  return deepFreeze({ status, revision, setup_hash: setupHash, candidate_hash: candidateHash, restart_required: true })
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("model setup hash input must be finite")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value !== "object" || value === null) throw new Error("model setup hash input must be JSON")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
