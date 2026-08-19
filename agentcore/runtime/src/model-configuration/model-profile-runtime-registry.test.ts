import { describe, expect, test } from "bun:test"
import type { CommanderInvestigationProviderReadiness } from "../commander-agent/commander-investigation-provider-types"
import {
  COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
  EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
  MODEL_CONFIGURATION_POLICY_VERSION,
  validateCommanderModelConformanceRegistry,
  validateExecutorProviderMappingRegistry,
  validateModelConfiguration,
} from "./model-configuration-kernel"
import {
  ModelProfileRuntimeRegistry,
  evaluateCommanderModelRoleReadiness,
  evaluateExecutorModelRoleReadiness,
} from "./model-profile-runtime-registry"

function validatedAuthority(options: { shared?: boolean } = {}) {
  const shared = options.shared !== false
  const configuration = validateModelConfiguration({
    schema_version: 1,
    policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
    connections: shared
      ? [{
          connection_id: "primary",
          provider_kind: "anthropic",
          credential_binding_id: "credential-primary",
          commander: { connector_id: "anthropic-main", conformance_id: "anthropic-native-v1" },
          executor: { provider_id: "anthropic" },
        }]
      : [
          {
            connection_id: "commander",
            provider_kind: "anthropic",
            credential_binding_id: "credential-commander",
            commander: { connector_id: "anthropic-main", conformance_id: "anthropic-native-v1" },
          },
          {
            connection_id: "executor",
            provider_kind: "openai",
            credential_binding_id: "credential-executor",
            executor: { provider_id: "openai" },
          },
        ],
    profiles: shared
      ? [{ profile_id: "shared", connection_id: "primary", model_id: "claude-sonnet-4-5-20250929" }]
      : [
          { profile_id: "commander", connection_id: "commander", model_id: "claude-sonnet-4-5-20250929" },
          { profile_id: "executor", connection_id: "executor", model_id: "gpt-5.2" },
        ],
    role_bindings: shared
      ? [
          { role: "commander", profile_id: "shared" },
          { role: "executor", profile_id: "shared" },
        ]
      : [
          { role: "commander", profile_id: "commander" },
          { role: "executor", profile_id: "executor" },
        ],
  })
  const commanderConformance = validateCommanderModelConformanceRegistry({
    registry_version: 1,
    policy_version: COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
    entries: [{
      conformance_version: 1,
      conformance_id: "anthropic-native-v1",
      provider_kind: "anthropic",
      transport_kind: "anthropic_messages_connector",
      provider_id: "anthropic-primary",
      model_id: "claude-sonnet-4-5-20250929",
    }],
  })
  const executorMappings = validateExecutorProviderMappingRegistry({
    registry_version: 1,
    policy_version: EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
    entries: [
      { mapping_version: 1, mapping_id: "anthropic-v1", provider_kind: "anthropic", provider_ids: ["anthropic"] },
      { mapping_version: 1, mapping_id: "openai-v1", provider_kind: "openai", provider_ids: ["openai"] },
    ],
  })
  return { configuration, commanderConformance, executorMappings }
}

function registry(options: { shared?: boolean } = {}) {
  const authority = validatedAuthority(options)
  return new ModelProfileRuntimeRegistry({
    authority_source: "explicit",
    configuration: authority.configuration,
    commander_conformance: authority.commanderConformance,
    executor_provider_mapping: authority.executorMappings,
  })
}

function commanderReadiness(overrides: Record<string, unknown> = {}): CommanderInvestigationProviderReadiness {
  return {
    readiness_id: "commander_provider_readiness_fixture",
    status: "ready",
    configuration_ready: true,
    execution_ready: true,
    provider_source: "configured_connector",
    provider_id: "anthropic-primary",
    provider_kind: "anthropic",
    connector_id: "anthropic-main",
    model_id: "claude-sonnet-4-5-20250929",
    enabled_phases: ["proposal_investigation"],
    default_tool_protocol: "native",
    runtime_mode: "active",
    runtime_lifecycle_state: "ready",
    runtime_started: true,
    run_lock_required: true,
    run_lock_held: true,
    supports_streaming: false,
    would_call_network: true,
    would_append_external_api_audit: true,
    checks: [],
    blockers: [],
    warnings: [],
    generated_at: "2026-08-18T00:00:00.000Z",
    network_called: false,
    events_appended: false,
    readiness_hash: "a".repeat(64),
    ...overrides,
  } as CommanderInvestigationProviderReadiness
}

describe("9W4B1 runtime model-profile registry", () => {
  test("constructs one immutable detached registry with shared or independent role projections", () => {
    const shared = registry()
    expect(shared.commanderSelection()).toMatchObject({ profile_id: "shared", provider_kind: "anthropic" })
    expect(shared.executorSelection()).toMatchObject({ profile_id: "shared", provider_id: "anthropic" })
    expect(shared.snapshot()).toMatchObject({ registry_version: 1, authority_source: "explicit" })
    expect(Object.isFrozen(shared.snapshot())).toBe(true)
    expect(Object.isFrozen(shared.snapshot().commander_selection)).toBe(true)

    const separate = registry({ shared: false })
    expect(separate.commanderSelection()?.model_id).toBe("claude-sonnet-4-5-20250929")
    expect(separate.executorSelection()?.model_id).toBe("gpt-5.2")
    expect(separate.commanderSelection()?.projection_hash).not.toBe(separate.executorSelection()?.projection_hash)
  })

  test("missing role bindings remain unconfigured and never fall back", () => {
    const authority = validatedAuthority()
    const raw = {
      schema_version: 1,
      policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
      connections: [{
        connection_id: "primary",
        provider_kind: "anthropic",
        credential_binding_id: "credential-primary",
        commander: { connector_id: "anthropic-main", conformance_id: "anthropic-native-v1" },
      }],
      profiles: [{ profile_id: "commander", connection_id: "primary", model_id: "claude-sonnet-4-5-20250929" }],
      role_bindings: [{ role: "commander", profile_id: "commander" }],
    }
    const value = new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: validateModelConfiguration(raw),
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })
    expect(value.commanderSelection()).toBeDefined()
    expect(value.executorSelection()).toBeUndefined()
    expect(evaluateExecutorModelRoleReadiness(value)).resolves.toMatchObject({ selection_status: "unconfigured", ready: false })
  })

  test("requires validated deeply frozen snapshots and rejects stale or duplicate authority", () => {
    const authority = validatedAuthority()
    const mutable = structuredClone(authority.configuration)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: mutable,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })).toThrow("deeply frozen")

    const stale = structuredClone(authority.configuration)
    ;(stale.profiles[0] as { model_id: string }).model_id = "redirected"
    deepFreeze(stale)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: stale,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })).toThrow("validated model configuration snapshot")

    const duplicate = structuredClone(authority.executorMappings)
    ;(duplicate.entries as Array<(typeof duplicate.entries)[number]>).push(structuredClone(duplicate.entries[0]!))
    deepFreeze(duplicate)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: authority.configuration,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: duplicate,
    })).toThrow()
  })

  test("revalidates configuration and both authority registries even when their roles are unbound", () => {
    const authority = validatedAuthority()
    const noBindings = validateModelConfiguration({
      schema_version: 1,
      policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
      connections: [{
        connection_id: "primary",
        provider_kind: "anthropic",
        credential_binding_id: "credential-primary",
        commander: { connector_id: "anthropic-main", conformance_id: "anthropic-native-v1" },
      }],
      profiles: [{ profile_id: "primary", connection_id: "primary", model_id: "claude-sonnet-4-5-20250929" }],
      role_bindings: [],
    })
    const forgedConfiguration = structuredClone(noBindings)
    ;(forgedConfiguration as { configuration_hash: string }).configuration_hash = "f".repeat(64)
    deepFreeze(forgedConfiguration)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: forgedConfiguration,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })).toThrow("validated model configuration snapshot")

    const executorOnly = validateModelConfiguration({
      schema_version: 1,
      policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
      connections: [{
        connection_id: "executor",
        provider_kind: "anthropic",
        credential_binding_id: "credential-executor",
        executor: { provider_id: "anthropic" },
      }],
      profiles: [{ profile_id: "executor", connection_id: "executor", model_id: "claude-sonnet-4-5-20250929" }],
      role_bindings: [{ role: "executor", profile_id: "executor" }],
    })
    const forgedCommander = structuredClone(authority.commanderConformance)
    ;(forgedCommander as { registry_hash: string }).registry_hash = "f".repeat(64)
    deepFreeze(forgedCommander)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: executorOnly,
      commander_conformance: forgedCommander,
      executor_provider_mapping: authority.executorMappings,
    })).toThrow("validated Commander conformance snapshot")

    const commanderOnly = validateModelConfiguration({
      schema_version: 1,
      policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
      connections: [{
        connection_id: "commander",
        provider_kind: "anthropic",
        credential_binding_id: "credential-commander",
        commander: { connector_id: "anthropic-main", conformance_id: "anthropic-native-v1" },
      }],
      profiles: [{ profile_id: "commander", connection_id: "commander", model_id: "claude-sonnet-4-5-20250929" }],
      role_bindings: [{ role: "commander", profile_id: "commander" }],
    })
    const forgedExecutor = structuredClone(authority.executorMappings)
    ;(forgedExecutor as { registry_hash: string }).registry_hash = "f".repeat(64)
    deepFreeze(forgedExecutor)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: commanderOnly,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: forgedExecutor,
    })).toThrow("validated Executor provider mapping snapshot")
  })

  test("rejects inherited fields, accessors, symbols, sparse arrays, and proxies without executing caller code", () => {
    const authority = validatedAuthority()
    let getterCalls = 0
    const accessorInput = Object.create(null)
    Object.defineProperties(accessorInput, {
      authority_source: { enumerable: true, value: "explicit" },
      configuration: { enumerable: true, get: () => { getterCalls += 1; return authority.configuration } },
      commander_conformance: { enumerable: true, value: authority.commanderConformance },
      executor_provider_mapping: { enumerable: true, value: authority.executorMappings },
    })
    expect(() => new ModelProfileRuntimeRegistry(accessorInput)).toThrow("data fields")
    expect(getterCalls).toBe(0)

    const inherited = Object.create({ authority_source: "explicit" })
    Object.assign(inherited, {
      configuration: authority.configuration,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })
    expect(() => new ModelProfileRuntimeRegistry(inherited)).toThrow("plain object")

    const symbolInput = {
      authority_source: "explicit",
      configuration: authority.configuration,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
      [Symbol("authority")]: true,
    }
    expect(() => new ModelProfileRuntimeRegistry(symbolInput)).toThrow("symbol")

    const sparse = structuredClone(authority.configuration)
    ;(sparse as { role_bindings: typeof sparse.role_bindings }).role_bindings = new Array(2) as typeof sparse.role_bindings
    deepFreeze(sparse)
    expect(() => new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: sparse,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })).toThrow("dense")

    let traps = 0
    const proxy = new Proxy({}, {
      ownKeys() { traps += 1; return ["authority_source", "configuration", "commander_conformance", "executor_provider_mapping"] },
      getOwnPropertyDescriptor() { traps += 1; return { configurable: true, enumerable: true, value: authority.configuration } },
      get() { traps += 1; return authority.configuration },
    })
    expect(() => new ModelProfileRuntimeRegistry(proxy)).toThrow("Proxy")
    expect(traps).toBe(0)

    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(() => new ModelProfileRuntimeRegistry(revoked.proxy)).toThrow("Proxy")
  })

  test("caller mutation cannot redirect accepted projections", () => {
    const authority = validatedAuthority()
    const value = new ModelProfileRuntimeRegistry({
      authority_source: "explicit",
      configuration: authority.configuration,
      commander_conformance: authority.commanderConformance,
      executor_provider_mapping: authority.executorMappings,
    })
    const copied = structuredClone(value.snapshot())
    ;(copied.executor_selection as { model_id: string }).model_id = "redirected"
    expect(value.executorSelection()?.model_id).toBe("claude-sonnet-4-5-20250929")
    expect(value.snapshot().executor_selection?.model_id).toBe("claude-sonnet-4-5-20250929")
  })

  test("registry detachment never invokes inherited toJSON behavior", () => {
    const authority = validatedAuthority()
    let calls = 0
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() { calls += 1; return { redirected: true } },
    })
    try {
      const value = new ModelProfileRuntimeRegistry({
        authority_source: "explicit",
        configuration: authority.configuration,
        commander_conformance: authority.commanderConformance,
        executor_provider_mapping: authority.executorMappings,
      })
      expect(value.commanderSelection()?.provider_id).toBe("anthropic-primary")
      expect(calls).toBe(0)
    } finally {
      delete (Object.prototype as { toJSON?: unknown }).toJSON
    }
  })

  test("Commander readiness composes exact configured-provider evidence", () => {
    const value = registry()
    const ready = evaluateCommanderModelRoleReadiness(value, commanderReadiness())
    expect(ready).toMatchObject({
      role: "commander",
      selection_status: "selected",
      static_support_status: "verified",
      provider_availability_status: "available",
      credential_connection_status: "connected",
      configuration_status: "complete",
      lifecycle_status: "ready",
      ready: true,
    })
    expect(ready.selection_projection_hash).toBe(value.commanderSelection()?.projection_hash)

    for (const mismatch of [
      { provider_id: "other" },
      { provider_kind: "openai" },
      { connector_id: "other" },
      { model_id: "other" },
      { provider_source: "injected_adapter" },
    ]) {
      expect(evaluateCommanderModelRoleReadiness(value, commanderReadiness(mismatch))).toMatchObject({ ready: false })
    }
  })

  test("Executor availability and credential connection are independent evidence", async () => {
    const value = registry()
    const unknown = await evaluateExecutorModelRoleReadiness(value)
    expect(unknown).toMatchObject({
      selection_status: "selected",
      static_support_status: "verified",
      provider_availability_status: "unknown",
      credential_connection_status: "unknown",
      ready: false,
    })

    const available = await evaluateExecutorModelRoleReadiness(value, {
      observe: () => ({
        observation_version: 1,
        selection_projection_hash: value.executorSelection()!.projection_hash,
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-5-20250929",
        credential_binding_id: "credential-primary",
        provider_availability_status: "available",
        credential_connection_status: "unknown",
        evidence_id: "readiness-provider-visible-v1",
      }),
    })
    expect(available).toMatchObject({ provider_availability_status: "available", credential_connection_status: "unknown", ready: false })

    const connected = await evaluateExecutorModelRoleReadiness(value, executorResolver(value, "readiness-connected-v1"))
    expect(connected).toMatchObject({ provider_availability_status: "available", credential_connection_status: "connected", ready: true })
    expect(connected.readiness_hash).not.toBe(available.readiness_hash)
  })

  test("Executor observations cannot create mapping authority or disagree with exact selection", async () => {
    const value = registry()
    for (const mismatch of [
      { provider_id: "openai" },
      { model_id: "other" },
      { credential_binding_id: "credential-other" },
      { selection_projection_hash: "b".repeat(64) },
    ]) {
      const result = await evaluateExecutorModelRoleReadiness(value, {
        observe: () => ({
          observation_version: 1,
          selection_projection_hash: value.executorSelection()!.projection_hash,
          provider_id: "anthropic",
          model_id: "claude-sonnet-4-5-20250929",
          credential_binding_id: "credential-primary",
          provider_availability_status: "available",
          credential_connection_status: "connected",
          evidence_id: "readiness-connected-v1",
          ...mismatch,
        }),
      })
      expect(result.ready).toBe(false)
    }
  })

  test("readiness evidence changes on secret rotation without changing selection hashes", async () => {
    const value = registry()
    const selectionHash = value.executorSelection()!.projection_hash
    const before = await evaluateExecutorModelRoleReadiness(value, executorResolver(value, "readiness-generation-1"))
    const after = await evaluateExecutorModelRoleReadiness(value, executorResolver(value, "readiness-generation-2"))
    expect(value.executorSelection()!.projection_hash).toBe(selectionHash)
    expect(before.readiness_hash).not.toBe(after.readiness_hash)
    expect(JSON.stringify([before, after, value.snapshot()])).not.toContain("API_KEY")
  })

  test("readiness observation parsing rejects accessors proxies sparse arrays and unknown or secret fields", async () => {
    const value = registry()
    let getterCalls = 0
    const accessor = Object.create(null)
    Object.defineProperty(accessor, "observation_version", { enumerable: true, get: () => { getterCalls += 1; return 1 } })
    const accessorResult = await evaluateExecutorModelRoleReadiness(value, { observe: () => accessor })
    expect(accessorResult.ready).toBe(false)
    expect(getterCalls).toBe(0)

    let traps = 0
    const proxy = new Proxy({}, {
      ownKeys() { traps += 1; return [] },
      getOwnPropertyDescriptor() { traps += 1; return undefined },
      get() { traps += 1; return undefined },
    })
    const proxyResult = await evaluateExecutorModelRoleReadiness(value, { observe: () => proxy })
    expect(proxyResult.ready).toBe(false)
    expect(traps).toBe(0)

    const unknown = await evaluateExecutorModelRoleReadiness(value, {
      observe: () => ({ ...executorObservation(value, "readiness-ok-v1"), auth_json: "secret" }),
    })
    expect(unknown.ready).toBe(false)

    const secret = await evaluateExecutorModelRoleReadiness(value, {
      observe: () => ({ ...executorObservation(value, "readiness-ok-v1"), evidence_id: "readiness-sk-secretvalue123456" }),
    })
    expect(secret.ready).toBe(false)
  })

  test("resolver failures disclose only one fixed public blocker", async () => {
    const value = registry()
    for (const detail of [
      "https://secret.example/v1",
      "NXL_EXECUTOR_API_KEY",
      "Authorization: Bearer credential-value",
      "x-api-key: sk-secretvalue123456",
      "AWS_SECRET_ACCESS_KEY=secret-material",
    ]) {
      const result = await evaluateExecutorModelRoleReadiness(value, { observe: () => { throw new Error(detail) } })
      expect(result.blockers).toEqual(["Executor readiness observation failed"])
      expect(JSON.stringify(result)).not.toContain(detail)
    }
  })

  test("readiness evidence IDs reuse the complete authority forbidden-shape policy", async () => {
    const value = registry()
    for (const evidenceId of [
      "AWS_PROFILE",
      "AUTH_JSON",
      "NXL_REGION",
      "https://secret.example",
      "Authorization:Bearer-value",
      "x-api-key:value",
      "npm:@scope/package",
      "plugin:provider-loader",
    ]) {
      const result = await evaluateExecutorModelRoleReadiness(value, {
        observe: () => executorObservation(value, evidenceId),
      })
      expect(result).toMatchObject({ ready: false, blockers: ["Executor readiness observation failed"] })
      expect(JSON.stringify(result)).not.toContain(evidenceId)
    }
  })

  test("Commander readiness details cannot forward forbidden authority material", () => {
    const value = registry()
    const forbidden = [
      "https://secret.example/v1",
      "NXL_COMMANDER_API_KEY",
      "Authorization: Bearer credential-value",
      "x-api-key: sk-secretvalue123456",
      "npm:@scope/provider",
    ]
    const result = evaluateCommanderModelRoleReadiness(value, commanderReadiness({ blockers: forbidden, warnings: forbidden }))
    expect(result.blockers).toEqual(forbidden.map(() => "Commander provider readiness detail withheld"))
    expect(result.warnings).toEqual(forbidden.map(() => "Commander provider readiness detail withheld"))
    for (const detail of forbidden) expect(JSON.stringify(result)).not.toContain(detail)
  })
})

function executorObservation(value: ModelProfileRuntimeRegistry, evidenceId: string) {
  const selection = value.executorSelection()!
  return {
    observation_version: 1,
    selection_projection_hash: selection.projection_hash,
    provider_id: selection.provider_id,
    model_id: selection.model_id,
    credential_binding_id: selection.credential_binding_id,
    provider_availability_status: "available",
    credential_connection_status: "connected",
    evidence_id: evidenceId,
  }
}

function executorResolver(value: ModelProfileRuntimeRegistry, evidenceId: string) {
  return { observe: () => executorObservation(value, evidenceId) }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}
