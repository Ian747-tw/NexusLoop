import type { CommanderToolPhase, CommanderToolTrustClass } from "./commander-tool-types"

export type CommanderReadStatus = "ready" | "empty" | "blocked" | "failed"

export type CommanderReadSourceKind =
  | "operational_memory"
  | "repository_directory"
  | "repository_file"
  | "repository_search_match"
  | "repository_symbol"
  | "git_worktree"
  | "git_diff"
  | "git_commit"
  | "github_read"
  | "test_manifest"
  | "dependency_manifest"

export type CommanderReadSafetyFlags = {
  filesystem_written: false
  events_appended: false
  network_called: false
  provider_called: false
  mcp_called: false
  research_db_written: false
  mission_mutated: false
  proposal_mutated: false
  opencode_action_performed: false
  shell_used: false
  arbitrary_command_executed: false
  git_process_invoked: boolean
}

export type CommanderReadSourceRef = {
  source_kind: string
  source_id: string
  label?: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type CommanderEvidenceCard = {
  evidence_id: string
  tool_id: string
  source_kind: CommanderReadSourceKind
  source_id: string
  title: string
  summary_preview: string
  trust_class: CommanderToolTrustClass
  instruction_semantics: "none"
  path?: string
  line_start?: number
  line_end?: number
  content_hash?: string
  commit_sha?: string
  branch?: string
  status?: string
  occurred_at?: string
  session_id?: string
  mission_id?: string
  source_refs: CommanderReadSourceRef[]
  content_included: boolean
  content_truncated: boolean
  observed_at: string
  warnings: string[]
  evidence_hash: string
}

export type CommanderInternalReadResult<T> = CommanderReadSafetyFlags & {
  call_id: string
  tool_id: string
  phase?: CommanderToolPhase
  status: CommanderReadStatus
  trust_class: CommanderToolTrustClass
  instruction_semantics: "none"
  result: T | null
  evidence: CommanderEvidenceCard[]
  output_bytes: number
  max_output_bytes: number
  truncated: boolean
  scanned_items?: number
  omitted_items?: number
  duration_ms: number
  blockers: string[]
  warnings: string[]
  generated_at: string
  result_hash: string
}

export type CommanderOperationalMemoryCandidate = {
  source_kind: string
  source_id: string
  label: string
  status?: string
  summary_preview: string
  session_id?: string
  launch_id?: string
  mission_id?: string
  occurred_at?: string
  relevance_score: number
  matched_terms: string[]
  unmatched_query_terms: string[]
  matched_fields: string[]
  source_ref: CommanderReadSourceRef
  pointer_only: true
}

export type CommanderOperationalMemorySearchPreview = CommanderInternalReadResult<{
  query_preview: string
  candidates: CommanderOperationalMemoryCandidate[]
  scan_limit: number
  returned_count: number
}>

export type CommanderRepoTreeEntry = {
  path: string
  kind: "file" | "directory" | "symlink"
  size_bytes?: number
  depth: number
  extension?: string
  readable: boolean
  excluded_reason?: string
  content_hash?: string
}

export type CommanderRepoTreeResult = {
  root: string
  path: string
  depth: number
  entries: CommanderRepoTreeEntry[]
  omitted_entries: number
}

export type CommanderRepoSearchMatch = {
  path: string
  line_number: number
  column_start?: number
  line_preview: string
  before_preview: string[]
  after_preview: string[]
  content_hash: string
  match_hash: string
}

export type CommanderRepoSearchResult = {
  query_preview: string
  path: string
  matches: CommanderRepoSearchMatch[]
  scanned_files: number
  scanned_bytes: number
  omitted_files: number
}

export type CommanderRepoFileLine = {
  line_number: number
  text: string
}

export type CommanderRepoFileResult = {
  path: string
  start_line: number
  end_line: number
  total_lines?: number
  lines: CommanderRepoFileLine[]
  content_hash: string
  encoding: "utf-8"
  truncated: boolean
}

export type CommanderRepoSymbolCandidate = {
  symbol: string
  declaration_kind: string
  path: string
  line_number: number
  signature_preview: string
  content_hash: string
  confidence: "exact_declaration" | "probable_declaration" | "exact_reference"
}

export type CommanderRepoSymbolResult = {
  symbol: string
  candidates: CommanderRepoSymbolCandidate[]
}

export type CommanderGitStatusResult = {
  is_git_repository: boolean
  branch?: string
  head_sha?: string
  detached_head: boolean
  staged: Array<{ path: string; status: string }>
  unstaged: Array<{ path: string; status: string }>
  untracked: string[]
  conflicted: string[]
  counts: Record<string, number>
  truncated: boolean
}

export type CommanderGitDiffResult = {
  scope: "working_tree" | "staged" | "head"
  head_sha?: string
  path_filter?: string
  files: Array<{ path: string; additions?: number; deletions?: number; binary: boolean }>
  stat_preview: string
  patch_preview?: string
  truncated: boolean
  output_bytes: number
}

export type CommanderGitLogResult = {
  commits: Array<{ commit_sha: string; short_sha: string; author_name: string; authored_at: string; subject_preview: string }>
}

export type CommanderTestManifestResult = {
  entries: Array<{ source_path: string; framework: string; command?: string; script_name?: string; command_preview?: string; test_paths: string[]; config_preview?: string; content_hash: string }>
}

export type CommanderDependencyManifestResult = {
  dependencies: Array<{ ecosystem: string; manifest_path: string; package_name: string; version_constraint: string; dependency_group: string; direct: true; content_hash: string }>
  lockfiles: Array<{ path: string; size_bytes: number; sha256?: string; hash_omitted?: boolean; omitted_reason?: string }>
}
