import type { CommanderInvestigationProviderReadiness } from "../commander-agent/commander-investigation-provider-types"
import type { CommanderModelSelectionProjection, ExecutorModelSelectionProjection } from "./model-configuration-types"

export const MODEL_PROFILE_RUNTIME_REGISTRY_VERSION = 1 as const
export const MODEL_PROFILE_RUNTIME_REGISTRY_POLICY_VERSION = "nexusloop_model_profile_runtime_registry_v1" as const
export const MODEL_ROLE_READINESS_VERSION = 1 as const
export const MODEL_ROLE_READINESS_POLICY_VERSION = "nexusloop_model_role_readiness_v1" as const

export type ModelProfileRuntimeAuthoritySource = "explicit" | "legacy_commander_environment"

export type ModelProfileRuntimeRegistrySnapshot = Readonly<{
  registry_version: 1
  policy_version: typeof MODEL_PROFILE_RUNTIME_REGISTRY_POLICY_VERSION
  authority_source: ModelProfileRuntimeAuthoritySource
  configuration_hash: string
  commander_conformance_registry_hash: string
  executor_provider_mapping_registry_hash: string
  commander_selection?: CommanderModelSelectionProjection
  executor_selection?: ExecutorModelSelectionProjection
  registry_hash: string
}>

export type ModelRoleReadinessEvidence = Readonly<{
  readiness_version: 1
  policy_version: typeof MODEL_ROLE_READINESS_POLICY_VERSION
  role: "commander" | "executor"
  selection_status: "selected" | "unconfigured"
  static_support_status: "verified" | "unsupported" | "incomplete"
  provider_availability_status: "available" | "unavailable" | "unknown"
  credential_connection_status: "connected" | "disconnected" | "unknown"
  configuration_status: "complete" | "incomplete" | "unknown"
  lifecycle_status: "ready" | "blocked" | "unknown" | "not_applicable"
  ready: boolean
  selection_projection_hash?: string
  evidence_id?: string
  blockers: readonly string[]
  warnings: readonly string[]
  generated_at: string
  readiness_hash: string
}>

export type ExecutorModelReadinessObservation = Readonly<{
  observation_version: 1
  selection_projection_hash: string
  provider_id: string
  model_id: string
  credential_binding_id: string
  provider_availability_status: "available" | "unavailable" | "unknown"
  credential_connection_status: "connected" | "disconnected" | "unknown"
  evidence_id: string
}>

export interface ExecutorModelReadinessResolver {
  observe(selection: ExecutorModelSelectionProjection): Promise<unknown> | unknown
}

export type CommanderModelReadinessInput = CommanderInvestigationProviderReadiness
