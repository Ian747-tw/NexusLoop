import { describe, expect, test } from "bun:test"
import {
  MODEL_CONFIGURATION_POLICY_VERSION,
  MODEL_CONFIGURATION_SCHEMA_VERSION,
  projectCommanderModelSelection,
  projectExecutorModelSelection,
  validateCommanderModelConformanceRegistry,
  validateExecutorProviderMappingRegistry,
  validateModelConfiguration,
} from "./model-configuration-kernel"

function configurationInput(options: { shared?: boolean; display?: string } = {}) {
  const shared = options.shared ?? true
  return {
    schema_version: 1,
    policy_version: "nexusloop_model_profile_policy_v1",
    connections: [
      {
        connection_id: "primary",
        provider_kind: "anthropic",
        credential_binding_id: "credential-primary",
        commander: { connector_id: "anthropic-main", conformance_id: "anthropic-claude-sonnet-4-5-native-v1" },
        executor: { provider_id: "anthropic" },
      },
      {
        connection_id: "executor-only",
        provider_kind: "opencode-cloud",
        credential_binding_id: "credential-executor",
        executor: { provider_id: "opencode" },
      },
    ],
    profiles: [
      {
        profile_id: "shared",
        connection_id: "primary",
        model_id: "claude-sonnet-4-5-20250929",
        display_name: options.display ?? "Claude Sonnet",
      },
      {
        profile_id: "executor",
        connection_id: "executor-only",
        model_id: "executor/model-v2",
      },
    ],
    role_bindings: [
      { role: "commander", profile_id: "shared" },
      { role: "executor", profile_id: shared ? "shared" : "executor" },
    ],
  }
}

function conformanceInput(modelId = "claude-sonnet-4-5-20250929") {
  return {
    registry_version: 1,
    policy_version: "nexusloop_commander_conformance_policy_v1",
    entries: [
      {
        conformance_version: 1,
        conformance_id: "anthropic-claude-sonnet-4-5-native-v1",
        provider_kind: "anthropic",
        transport_kind: "anthropic_messages_connector",
        provider_id: "anthropic-primary",
        model_id: modelId,
      },
    ],
  }
}

function executorProviderMappingInput() {
  return {
    registry_version: 1,
    policy_version: "nexusloop_executor_provider_mapping_policy_v1",
    entries: [
      {
        mapping_version: 1,
        mapping_id: "anthropic-opencode-v1",
        provider_kind: "anthropic",
        provider_ids: ["anthropic", "anthropic-enterprise", "Anthropic-Enterprise", "My_Provider"],
      },
      {
        mapping_version: 1,
        mapping_id: "opencode-cloud-v1",
        provider_kind: "opencode-cloud",
        provider_ids: ["opencode"],
      },
    ],
  }
}

function executorProjection(configuration: ReturnType<typeof validateModelConfiguration>, input = executorProviderMappingInput()) {
  return projectExecutorModelSelection(configuration, validateExecutorProviderMappingRegistry(input))
}

function projections(input = configurationInput()) {
  const config = validateModelConfiguration(input)
  const conformance = validateCommanderModelConformanceRegistry(conformanceInput())
  return {
    config,
    conformance,
    commander: projectCommanderModelSelection(config, conformance),
    executor: executorProjection(config),
  }
}

describe("unified model profiles and role-binding authority", () => {
  test("same profile can select Commander and the primary tactical Executor without sharing runtime authority", () => {
    const { commander, conformance, executor } = projections()
    expect(MODEL_CONFIGURATION_SCHEMA_VERSION).toBe(1)
    expect(MODEL_CONFIGURATION_POLICY_VERSION).toBe("nexusloop_model_profile_policy_v1")
    expect(commander.profile_id).toBe("shared")
    expect(executor.profile_id).toBe("shared")
    expect(commander.model_id).toBe(executor.model_id)
    expect(commander.transport_kind).toBe("anthropic_messages_connector")
    expect(commander.conformance_policy_hash).toBe(conformance.policy_hash)
    expect(executor.provider_id).toBe("anthropic")
    expect("connector_id" in executor).toBe(false)
    expect("transport_kind" in executor).toBe(false)
  })

  test("Gemini requires conformance policy v2 while legacy v1 hashes remain stable", () => {
    const input = configurationInput()
    input.connections[0].provider_kind = "google"
    input.connections[0].commander = { connector_id: "google-main", conformance_id: "google-gemini-native-v1" }
    input.profiles[0].model_id = "gemini-2.5-flash"
    const config = validateModelConfiguration(input)
    const gemini = validateCommanderModelConformanceRegistry({
      registry_version: 1,
      policy_version: "nexusloop_commander_conformance_policy_v2",
      entries: [{ conformance_version: 1, conformance_id: "google-gemini-native-v1", provider_kind: "google", transport_kind: "google_generative_ai_connector", provider_id: "google-primary", model_id: "gemini-2.5-flash" }],
    })
    expect(projectCommanderModelSelection(config, gemini)).toMatchObject({ provider_kind: "google", transport_kind: "google_generative_ai_connector", model_id: "gemini-2.5-flash" })
    expect(() => validateCommanderModelConformanceRegistry({ registry_version: 1, policy_version: "nexusloop_commander_conformance_policy_v1", entries: [{ conformance_version: 1, conformance_id: "google-gemini-native-v1", provider_kind: "google", transport_kind: "google_generative_ai_connector", provider_id: "google-primary", model_id: "gemini-2.5-flash" }] })).toThrow("policy v2")
    expect(validateCommanderModelConformanceRegistry(conformanceInput()).registry_hash).toBe(projections().conformance.registry_hash)
  })

  test("different profiles remain independently bound and missing roles never fall back", () => {
    const { commander, executor } = projections(configurationInput({ shared: false }))
    expect(commander.profile_id).toBe("shared")
    expect(executor.profile_id).toBe("executor")

    const missingExecutor = configurationInput()
    missingExecutor.role_bindings = [{ role: "commander", profile_id: "shared" }]
    const snapshot = validateModelConfiguration(missingExecutor)
    expect(() => executorProjection(snapshot)).toThrow("executor role binding is required")

    const missingCommander = configurationInput()
    missingCommander.role_bindings = [{ role: "executor", profile_id: "shared" }]
    const executorOnly = validateModelConfiguration(missingCommander)
    expect(() => projectCommanderModelSelection(executorOnly, validateCommanderModelConformanceRegistry(conformanceInput()))).toThrow("commander role binding is required")
  })

  test("Executor-only providers and OpenCode observations cannot authorize Commander", () => {
    const input = configurationInput({ shared: false })
    input.role_bindings = [{ role: "commander", profile_id: "executor" }, { role: "executor", profile_id: "executor" }]
    const snapshot = validateModelConfiguration(input)
    expect(() => projectCommanderModelSelection(snapshot, validateCommanderModelConformanceRegistry(conformanceInput()))).toThrow("Commander mapping is required")

    const noConformance = validateCommanderModelConformanceRegistry({ ...conformanceInput(), entries: [] })
    const normal = validateModelConfiguration(configurationInput())
    expect(() => projectCommanderModelSelection(normal, noConformance)).toThrow("static Commander conformance entry is required")

    for (const observation of [
      { opencode_authenticated: true },
      { opencode_catalog_models: ["claude-sonnet-4-5-20250929"] },
      { provider_list_connected: ["anthropic"] },
    ]) {
      expect(() => validateModelConfiguration({ ...configurationInput(), ...observation })).toThrow("unknown model configuration key")
    }
  })

  test("Executor projection requires trusted provider-kind mapping authority", () => {
    const mismatched = configurationInput()
    mismatched.connections[0].executor!.provider_id = "openai"
    const mismatchedConfig = validateModelConfiguration(mismatched)
    expect(() => executorProjection(mismatchedConfig)).toThrow("static Executor provider mapping authority is required")

    const conflictingAuthority = executorProviderMappingInput()
    conflictingAuthority.entries.push({
      mapping_version: 1,
      mapping_id: "openai-v1",
      provider_kind: "openai",
      provider_ids: ["openai"],
    })
    expect(() => executorProjection(mismatchedConfig, conflictingAuthority)).toThrow("provider mapping kind disagrees")

    const aliased = configurationInput()
    aliased.connections[0].executor!.provider_id = "Anthropic-Enterprise"
    expect(executorProjection(validateModelConfiguration(aliased))).toMatchObject({
      provider_kind: "anthropic",
      provider_id: "Anthropic-Enterprise",
      provider_mapping_id: "anthropic-opencode-v1",
    })

    const registry = validateExecutorProviderMappingRegistry(executorProviderMappingInput())
    const copied = structuredClone(registry) as unknown as { entries: Array<{ provider_kind: string }> }
    copied.entries[0].provider_kind = "openai"
    expect(() => projectExecutorModelSelection(validateModelConfiguration(configurationInput()), copied as unknown as typeof registry)).toThrow(
      "validated Executor provider mapping snapshot",
    )

    const unknown = { ...executorProviderMappingInput(), source: "provider.list" }
    expect(() => validateExecutorProviderMappingRegistry(unknown)).toThrow("unknown Executor provider mapping registry key")
    const duplicated = executorProviderMappingInput()
    duplicated.entries.push({ mapping_version: 1, mapping_id: "duplicate-v1", provider_kind: "anthropic", provider_ids: ["anthropic"] })
    expect(() => validateExecutorProviderMappingRegistry(duplicated)).toThrow("duplicate Executor provider ID authority")
  })

  test("model or provider name patterns cannot substitute for exact conformance", () => {
    const snapshot = validateModelConfiguration(configurationInput())
    expect(() => validateCommanderModelConformanceRegistry(conformanceInput("claude-*"))).toThrow("exact bounded model identifier")

    const wrongProvider = conformanceInput()
    wrongProvider.entries[0].provider_kind = "anthropic-compatible"
    wrongProvider.entries[0].transport_kind = "openai_compatible_connector"
    const registry = validateCommanderModelConformanceRegistry(wrongProvider)
    expect(() => projectCommanderModelSelection(snapshot, registry)).toThrow("provider kind disagrees")

    const unknownAuthority = conformanceInput()
    expect(() => validateCommanderModelConformanceRegistry({ ...unknownAuthority, source: "opencode" })).toThrow("unknown Commander conformance registry key")
    unknownAuthority.entries.push({ ...structuredClone(unknownAuthority.entries[0]), conformance_id: unknownAuthority.entries[0].conformance_id.toUpperCase() })
    expect(() => validateCommanderModelConformanceRegistry(unknownAuthority)).toThrow("duplicate conformance_id")
  })

  test("unknown authority fields and URL, header, package, plugin, environment, and secret material fail closed", () => {
    const cases: unknown[] = [
      { ...configurationInput(), extra: true },
      { ...configurationInput(), base_url: "https://example.test" },
      { ...configurationInput(), headers: { authorization: "Bearer x" } },
      { ...configurationInput(), npm: "@ai-sdk/anthropic" },
      { ...configurationInput(), plugin: "file:///tmp/provider.ts" },
      { ...configurationInput(), credential_env: "ANTHROPIC_API_KEY" },
      { ...configurationInput(), api_key: "sk-ant-secret" },
    ]
    for (const value of cases) expect(() => validateModelConfiguration(value)).toThrow()

    const badValue = configurationInput()
    badValue.connections[0].credential_binding_id = "ANTHROPIC_API_KEY"
    expect(() => validateModelConfiguration(badValue)).toThrow("environment-shaped")
    badValue.connections[0].credential_binding_id = "anthropic_api_key"
    expect(() => validateModelConfiguration(badValue)).toThrow("environment-shaped")
    for (const embeddedEnvironment of ["credential-ANTHROPIC_API_KEY", "credential-anthropic_api_key", "primary-OPENAI_API_KEY", "primary-HOME"]) {
      badValue.connections[0].credential_binding_id = embeddedEnvironment
      expect(() => validateModelConfiguration(badValue)).toThrow("environment-shaped")
    }
    for (const environmentName of ["PATH", "HOME", "TOKEN", "SECRET", "token", "secret"]) {
      badValue.connections[0].credential_binding_id = environmentName
      expect(() => validateModelConfiguration(badValue)).toThrow("environment-shaped")
    }
    badValue.connections[0].credential_binding_id = "sk-ant-api03-secret"
    expect(() => validateModelConfiguration(badValue)).toThrow("credential-shaped")
    for (const credential of [
      "xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx",
      "xapp-1-A123456789012345678901234567890",
      "AKIAIOSFODNN7EXAMPLE",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue1234567890",
      "ya29.a0AfH6SMBcredentialArtifact1234567890",
      "AIzaSyA123456789012345678901234567890123",
    ]) {
      badValue.connections[0].credential_binding_id = credential
      expect(() => validateModelConfiguration(badValue)).toThrow("credential-shaped")
    }
    badValue.connections[0].credential_binding_id = "opaque-but-unscoped"
    expect(() => validateModelConfiguration(badValue)).toThrow("opaque NexusLoop credential authority identifier")

    const hierarchicalUrl = configurationInput()
    hierarchicalUrl.profiles[0].model_id = "HTTPS://example.com"
    expect(() => validateModelConfiguration(hierarchicalUrl)).toThrow("exact bounded model identifier")
    for (const inertModelId of ["https:example.com", "file:provider.json", "vendor @ai-sdk/anthropic", "Cookie:sessionid", "X-Credential:value"]) {
      const inert = configurationInput()
      inert.profiles[0].model_id = inertModelId
      expect(validateModelConfiguration(inert).profiles.find((profile) => profile.profile_id === "shared")?.model_id).toBe(inertModelId)
    }

    for (const display of [
      "See https://secret.example/v1",
      "See:https://secret.example/v1",
      "endpoint:api.example.ca",
      "endpoint=api.example.ca",
      "ssh://internal-host",
      "urn:isbn:0451450523",
      "Model bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
      "Set-Cookie: sid=credential; HttpOnly",
      "Set-Cookie:sid=credential",
      "X-Credential:value",
    ]) {
      const embeddedUrl = configurationInput({ display })
      expect(() => validateModelConfiguration(embeddedUrl)).toThrow("forbidden URL")
    }
    expect(() => validateModelConfiguration(configurationInput({ display: "Basic dXNlcjpwYXNzd29yZA" }))).toThrow("credential-shaped")
    for (const display of ["Claude\u2028Injected", "Claude\u2029Injected", "Claude\u202eInjected"]) {
      expect(() => validateModelConfiguration(configurationInput({ display }))).toThrow("control characters")
    }
    for (const modelId of ["claude\u200bsonnet", "claude\u2028sonnet", "claude\u202esonnet"]) {
      const controlModel = configurationInput()
      controlModel.profiles[0].model_id = modelId
      expect(() => validateModelConfiguration(controlModel)).toThrow("control characters")
    }
    for (const display of ["Model $ANTHROPIC_API_KEY", "Model $X", "Model ${ANTHROPIC_API_KEY}", "Model ${OPENAI_API_KEY:-unset}", "env:OPENAI_API_KEY", "env:X", "credential env=OPENAI_API_KEY", "Windows %OPENAI_API_KEY%", "%USERPROFILE% model", "%CI% model"]) {
      expect(() => validateModelConfiguration(configurationInput({ display }))).toThrow("environment-shaped")
    }
    const environmentModel = configurationInput()
    environmentModel.profiles[0].model_id = "env:OPENAI_API_KEY"
    expect(() => validateModelConfiguration(environmentModel)).toThrow("environment-shaped")
    environmentModel.profiles[0].model_id = "env:X"
    expect(() => validateModelConfiguration(environmentModel)).toThrow("environment-shaped")
    const environmentProvider = configurationInput()
    environmentProvider.connections[0].executor!.provider_id = "env:OPENAI_API_KEY"
    expect(() => validateModelConfiguration(environmentProvider)).toThrow("environment-shaped")
    for (const packageReference of ["vendor @ai-sdk/anthropic", "Use @ai-sdk/anthropic"]) {
      const packageValue = configurationInput({ display: packageReference })
      expect(() => validateModelConfiguration(packageValue)).toThrow("package-shaped")
    }
    const credentialModel = configurationInput()
    credentialModel.profiles[0].model_id = "Basic dXNlcjpwYXNzd29yZA"
    expect(() => validateModelConfiguration(credentialModel)).toThrow("credential-shaped")
    expect(validateModelConfiguration(configurationInput({ display: "Basic Model" })).profiles.find((profile) => profile.profile_id === "shared")?.display_name).toBe("Basic Model")
    for (const display of [
      "/etc/passwd",
      "Config /etc/passwd",
      "../secrets/config",
      "Config ../secrets/config",
      "~/credentials",
      "Model ~/credentials",
      "C:\\Users\\me\\credentials",
      "Config C:\\Users\\me\\credentials",
      "Config \\\\server\\share",
    ]) {
      expect(() => validateModelConfiguration(configurationInput({ display }))).toThrow("path-shaped")
    }
    for (const display of ["User Model", "Home Assistant Model", "Temporary Shell Coder", "Claude / Sonnet"]) {
      expect(validateModelConfiguration(configurationInput({ display })).profiles.find((profile) => profile.profile_id === "shared")?.display_name).toBe(display)
    }
    for (const inertModelId of ["127.0.0.1", "127.0.0.1:8080/v1", "api.openai.com", "secret.example/v1", "1::1"]) {
      const inert = configurationInput()
      inert.profiles[0].model_id = inertModelId
      expect(validateModelConfiguration(inert).profiles.find((profile) => profile.profile_id === "shared")?.model_id).toBe(inertModelId)
    }
    for (const display of ["endpoint api.openai.com", "endpoint api.example.ca", "endpoint 1::1"]) {
      const bareDisplayEndpoint = configurationInput({ display })
      expect(() => validateModelConfiguration(bareDisplayEndpoint)).toThrow("forbidden URL")
    }

    const secretKey = "AKIAIOSFODNN7EXAMPLE"
    let unknownKeyError = ""
    try {
      validateModelConfiguration({ ...configurationInput(), [secretKey]: true })
    } catch (error) {
      unknownKeyError = String(error)
    }
    expect(unknownKeyError).toContain("unknown model configuration key")
    expect(unknownKeyError).not.toContain(secretKey)

    const assignedSecret = configurationInput({ display: "api_key=supersecretvalue" })
    expect(() => validateModelConfiguration(assignedSecret)).toThrow("credential-shaped")
    for (const privateKey of [
      "-----BEGIN PRIVATE KEY----- MC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA -----END PRIVATE KEY-----",
      "BEGIN OPENSSH PRIVATE KEY credential body END OPENSSH PRIVATE KEY",
    ]) {
      expect(() => validateModelConfiguration(configurationInput({ display: privateKey }))).toThrow("credential-shaped")
      const privateKeyModel = configurationInput()
      privateKeyModel.profiles[0].model_id = privateKey
      expect(() => validateModelConfiguration(privateKeyModel)).toThrow("credential-shaped")
    }

    for (const control of ["Claude\nInjected", "Claude\rInjected", "Claude\0Injected", "Claude\u007fInjected"]) {
      expect(() => validateModelConfiguration(configurationInput({ display: control }))).toThrow("control characters")
    }
    expect(() => validateModelConfiguration(configurationInput({ display: "Claude\u0085Injected" }))).toThrow("control characters")
    for (const mutate of [
      (value: ReturnType<typeof configurationInput>) => value.profiles[0].model_id = "model\n",
      (value: ReturnType<typeof configurationInput>) => value.connections[0].connection_id = "primary\t",
      (value: ReturnType<typeof configurationInput>) => value.connections[0].credential_binding_id = "credential-primary\r",
    ]) {
      const controlled = configurationInput()
      mutate(controlled)
      expect(() => validateModelConfiguration(controlled)).toThrow("control characters")
    }

    const callbackValue = configurationInput()
    Object.assign(callbackValue.connections[0], { commander: () => "redirect" })
    expect(() => validateModelConfiguration(callbackValue)).toThrow("commander must be an object")
  })

  test("own __proto__ fields cannot inject inherited configuration authority", () => {
    let inheritedAccessorCalls = 0
    const inherited = configurationInput()
    Object.defineProperty(inherited, "connections", {
      enumerable: true,
      get() {
        inheritedAccessorCalls += 1
        return configurationInput().connections
      },
    })
    const input = Object.create(Object.prototype) as Record<string, unknown>
    Object.defineProperty(input, "__proto__", {
      value: inherited,
      enumerable: true,
      configurable: true,
      writable: true,
    })

    expect(() => validateModelConfiguration(input)).toThrow("unknown model configuration key")
    expect(inheritedAccessorCalls).toBe(0)
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype)
  })

  test("inherited Object.prototype fields never satisfy required authority", () => {
    let getterCalls = 0
    Object.defineProperty(Object.prototype, "schema_version", {
      configurable: true,
      get() {
        getterCalls += 1
        return 1
      },
    })
    Object.defineProperty(Object.prototype, "registry_version", {
      configurable: true,
      get() {
        getterCalls += 1
        return 1
      },
    })
    try {
      const configuration = configurationInput() as Partial<ReturnType<typeof configurationInput>>
      delete configuration.schema_version
      expect(() => validateModelConfiguration(configuration)).toThrow("schema_version must be 1")

      const conformance = conformanceInput() as Partial<ReturnType<typeof conformanceInput>>
      delete conformance.registry_version
      expect(() => validateCommanderModelConformanceRegistry(conformance)).toThrow("registry_version must be 1")

      const executor = executorProviderMappingInput() as Partial<ReturnType<typeof executorProviderMappingInput>>
      delete executor.registry_version
      expect(() => validateExecutorProviderMappingRegistry(executor)).toThrow("registry_version must be 1")
      expect(getterCalls).toBe(0)
    } finally {
      delete (Object.prototype as Record<string, unknown>).schema_version
      delete (Object.prototype as Record<string, unknown>).registry_version
    }
  })

  test("validators reject live and revoked Proxies before caller traps execute", () => {
    let trapCalls = 0
    const traps: ProxyHandler<object> = {
      get() { trapCalls += 1; return undefined },
      getOwnPropertyDescriptor() { trapCalls += 1; return undefined },
      getPrototypeOf() { trapCalls += 1; return Object.prototype },
      has() { trapCalls += 1; return false },
      ownKeys() { trapCalls += 1; return [] },
    }

    for (const [validate, target] of [
      [validateModelConfiguration, {}],
      [validateCommanderModelConformanceRegistry, {}],
      [validateExecutorProviderMappingRegistry, {}],
    ] as const) {
      expect(() => validate(new Proxy(target, traps))).toThrow("must not be a Proxy")
      expect(trapCalls).toBe(0)
    }

    for (const field of ["connections", "profiles", "role_bindings"] as const) {
      const input = configurationInput()
      const target = input[field].map(() => null) as unknown as typeof input[typeof field]
      ;(input as unknown as Record<string, unknown>)[field] = new Proxy(target, traps as ProxyHandler<typeof target>)
      expect(() => validateModelConfiguration(input)).toThrow("must not be a Proxy")
      expect(trapCalls).toBe(0)
    }

    const nestedConnection = configurationInput()
    nestedConnection.connections[0] = new Proxy({}, traps) as typeof nestedConnection.connections[0]
    expect(() => validateModelConfiguration(nestedConnection)).toThrow("must not be a Proxy")
    expect(trapCalls).toBe(0)

    for (const validate of [validateModelConfiguration, validateCommanderModelConformanceRegistry, validateExecutorProviderMappingRegistry] as const) {
      const revoked = Proxy.revocable({}, traps)
      revoked.revoke()
      expect(() => validate(revoked.proxy)).toThrow("must not be a Proxy")
      expect(trapCalls).toBe(0)
    }
  })

  test("projections reject Proxy authority and nested hash values without executing traps", () => {
    const configuration = validateModelConfiguration(configurationInput())
    const conformance = validateCommanderModelConformanceRegistry(conformanceInput())
    const executor = validateExecutorProviderMappingRegistry(executorProviderMappingInput())
    let trapCalls = 0
    const traps: ProxyHandler<object> = {
      get() { trapCalls += 1; return undefined },
      getOwnPropertyDescriptor() { trapCalls += 1; return undefined },
      getPrototypeOf() { trapCalls += 1; return Object.prototype },
      has() { trapCalls += 1; return false },
      ownKeys() { trapCalls += 1; return [] },
    }

    expect(() => projectCommanderModelSelection(new Proxy(configuration, traps) as typeof configuration, conformance)).toThrow("must not be a Proxy")
    expect(() => projectCommanderModelSelection(configuration, new Proxy(conformance, traps) as typeof conformance)).toThrow("must not be a Proxy")
    expect(() => projectExecutorModelSelection(new Proxy(configuration, traps) as typeof configuration, executor)).toThrow("must not be a Proxy")
    expect(() => projectExecutorModelSelection(configuration, new Proxy(executor, traps) as typeof executor)).toThrow("must not be a Proxy")
    expect(trapCalls).toBe(0)

    const nestedHashProxy = new Proxy({}, traps)
    const copied = structuredClone(configuration) as unknown as Record<string, unknown>
    copied.configuration_hash = nestedHashProxy
    expect(() => projectCommanderModelSelection(copied as unknown as typeof configuration, conformance)).toThrow("must not be a Proxy")
    expect(trapCalls).toBe(0)

    const revoked = Proxy.revocable(structuredClone(configuration), traps)
    revoked.revoke()
    expect(() => projectCommanderModelSelection(revoked.proxy as typeof configuration, conformance)).toThrow("must not be a Proxy")
    expect(trapCalls).toBe(0)
  })

  test("duplicates and dangling references fail after normalized identity", () => {
    const duplicateConnection = configurationInput()
    duplicateConnection.connections.push({ ...structuredClone(duplicateConnection.connections[0]), connection_id: "PRIMARY" })
    expect(() => validateModelConfiguration(duplicateConnection)).toThrow("duplicate connection_id")

    const duplicateProfile = configurationInput()
    duplicateProfile.profiles.push({ ...structuredClone(duplicateProfile.profiles[0]), profile_id: "SHARED" })
    expect(() => validateModelConfiguration(duplicateProfile)).toThrow("duplicate profile_id")

    const duplicateRole = configurationInput()
    duplicateRole.role_bindings.push({ role: "commander", profile_id: "shared" })
    expect(() => validateModelConfiguration(duplicateRole)).toThrow("duplicate role binding")

    const danglingConnection = configurationInput()
    danglingConnection.profiles[0].connection_id = "missing"
    expect(() => validateModelConfiguration(danglingConnection)).toThrow("unknown connection")

    const danglingProfile = configurationInput()
    danglingProfile.role_bindings[0].profile_id = "missing"
    expect(() => validateModelConfiguration(danglingProfile)).toThrow("unknown profile")
  })

  test("provider-kind disagreement and malformed or oversized identifiers fail", () => {
    const mismatch = configurationInput()
    mismatch.connections[0].provider_kind = "openai"
    const snapshot = validateModelConfiguration(mismatch)
    expect(() => projectCommanderModelSelection(snapshot, validateCommanderModelConformanceRegistry(conformanceInput()))).toThrow("provider kind disagrees")

    for (const bad of ["", "../provider", "provider name", "provider\u0430", "x".repeat(161)]) {
      const input = configurationInput()
      input.connections[0].connection_id = bad
      expect(() => validateModelConfiguration(input)).toThrow()
    }
  })

  test("accepted snapshots are deeply immutable and detached from caller ownership", async () => {
    const input = configurationInput()
    const snapshot = validateModelConfiguration(input)
    const originalHash = snapshot.configuration_hash
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.connections)).toBe(true)
    expect(Object.isFrozen(snapshot.connections[0])).toBe(true)
    expect(Object.isFrozen(snapshot.connections[0].commander)).toBe(true)
    expect(Object.isFrozen(snapshot.profiles)).toBe(true)
    expect(Object.isFrozen(snapshot.role_bindings)).toBe(true)

    input.connections[0].provider_kind = "redirected"
    input.connections[0].commander!.connector_id = "redirected"
    input.profiles[0].model_id = "redirected"
    input.role_bindings[0].profile_id = "executor"
    const registry = validateCommanderModelConformanceRegistry(conformanceInput())
    const delayed = Promise.resolve().then(() => projectCommanderModelSelection(snapshot, registry))
    input.connections.splice(0)
    const commander = await delayed
    expect(commander.model_id).toBe("claude-sonnet-4-5-20250929")
    expect(commander.connector_id).toBe("anthropic-main")
    expect(snapshot.configuration_hash).toBe(originalHash)
  })

  test("validation reconstructs dense arrays without invoking caller-controlled array behavior", () => {
    for (const method of ["slice", "map", "sort"] as const) {
      const input = configurationInput()
      let calls = 0
      Object.defineProperty(input.connections, method, {
        configurable: true,
        enumerable: true,
        value: () => {
          calls += 1
          return [{
            connection_version: 1,
            connection_id: "forged",
            provider_kind: "forged",
            credential_binding_id: "credential-forged",
            semantic_hash: "forged",
            fetch: () => undefined,
            plugin: "forged",
            callback: () => undefined,
          }]
        },
      })
      expect(() => validateModelConfiguration(input)).toThrow("non-index properties")
      expect(calls).toBe(0)
    }

    const iteratorInput = configurationInput()
    let iteratorCalls = 0
    Object.defineProperty(iteratorInput.profiles, Symbol.iterator, {
      configurable: true,
      value: () => {
        iteratorCalls += 1
        return [][Symbol.iterator]()
      },
    })
    expect(() => validateModelConfiguration(iteratorInput)).toThrow("non-index properties")
    expect(iteratorCalls).toBe(0)

    const sparse = configurationInput()
    sparse.role_bindings = new Array(1) as typeof sparse.role_bindings
    expect(() => validateModelConfiguration(sparse)).toThrow("dense enumerable data")

    const inheritedOverride = configurationInput()
    let inheritedCalls = 0
    Object.setPrototypeOf(inheritedOverride.connections, Object.assign(Object.create(Array.prototype), {
      map: () => { inheritedCalls += 1; return [] },
    }))
    expect(() => validateModelConfiguration(inheritedOverride)).toThrow("plain array")
    expect(inheritedCalls).toBe(0)

    const unknownFunction = configurationInput()
    Object.assign(unknownFunction.connections[0], { fetch: () => undefined, plugin: "forged", callback: () => undefined })
    expect(() => validateModelConfiguration(unknownFunction)).toThrow("unknown connections[0] key")
  })

  test("registries reject sparse and behavior-bearing arrays before projection", () => {
    const sparseAliases = executorProviderMappingInput()
    sparseAliases.entries[0].provider_ids = new Array(1) as string[]
    expect(() => validateExecutorProviderMappingRegistry(sparseAliases)).toThrow("dense enumerable data")

    const conformance = conformanceInput()
    let conformanceMapCalls = 0
    Object.defineProperty(conformance.entries, "map", {
      enumerable: true,
      value: () => { conformanceMapCalls += 1; return [] },
    })
    expect(() => validateCommanderModelConformanceRegistry(conformance)).toThrow("non-index properties")
    expect(conformanceMapCalls).toBe(0)

    const mapping = executorProviderMappingInput()
    let aliasSortCalls = 0
    Object.defineProperty(mapping.entries[0].provider_ids, "sort", {
      enumerable: true,
      value: () => { aliasSortCalls += 1; return [] },
    })
    expect(() => validateExecutorProviderMappingRegistry(mapping)).toThrow("non-index properties")
    expect(aliasSortCalls).toBe(0)
  })

  test("projection entry points revalidate copied configuration and conformance authority", () => {
    const config = validateModelConfiguration(configurationInput())
    const registry = validateCommanderModelConformanceRegistry(conformanceInput())
    const copiedConfig = structuredClone(config) as unknown as { profiles: Array<{ model_id: string }> }
    copiedConfig.profiles[0].model_id = "redirected-model"
    expect(() => projectCommanderModelSelection(copiedConfig as unknown as typeof config, registry)).toThrow("validated model configuration snapshot")

    const copiedRegistry = structuredClone(registry) as unknown as { entries: Array<{ model_id: string }> }
    copiedRegistry.entries[0].model_id = "redirected-model"
    expect(() => projectCommanderModelSelection(config, copiedRegistry as unknown as typeof registry)).toThrow("validated Commander conformance snapshot")

    const behaviorBearingRegistry = structuredClone(registry)
    let conformanceSortCalls = 0
    Object.defineProperty(behaviorBearingRegistry.entries, "sort", {
      enumerable: true,
      value: () => { conformanceSortCalls += 1; return [] },
    })
    expect(() => projectCommanderModelSelection(config, behaviorBearingRegistry)).toThrow("non-index properties")
    expect(conformanceSortCalls).toBe(0)

    const executorRegistry = validateExecutorProviderMappingRegistry(executorProviderMappingInput())
    const copiedExecutorRegistry = structuredClone(executorRegistry)
    let executorMapCalls = 0
    Object.defineProperty(copiedExecutorRegistry.entries, "map", {
      enumerable: true,
      value: () => { executorMapCalls += 1; return [] },
    })
    expect(() => projectExecutorModelSelection(config, copiedExecutorRegistry)).toThrow("non-index properties")
    expect(executorMapCalls).toBe(0)

    const copiedConfiguration = structuredClone(config)
    let configurationIteratorCalls = 0
    Object.defineProperty(copiedConfiguration.connections, Symbol.iterator, {
      value: () => { configurationIteratorCalls += 1; return [][Symbol.iterator]() },
    })
    expect(() => projectCommanderModelSelection(copiedConfiguration, registry)).toThrow("non-index properties")
    expect(configurationIteratorCalls).toBe(0)

    expect(projectCommanderModelSelection(config, registry).profile_id).toBe("shared")
    expect(projectExecutorModelSelection(config, executorRegistry).profile_id).toBe("shared")
  })

  test("exact model IDs preserve case while semantic authority identifiers normalize", () => {
    const input = configurationInput()
    input.connections[0].connection_id = "Primary"
    input.profiles[0].connection_id = "PRIMARY"
    input.profiles[0].model_id = "Claude-Sonnet-Case-Sensitive"
    const config = validateModelConfiguration(input)
    expect(config.connections.find((item) => item.connection_id === "primary")).toBeDefined()
    expect(config.profiles.find((item) => item.profile_id === "shared")?.model_id).toBe("Claude-Sonnet-Case-Sensitive")

    const tagged = configurationInput()
    tagged.profiles[0].model_id = "qwen2.5-coder:7b"
    expect(validateModelConfiguration(tagged).profiles.find((item) => item.profile_id === "shared")?.model_id).toBe("qwen2.5-coder:7b")

    const bedrock = configurationInput()
    bedrock.profiles[0].model_id = "us.anthropic.claude-opus-4-5-20251101-v1:0"
    const bedrockConfig = validateModelConfiguration(bedrock)
    expect(bedrockConfig.profiles.find((item) => item.profile_id === "shared")?.model_id).toBe(
      "us.anthropic.claude-opus-4-5-20251101-v1:0",
    )
    const bedrockConformance = conformanceInput()
    bedrockConformance.entries[0].model_id = "us.anthropic.claude-opus-4-5-20251101-v1:0"
    expect(projectCommanderModelSelection(bedrockConfig, validateCommanderModelConformanceRegistry(bedrockConformance)).model_id).toBe(
      "us.anthropic.claude-opus-4-5-20251101-v1:0",
    )
    for (const modelId of ["anthropic.claude-opus-4-5-20251101-v1:0", "amazon.nova-pro-v1:0", "cohere.command-r-plus-v1:0"]) {
      const model = configurationInput()
      model.profiles[0].model_id = modelId
      const modelConfig = validateModelConfiguration(model)
      const conformance = conformanceInput()
      conformance.entries[0].model_id = modelId
      expect(projectCommanderModelSelection(modelConfig, validateCommanderModelConformanceRegistry(conformance)).model_id).toBe(modelId)
    }
    for (const modelId of ["global.anthropic.claude-sonnet-4-6", "anthropic.claude-sonnet-4-6", "mistral.ministral-3-8b-instruct"]) {
      const model = configurationInput()
      model.profiles[0].model_id = modelId
      const modelConfig = validateModelConfiguration(model)
      const conformance = conformanceInput()
      conformance.entries[0].model_id = modelId
      expect(projectCommanderModelSelection(modelConfig, validateCommanderModelConformanceRegistry(conformance)).model_id).toBe(modelId)
    }
    const slashQualified = configurationInput({ shared: false })
    slashQualified.profiles[1].model_id = "rednote-hilab/dots.ocr"
    expect(executorProjection(validateModelConfiguration(slashQualified)).model_id).toBe("rednote-hilab/dots.ocr")
    for (const modelId of ["claude-sonnet-4-6@default", "workers-ai/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"]) {
      const atQualified = configurationInput({ shared: false })
      atQualified.profiles[1].model_id = modelId
      expect(executorProjection(validateModelConfiguration(atQualified)).model_id).toBe(modelId)
    }
    for (const modelId of ["Llama-3.3+(3v3.3)-70B-TenyxChat-DaybreakStorywriter", "NousResearch 2/hermes-4-70b", "aion-labs.aion-2-0"]) {
      const catalogModel = configurationInput({ shared: false })
      catalogModel.profiles[1].model_id = modelId
      expect(executorProjection(validateModelConfiguration(catalogModel)).model_id).toBe(modelId)
    }
    for (const modelId of ["hf:moonshotai/Kimi-K2.5", "corethink:free"]) {
      const catalogModel = configurationInput({ shared: false })
      catalogModel.profiles[1].model_id = modelId
      expect(executorProjection(validateModelConfiguration(catalogModel)).model_id).toBe(modelId)

      const conformance = conformanceInput(modelId)
      expect(validateCommanderModelConformanceRegistry(conformance).entries[0]?.model_id).toBe(modelId)
    }

    for (const opaqueModelId of ["news:comp.lang.misc", "sip:user@host", "gateway:443", "service:8080", "modelhost:8080"]) {
      const opaque = configurationInput()
      opaque.profiles[0].model_id = opaqueModelId
      const opaqueConfig = validateModelConfiguration(opaque)
      const opaqueConformance = validateCommanderModelConformanceRegistry(conformanceInput(opaqueModelId))
      expect(projectCommanderModelSelection(opaqueConfig, opaqueConformance).model_id).toBe(opaqueModelId)
      expect("base_url" in projectCommanderModelSelection(opaqueConfig, opaqueConformance)).toBe(false)
    }
  })

  test("external connector and provider identities preserve exact case", () => {
    const input = configurationInput()
    input.connections[0].commander!.connector_id = "Anthropic-Main"
    input.connections[0].executor!.provider_id = "My_Provider"
    const registryInput = conformanceInput()
    registryInput.entries[0].provider_id = "Anthropic-Primary"

    const config = validateModelConfiguration(input)
    const registry = validateCommanderModelConformanceRegistry(registryInput)
    expect(projectCommanderModelSelection(config, registry).connector_id).toBe("Anthropic-Main")
    expect(projectCommanderModelSelection(config, registry).provider_id).toBe("Anthropic-Primary")
    expect(executorProjection(config).provider_id).toBe("My_Provider")

    const lower = configurationInput()
    lower.connections[0].commander!.connector_id = "anthropic-main"
    lower.connections[0].executor!.provider_id = "myprovider"
    const lowerConfig = validateModelConfiguration(lower)
    expect(lowerConfig.connections.find((item) => item.connection_id === "primary")?.semantic_hash).not.toBe(
      config.connections.find((item) => item.connection_id === "primary")?.semantic_hash,
    )
  })

  test("canonical hashes ignore unordered input and normalized identifier spelling", () => {
    const left = validateModelConfiguration(configurationInput())
    const rightInput = configurationInput()
    rightInput.connections.reverse()
    rightInput.profiles.reverse()
    rightInput.role_bindings.reverse()
    rightInput.connections[0].connection_id = rightInput.connections[0].connection_id.toUpperCase()
    rightInput.profiles[0].profile_id = rightInput.profiles[0].profile_id.toUpperCase()
    const right = validateModelConfiguration(rightInput)
    expect(right.configuration_hash).toBe(left.configuration_hash)
    expect(executorProjection(right).projection_hash).toBe(executorProjection(left).projection_hash)

    const registryLeft = conformanceInput()
    registryLeft.entries.push({
      conformance_version: 1,
      conformance_id: "openai-fixture-compat-v1",
      provider_kind: "openai",
      transport_kind: "openai_compatible_connector",
      provider_id: "fixture-provider",
      model_id: "fixture-model",
    })
    const registryRight = structuredClone(registryLeft)
    registryRight.entries.reverse()
    expect(validateCommanderModelConformanceRegistry(registryRight).registry_hash).toBe(validateCommanderModelConformanceRegistry(registryLeft).registry_hash)
  })

  test("hash invalidation is role-isolated and display or remote catalog data is non-semantic", () => {
    const base = projections()

    const modelChanged = configurationInput()
    modelChanged.profiles[0].model_id = "claude-sonnet-4-6"
    const changedConfig = validateModelConfiguration(modelChanged)
    const changedRegistry = validateCommanderModelConformanceRegistry(conformanceInput("claude-sonnet-4-6"))
    expect(projectCommanderModelSelection(changedConfig, changedRegistry).projection_hash).not.toBe(base.commander.projection_hash)
    expect(executorProjection(changedConfig).projection_hash).not.toBe(base.executor.projection_hash)

    const commanderOnly = configurationInput()
    commanderOnly.connections[0].commander!.connector_id = "anthropic-secondary"
    const commanderOnlyConfig = validateModelConfiguration(commanderOnly)
    expect(projectCommanderModelSelection(commanderOnlyConfig, validateCommanderModelConformanceRegistry(conformanceInput())).projection_hash).not.toBe(base.commander.projection_hash)
    expect(executorProjection(commanderOnlyConfig).projection_hash).toBe(base.executor.projection_hash)

    const executorOnly = configurationInput()
    executorOnly.connections[0].executor!.provider_id = "anthropic-enterprise"
    const executorOnlyConfig = validateModelConfiguration(executorOnly)
    expect(projectCommanderModelSelection(executorOnlyConfig, validateCommanderModelConformanceRegistry(conformanceInput())).projection_hash).toBe(base.commander.projection_hash)
    expect(executorProjection(executorOnlyConfig)).toMatchObject({ provider_id: "anthropic-enterprise", provider_mapping_id: "anthropic-opencode-v1" })
    expect(executorProjection(executorOnlyConfig).projection_hash).not.toBe(base.executor.projection_hash)

    const displayOnly = projections(configurationInput({ display: "Different label" }))
    expect(displayOnly.commander.projection_hash).toBe(base.commander.projection_hash)
    expect(displayOnly.executor.projection_hash).toBe(base.executor.projection_hash)

    const fresh = projections()
    expect(fresh.commander.projection_hash).toBe(base.commander.projection_hash)
    expect(fresh.executor.projection_hash).toBe(base.executor.projection_hash)

    const selectedMappingChanged = executorProviderMappingInput()
    selectedMappingChanged.entries[0].provider_ids.push("anthropic-new-alias")
    expect(executorProjection(base.config, selectedMappingChanged).projection_hash).not.toBe(base.executor.projection_hash)
    expect(projectCommanderModelSelection(base.config, base.conformance).projection_hash).toBe(base.commander.projection_hash)

    const unrelatedMappingAdded = executorProviderMappingInput()
    unrelatedMappingAdded.entries.push({ mapping_version: 1, mapping_id: "unrelated-v1", provider_kind: "unrelated", provider_ids: ["unrelated"] })
    expect(executorProjection(base.config, unrelatedMappingAdded).projection_hash).toBe(base.executor.projection_hash)
  })

  test("credential authority identity is semantic while secret rotation behind it is outside the configuration", () => {
    const base = projections()
    const changed = configurationInput()
    changed.connections[0].credential_binding_id = "credential-rotated-authority"
    const changedConfig = validateModelConfiguration(changed)
    const registry = validateCommanderModelConformanceRegistry(conformanceInput())
    expect(projectCommanderModelSelection(changedConfig, registry).projection_hash).not.toBe(base.commander.projection_hash)
    expect(executorProjection(changedConfig).projection_hash).not.toBe(base.executor.projection_hash)

    const sameAuthorityAfterSecretRotation = projections()
    expect(sameAuthorityAfterSecretRotation.commander.projection_hash).toBe(base.commander.projection_hash)
    expect(sameAuthorityAfterSecretRotation.executor.projection_hash).toBe(base.executor.projection_hash)
  })

  test("unrelated profiles change only registry authority, not selected projections", () => {
    const base = projections()
    const input = configurationInput()
    input.profiles.push({ profile_id: "unused", connection_id: "executor-only", model_id: "unused-model" })
    const changed = validateModelConfiguration(input)
    const registry = validateCommanderModelConformanceRegistry(conformanceInput())
    expect(changed.configuration_hash).not.toBe(base.config.configuration_hash)
    expect(projectCommanderModelSelection(changed, registry).projection_hash).toBe(base.commander.projection_hash)
    expect(executorProjection(changed).projection_hash).toBe(base.executor.projection_hash)
  })
})
