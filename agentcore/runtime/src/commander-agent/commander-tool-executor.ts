import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import { isToolAllowedInPhase } from "../commander-tools/commander-tool-service"
import { validateCommanderToolArguments } from "./commander-model-schema"
import type { CommanderModelToolResultMessage } from "./commander-model-types"
import type { CommanderToolExecutionRequest, CommanderToolExecutionResult, CommanderToolExecutorOptions } from "./commander-tool-execution-types"

const DEFAULT_RESULT_MESSAGE_BYTES = 12_000
const SAFE_GIT_TOOL_IDS = new Set(["repo.git_status", "repo.git_diff"])

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
    try {
      timeoutHandle = this.timeout(descriptor.timeout_ms, request.abort_signal)
      timeoutHandle.promise.catch(() => undefined)
      const handler = Promise.resolve(binding.execute({
        phase: request.phase,
        requested_by: request.requested_by,
        call_id: request.call_id,
        abort_signal: request.abort_signal,
        now: this.now,
      }, validated.arguments))
      const raw = await Promise.race([handler, timeoutHandle.promise])
      const outcome = handlerOutcome(raw)
      return this.result(request, descriptor, outcome.status, true, raw, started, generatedAt, outcome.blockers, undefined, outcome.warnings)
    } catch (error) {
      const cancelled = request.abort_signal?.aborted || (error instanceof Error && /timeout|cancel/i.test(error.message))
      return this.result(request, descriptor, cancelled ? "cancelled" : "failed", true, undefined, started, generatedAt, [], error)
    } finally {
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
    const authority = this.options.authorityRecords.find((record) => record.authority_id === descriptor.authority_id)
    if (!authority) blockers.push("Commander tool authority record was not found")
    else {
      if (authority.risk !== descriptor.risk || authority.risk !== "safe_read") blockers.push("Commander tool authority risk mismatch")
      if (authority.runtime_command !== descriptor.runtime_command) blockers.push("Commander tool authority runtime command mismatch")
      if (authority.mutates_events || authority.calls_provider || authority.requires_approval || authority.requires_run_lock) blockers.push("Commander tool authority is not safe-read executable")
      const gitException = SAFE_GIT_TOOL_IDS.has(descriptor.tool_id)
        && descriptor.execution_backend === "restricted_git_read"
        && descriptor.process_policy === "fixed_git_read_only"
        && authority.creates_external_process === true
      if (descriptor.creates_external_process && !gitException) blockers.push("Commander tool external process is not an allowed fixed Git read")
      if (!descriptor.creates_external_process && authority.creates_external_process) blockers.push("Commander tool authority process metadata mismatch")
    }
    if (descriptor.side_effect_class !== "none" && descriptor.side_effect_class !== "internal_read") blockers.push("Commander tool side effect class is not executable")
    if (descriptor.calls_provider || descriptor.mutates_events || descriptor.requires_approval || descriptor.requires_run_lock || descriptor.requires_network || descriptor.requires_credentials) blockers.push("Commander tool descriptor is not safe-read executable")
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
      evidence: extractEvidence(safeResult),
      output_bytes: oversized ? 0 : bytes,
      max_output_bytes: maxOutputBytes,
      truncated: false,
      handler_invoked: invoked,
      external_process_invoked: invoked && SAFE_GIT_TOOL_IDS.has(request.tool_id) && gitInvoked(safeResult),
      process_policy: descriptor?.process_policy ?? "none",
      events_appended: false,
      provider_called: false,
      mcp_called: false,
      network_called: false,
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
    result.result_hash = hash({ ...result, duration_ms: 0, generated_at: "" })
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
    content = JSON.stringify({ status: executionResult.status, tool_id: executionResult.tool_id, omitted_result: true, warnings: executionResult.warnings.slice(0, 8) })
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
