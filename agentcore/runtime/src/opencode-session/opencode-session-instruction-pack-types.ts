import type { ContextPacketSourceRef } from "../context/context-packet-types"
import type { OpenCodeSessionSourceKind } from "./opencode-session-types"

export type OpenCodeSessionInstructionPackStatus =
  | "ready"
  | "blocked"
  | "written"
  | "failed"
  | "dry_run"

export type OpenCodeSessionInstructionPackFileKind =
  | "task"
  | "context"
  | "guidance"
  | "session_memory"
  | "policy"
  | "manifest"
  | "opencode_config"

export type OpenCodeSessionInstructionPackFilePreview = {
  file_kind: OpenCodeSessionInstructionPackFileKind
  relative_path: string
  would_write: boolean
  size_bytes: number
  sha256: string
  summary_preview: string
  sections_used: string[]
  source_refs: string[]
  warnings: string[]
}

export type OpenCodeSessionInstructionPackPreview = {
  preview_id: string
  status: OpenCodeSessionInstructionPackStatus
  can_write: boolean
  session_id: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  source_kind?: OpenCodeSessionSourceKind
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  target_dir: string
  files: OpenCodeSessionInstructionPackFilePreview[]
  total_size_bytes: number
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeSessionInstructionPackCommand[]
  generated_at: string
  redacted_summary_preview: string
  pack_hash: string
}

export type OpenCodeSessionInstructionPackResult = {
  pack_id: string
  status: "written" | "blocked" | "failed" | "dry_run"
  session_id: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  target_dir: string
  files: OpenCodeSessionInstructionPackFilePreview[]
  total_size_bytes: number
  written_at: string
  written_by: string
  error?: string
  pack_hash: string
  recommended_commands: OpenCodeSessionInstructionPackCommand[]
}

export type OpenCodeSessionInstructionPackRecord = {
  pack_id: string
  status: OpenCodeSessionInstructionPackStatus
  session_id: string
  packet_id?: string
  target_dir: string
  file_count: number
  total_size_bytes: number
  written_at: string
  summary_preview: string
  pack_hash: string
}

export type OpenCodeSessionInstructionPackCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeSessionInstructionPackPreviewInput = {
  session_id?: string
  provider_kind?: string
  model_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  include_opencode_config?: boolean
  include_manifest?: boolean
}

export type OpenCodeSessionInstructionPackWriteInput = OpenCodeSessionInstructionPackPreviewInput & {
  dry_run?: boolean
  written_by?: string
}

export type OpenCodeSessionInstructionPackManifest = {
  pack_id: string
  session_id: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  generated_at: string
  written_at?: string
  launch_ready: false
  generated_for_future_launch: true
  files: Array<{
    file_kind: OpenCodeSessionInstructionPackFileKind
    relative_path: string
    size_bytes: number
    sha256: string
  }>
  source_refs: ContextPacketSourceRef[]
  omitted_refs: ContextPacketSourceRef[]
  redaction_policy: string
}
