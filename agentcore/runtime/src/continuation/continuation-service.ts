import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeAssessmentService } from "../wake/wake-hook-service"
import type { WakeAssessment, WakeSuggestedCommand } from "../wake/wake-hook-types"
import type {
  ContinuationCommandType,
  ContinuationPlan,
  ContinuationPlanDecisionInput,
  ContinuationPlanInput,
  ContinuationPlanPreview,
  ContinuationPlanRecord,
  ContinuationPlanStatus,
  ContinuationStep,
  ContinuationStepInput,
  ContinuationStepKind,
  ContinuationStepPreview,
  ContinuationStepResult,
} from "./continuation-types"

const DEFAULT_MAX_BYTES = 64 * 1024
const HARD_MAX_BYTES = 256 * 1024
const MIN_MAX_BYTES = 4096
const DEFAULT_MAX_STEPS = 20
const HARD_MAX_STEPS = 50
const MAX_STRING_CHARS = 1000
const PREVIEW_CHARS = 360
const MAX_LIST_LIMIT = 100
const APPEND_EVENT_ID_PLACEHOLDER = "rt_zzzzzzzzzz_zzzzzzzz"
const APPEND_TIMESTAMP_PLACEHOLDER = "9999-12-31T23:59:59.999Z"

export type ContinuationCommandExecutor = (command: string) => Promise<unknown> | unknown

export interface ContinuationServiceOptions {
  eventStore: EventStore
  wakeService: WakeAssessmentService
  executeReadCommand: ContinuationCommandExecutor
  idFactory?: () => string
  stepIdFactory?: () => string
  now?: () => Date
}

type ContinuationEvent = JsonlEvent & {
  kind:
    | "runtime_continuation_plan_created"
    | "runtime_continuation_step_started"
    | "runtime_continuation_step_succeeded"
    | "runtime_continuation_step_failed"
    | "runtime_continuation_plan_paused"
    | "runtime_continuation_plan_cancelled"
    | "runtime_continuation_plan_completed"
  plan?: ContinuationPlan
  result?: ContinuationStepResult
}

type NormalizedPlanInput = {
  wake_id: string
  created_by: string
  include_write_steps: boolean
  allowed_write_commands: string[]
  max_steps: number
  max_bytes: number
}

type NormalizedStepInput = {
  plan_id: string
  step_id?: string
  index?: number
  dry_run: boolean
  allow_write: boolean
  requested_by: string
}

type NormalizedDecisionInput = {
  plan_id: string
  reason?: string
  requested_by: string
}

export class ContinuationService {
  private generatedPlanIds = 0
  private generatedStepIds = 0

  constructor(private readonly options: ContinuationServiceOptions) {}

  async preview(input: ContinuationPlanInput): Promise<ContinuationPlanPreview> {
    const normalized = normalizePlanInput(input)
    const wake = await this.options.wakeService.get(normalized.wake_id)
    return this.previewFromWake(normalized, wake)
  }

  async create(input: ContinuationPlanInput): Promise<ContinuationPlan> {
    const normalized = normalizePlanInput(input)
    const wake = await this.options.wakeService.get(normalized.wake_id)
    const preview = this.previewFromWake(normalized, wake)
    if (!preview.can_create) throw new Error(preview.blockers[0] ?? "continuation plan is blocked")
    const now = this.now()
    const planId = this.options.idFactory ? this.options.idFactory() : `cont_${Date.now().toString(36)}_${++this.generatedPlanIds}`
    const plan = fitPlan({
      plan_id: planId,
      wake_id: preview.wake_id,
      resume_id: preview.resume_id,
      checkpoint_id: preview.checkpoint_id,
      status: "proposed",
      created_at: now,
      created_by: redactText(normalized.created_by),
      updated_at: now,
      steps: preview.steps.map((step) => ({
        ...step,
        step_id: this.options.stepIdFactory ? this.options.stepIdFactory() : `cont_step_${Date.now().toString(36)}_${++this.generatedStepIds}`,
        status: step.allowed_by_default ? "pending" : "blocked",
        created_from_suggestion: true,
      })),
      current_step_index: nextPendingIndex(preview.steps.map((step) => ({
        ...step,
        step_id: "",
        status: step.allowed_by_default ? "pending" : "blocked",
      } as ContinuationStep))),
      completed_step_count: 0,
      failed_step_count: 0,
      blockers: preview.blockers,
      warnings: preview.warnings,
      allowed_write_commands: normalized.allowed_write_commands,
    }, normalized.max_bytes)
    const eventPayload = eventPayloadFromPlan(plan)
    if (persistedEventByteLength(eventPayload) > normalized.max_bytes) throw new Error("runtime continuation plan event exceeds max_bytes")
    await this.options.eventStore.append(eventPayload)
    return redactValue(plan)
  }

  async get(planId: string): Promise<ContinuationPlan | null> {
    const id = cleanString(planId, "plan_id")
    return redactValue((await this.plans()).find((plan) => plan.plan_id === id) ?? null)
  }

  async list(limit = DEFAULT_MAX_STEPS): Promise<ContinuationPlanRecord[]> {
    const cleanLimit = readLimit(limit)
    return redactValue((await this.plans()).slice().reverse().slice(0, cleanLimit).map(recordFromPlan))
  }

  async executeStep(input: ContinuationStepInput): Promise<ContinuationStepResult> {
    const normalized = normalizeStepInput(input)
    const plan = await this.requirePlan(normalized.plan_id)
    if (plan.status === "paused") throw new Error("continuation plan is paused")
    if (plan.status === "cancelled") throw new Error("continuation plan is cancelled")
    if (plan.status === "completed") throw new Error("continuation plan is completed")
    if (plan.status === "failed") throw new Error("continuation plan is failed")
    const step = selectStep(plan, normalized)
    if (step.status === "blocked") throw new Error(step.blockers[0] ?? "continuation step is blocked")
    if (step.status !== "pending") throw new Error("continuation step is not pending")
    if (step.command_type === "write") {
      if (!normalized.allow_write) throw new Error("continuation write steps require allow_write=true")
      if (!plan.allowed_write_commands?.includes(step.command)) throw new Error("continuation write step is not in allowed_write_commands")
      throw new Error("continuation write step execution is not supported in Branch 7I")
    }
    const startedAt = this.now()
    if (normalized.dry_run) {
      return redactValue({
        plan_id: plan.plan_id,
        step_id: step.step_id,
        index: step.index,
        status: "succeeded",
        command: step.command,
        result_summary: `dry-run would execute ${step.command}`,
        dry_run: true,
        started_at: startedAt,
        completed_at: startedAt,
      })
    }
    await this.options.eventStore.append({
      kind: "runtime_continuation_step_started",
      plan_id: plan.plan_id,
      step_id: step.step_id,
      index: step.index,
      command: step.command,
      started_at: startedAt,
      requested_by: normalized.requested_by,
    })
    let value: unknown
    try {
      value = await this.options.executeReadCommand(step.command)
    } catch (error) {
      const completedAt = this.now()
      const result: ContinuationStepResult = {
        plan_id: plan.plan_id,
        step_id: step.step_id,
        index: step.index,
        status: "failed",
        command: step.command,
        error: previewText(redactText(error instanceof Error ? error.message : String(error))),
        started_at: startedAt,
        completed_at: completedAt,
      }
      await this.options.eventStore.append({ kind: "runtime_continuation_step_failed", plan_id: plan.plan_id, step_id: step.step_id, result })
      return redactValue(result)
    }
    const completedAt = this.now()
    const result: ContinuationStepResult = {
      plan_id: plan.plan_id,
      step_id: step.step_id,
      index: step.index,
      status: "succeeded",
      command: step.command,
      result_summary: previewText(stableStringify(redactValue(value))),
      started_at: startedAt,
      completed_at: completedAt,
    }
    await this.options.eventStore.append({ kind: "runtime_continuation_step_succeeded", plan_id: plan.plan_id, step_id: step.step_id, result })
    const afterSuccess = await this.requirePlan(plan.plan_id)
    if (afterSuccess.status === "active" && afterSuccess.steps.every((item) => item.status !== "pending" && item.status !== "running")) {
      await this.options.eventStore.append({ kind: "runtime_continuation_plan_completed", plan_id: plan.plan_id, completed_at: completedAt, requested_by: normalized.requested_by })
    }
    return redactValue(result)
  }

  async pause(input: ContinuationPlanDecisionInput): Promise<ContinuationPlan> {
    const normalized = normalizeDecisionInput(input)
    const plan = await this.requirePlan(normalized.plan_id)
    if (plan.status === "cancelled" || plan.status === "completed" || plan.status === "failed") throw new Error(`continuation plan is ${plan.status}`)
    await this.options.eventStore.append({
      kind: "runtime_continuation_plan_paused",
      plan_id: plan.plan_id,
      paused_at: this.now(),
      requested_by: normalized.requested_by,
      reason: normalized.reason,
    })
    return redactValue(await this.requirePlan(plan.plan_id))
  }

  async cancel(input: ContinuationPlanDecisionInput): Promise<ContinuationPlan> {
    const normalized = normalizeDecisionInput(input)
    const plan = await this.requirePlan(normalized.plan_id)
    if (plan.status === "completed" || plan.status === "failed") throw new Error(`continuation plan is ${plan.status}`)
    await this.options.eventStore.append({
      kind: "runtime_continuation_plan_cancelled",
      plan_id: plan.plan_id,
      cancelled_at: this.now(),
      requested_by: normalized.requested_by,
      reason: normalized.reason,
    })
    return redactValue(await this.requirePlan(plan.plan_id))
  }

  private previewFromWake(input: NormalizedPlanInput, wake: WakeAssessment | null): ContinuationPlanPreview {
    const blockers: string[] = []
    const warnings: string[] = []
    if (!wake) blockers.push("wake assessment not found")
    if (wake && !wake.allowed) blockers.push("wake assessment is not allowed")
    if (wake?.blockers?.length) blockers.push(...wake.blockers)
    const stepPreviews = wake ? stepsFromSuggestions(wake.suggested_commands, input) : []
    if (wake && stepPreviews.length === 0) blockers.push("wake assessment has no continuation-compatible suggested commands")
    warnings.push(...(wake?.warnings ?? []))
    const readCount = stepPreviews.filter((step) => step.command_type === "read").length
    const writeCount = stepPreviews.filter((step) => step.command_type === "write").length
    const checkpointCount = stepPreviews.filter((step) => step.step_kind === "operator_checkpoint").length
    if (wake && stepPreviews.length > 0 && stepPreviews.every((step) => !step.allowed_by_default)) blockers.push("wake assessment has no executable continuation steps")
    const cleanBlockers = unique(blockers)
    return redactValue({
      wake_id: input.wake_id,
      resume_id: wake?.resume_id,
      checkpoint_id: wake?.checkpoint_id,
      can_create: cleanBlockers.length === 0,
      blockers: cleanBlockers,
      warnings: unique(warnings),
      step_count: stepPreviews.length,
      read_step_count: readCount,
      write_step_count: writeCount,
      operator_checkpoint_count: checkpointCount,
      redacted_summary_preview: previewText(stableStringify({
        wake_id: input.wake_id,
        can_create: cleanBlockers.length === 0,
        step_count: stepPreviews.length,
        read_step_count: readCount,
        write_step_count: writeCount,
      })),
      steps: stepPreviews,
    })
  }

  private async plans(): Promise<ContinuationPlan[]> {
    const plans = new Map<string, ContinuationPlan>()
    for (const event of await this.options.eventStore.readAll()) {
      if (!String(event.kind ?? "").startsWith("runtime_continuation_")) continue
      applyContinuationEvent(plans, event as ContinuationEvent)
    }
    return [...plans.values()]
  }

  private async requirePlan(planId: string): Promise<ContinuationPlan> {
    const plan = await this.get(planId)
    if (!plan) throw new Error("continuation plan not found")
    return plan
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }
}

export function readContinuationPlanInput(payload: Record<string, unknown>): ContinuationPlanInput {
  return {
    wake_id: optionalString(payload.wakeId ?? payload.wake_id, "wakeId"),
    created_by: optionalString(payload.createdBy ?? payload.created_by, "createdBy"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    include_write_steps: optionalBoolean(payload.includeWriteSteps ?? payload.include_write_steps, "includeWriteSteps"),
    allowed_write_commands: optionalStringArray(payload.allowedWriteCommands ?? payload.allowed_write_commands, "allowedWriteCommands"),
    max_steps: optionalPositiveInteger(payload.maxSteps ?? payload.max_steps, "maxSteps", HARD_MAX_STEPS),
    max_bytes: optionalPositiveInteger(payload.maxBytes ?? payload.max_bytes, "maxBytes", HARD_MAX_BYTES),
  }
}

export function readContinuationStepInput(payload: Record<string, unknown>): ContinuationStepInput {
  return {
    plan_id: optionalString(payload.planId ?? payload.plan_id, "planId"),
    step_id: optionalString(payload.stepId ?? payload.step_id, "stepId"),
    index: optionalNonnegativeInteger(payload.index, "index", HARD_MAX_STEPS - 1),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
    allow_write: optionalBoolean(payload.allowWrite ?? payload.allow_write, "allowWrite"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

export function readContinuationPlanDecisionInput(payload: Record<string, unknown>): ContinuationPlanDecisionInput {
  return {
    plan_id: optionalString(payload.planId ?? payload.plan_id, "planId"),
    reason: optionalString(payload.reason, "reason"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

function applyContinuationEvent(plans: Map<string, ContinuationPlan>, event: ContinuationEvent): void {
  if (event.kind === "runtime_continuation_plan_created") {
    if (isRecord(event.plan) && typeof event.plan.plan_id === "string") plans.set(event.plan.plan_id, redactValue(event.plan as ContinuationPlan))
    return
  }
  const planId = typeof event.plan_id === "string" ? event.plan_id : undefined
  if (!planId) return
  const plan = plans.get(planId)
  if (!plan) return
  const updatedAt = stringField(event.completed_at) ?? stringField(event.paused_at) ?? stringField(event.cancelled_at) ?? stringField(event.timestamp) ?? plan.updated_at
  if (event.kind === "runtime_continuation_step_started") {
    updateStep(plan, stringField(event.step_id), { status: "running", started_at: stringField(event.started_at) ?? updatedAt })
    if (!preservePlanStatusAgainstStepResult(plan.status)) plan.status = "active"
    plan.updated_at = updatedAt
    plan.current_step_index = typeof event.index === "number" ? event.index : plan.current_step_index
    refreshCounts(plan)
    return
  }
  if ((event.kind === "runtime_continuation_step_succeeded" || event.kind === "runtime_continuation_step_failed") && isRecord(event.result)) {
    const result = event.result as ContinuationStepResult
    updateStep(plan, result.step_id, {
      status: result.status,
      result_summary: result.result_summary,
      error: result.error,
      started_at: result.started_at,
      completed_at: result.completed_at,
    })
    if (!preservePlanStatusAgainstStepResult(plan.status)) plan.status = result.status === "failed" ? "failed" : "active"
    plan.updated_at = result.completed_at
    refreshCounts(plan)
    return
  }
  if (event.kind === "runtime_continuation_plan_paused") plan.status = "paused"
  if (event.kind === "runtime_continuation_plan_cancelled") plan.status = "cancelled"
  if (event.kind === "runtime_continuation_plan_completed") plan.status = "completed"
  plan.updated_at = updatedAt
  refreshCounts(plan)
}

function updateStep(plan: ContinuationPlan, stepId: string | undefined, patch: Partial<ContinuationStep>): void {
  const step = stepId ? plan.steps.find((item) => item.step_id === stepId) : undefined
  if (!step) return
  Object.assign(step, patch)
}

function refreshCounts(plan: ContinuationPlan): void {
  plan.completed_step_count = plan.steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length
  plan.failed_step_count = plan.steps.filter((step) => step.status === "failed").length
  plan.current_step_index = nextPendingIndex(plan.steps)
}

function preservePlanStatusAgainstStepResult(status: ContinuationPlanStatus): boolean {
  return status === "paused" || status === "cancelled" || status === "completed" || status === "failed"
}

function stepsFromSuggestions(suggestions: WakeSuggestedCommand[], input: NormalizedPlanInput): ContinuationStepPreview[] {
  const seen = new Set<string>()
  const steps: ContinuationStepPreview[] = []
  for (const suggestion of suggestions) {
    const command = normalizeCommand(suggestion.command)
    if (!command || seen.has(command) || isContinuationMetaCommand(command)) continue
    seen.add(command)
    const commandType: ContinuationCommandType = suggestion.command_type === "write" ? "write" : "read"
    const stepKind = classifyStep(command, commandType)
    const blockers: string[] = []
    const readSupported = commandType === "read" && supportedReadCommand(command)
    const writeAllowed = commandType === "write" && input.include_write_steps && input.allowed_write_commands.includes(command) && command.startsWith("/checkpoint ")
    if (commandType === "read" && !readSupported) blockers.push("continuation read command is not supported")
    if (commandType === "write") {
      if (!input.include_write_steps) blockers.push("continuation write commands are blocked by default")
      else if (!input.allowed_write_commands.includes(command)) blockers.push("continuation write command is not explicitly allowed")
      else blockers.push("continuation write execution is not supported in Branch 7I")
    }
    const allowedByDefault = commandType === "read" && blockers.length === 0
    steps.push({
      index: steps.length,
      label: boundedText(suggestion.label || command, 160),
      command,
      command_type: commandType,
      step_kind: writeAllowed ? stepKind : stepKind,
      requires_active_runtime: suggestion.requires_active_runtime === true,
      requires_review: suggestion.requires_review === true,
      allowed_by_default: allowedByDefault,
      blockers,
    })
    if (steps.length >= input.max_steps) break
  }
  return steps
}

export function supportedReadCommand(command: string): boolean {
  if (command === "/reasoning" || command === "/handoff-followups" || command === "/handoff-active" || command === "/handoff-results" || command === "/handoff-failed" || command === "/handoff-blocked" || command === "/handoff-stale" || command === "/queues" || command === "/missions" || command === "/cycles" || command === "/syntheses" || command === "/wakes" || command === "/resume-anchors" || command === "/checkpoints") return true
  return /^\/resume-anchor\s+\S+$/.test(command)
    || /^\/restore-preview\s+\S+$/.test(command)
    || /^\/checkpoint-show\s+\S+$/.test(command)
    || /^\/wake-show\s+\S+$/.test(command)
    || /^\/handoff-followup\s+\S+$/.test(command)
    || /^\/cycle-show\s+\S+$/.test(command)
    || /^\/synthesis\s+\S+$/.test(command)
    || /^\/mission\s+\S+$/.test(command)
}

function isContinuationMetaCommand(command: string): boolean {
  return /^\/cont/.test(command) || /^\/continue/.test(command) || command === "/wake" || command.startsWith("/wake ") || command.startsWith("/wake-preview ")
}

function classifyStep(command: string, commandType: ContinuationCommandType): ContinuationStepKind {
  if (commandType === "write" && command.startsWith("/checkpoint ")) return "operator_checkpoint"
  return commandType === "write" ? "write_command" : "read_command"
}

function selectStep(plan: ContinuationPlan, input: NormalizedStepInput): ContinuationStep {
  if (input.step_id) {
    const step = plan.steps.find((item) => item.step_id === input.step_id)
    if (!step) throw new Error("continuation step not found")
    return step
  }
  if (input.index !== undefined) {
    const step = plan.steps.find((item) => item.index === input.index)
    if (!step) throw new Error("continuation step not found")
    return step
  }
  const next = plan.steps.find((step) => step.status === "pending")
  if (!next) throw new Error("continuation plan has no pending step")
  return next
}

function fitPlan(input: Omit<ContinuationPlan, "plan_hash">, maxBytes: number): ContinuationPlan {
  let plan = finalizePlan(input)
  if (persistedEventByteLength(eventPayloadFromPlan(plan)) <= maxBytes) return redactValue(plan)
  const warning = `continuation plan truncated to fit max_bytes=${maxBytes}`
  for (let stepCount = Math.max(1, input.steps.length - 1); stepCount >= 1; stepCount--) {
    const steps = truncateStepsWithExecutable(input.steps, stepCount)
    if (steps.length === 0 || steps.every((step) => step.status !== "pending")) continue
    const candidate = finalizePlan({ ...input, warnings: unique([...input.warnings, warning]), steps, current_step_index: nextPendingIndex(steps) })
    if (persistedEventByteLength(eventPayloadFromPlan(candidate)) <= maxBytes) return redactValue(candidate)
  }
  throw new Error("minimal continuation plan exceeds max_bytes")
}

function truncateStepsWithExecutable(steps: ContinuationStep[], count: number): ContinuationStep[] {
  const executable = steps.filter((step) => step.status === "pending" && step.allowed_by_default)
  const blocked = steps.filter((step) => !(step.status === "pending" && step.allowed_by_default))
  const retained = [...executable, ...blocked].slice(0, count).sort((left, right) => left.index - right.index)
  return retained.map((step, index) => ({ ...step, index }))
}

function eventPayloadFromPlan(plan: ContinuationPlan): JsonlEvent {
  return {
    kind: "runtime_continuation_plan_created",
    plan_id: plan.plan_id,
    wake_id: plan.wake_id,
    plan,
  }
}

function persistedEventByteLength(event: JsonlEvent): number {
  return byteLength(JSON.stringify({
    ...event,
    event_id: event.event_id ?? APPEND_EVENT_ID_PLACEHOLDER,
    timestamp: event.timestamp ?? APPEND_TIMESTAMP_PLACEHOLDER,
  }))
}

function finalizePlan(input: Omit<ContinuationPlan, "plan_hash">): ContinuationPlan {
  return { ...input, plan_hash: sha256(stableStringify(input)) }
}

function recordFromPlan(plan: ContinuationPlan): ContinuationPlanRecord {
  return {
    plan_id: plan.plan_id,
    wake_id: plan.wake_id,
    status: plan.status,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    step_count: plan.steps.length,
    completed_step_count: plan.completed_step_count,
    failed_step_count: plan.failed_step_count,
    summary_preview: previewText(stableStringify({ plan_id: plan.plan_id, wake_id: plan.wake_id, status: plan.status, steps: plan.steps.length })),
    plan_hash: plan.plan_hash,
  }
}

function normalizePlanInput(input: ContinuationPlanInput): NormalizedPlanInput {
  const wakeId = input.wake_id ?? input.wakeId
  if (!wakeId) throw new Error("wake_id is required")
  const includeWrite = input.include_write_steps === true || input.includeWriteSteps === true
  return {
    wake_id: cleanString(wakeId, "wake_id"),
    created_by: boundedText(cleanString(input.created_by ?? input.createdBy ?? input.requested_by ?? input.requestedBy ?? "operator", "created_by"), 128),
    include_write_steps: includeWrite,
    allowed_write_commands: unique((input.allowed_write_commands ?? input.allowedWriteCommands ?? []).map((value) => normalizeCommand(value)).filter((value): value is string => Boolean(value))),
    max_steps: readMaxSteps(input.max_steps ?? input.maxSteps),
    max_bytes: readMaxBytes(input.max_bytes ?? input.maxBytes),
  }
}

function normalizeStepInput(input: ContinuationStepInput): NormalizedStepInput {
  const planId = input.plan_id ?? input.planId
  if (!planId) throw new Error("plan_id is required")
  return {
    plan_id: cleanString(planId, "plan_id"),
    step_id: input.step_id ?? input.stepId ? cleanString(String(input.step_id ?? input.stepId), "step_id") : undefined,
    index: input.index,
    dry_run: input.dry_run === true || input.dryRun === true,
    allow_write: input.allow_write === true || input.allowWrite === true,
    requested_by: boundedText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by"), 128),
  }
}

function normalizeDecisionInput(input: ContinuationPlanDecisionInput): NormalizedDecisionInput {
  const planId = input.plan_id ?? input.planId
  if (!planId) throw new Error("plan_id is required")
  return {
    plan_id: cleanString(planId, "plan_id"),
    reason: input.reason ? boundedText(cleanString(input.reason, "reason"), 300) : undefined,
    requested_by: boundedText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by"), 128),
  }
}

function nextPendingIndex(steps: ContinuationStep[]): number | undefined {
  return steps.find((step) => step.status === "pending")?.index
}

function normalizeCommand(value: string): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed.startsWith("/")) return null
  return boundedText(trimmed, 300)
}

function readMaxSteps(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_STEPS
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("max_steps must be a positive integer")
  return Math.min(Number(value), HARD_MAX_STEPS)
}

function readMaxBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_BYTES
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("max_bytes must be a positive integer")
  if (Number(value) < MIN_MAX_BYTES) throw new Error(`max_bytes must be at least ${MIN_MAX_BYTES}`)
  if (Number(value) > HARD_MAX_BYTES) throw new Error(`max_bytes must be no greater than ${HARD_MAX_BYTES}`)
  return Number(value)
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("continuation plan list limit must be a positive integer")
  return Math.min(Number(value), MAX_LIST_LIMIT)
}

function optionalPositiveInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), max)
}

function optionalNonnegativeInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} must be a nonnegative integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return value.trim()
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`)
  return value
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} must be a string array`)
  return value
}

function cleanString(value: string, field: string): string {
  const trimmed = String(value).trim()
  if (!trimmed) throw new Error(`${field} must be nonblank`)
  return redactText(trimmed)
}

function boundedText(value: string, maxChars: number): string {
  return redactText(value).slice(0, maxChars)
}

function previewText(value: string): string {
  return boundedText(value, PREVIEW_CHARS)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]))
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? redactText(value) : undefined
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => redactText(value)).filter(Boolean))]
}
