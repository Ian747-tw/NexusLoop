import type { OpenCodeSpawn } from "../opencode/process-adapter"
import type { OpenCodeLaunchAdapterKind } from "./opencode-launch-gate-types"

export type OpenCodeLaunchAdapterPreviewInput = {
  project_dir: string
  target_dir?: string
  instruction_files: string[]
  primary_model_selection?: OpenCodePrimaryModelSelection
}

export type OpenCodePrimaryModelSelection = Readonly<{
  selection_version: 1
  role: "executor"
  provider_id: string
  model_id: string
  selection_projection_hash: string
}>

export type OpenCodeLaunchAdapterLaunchInput = OpenCodeLaunchAdapterPreviewInput & {
  launch_id: string
  session_id: string
}

export type OpenCodeLaunchAdapterPreview = {
  adapter_kind: OpenCodeLaunchAdapterKind
  command_preview?: string
  env_preview?: string
  blockers: string[]
  warnings: string[]
}

export type OpenCodeLaunchAdapterResult = {
  status: "launched" | "launch_started" | "launch_failed"
  process_id?: number
  native_session_id?: string
  exit_code?: number
  output_summary_preview?: string
  event_count?: number
  error?: string
}

export interface OpenCodeLaunchAdapter {
  kind: OpenCodeLaunchAdapterKind
  preview(input: OpenCodeLaunchAdapterPreviewInput): Promise<OpenCodeLaunchAdapterPreview> | OpenCodeLaunchAdapterPreview
  launch(input: OpenCodeLaunchAdapterLaunchInput): Promise<OpenCodeLaunchAdapterResult>
}

export class FakeOpenCodeLaunchAdapter implements OpenCodeLaunchAdapter {
  readonly kind = "fake" as const

  preview(input: OpenCodeLaunchAdapterPreviewInput): OpenCodeLaunchAdapterPreview {
    return {
      adapter_kind: this.kind,
      command_preview: `fake-opencode-launch ${input.instruction_files.join(" ")}`,
      env_preview: "fake adapter; no external process",
      blockers: [],
      warnings: ["fake launch adapter does not start an external OpenCode process"],
    }
  }

  async launch(input: OpenCodeLaunchAdapterLaunchInput): Promise<OpenCodeLaunchAdapterResult> {
    return {
      status: "launched",
      native_session_id: `fake_native_${input.session_id}`,
      process_id: 0,
      output_summary_preview: "fake OpenCode launch recorded; no external process was started",
      event_count: 0,
    }
  }
}

export class DisabledOpenCodeLaunchAdapter implements OpenCodeLaunchAdapter {
  readonly kind = "disabled" as const

  preview(): OpenCodeLaunchAdapterPreview {
    return {
      adapter_kind: this.kind,
      blockers: ["real OpenCode launch adapter is disabled or not configured"],
      warnings: ["set NXL_REAL_OPENCODE_LAUNCH=1 and configure a process adapter for real launch"],
    }
  }

  async launch(): Promise<OpenCodeLaunchAdapterResult> {
    return {
      status: "launch_failed",
      error: "real OpenCode launch adapter is disabled or not configured",
    }
  }
}

export type ProcessOpenCodeLaunchAdapterOptions = {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  spawn?: OpenCodeSpawn
  spawnTimeoutMs?: number
}
