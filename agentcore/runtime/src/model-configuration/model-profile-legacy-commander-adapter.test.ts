import { describe, expect, test } from "bun:test"
import { readRuntimeServerLaunchOptionsFromEnv } from "../launch-config"
import { validateCommanderInvestigationProviderConfig } from "../commander-agent/commander-investigation-provider-config"
import { adaptLegacyCommanderModelAuthority } from "./model-profile-legacy-commander-adapter"

function config() {
  return validateCommanderInvestigationProviderConfig({
    transport_kind: "anthropic_messages_connector",
    provider_id: "anthropic-primary",
    provider_kind: "anthropic",
    connector_id: "anthropic-main",
    model_id: "claude-sonnet-4-5-20250929",
    enabled_phases: ["proposal_investigation"],
    timeout_ms: 30_000,
    max_request_bytes: 65_536,
    max_response_bytes: 65_536,
    max_context_bytes: 48_000,
    max_context_tokens: 16_000,
    max_output_tokens: 4_096,
    supports_tools: true,
    supports_json_schema: false,
    supports_long_context: true,
    supports_local_execution: false,
  })
}

describe("9W4B1 legacy Commander model authority adapter", () => {
  test("deterministically maps validated legacy authority to an exact Commander selection", () => {
    const first = adaptLegacyCommanderModelAuthority(config())
    const second = adaptLegacyCommanderModelAuthority(structuredClone(config()))
    expect(first.registry.snapshot()).toEqual(second.registry.snapshot())
    expect(first.registry.snapshot().authority_source).toBe("legacy_commander_environment")
    expect(first.registry.executorSelection()).toBeUndefined()
    expect(first.registry.commanderSelection()).toMatchObject({
      provider_kind: "anthropic",
      provider_id: "anthropic-primary",
      connector_id: "anthropic-main",
      model_id: "claude-sonnet-4-5-20250929",
      transport_kind: "anthropic_messages_connector",
    })
  })

  test("compatibility identifiers contain no environment name credential value URL or header", () => {
    const serialized = JSON.stringify(adaptLegacyCommanderModelAuthority(config()).registry.snapshot())
    expect(serialized).not.toContain("NXL_")
    expect(serialized).not.toContain("API_KEY")
    expect(serialized).not.toContain("x-api-key")
    expect(serialized).not.toContain("https://")
    expect(serialized).not.toContain("secret")
  })

  test("legacy environment remains absent or disabled and malformed input still fails through the existing parser", () => {
    expect(readRuntimeServerLaunchOptionsFromEnv({} as Record<string, string | undefined>).commanderInvestigationProviderConfig).toBeUndefined()
    expect(readRuntimeServerLaunchOptionsFromEnv({ NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED: "0" }).commanderInvestigationProviderConfig).toBeUndefined()
    expect(() => readRuntimeServerLaunchOptionsFromEnv({
      NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED: "1",
      NXL_COMMANDER_INVESTIGATION_PROVIDER_ID: "incomplete",
    })).toThrow()
  })

  test("explicit model registry and legacy environment authority fail closed instead of merging", () => {
    const explicit = adaptLegacyCommanderModelAuthority(config()).registry
    expect(() => readRuntimeServerLaunchOptionsFromEnv({
      NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED: "1",
      NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND: "anthropic_messages_connector",
      NXL_COMMANDER_INVESTIGATION_PROVIDER_ID: "anthropic-primary",
      NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND: "anthropic",
      NXL_COMMANDER_INVESTIGATION_CONNECTOR_ID: "anthropic-main",
      NXL_COMMANDER_INVESTIGATION_MODEL_ID: "claude-sonnet-4-5-20250929",
      NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES: "proposal_investigation",
      NXL_COMMANDER_INVESTIGATION_TIMEOUT_MS: "30000",
      NXL_COMMANDER_INVESTIGATION_MAX_REQUEST_BYTES: "65536",
      NXL_COMMANDER_INVESTIGATION_MAX_RESPONSE_BYTES: "65536",
      NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_BYTES: "48000",
      NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_TOKENS: "16000",
      NXL_COMMANDER_INVESTIGATION_MAX_OUTPUT_TOKENS: "4096",
      NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS: "1",
      NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA: "0",
      NXL_COMMANDER_INVESTIGATION_SUPPORTS_LONG_CONTEXT: "1",
      NXL_COMMANDER_INVESTIGATION_SUPPORTS_LOCAL_EXECUTION: "0",
    }, { modelProfileRuntimeRegistry: explicit })).toThrow("explicit model-profile registry cannot be combined with legacy Commander environment authority")
    expect(() => readRuntimeServerLaunchOptionsFromEnv({
      NXL_COMMANDER_INVESTIGATION_MODEL_ID: "partial-legacy-authority",
    }, { modelProfileRuntimeRegistry: explicit })).toThrow("explicit model-profile registry cannot be combined with legacy Commander environment authority")
  })
})
