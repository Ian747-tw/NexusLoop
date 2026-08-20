import { createHash } from "node:crypto"
import type { CommanderConnectorModelTransportKind } from "../commander-agent/commander-connector-transport-types"
import type { CommanderModelConformancePolicyVersion } from "./model-configuration-types"

export const PROVIDER_COMPATIBILITY_MATRIX_SCHEMA_VERSION = 1 as const
export const PROVIDER_COMPATIBILITY_MATRIX_POLICY_VERSION = "nexusloop_provider_compatibility_matrix_v1" as const

export type CommanderProviderCompatibilityEvidence = Readonly<{
  evidence_version: 1
  evidence_id: string
  provider_kind: string
  transport_kind: CommanderConnectorModelTransportKind
  verification_class: "verified_native_protocol" | "verified_openai_compatible_protocol"
  request_policy_id: string
  package_protocol_id: string
  client_tools_supported: true
  native_structured_output: "verified" | "not_verified"
  recovery_mode: "fresh_checkpoint_no_network_replay"
  streaming_supported: false
  retry_policy: "zero"
  stateful_server_behavior: "forbidden"
  minimum_commander_conformance_policy: CommanderModelConformancePolicyVersion
  evidence_hash: string
}>

export type CommanderProviderCompatibilityMatrix = Readonly<{
  schema_version: 1
  policy_version: typeof PROVIDER_COMPATIBILITY_MATRIX_POLICY_VERSION
  entries: readonly CommanderProviderCompatibilityEvidence[]
  matrix_hash: string
}>

const ENTRY_INPUTS = [
  {
    evidence_id: "anthropic-messages-native-v1",
    provider_kind: "anthropic",
    transport_kind: "anthropic_messages_connector",
    verification_class: "verified_native_protocol",
    request_policy_id: "anthropic_messages_v1",
    package_protocol_id: "ai@7.0.29/@ai-sdk/anthropic@4.0.15",
    native_structured_output: "not_verified",
    minimum_commander_conformance_policy: "nexusloop_commander_conformance_policy_v1",
  },
  {
    evidence_id: "google-generate-content-native-v1",
    provider_kind: "google",
    transport_kind: "google_generative_ai_connector",
    verification_class: "verified_native_protocol",
    request_policy_id: "google_generate_content_v1",
    package_protocol_id: "ai@7.0.29/@ai-sdk/google@4.0.15",
    native_structured_output: "not_verified",
    minimum_commander_conformance_policy: "nexusloop_commander_conformance_policy_v2",
  },
  {
    evidence_id: "openai-compatible-chat-completions-v1",
    provider_kind: "openai_compatible",
    transport_kind: "openai_compatible_connector",
    verification_class: "verified_openai_compatible_protocol",
    request_policy_id: "openai_compatible_chat_completions_v1",
    package_protocol_id: "ai@7.0.29/@ai-sdk/openai-compatible@3.0.11",
    native_structured_output: "verified",
    minimum_commander_conformance_policy: "nexusloop_commander_conformance_policy_v1",
  },
  {
    evidence_id: "openai-responses-native-v1",
    provider_kind: "openai",
    transport_kind: "openai_responses_connector",
    verification_class: "verified_native_protocol",
    request_policy_id: "openai_responses_stateless_v1",
    package_protocol_id: "ai@7.0.29/@ai-sdk/openai@4.0.15",
    native_structured_output: "not_verified",
    minimum_commander_conformance_policy: "nexusloop_commander_conformance_policy_v3",
  },
] as const

const ENTRIES = Object.freeze(ENTRY_INPUTS.map((input): CommanderProviderCompatibilityEvidence => {
  const semantic = {
    evidence_version: 1 as const,
    ...input,
    client_tools_supported: true as const,
    recovery_mode: "fresh_checkpoint_no_network_replay" as const,
    streaming_supported: false as const,
    retry_policy: "zero" as const,
    stateful_server_behavior: "forbidden" as const,
  }
  return Object.freeze({ ...semantic, evidence_hash: hash(semantic) })
}))

const MATRIX: CommanderProviderCompatibilityMatrix = Object.freeze({
  schema_version: PROVIDER_COMPATIBILITY_MATRIX_SCHEMA_VERSION,
  policy_version: PROVIDER_COMPATIBILITY_MATRIX_POLICY_VERSION,
  entries: ENTRIES,
  matrix_hash: hash({
    schema_version: PROVIDER_COMPATIBILITY_MATRIX_SCHEMA_VERSION,
    policy_version: PROVIDER_COMPATIBILITY_MATRIX_POLICY_VERSION,
    evidence_hashes: ENTRIES.map((entry) => entry.evidence_hash),
  }),
})

export function providerCompatibilityMatrix(): CommanderProviderCompatibilityMatrix {
  return MATRIX
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
