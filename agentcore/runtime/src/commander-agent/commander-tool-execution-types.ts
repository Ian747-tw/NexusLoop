import type { CommandAuthorityRecord } from "../authority/command-authority-types"
import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolDescriptor, CommanderToolPhase, CommanderToolTrustClass } from "../commander-tools/commander-tool-types"

export type CommanderToolExecutionStatus = "ready" | "blocked" | "failed" | "cancelled"

export type CommanderToolExecutionRequest = {
  execution_id: string
  call_id: string
  tool_call_id?: string
  tool_id: string
  phase: CommanderToolPhase
  arguments: Record<string, unknown>
  requested_by: string
  abort_signal?: AbortSignal
  source_model_request_id?: string
  source_model_result_hash?: string
  remaining_tool_call_budget?: number
}

export type CommanderToolExecutionResult = {
  execution_id: string
  call_id: string
  tool_call_id?: string
  tool_id: string
  phase: CommanderToolPhase
  status: CommanderToolExecutionStatus
  descriptor_version?: string
  authority_id?: string
  trust_class: CommanderToolTrustClass
  instruction_semantics: "none"
  result?: unknown
  evidence: CommanderEvidenceCard[]
  output_bytes: number
  max_output_bytes: number
  truncated: boolean
  handler_invoked: boolean
  external_process_invoked: boolean
  process_policy: string
  events_appended: false
  provider_called: false
  mcp_called: false
  network_called: boolean
  external_api_audit_event_count?: number
  external_api_audit_request_ids?: string[]
  research_db_written: false
  mission_mutated: false
  proposal_mutated: false
  opencode_action_performed: false
  blockers: string[]
  warnings: string[]
  error?: string
  duration_ms: number
  generated_at: string
  result_hash: string
}

export type CommanderToolBindingContext = {
  phase: CommanderToolPhase
  requested_by: string
  call_id: string
  abort_signal?: AbortSignal
  remaining_tool_call_budget?: number
  now: () => Date
}

export type CommanderToolBinding = {
  tool_id: string
  descriptor_version: string
  descriptor_schema_hash: string
  execute: (context: CommanderToolBindingContext, validatedArguments: Record<string, unknown>) => Promise<unknown> | unknown
}

export type CommanderToolBindingRegistry = {
  bindings: CommanderToolBinding[]
  lookup: (toolId: string) => CommanderToolBinding | undefined
  validation_summary: {
    binding_count: number
    duplicate_tool_ids: string[]
    tool_ids: string[]
  }
}

export type CommanderToolBindingDependencies = {
  commanderToolService: {
    search(input?: Record<string, unknown>): unknown
    get(input?: Record<string, unknown>): unknown
    profile(input?: Record<string, unknown>): unknown
  }
  commandAuthorityService: {
    get(command: string): CommandAuthorityRecord
  }
  researchMemoryService: {
    preview(input?: Record<string, unknown>): unknown
  }
  operationalMemorySearchService: {
    search(input?: Record<string, unknown>): Promise<unknown>
  }
  repoReadService: {
    searchText(input?: Record<string, unknown>): Promise<unknown>
    readLines(input?: Record<string, unknown>): Promise<unknown>
    gitStatus(): Promise<unknown>
    gitDiff(input?: Record<string, unknown>): Promise<unknown>
  }
  githubReadService?: {
    execute(toolId: "github.repository_get" | "github.commit_get" | "github.pull_request_get" | "github.issue_get" | "github.commit_checks" | "github.pull_request_reviews", args: Record<string, unknown>, signal?: AbortSignal, requestBudget?: number): Promise<unknown>
  }
}

export type CommanderToolExecutorOptions = {
  descriptors: CommanderToolDescriptor[]
  authorityRecords: CommandAuthorityRecord[]
  bindingRegistry: CommanderToolBindingRegistry
  runtimeAuthority?: () => {
    active_runtime: boolean
    run_lock_held: boolean
  }
  now?: () => Date
  timeout?: (ms: number, signal?: AbortSignal) => Promise<never> | { promise: Promise<never>; cancel: () => void }
}
