import { RuntimeServer, type RuntimeServerOptions } from "./server"
import { readOpenCodeAdapterConfigFromEnv } from "./opencode/adapter-config"
import { readExternalApiConnectorsFromEnv } from "./external-api/api-connector-registry"
import { readReasoningProviderConfigFromEnv } from "./reasoning/reasoning-provider-config"
import { readCommanderInvestigationProviderConfigFromEnv } from "./commander-agent"
import type { WakeSchedulerBootstrapConfig } from "./schedules/wake-scheduler-bootstrap-types"

export interface RuntimeServerLaunchConfig extends RuntimeServerOptions {
  env?: Record<string, string | undefined>
}

export function readRuntimeServerLaunchOptionsFromEnv(
  env: Record<string, string | undefined>,
  baseOptions: RuntimeServerOptions = {},
): RuntimeServerOptions {
  const options: RuntimeServerOptions = { ...baseOptions }
  if (options.modelProfileRuntimeRegistry && hasLegacyCommanderEnvironmentAuthority(env)) {
    throw new Error("explicit model-profile registry cannot be combined with legacy Commander environment authority")
  }
  if (!options.externalApiConnectorRegistry && !options.externalApiConnectors) {
    options.externalApiConnectors = readExternalApiConnectorsFromEnv(env)
  }
  if (!options.externalApiEnv) options.externalApiEnv = env
  if (!options.opencodeProcessSmokeEnv) options.opencodeProcessSmokeEnv = env
  if (!options.opencodeLaunchEnv) options.opencodeLaunchEnv = env
  if (!options.reasoningProviderConfig) {
    const reasoningProviderConfig = readReasoningProviderConfigFromEnv(env)
    if (reasoningProviderConfig) options.reasoningProviderConfig = reasoningProviderConfig
  }
  if (!options.commanderInvestigationProviderConfig) {
    const commanderInvestigationProviderConfig = readCommanderInvestigationProviderConfigFromEnv(env)
    if (commanderInvestigationProviderConfig) {
      if (options.commanderModelStepAdapter) throw new Error("Commander investigation provider env config cannot be combined with an injected commanderModelStepAdapter")
      options.commanderInvestigationProviderConfig = commanderInvestigationProviderConfig
    }
  } else if (options.commanderModelStepAdapter && env.NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED === "1") {
    throw new Error("Commander investigation provider config cannot be combined with an injected commanderModelStepAdapter")
  }
  if (!options.wakeSchedulerBootstrapConfig) {
    const wakeSchedulerBootstrapConfig = readWakeSchedulerBootstrapConfigFromEnv(env)
    if (wakeSchedulerBootstrapConfig) options.wakeSchedulerBootstrapConfig = wakeSchedulerBootstrapConfig
  }
  if (options.adapter || options.openCodeAdapterConfig) return options
  const openCodeAdapterConfig = readOpenCodeAdapterConfigFromEnv(env)
  if (!openCodeAdapterConfig) return options
  return { ...options, openCodeAdapterConfig }
}

function hasLegacyCommanderEnvironmentAuthority(env: Record<string, string | undefined>): boolean {
  const enabledKey = "NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED"
  for (const key of Object.keys(env)) {
    if (!key.startsWith("NXL_COMMANDER_INVESTIGATION_") || env[key] === undefined) continue
    if (key !== enabledKey || env[key] !== "0") return true
  }
  return false
}

export function createRuntimeServerFromLaunchConfig(config: RuntimeServerLaunchConfig = {}): RuntimeServer {
  const { env, ...baseOptions } = config
  return new RuntimeServer(env ? readRuntimeServerLaunchOptionsFromEnv(env, baseOptions) : baseOptions)
}

export function readWakeSchedulerBootstrapConfigFromEnv(env: Record<string, string | undefined>): WakeSchedulerBootstrapConfig | undefined {
  const keys = [
    "NXL_WAKE_SCHEDULER_AUTOSTART",
    "NXL_WAKE_SCHEDULER_INTERVAL_MS",
    "NXL_WAKE_SCHEDULER_MAX_DUE_ITEMS",
    "NXL_WAKE_SCHEDULER_DRY_RUN",
    "NXL_WAKE_SCHEDULER_HEARTBEAT_INTERVAL_MS",
    "NXL_WAKE_SCHEDULER_MAX_TICKS_PER_RUN",
    "NXL_WAKE_SCHEDULER_STOP_ON_ERROR",
    "NXL_WAKE_SCHEDULER_REQUIRE_DUE",
  ]
  if (!keys.some((key) => env[key] !== undefined)) return undefined
  return {
    autostart_enabled: readEnvBoolean(env.NXL_WAKE_SCHEDULER_AUTOSTART, "NXL_WAKE_SCHEDULER_AUTOSTART") ?? false,
    interval_ms: readEnvPositiveInteger(env.NXL_WAKE_SCHEDULER_INTERVAL_MS, "NXL_WAKE_SCHEDULER_INTERVAL_MS") ?? 60_000,
    max_due_items: readEnvPositiveInteger(env.NXL_WAKE_SCHEDULER_MAX_DUE_ITEMS, "NXL_WAKE_SCHEDULER_MAX_DUE_ITEMS") ?? 5,
    dry_run: readEnvBoolean(env.NXL_WAKE_SCHEDULER_DRY_RUN, "NXL_WAKE_SCHEDULER_DRY_RUN") ?? false,
    heartbeat_interval_ms: readEnvPositiveInteger(env.NXL_WAKE_SCHEDULER_HEARTBEAT_INTERVAL_MS, "NXL_WAKE_SCHEDULER_HEARTBEAT_INTERVAL_MS"),
    max_ticks_per_run: readEnvPositiveInteger(env.NXL_WAKE_SCHEDULER_MAX_TICKS_PER_RUN, "NXL_WAKE_SCHEDULER_MAX_TICKS_PER_RUN"),
    stop_on_error: readEnvBoolean(env.NXL_WAKE_SCHEDULER_STOP_ON_ERROR, "NXL_WAKE_SCHEDULER_STOP_ON_ERROR") ?? false,
    require_due_schedule: readEnvBoolean(env.NXL_WAKE_SCHEDULER_REQUIRE_DUE, "NXL_WAKE_SCHEDULER_REQUIRE_DUE") ?? false,
    requested_by: "scheduler-bootstrap",
  }
}

function readEnvBoolean(value: string | undefined, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === "1") return true
  if (value === "0") return false
  throw new Error(`${key} must be 0 or 1`)
}

function readEnvPositiveInteger(value: string | undefined, key: string): number | undefined {
  if (value === undefined) return undefined
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${key} must be a positive integer`)
  return Number(value)
}
