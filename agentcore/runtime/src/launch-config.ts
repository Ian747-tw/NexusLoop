import { RuntimeServer, type RuntimeServerOptions } from "./server"
import { readOpenCodeAdapterConfigFromEnv } from "./opencode/adapter-config"
import { readExternalApiConnectorsFromEnv } from "./external-api/api-connector-registry"
import { readReasoningProviderConfigFromEnv } from "./reasoning/reasoning-provider-config"

export interface RuntimeServerLaunchConfig extends RuntimeServerOptions {
  env?: Record<string, string | undefined>
}

export function readRuntimeServerLaunchOptionsFromEnv(
  env: Record<string, string | undefined>,
  baseOptions: RuntimeServerOptions = {},
): RuntimeServerOptions {
  const options: RuntimeServerOptions = { ...baseOptions }
  if (!options.externalApiConnectorRegistry && !options.externalApiConnectors) {
    options.externalApiConnectors = readExternalApiConnectorsFromEnv(env)
  }
  if (!options.externalApiEnv) options.externalApiEnv = env
  if (!options.reasoningProviderConfig) {
    const reasoningProviderConfig = readReasoningProviderConfigFromEnv(env)
    if (reasoningProviderConfig) options.reasoningProviderConfig = reasoningProviderConfig
  }
  if (options.adapter || options.openCodeAdapterConfig) return options
  const openCodeAdapterConfig = readOpenCodeAdapterConfigFromEnv(env)
  if (!openCodeAdapterConfig) return options
  return { ...options, openCodeAdapterConfig }
}

export function createRuntimeServerFromLaunchConfig(config: RuntimeServerLaunchConfig = {}): RuntimeServer {
  const { env, ...baseOptions } = config
  return new RuntimeServer(env ? readRuntimeServerLaunchOptionsFromEnv(env, baseOptions) : baseOptions)
}
