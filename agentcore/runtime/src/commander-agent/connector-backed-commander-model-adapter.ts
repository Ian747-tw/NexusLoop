import { redactText } from "../security/redaction"
import type { ExternalApiConnectorRegistry } from "../external-api/api-connector-registry"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import { AiSdkCommanderModelStepAdapter } from "./ai-sdk-commander-model-adapter"
import type { CommanderConnectorModelTransportMetadata, CommanderConnectorModelTransportConfig } from "./commander-connector-transport-types"
import { ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION, GOOGLE_GENERATIVE_AI_PROVIDER_ADAPTER_VERSION, OPENAI_RESPONSES_PROVIDER_ADAPTER_VERSION, validateCommanderConnectorModelTransportConfig, validateCommanderConnectorProtocolPolicy } from "./commander-connector-transport-types"
import type { CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStepResult, CommanderModelStreamEvent, CommanderModelUsage } from "./commander-model-types"
import { stableHash } from "./commander-model-schema"
import { createExternalApiConnectorFetch } from "./external-api-connector-fetch"

export type ConnectorBackedCommanderModelStepAdapterOptions = {
  config: CommanderConnectorModelTransportConfig
  registry: ExternalApiConnectorRegistry
  requestService: ExternalApiRequestService
  now?: () => Date
}

export class ConnectorBackedCommanderModelStepAdapter implements CommanderModelStepAdapter {
  readonly adapter_id = "external_api_connector_ai_sdk_core" as const
  readonly adapter_version: string
  readonly supports_streaming = false as const
  readonly supports_native_tools = true as const
  readonly supports_json_fallback = true as const
  readonly supports_structured_output: boolean
  readonly supports_abort_signal = true as const
  readonly supports_usage = true as const
  readonly supports_openai_compatible: boolean
  private readonly config: CommanderConnectorModelTransportConfig
  private readonly registry: ExternalApiConnectorRegistry
  private readonly requestService: ExternalApiRequestService
  private readonly now: () => Date

  constructor(options: ConnectorBackedCommanderModelStepAdapterOptions) {
    this.config = validateCommanderConnectorModelTransportConfig(options.config)
    this.registry = options.registry
    this.requestService = options.requestService
    this.adapter_version = this.config.transport_kind === "anthropic_messages_connector"
      ? `${ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION}/external-api-connector`
      : this.config.transport_kind === "google_generative_ai_connector"
        ? `${GOOGLE_GENERATIVE_AI_PROVIDER_ADAPTER_VERSION}/external-api-connector`
        : this.config.transport_kind === "openai_responses_connector"
          ? `${OPENAI_RESPONSES_PROVIDER_ADAPTER_VERSION}/external-api-connector`
      : "ai@7.0.29/@ai-sdk/openai-compatible@3.0.11/external-api-connector"
    this.supports_structured_output = this.config.transport_kind === "openai_compatible_connector"
    this.supports_openai_compatible = this.config.transport_kind === "openai_compatible_connector"
    this.now = options.now ?? (() => new Date())
  }

  async executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult> {
    if (request.provider_id !== this.config.provider_id) return failedResult(request, this.adapter_id, "provider_id does not match connector transport config")
    if (request.model_id !== this.config.model_id) return failedResult(request, this.adapter_id, "model_id does not match connector transport config")
    const connector = this.registry.get(this.config.connector_id)
    if (!connector) return failedResult(request, this.adapter_id, `connector not found: ${this.config.connector_id}`)
    let bridge: ReturnType<typeof createExternalApiConnectorFetch>
    try {
      validateCommanderConnectorProtocolPolicy(this.config, connector)
      bridge = createExternalApiConnectorFetch({
        registry: this.registry,
        requestService: this.requestService,
        config: this.config,
        context: {
          commander_model_request_id: request.request_id,
          investigation_id: request.metadata?.investigation_id,
          requested_by: request.metadata?.requested_by ?? "commander_model_adapter",
          provider_id: request.provider_id,
          model_id: request.model_id,
        },
      })
    } catch (error) {
      return failedResult(request, this.adapter_id, error instanceof Error ? error.message : String(error))
    }
    const adapter = new AiSdkCommanderModelStepAdapter({
      transport_kind: this.config.transport_kind,
      provider_name: this.config.provider_id,
      base_url: connector.base_url,
      credential_mode: "connector_managed",
      fetch: bridge.fetch,
      now: this.now,
    })
    const result = await adapter.executeOneStep(request)
    return {
      ...result,
      adapter_id: this.adapter_id,
      provider_metadata: {
        ...result.provider_metadata,
        nexusloop_transport: metadata(this.config.connector_id, bridge.metadata),
      },
      result_hash: result.result_hash,
    }
  }

  async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
    yield {
      type: "error",
      error: `connector-backed Commander model streaming is not enabled for request ${redactText(request.request_id).slice(0, 120)}`,
    }
  }
}

function metadata(connectorId: string, observed: ReturnType<typeof createExternalApiConnectorFetch>["metadata"]): CommanderConnectorModelTransportMetadata {
  const records = observed.audit_records
  return {
    transport_kind: "external_api_connector",
    connector_id: connectorId,
    request_ids: records.map((record) => record.request_id).slice(0, 4),
    audit_event_kinds: records.map((record) => record.event_kind).slice(0, 4),
    audit_event_count: records.length,
    successful_audit_count: records.filter((record) => record.event_kind === "external_api_request_executed").length,
    failed_audit_count: records.filter((record) => record.event_kind === "external_api_request_failed").length,
    transport_dispatch_count: observed.transport_dispatch_count(),
    dropped_header_names: observed.dropped_header_names.slice(0, 8),
    request_body_persisted: false,
    response_body_persisted: false,
    credentials_persisted: false,
  }
}

function failedResult(request: CommanderModelStepRequest, adapterId: string, error: string): CommanderModelStepResult {
  const usage: CommanderModelUsage = { provider_reported: false }
  const result: CommanderModelStepResult = {
    request_id: request.request_id,
    provider_id: request.provider_id,
    adapter_id: adapterId,
    status: "failed",
    tool_calls: [],
    usage,
    provider_metadata: {
      nexusloop_transport: {
        transport_kind: "external_api_connector",
        connector_id: "unresolved",
        request_ids: [],
        audit_event_kinds: [],
        audit_event_count: 0,
        successful_audit_count: 0,
        failed_audit_count: 0,
        dropped_header_names: [],
        request_body_persisted: false,
        response_body_persisted: false,
        credentials_persisted: false,
      },
    },
    request_count: 0,
    raw_provider_payload_included: false,
    duration_ms: 0,
    warnings: [],
    error: redactText(error).slice(0, 300),
    result_hash: "",
  }
  result.result_hash = stableHash({ ...result, duration_ms: 0 })
  return result
}
