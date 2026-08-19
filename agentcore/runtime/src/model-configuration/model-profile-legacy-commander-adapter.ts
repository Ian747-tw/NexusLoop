import { createHash } from "node:crypto"
import { validateCommanderInvestigationProviderConfig } from "../commander-agent/commander-investigation-provider-config"
import type { CommanderInvestigationProviderConfig } from "../commander-agent/commander-investigation-provider-types"
import {
  COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
  COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION_V2,
  EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
  MODEL_CONFIGURATION_POLICY_VERSION,
  validateCommanderModelConformanceRegistry,
  validateExecutorProviderMappingRegistry,
  validateModelConfiguration,
} from "./model-configuration-kernel"
import { ModelProfileRuntimeRegistry } from "./model-profile-runtime-registry"

export type LegacyCommanderModelAuthority = Readonly<{
  provider_config: CommanderInvestigationProviderConfig
  registry: ModelProfileRuntimeRegistry
}>

export function adaptLegacyCommanderModelAuthority(value: unknown): LegacyCommanderModelAuthority {
  const providerConfig = validateCommanderInvestigationProviderConfig(value)
  const identity = hash({
    transport_kind: providerConfig.transport_kind,
    provider_id: providerConfig.provider_id,
    provider_kind: providerConfig.provider_kind,
    connector_id: providerConfig.connector_id,
    model_id: providerConfig.model_id,
  }).slice(0, 24)
  const connectionId = `legacy-commander-${identity}`
  const profileId = `legacy-commander-profile-${identity}`
  const conformanceId = `legacy-commander-conformance-${identity}`
  const configuration = validateModelConfiguration({
    schema_version: 1,
    policy_version: MODEL_CONFIGURATION_POLICY_VERSION,
    connections: [{
      connection_id: connectionId,
      provider_kind: providerConfig.provider_kind,
      credential_binding_id: `credential-legacy-${identity}`,
      commander: { connector_id: providerConfig.connector_id, conformance_id: conformanceId },
    }],
    profiles: [{ profile_id: profileId, connection_id: connectionId, model_id: providerConfig.model_id }],
    role_bindings: [{ role: "commander", profile_id: profileId }],
  })
  const commanderConformance = validateCommanderModelConformanceRegistry({
    registry_version: 1,
    policy_version: providerConfig.transport_kind === "google_generative_ai_connector" ? COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION_V2 : COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION,
    entries: [{
      conformance_version: 1,
      conformance_id: conformanceId,
      provider_kind: providerConfig.provider_kind,
      transport_kind: providerConfig.transport_kind,
      provider_id: providerConfig.provider_id,
      model_id: providerConfig.model_id,
    }],
  })
  const executorMapping = validateExecutorProviderMappingRegistry({
    registry_version: 1,
    policy_version: EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION,
    entries: [],
  })
  return Object.freeze({
    provider_config: providerConfig,
    registry: new ModelProfileRuntimeRegistry({
      authority_source: "legacy_commander_environment",
      configuration,
      commander_conformance: commanderConformance,
      executor_provider_mapping: executorMapping,
    }),
  })
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
