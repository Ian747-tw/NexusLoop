import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import { COMMANDER_GITHUB_TOOL_AUTHORITY_RECORDS } from "./commander-github-tool-authority-registry"
import { isToolAllowedInPhase } from "../commander-tools/commander-tool-service"
import { validateCommanderToolArguments } from "./commander-model-schema"
import type { CommanderModelToolResultMessage } from "./commander-model-types"
import type { CommanderToolExecutionRequest, CommanderToolExecutionResult, CommanderToolExecutorOptions } from "./commander-tool-execution-types"

const DEFAULT_RESULT_MESSAGE_BYTES = 12_000
const SAFE_GIT_TOOL_IDS = new Set(["repo.git_status", "repo.git_diff"])
const SAFE_GITHUB_TOOL_IDS = new Set(["github.repository_get", "github.commit_get", "github.pull_request_get", "github.issue_get", "github.commit_checks", "github.pull_request_reviews"])

export class CommanderToolExecutor {
  private readonly now: () => Date
  private readonly timeout: (ms: number, signal?: AbortSignal) => CommanderToolTimeout

  constructor(private readonly options: CommanderToolExecutorOptions) {
    this.now = options.now ?? (() => new Date())
    this.timeout = options.timeout ? (ms, signal) => normalizeTimeout(options.timeout!(ms, signal)) : defaultTimeout
  }

  async execute(request: CommanderToolExecutionRequest): Promise<CommanderToolExecutionResult> {
    const started = Date.now()
    const generatedAt = this.now().toISOString()
    const descriptor = this.options.descriptors.find((item) => item.tool_id === request.tool_id)
    const binding = this.options.bindingRegistry.lookup(request.tool_id)
    const blockers = this.preflight(request, descriptor, binding)
    if (request.abort_signal?.aborted) blockers.push("Commander tool execution was cancelled before invocation")
    if (!descriptor || !binding || blockers.length > 0) {
      return this.result(request, descriptor, "blocked", false, undefined, started, generatedAt, blockers)
    }
    const validated = validateCommanderToolArguments(descriptor.input_schema!, request.arguments)
    if (!validated.valid) {
      return this.result(request, descriptor, "blocked", false, undefined, started, generatedAt, validated.errors)
    }
    let timeoutHandle: CommanderToolTimeout | undefined
    let handler: Promise<unknown> | undefined
    const executionAbort = new AbortController()
    const relayAbort = () => executionAbort.abort()
    request.abort_signal?.addEventListener("abort", relayAbort, { once: true })
    try {
      timeoutHandle = this.timeout(descriptor.timeout_ms, executionAbort.signal)
      timeoutHandle.promise.catch(() => undefined)
      handler = Promise.resolve(binding.execute({
        phase: request.phase,
        requested_by: request.requested_by,
        call_id: request.call_id,
        abort_signal: executionAbort.signal,
        remaining_tool_call_budget: request.remaining_tool_call_budget,
        now: this.now,
      }, validated.arguments))
      const raw = await Promise.race([handler, timeoutHandle.promise])
      const outcome = handlerOutcome(raw)
      return this.result(request, descriptor, outcome.status, true, raw, started, generatedAt, outcome.blockers, undefined, outcome.warnings)
    } catch (error) {
      const cancelled = request.abort_signal?.aborted || (error instanceof Error && /timeout|timed out|cancel/i.test(error.message))
      if (cancelled) executionAbort.abort()
      let drained: unknown
      if (cancelled && SAFE_GITHUB_TOOL_IDS.has(request.tool_id) && handler) {
        try { drained = await handler } catch { drained = undefined }
      }
      return this.result(request, descriptor, cancelled ? "cancelled" : "failed", true, drained, started, generatedAt, [], error)
    } finally {
      request.abort_signal?.removeEventListener("abort", relayAbort)
      timeoutHandle?.cancel()
    }
  }

  private preflight(request: CommanderToolExecutionRequest, descriptor: typeof this.options.descriptors[number] | undefined, binding: ReturnType<typeof this.options.bindingRegistry.lookup>): string[] {
    const blockers: string[] = []
    if (!descriptor) return ["Commander tool descriptor was not found"]
    if (!binding) blockers.push("Commander tool is not bound for model-call execution")
    if (descriptor.availability !== "implemented_read_surface") blockers.push("Commander tool is not an implemented read surface")
    if (!isToolAllowedInPhase(descriptor, request.phase)) blockers.push("Commander tool is not allowed in requested phase")
    if (!descriptor.authority_id) blockers.push("Commander tool descriptor lacks authority_id")
    const authority = [...this.options.authorityRecords, ...COMMANDER_GITHUB_TOOL_AUTHORITY_RECORDS].find((record) => record.authority_id === descriptor.authority_id)
    if (!authority) blockers.push("Commander tool authority record was not found")
    else {
      if (authority.risk !== descriptor.risk || authority.risk !== "safe_read") blockers.push("Commander tool authority risk mismatch")
      if (authority.runtime_command !== descriptor.runtime_command) blockers.push("Commander tool authority runtime command mismatch")
      const githubAuthorityException = SAFE_GITHUB_TOOL_IDS.has(descriptor.tool_id)
        && descriptor.namespace === "github_read"
        && authority.requires_run_lock === true
        && authority.gate === "external_api_runtime"
        && authority.mutates_events === true
        && authority.expected_event_kinds.length === 2
        && authority.expected_event_kinds.includes("external_api_request_executed")
        && authority.expected_event_kinds.includes("external_api_request_failed")
      if ((authority.mutates_events && !githubAuthorityException) || authority.calls_provider || authority.requires_approval || (authority.requires_run_lock && !githubAuthorityException)) blockers.push("Commander tool authority is not safe-read executable")
      if (authority.requires_active_runtime || authority.requires_run_lock) {
        const runtimeAuthority = this.options.runtimeAuthority?.()
        if (authority.requires_active_runtime && runtimeAuthority?.active_runtime !== true) blockers.push("Commander tool requires an active ready runtime")
        if (authority.requires_run_lock && runtimeAuthority?.run_lock_held !== true) blockers.push("Commander tool requires the RuntimeServer run lock")
      }
      const gitException = SAFE_GIT_TOOL_IDS.has(descriptor.tool_id)
        && descriptor.execution_backend === "restricted_git_read"
        && descriptor.process_policy === "fixed_git_read_only"
        && authority.creates_external_process === true
      if (descriptor.creates_external_process && !gitException) blockers.push("Commander tool external process is not an allowed fixed Git read")
      if (!descriptor.creates_external_process && authority.creates_external_process) blockers.push("Commander tool authority process metadata mismatch")
    }
    const githubException = SAFE_GITHUB_TOOL_IDS.has(descriptor.tool_id)
      && descriptor.namespace === "github_read"
      && descriptor.side_effect_class === "external_read"
      && descriptor.execution_backend === "runtime_service"
      && descriptor.requires_network === true
      && descriptor.requires_credentials === true
      && descriptor.mutates_events === true
    if (descriptor.side_effect_class !== "none" && descriptor.side_effect_class !== "internal_read" && !githubException) blockers.push("Commander tool side effect class is not executable")
    if (descriptor.calls_provider || (descriptor.mutates_events && !githubException) || descriptor.requires_approval || (descriptor.requires_run_lock && !githubException) || ((descriptor.requires_network || descriptor.requires_credentials) && !githubException)) blockers.push("Commander tool descriptor is not safe-read executable")
    if (!descriptor.input_schema) blockers.push("Commander tool descriptor lacks input schema")
    return blockers
  }

  private result(request: CommanderToolExecutionRequest, descriptor: typeof this.options.descriptors[number] | undefined, status: CommanderToolExecutionResult["status"], invoked: boolean, rawResult: unknown, started: number, generatedAt: string, blockers: string[], error?: unknown, handlerWarnings: string[] = []): CommanderToolExecutionResult {
    const maxOutputBytes = descriptor?.max_output_bytes ?? 8_000
    const safeResult = rawResult === undefined ? undefined : redactValue(rawResult)
    const bytes = measuredOutputBytes(safeResult)
    const oversized = bytes > maxOutputBytes
    const finalStatus = oversized && status === "ready" ? "failed" : status
    const result: CommanderToolExecutionResult = {
      execution_id: request.execution_id,
      call_id: request.call_id,
      tool_call_id: request.tool_call_id,
      tool_id: request.tool_id,
      phase: request.phase,
      status: finalStatus,
      descriptor_version: descriptor?.version,
      authority_id: descriptor?.authority_id,
      trust_class: descriptor?.trust_class ?? "unknown",
      instruction_semantics: "none",
      result: finalStatus === "ready" ? safeResult : undefined,
      evidence: finalStatus === "ready" ? extractEvidence(safeResult) : [],
      output_bytes: oversized ? 0 : bytes,
      max_output_bytes: maxOutputBytes,
      truncated: false,
      handler_invoked: invoked,
      external_process_invoked: invoked && SAFE_GIT_TOOL_IDS.has(request.tool_id) && gitInvoked(safeResult),
      process_policy: descriptor?.process_policy ?? "none",
      events_appended: auditCount(safeResult) > 0,
      provider_called: false,
      mcp_called: false,
      network_called: typeof safeResult === "object" && safeResult !== null && (safeResult as { network_called?: unknown }).network_called === true,
      external_api_audit_event_count: auditCount(safeResult),
      external_api_audit_request_ids: auditIds(safeResult),
      research_db_written: false,
      mission_mutated: false,
      proposal_mutated: false,
      opencode_action_performed: false,
      blockers: blockers.map(redactText),
      warnings: [
        "Commander tool output is transient evidence only and instruction_semantics=none.",
        ...handlerWarnings.map(redactText),
        ...(oversized ? [`Commander tool output exceeded max_output_bytes=${maxOutputBytes}; oversized result omitted`] : []),
      ],
      error: error ? redactText(error instanceof Error ? error.message : String(error)).slice(0, 300) : oversized ? "Commander tool output exceeded descriptor max_output_bytes" : undefined,
      duration_ms: Math.max(0, Date.now() - started),
      generated_at: generatedAt,
      result_hash: "",
    }
    result.result_hash = hash(normalizeStableExecutionValue({ ...result, duration_ms: 0, generated_at: "" }))
    return redactValue(result)
  }
}

export function toCommanderToolResultMessage(executionResult: CommanderToolExecutionResult, maxBytes = DEFAULT_RESULT_MESSAGE_BYTES): CommanderModelToolResultMessage {
  const payload = {
    status: executionResult.status,
    tool_id: executionResult.tool_id,
    evidence_refs: executionResult.evidence.map((item) => ({ evidence_id: item.evidence_id, source_kind: item.source_kind, source_id: item.source_id })).slice(0, 12),
    warnings: executionResult.warnings.slice(0, 8),
    blockers: executionResult.blockers.slice(0, 8),
    result: executionResult.result,
  }
  let content = JSON.stringify(redactValue(payload))
  let truncated = false
  if (Buffer.byteLength(content) > maxBytes) {
    truncated = true
    content = JSON.stringify({ status: executionResult.status, tool_id: executionResult.tool_id, omitted_result: true, warnings: executionResult.warnings.slice(0, 8).map((item) => item.slice(0, 200)) })
    if (Buffer.byteLength(content) > maxBytes) content = JSON.stringify({ status: executionResult.status, tool_id: executionResult.tool_id, omitted_result: true })
    if (Buffer.byteLength(content) > maxBytes) content = "{}".slice(0, Math.max(0, maxBytes))
  }
  return {
    role: "tool",
    tool_call_id: executionResult.tool_call_id ?? "missing_tool_call_id",
    tool_id: executionResult.tool_id,
    content,
    content_hash: hash(content),
    truncated,
    source_execution_id: executionResult.execution_id,
  }
}

function extractEvidence(value: unknown) {
  if (value && typeof value === "object" && Array.isArray((value as { evidence?: unknown }).evidence)) return (value as { evidence: [] }).evidence
  return []
}

function gitInvoked(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { git_process_invoked?: unknown }).git_process_invoked === true
}

function auditCount(value: unknown): number {
  const count = value && typeof value === "object" ? (value as { external_api_audit_event_kinds?: unknown }).external_api_audit_event_kinds : undefined
  return Array.isArray(count) ? count.length : 0
}

function auditIds(value: unknown): string[] {
  const ids = value && typeof value === "object" ? (value as { external_api_audit_request_ids?: unknown }).external_api_audit_request_ids : undefined
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, 8) : []
}

function measuredOutputBytes(value: unknown): number {
  const payload = value && typeof value === "object" && "result" in value ? (value as { result?: unknown }).result : value
  const serializedBytes = payload === undefined ? 0 : Buffer.byteLength(JSON.stringify(payload))
  if (value && typeof value === "object") {
    const outputBytes = (value as { output_bytes?: unknown }).output_bytes
    if (typeof outputBytes === "number" && Number.isFinite(outputBytes) && outputBytes >= 0) return Math.max(Math.floor(outputBytes), serializedBytes)
  }
  return serializedBytes
}

function handlerOutcome(value: unknown): { status: CommanderToolExecutionResult["status"]; blockers: string[]; warnings: string[] } {
  if (!value || typeof value !== "object") return { status: "ready", blockers: [], warnings: [] }
  const raw = value as { status?: unknown; blockers?: unknown; warnings?: unknown }
  const blockers = Array.isArray(raw.blockers) ? raw.blockers.filter((item): item is string => typeof item === "string") : []
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === "string") : []
  if (raw.status === "blocked") return { status: "blocked", blockers, warnings }
  if (raw.status === "failed") return { status: "failed", blockers, warnings }
  if (raw.status === "cancelled") return { status: "cancelled", blockers, warnings }
  return { status: "ready", blockers, warnings }
}

type CommanderToolTimeout = {
  promise: Promise<never>
  cancel: () => void
}

function defaultTimeout(ms: number, signal?: AbortSignal): CommanderToolTimeout {
  let settled = false
  let onAbort: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      settled = true
      reject(new Error("Commander tool execution timed out"))
    }, Math.max(1, ms))
    onAbort = () => {
      if (timer) clearTimeout(timer)
      settled = true
      reject(new Error("Commander tool execution cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal && onAbort && signal.removeEventListener("abort", onAbort)
    },
  }
}

function normalizeTimeout(timeout: Promise<never> | CommanderToolTimeout): CommanderToolTimeout {
  const candidate = timeout as Partial<CommanderToolTimeout>
  return candidate.promise && typeof candidate.cancel === "function" ? candidate as CommanderToolTimeout : { promise: timeout as Promise<never>, cancel: () => undefined }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function normalizeStableExecutionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStableExecutionValue)
  if (!value || typeof value !== "object") return value
  const normalized: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === "generated_at" || key === "observed_at" || key === "duration_ms") continue
    normalized[key] = normalizeStableExecutionValue(nested)
  }
  return normalized
}
