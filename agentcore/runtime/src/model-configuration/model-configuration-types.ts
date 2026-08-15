import type { CommanderConnectorModelTransportKind } from "../commander-agent/commander-connector-transport-types"

export const MODEL_CONFIGURATION_SCHEMA_VERSION = 1 as const
export const MODEL_CONFIGURATION_POLICY_VERSION = "nexusloop_model_profile_policy_v1" as const
export const COMMANDER_MODEL_CONFORMANCE_REGISTRY_VERSION = 1 as const
export const COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION = "nexusloop_commander_conformance_policy_v1" as const
export const EXECUTOR_PROVIDER_MAPPING_REGISTRY_VERSION = 1 as const
export const EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION = "nexusloop_executor_provider_mapping_policy_v1" as const

export type ModelRole = "commander" | "executor"
export type ModelSelectionStatus = "selected"
export type ModelRoleReadinessStatus =
  | "executor_available"
  | "executor_connected"
  | "commander_verified"
  | "commander_unsupported"
  | "commander_configuration_incomplete"
  | "role_readiness_unknown"

export type CommanderConnectionMapping = Readonly<{
  connector_id: string
  conformance_id: string
}>

export type ExecutorConnectionMapping = Readonly<{
  provider_id: string
}>

export type ModelConnection = Readonly<{
  connection_version: 1
  connection_id: string
  provider_kind: string
  credential_binding_id: string
  commander?: CommanderConnectionMapping
  executor?: ExecutorConnectionMapping
  semantic_hash: string
  commander_authority_hash?: string
  executor_authority_hash?: string
}>

export type ModelProfile = Readonly<{
  profile_version: 1
  profile_id: string
  connection_id: string
  model_id: string
  display_name?: string
  semantic_hash: string
}>

export type RoleModelBinding = Readonly<{
  binding_version: 1
  role: ModelRole
  profile_id: string
  binding_hash: string
}>

export type ModelConfiguration = Readonly<{
  schema_version: 1
  policy_version: typeof MODEL_CONFIGURATION_POLICY_VERSION
  connections: readonly ModelConnection[]
  profiles: readonly ModelProfile[]
  role_bindings: readonly RoleModelBinding[]
  connection_registry_hash: string
  profile_registry_hash: string
  role_binding_registry_hash: string
  configuration_hash: string
}>

export type CommanderModelConformanceEntry = Readonly<{
  conformance_version: 1
  conformance_id: string
  provider_kind: string
  transport_kind: CommanderConnectorModelTransportKind
  provider_id: string
  model_id: string
  conformance_hash: string
}>

export type CommanderModelConformanceRegistry = Readonly<{
  registry_version: 1
  policy_version: typeof COMMANDER_MODEL_CONFORMANCE_POLICY_VERSION
  entries: readonly CommanderModelConformanceEntry[]
  policy_hash: string
  registry_hash: string
}>

export type ExecutorProviderMappingEntry = Readonly<{
  mapping_version: 1
  mapping_id: string
  provider_kind: string
  provider_ids: readonly string[]
  mapping_hash: string
}>

export type ExecutorProviderMappingRegistry = Readonly<{
  registry_version: 1
  policy_version: typeof EXECUTOR_PROVIDER_MAPPING_POLICY_VERSION
  entries: readonly ExecutorProviderMappingEntry[]
  policy_hash: string
  registry_hash: string
}>

export type CommanderModelSelectionProjection = Readonly<{
  projection_version: 1
  role: "commander"
  selection_status: "selected"
  support_status: "commander_verified"
  readiness_status: "role_readiness_unknown"
  connection_id: string
  profile_id: string
  provider_kind: string
  provider_id: string
  model_id: string
  credential_binding_id: string
  connector_id: string
  conformance_id: string
  transport_kind: CommanderConnectorModelTransportKind
  connection_authority_hash: string
  profile_hash: string
  binding_hash: string
  conformance_hash: string
  conformance_policy_hash: string
  projection_hash: string
}>

export type ExecutorModelSelectionProjection = Readonly<{
  projection_version: 1
  role: "executor"
  selection_status: "selected"
  availability_status: "role_readiness_unknown"
  connection_status: "role_readiness_unknown"
  connection_id: string
  profile_id: string
  provider_kind: string
  provider_id: string
  model_id: string
  credential_binding_id: string
  connection_authority_hash: string
  profile_hash: string
  binding_hash: string
  provider_mapping_id: string
  provider_mapping_hash: string
  provider_mapping_policy_hash: string
  projection_hash: string
}>
