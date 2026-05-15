import { RuntimeServer, type RuntimeServerOptions } from "./server"
import { readOpenCodeAdapterConfigFromEnv } from "./opencode/adapter-config"

export interface RuntimeServerLaunchConfig extends RuntimeServerOptions {
  env?: Record<string, string | undefined>
}

export function readRuntimeServerLaunchOptionsFromEnv(
  env: Record<string, string | undefined>,
  baseOptions: RuntimeServerOptions = {},
): RuntimeServerOptions {
  if (baseOptions.adapter || baseOptions.openCodeAdapterConfig) return { ...baseOptions }
  const openCodeAdapterConfig = readOpenCodeAdapterConfigFromEnv(env)
  if (!openCodeAdapterConfig) return { ...baseOptions }
  return { ...baseOptions, openCodeAdapterConfig }
}

export function createRuntimeServerFromLaunchConfig(config: RuntimeServerLaunchConfig = {}): RuntimeServer {
  const { env, ...baseOptions } = config
  return new RuntimeServer(env ? readRuntimeServerLaunchOptionsFromEnv(env, baseOptions) : baseOptions)
}
