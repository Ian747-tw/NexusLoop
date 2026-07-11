import type { OpenCodeContinuationInput, OpenCodeContinuityCommand, OpenCodeContinuityDelta, OpenCodeContinuityMode, OpenCodeContinuityPacketKind, OpenCodeContinuitySafetyFlags, OpenCodeSessionContinuityInput } from "./opencode-session-continuity-types"

export type OpenCodeContextRefreshFileKind = "context_refresh" | "delta" | "manifest"
export type OpenCodeContextRefreshFilePreview = {
  file_kind: OpenCodeContextRefreshFileKind
  relative_path: string
  size_bytes: number
  sha256: string
  would_write: boolean
  summary_preview: string
  section_kinds: string[]
  source_ref_ids: string[]
  warnings: string[]
}

export type OpenCodeContextRefreshPreview = OpenCodeContinuitySafetyFlags & {
  preview_id: string
  status: "ready" | "blocked" | "partial"
  can_write: boolean
  packet_kind: OpenCodeContinuityPacketKind
  continuity_mode: OpenCodeContinuityMode
  packet_id: string
  packet_hash: string
  source_session_id: string
  target_session_id: string
  launch_id?: string
  native_session_id?: string
  base_pack_id?: string
  base_pack_hash?: string
  previous_refresh_id?: string
  delta: OpenCodeContinuityDelta
  target_dir: string
  files: OpenCodeContextRefreshFilePreview[]
  total_size_bytes: number
  consumption_status: "not_delivered"
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeContinuityCommand[]
  generated_at: string
  redacted_summary_preview: string
  refresh_hash: string
}

export type OpenCodeContextRefreshResult = OpenCodeContinuitySafetyFlags & {
  refresh_id: string
  status: "written" | "dry_run" | "blocked" | "failed"
  packet_id: string
  packet_hash: string
  packet_kind: OpenCodeContinuityPacketKind
  continuity_mode: OpenCodeContinuityMode
  source_session_id: string
  target_session_id: string
  launch_id?: string
  native_session_id?: string
  base_pack_id?: string
  base_pack_hash?: string
  previous_refresh_id?: string
  delta: OpenCodeContinuityDelta
  target_dir: string
  files: OpenCodeContextRefreshFilePreview[]
  total_size_bytes: number
  consumption_status: "not_delivered"
  written_at: string
  written_by: string
  error?: string
  refresh_hash: string
  recommended_commands: OpenCodeContinuityCommand[]
}

export type OpenCodeContextRefreshRecord = {
  refresh_id: string
  packet_id: string
  packet_kind: OpenCodeContinuityPacketKind
  continuity_mode: OpenCodeContinuityMode
  source_session_id: string
  target_session_id: string
  launch_id?: string
  native_session_id?: string
  base_pack_id?: string
  previous_refresh_id?: string
  status: "written"
  written_at: string
  written_by: string
  summary_preview: string
  refresh_hash: string
}

export type OpenCodeContextRefreshSummary = {
  total_refreshes: number
  session_count: number
  active_refresh_count: number
  continue_same_session_count: number
  fork_from_session_count: number
  patch_session_count: number
  resume_from_checkpoint_count: number
  not_delivered_count: number
  latest_refreshes: OpenCodeContextRefreshRecord[]
  generated_at: string
}

export type OpenCodeContextRefreshWriteInput = OpenCodeSessionContinuityInput & OpenCodeContinuationInput & {
  packet_kind?: OpenCodeContinuityPacketKind
  session_id?: string
  launch_id?: string
  dry_run?: boolean
  written_by?: string
}
