import { describe, expect, test } from "bun:test"
import {
  PROVIDER_COMPATIBILITY_MATRIX_POLICY_VERSION,
  providerCompatibilityMatrix,
} from "./provider-compatibility-matrix"

describe("verified Commander provider compatibility matrix", () => {
  test("contains exactly four immutable protocol evidence entries without selection authority", () => {
    const matrix = providerCompatibilityMatrix()
    expect(PROVIDER_COMPATIBILITY_MATRIX_POLICY_VERSION).toBe("nexusloop_provider_compatibility_matrix_v1")
    expect(matrix.entries.map((entry) => entry.transport_kind)).toEqual([
      "anthropic_messages_connector",
      "google_generative_ai_connector",
      "openai_compatible_connector",
      "openai_responses_connector",
    ])
    expect(matrix.entries.every((entry) => entry.client_tools_supported)).toBe(true)
    expect(matrix.entries.every((entry) => entry.retry_policy === "zero" && entry.streaming_supported === false)).toBe(true)
    expect(matrix.entries.find((entry) => entry.transport_kind === "openai_responses_connector")).toMatchObject({
      provider_kind: "openai",
      stateful_server_behavior: "forbidden",
      native_structured_output: "not_verified",
      minimum_commander_conformance_policy: "nexusloop_commander_conformance_policy_v3",
    })
    expect(JSON.stringify(matrix)).not.toMatch(/credential|environment|base_url|header|readiness|available|connected|model_id/i)
    expect(Object.isFrozen(matrix)).toBe(true)
    expect(Object.isFrozen(matrix.entries)).toBe(true)
    expect(Object.isFrozen(matrix.entries[0])).toBe(true)
    const second = providerCompatibilityMatrix()
    expect(second).toEqual(matrix)
    expect(second.matrix_hash).toBe(matrix.matrix_hash)
  })
})
