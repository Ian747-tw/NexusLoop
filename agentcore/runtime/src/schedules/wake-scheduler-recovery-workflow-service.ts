import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerRecoveryService } from "./wake-scheduler-recovery-service"
import type { WakeSchedulerRecovery, WakeSchedulerRecoveryCommand, WakeSchedulerRecoveryPreview } from "./wake-scheduler-recovery-types"
import type {
  WakeSchedulerRecoveryWorkflow,
  WakeSchedulerRecoveryWorkflowCancelInput,
  WakeSchedulerRecoveryWorkflowInput,
  WakeSchedulerRecoveryWorkflowObservableEvent,
  WakeSchedulerRecoveryWorkflowPreview,
  WakeSchedulerRecoveryWorkflowRecord,
  WakeSchedulerRecoveryWorkflowStatus,
  WakeSchedulerRecoveryWorkflowStep,
  WakeSchedulerRecoveryWorkflowStepKind,
  WakeSchedulerRecoveryWorkflowStepPreview,
  WakeSchedulerRecoveryWorkflowStepRecordInput,
  WakeSchedulerRecoveryWorkflowStepStatus,
  WakeSchedulerRecoveryWorkflowVerification,
} from "./wake-scheduler-recovery-workflow-types"

const PREVIEW_CHARS = 360
const MAX_LIST_LIMIT = 100
const DEFAULT_MAX_STEPS = 20
const HARD_MAX_STEPS = 50
const DEFAULT_MAX_BYTES = 64 * 1024
const HARD_MAX_BYTES = 256 * 1024

type WorkflowCreatedEvent = JsonlEvent & {
  kind: "runtime_wake_scheduler_recovery_workflow_created"
  workflow: WakeSchedulerRecoveryWorkflow
}

type WorkflowStepEvent = JsonlEvent & {
  kind: "runtime_wake_scheduler_recovery_workflow_step_recorded"
  workflow_id: string
  step_id: string
  index: number
  status: "manually_done" | "skipped" | "blocked"
  note?: string
  recorded_at: string
  requested_by: string
}

type WorkflowCancelledEvent = JsonlEvent & {
  kind: "runtime_wake_scheduler_recovery_workflow_cancelled"
  workflow_id: string
  reason?: string
  cancelled_at: string
  requested_by: string
}

type WorkflowEvent = WorkflowCreatedEvent | WorkflowStepEvent | WorkflowCancelledEvent

export interface WakeSchedulerRecoveryWorkflowServiceOptions {
  eventStore: EventStore
  recovery: WakeSchedulerRecoveryService
  now?: () => Date
}

export class WakeSchedulerRecoveryWorkflowService {
  constructor(private readonly options: WakeSchedulerRecoveryWorkflowServiceOptions) {}

  async preview(input: WakeSchedulerRecoveryWorkflowInput = {}): Promise<WakeSchedulerRecoveryWorkflowPreview> {
    const normalized = normalizeWorkflowInput(input)
    const recovery = await this.loadRecovery(normalized.recovery_id)
    const steps = buildSteps(recovery, normalized)
    const blockers: string[] = []
    const warnings = [...recovery.warnings]
    if (!recovery.stale_detected && recovery.status === "none") blockers.push("no stale scheduler recovery is available for workflow creation")
    if (!recovery.recovery_id) blockers.push("scheduler recovery id is required")
    if (steps.length === 0) blockers.push("scheduler recovery has no recommended commands to place in a workflow")
    return redactValue({
      recovery_id: recovery.recovery_id ?? normalized.recovery_id ?? "",
      can_create: blockers.length === 0,
      blockers: unique(blockers),
      warnings: unique(warnings),
      recovery_status: recovery.status,
      stale_detected: recovery.stale_detected,
      step_count: steps.length,
      read_step_count: steps.filter((step) => step.command_type === "read").length,
      write_step_count: steps.filter((step) => step.command_type === "write").length,
      dry_run_step_count: steps.filter((step) => step.step_kind === "dry_run_command").length,
      resolution_step_count: steps.filter((step) => step.step_kind === "recovery_resolution").length,
      steps,
      redacted_summary_preview: previewText(JSON.stringify({ recovery_id: recovery.recovery_id, status: recovery.status, steps: steps.length })),
    })
  }

  async create(input: WakeSchedulerRecoveryWorkflowInput = {}): Promise<WakeSchedulerRecoveryWorkflow> {
    const normalized = normalizeWorkflowInput(input)
    const preview = await this.preview(input)
    if (!preview.can_create) throw new Error(`wake scheduler recovery workflow cannot be created: ${preview.blockers.join("; ")}`)
    const recovery = await this.loadRecovery(preview.recovery_id)
    const now = this.now()
    const steps = preview.steps.map((step) => ({
      ...step,
      step_id: workflowStepId(preview.recovery_id, step.index, step.command),
      status: "pending" as const,
    }))
    const recoveryHash = recoveryHashOf(recovery)
    const workflow_id = workflowId(preview.recovery_id, recoveryHash, steps)
    const existing = (await this.projectWorkflows()).get(workflow_id)
    if (existing) return existing
    const draft = {
      workflow_id,
      recovery_id: preview.recovery_id,
      recovery_hash: recoveryHash,
      status: "active" as const,
      created_at: now,
      created_by: normalized.created_by,
      updated_at: now,
      workflow_hash: "",
      steps,
      completed_step_count: 0,
      skipped_step_count: 0,
      blocked_step_count: 0,
      warnings: preview.warnings,
      blockers: [],
    }
    const workflow = redactValue({ ...draft, workflow_hash: hashPayload({ ...draft, workflow_hash: undefined }) })
    await this.options.eventStore.append({
      kind: "runtime_wake_scheduler_recovery_workflow_created",
      workflow,
      workflow_id: workflow.workflow_id,
      recovery_id: workflow.recovery_id,
      recovery_hash: workflow.recovery_hash,
      created_at: now,
      requested_by: normalized.created_by,
      summary_preview: summaryPreview(workflow),
    })
    return workflow
  }

  async get(workflowId: string): Promise<WakeSchedulerRecoveryWorkflow | null> {
    return (await this.projectWorkflows()).get(cleanString(workflowId, "workflow_id")) ?? null
  }

  async list(limit = 20): Promise<WakeSchedulerRecoveryWorkflowRecord[]> {
    const cleanLimit = readLimit(limit)
    return redactValue([...((await this.projectWorkflows()).values())]
      .map(recordFromWorkflow)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, cleanLimit))
  }

  async recordStep(input: WakeSchedulerRecoveryWorkflowStepRecordInput): Promise<WakeSchedulerRecoveryWorkflow> {
    const normalized = normalizeStepRecordInput(input)
    const workflow = await this.get(normalized.workflow_id)
    if (!workflow) throw new Error("wake scheduler recovery workflow not found")
    if (workflow.status === "cancelled" || workflow.status === "completed") throw new Error("terminal recovery workflow cannot record more steps")
    const step = selectStep(workflow, normalized)
    const now = this.now()
    await this.options.eventStore.append({
      kind: "runtime_wake_scheduler_recovery_workflow_step_recorded",
      workflow_id: workflow.workflow_id,
      step_id: step.step_id,
      index: step.index,
      status: normalized.status,
      note: normalized.note,
      recorded_at: now,
      requested_by: normalized.requested_by,
    })
    return (await this.get(workflow.workflow_id)) ?? workflow
  }

  async cancel(input: WakeSchedulerRecoveryWorkflowCancelInput): Promise<WakeSchedulerRecoveryWorkflow> {
    const normalized = normalizeCancelInput(input)
    const workflow = await this.get(normalized.workflow_id)
    if (!workflow) throw new Error("wake scheduler recovery workflow not found")
    if (workflow.status === "cancelled") return workflow
    if (workflow.status === "completed") throw new Error("completed recovery workflow cannot be cancelled")
    await this.options.eventStore.append({
      kind: "runtime_wake_scheduler_recovery_workflow_cancelled",
      workflow_id: workflow.workflow_id,
      reason: normalized.reason,
      cancelled_at: this.now(),
      requested_by: normalized.requested_by,
    })
    return (await this.get(workflow.workflow_id)) ?? workflow
  }

  async verify(workflowId: string): Promise<WakeSchedulerRecoveryWorkflowVerification> {
    const workflow = await this.get(workflowId)
    if (!workflow) throw new Error("wake scheduler recovery workflow not found")
    const events = await this.options.eventStore.readAll()
    const after = events.filter((event) => eventTime(event) >= workflow.created_at)
    const observable: WakeSchedulerRecoveryWorkflowObservableEvent[] = []
    const stepUpdates: WakeSchedulerRecoveryWorkflowVerification["step_updates"] = []
    const warnings: string[] = []
    for (const step of workflow.steps.slice(0, HARD_MAX_STEPS)) {
      const match = matchStep(step, workflow, after)
      if (match.event) {
        observable.push(observableFromEvent(match.event, step.command))
        stepUpdates.push({ step_id: step.step_id, index: step.index, suggested_status: "verified", verification_summary: match.summary })
      } else if (match.warning) {
        warnings.push(match.warning)
      }
    }
    return redactValue({
      workflow_id: workflow.workflow_id,
      recovery_id: workflow.recovery_id,
      checked_at: this.now(),
      observable_events: observable.slice(0, 20),
      step_updates: stepUpdates.slice(0, 20),
      warnings: unique(warnings).slice(0, 20),
    })
  }

  private async loadRecovery(recoveryId?: string): Promise<WakeSchedulerRecovery | WakeSchedulerRecoveryPreview> {
    if (recoveryId) {
      const recovery = await this.options.recovery.get(recoveryId)
      if (recovery) return recovery
      throw new Error("wake scheduler recovery not found")
    }
    const preview = await this.options.recovery.preview()
    return preview
  }

  private async projectWorkflows(): Promise<Map<string, WakeSchedulerRecoveryWorkflow>> {
    const workflows = new Map<string, WakeSchedulerRecoveryWorkflow>()
    const events = await this.options.eventStore.readAll() as WorkflowEvent[]
    for (const event of events) {
      if (event.kind === "runtime_wake_scheduler_recovery_workflow_created" && isWorkflow(event.workflow)) {
        workflows.set(event.workflow.workflow_id, redactValue(event.workflow))
      } else if (event.kind === "runtime_wake_scheduler_recovery_workflow_step_recorded") {
        const workflow = workflows.get(event.workflow_id)
        if (!workflow) continue
        const step = workflow.steps.find((item) => item.step_id === event.step_id || item.index === event.index)
        if (!step) continue
        step.status = event.status
        step.note = event.note
        step.marked_at = event.recorded_at
        step.marked_by = event.requested_by
        workflow.updated_at = event.recorded_at
        workflow.status = workflowStatus(workflow)
      } else if (event.kind === "runtime_wake_scheduler_recovery_workflow_cancelled") {
        const workflow = workflows.get(event.workflow_id)
        if (!workflow) continue
        if (workflow.status === "completed") continue
        workflow.status = "cancelled"
        workflow.updated_at = event.cancelled_at
        workflow.blockers = event.reason ? [event.reason] : workflow.blockers
      }
      const workflowId = "workflow_id" in event && typeof event.workflow_id === "string" ? event.workflow_id : undefined
      const workflow = workflowId ? workflows.get(workflowId) : undefined
      if (workflow) updateCounts(workflow)
    }
    return workflows
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }
}

export function readWakeSchedulerRecoveryWorkflowInput(payload: Record<string, unknown>): WakeSchedulerRecoveryWorkflowInput {
  return normalizeWorkflowInput(payload)
}

export function readWakeSchedulerRecoveryWorkflowStepRecordInput(payload: Record<string, unknown>): WakeSchedulerRecoveryWorkflowStepRecordInput {
  return normalizeStepRecordInput(payload)
}

export function readWakeSchedulerRecoveryWorkflowCancelInput(payload: Record<string, unknown>): WakeSchedulerRecoveryWorkflowCancelInput {
  return normalizeCancelInput(payload)
}

function buildSteps(recovery: WakeSchedulerRecovery | WakeSchedulerRecoveryPreview, input: ReturnType<typeof normalizeWorkflowInput>): WakeSchedulerRecoveryWorkflowStepPreview[] {
  const commands = dedupeCommands(recovery.recommended_commands)
  const filtered = input.include_write_steps ? commands : commands.filter((command) => command.command_type === "read")
  const ordered = filtered.sort((left, right) => commandRank(left.command) - commandRank(right.command))
  const steps = ordered.slice(0, input.max_steps).map((command, index) => stepPreview(index, command))
  if (steps.length === 0) return []
  if (JSON.stringify(steps).length <= input.max_bytes) return steps
  const kept: WakeSchedulerRecoveryWorkflowStepPreview[] = []
  for (const step of steps) {
    kept.push(step)
    if (JSON.stringify(kept).length > input.max_bytes) {
      kept.pop()
      break
    }
  }
  return kept.length > 0 ? kept : [steps[0]]
}

function stepPreview(index: number, command: WakeSchedulerRecoveryCommand): WakeSchedulerRecoveryWorkflowStepPreview {
  const stepKind = stepKindFor(command)
  return {
    index,
    label: previewText(command.label),
    command: previewText(command.command),
    command_type: command.command_type,
    step_kind: stepKind,
    allowed_to_execute_here: false,
    requires_active_runtime: command.requires_active_runtime,
    verification_hint: verificationHint(command.command, stepKind),
    blockers: [],
  }
}

function stepKindFor(command: WakeSchedulerRecoveryCommand): WakeSchedulerRecoveryWorkflowStepKind {
  if (command.command_type === "read") return "read_command"
  if (command.command.includes("dry-run") || command.command.includes("dry_run")) return "dry_run_command"
  if (command.command.startsWith("/scheduler-recovery-ack") || command.command.startsWith("/scheduler-recovery-resolve") || command.command.startsWith("/scheduler-recovery-dismiss")) return "recovery_resolution"
  return "write_command"
}

function verificationHint(command: string, kind: WakeSchedulerRecoveryWorkflowStepKind): string {
  if (kind === "read_command") return "read commands are operator inspection steps and may not write durable events"
  if (command.startsWith("/wake-tick-dry-run")) return "dry-run wake ticks are explicit operator commands and may not write tick completion events"
  if (command.startsWith("/scheduler-start")) return "can be verified from runtime_wake_scheduler_started after workflow creation"
  if (command.startsWith("/wake-tick")) return "can be verified from runtime_wake_schedule_tick_completed after workflow creation"
  if (kind === "recovery_resolution") return "can be verified from runtime_wake_scheduler_recovery_recorded for this recovery"
  return "verification depends on durable runtime events after workflow creation"
}

function matchStep(step: WakeSchedulerRecoveryWorkflowStep, workflow: WakeSchedulerRecoveryWorkflow, events: JsonlEvent[]): { event?: JsonlEvent; summary: string; warning?: string } {
  if (step.command.startsWith("/wake-tick-dry-run")) return { summary: "", warning: "wake tick dry-run step cannot be verified from durable events" }
  if (step.command.startsWith("/scheduler-start")) {
    const event = events.find((item) => item.kind === "runtime_wake_scheduler_started")
    return event ? { event, summary: "scheduler start event observed after workflow creation" } : { summary: "" }
  }
  if (step.command.startsWith("/wake-tick")) {
    const event = events.find((item) => item.kind === "runtime_wake_schedule_tick_completed")
    return event ? { event, summary: "wake schedule tick completion observed after workflow creation" } : { summary: "" }
  }
  if (step.command.startsWith("/scheduler-recovery-ack") || step.command.startsWith("/scheduler-recovery-resolve") || step.command.startsWith("/scheduler-recovery-dismiss")) {
    const event = events.find((item) => item.kind === "runtime_wake_scheduler_recovery_recorded" && (item.recovery_id === workflow.recovery_id || item.recovery_hash === workflow.recovery_hash))
    return event ? { event, summary: "scheduler recovery record observed after workflow creation" } : { summary: "" }
  }
  return { summary: "" }
}

function observableFromEvent(event: JsonlEvent, command: string): WakeSchedulerRecoveryWorkflowObservableEvent {
  return {
    kind: String(event.kind ?? event.type ?? "event"),
    event_id: typeof event.event_id === "string" ? event.event_id : undefined,
    created_at: eventTime(event),
    command_match: previewText(command),
    summary_preview: previewText(JSON.stringify({ kind: event.kind, event_id: event.event_id })),
  }
}

function normalizeWorkflowInput(input: WakeSchedulerRecoveryWorkflowInput | Record<string, unknown>): { recovery_id?: string; created_by: string; include_write_steps: boolean; max_steps: number; max_bytes: number } {
  return {
    recovery_id: optionalString(input.recovery_id ?? input.recoveryId, "recoveryId"),
    created_by: previewText(String(input.created_by ?? input.createdBy ?? input.requested_by ?? input.requestedBy ?? "operator")),
    include_write_steps: readBoolean(input.include_write_steps ?? input.includeWriteSteps, true),
    max_steps: readCappedInteger(input.max_steps ?? input.maxSteps, "maxSteps", DEFAULT_MAX_STEPS, HARD_MAX_STEPS),
    max_bytes: readCappedInteger(input.max_bytes ?? input.maxBytes, "maxBytes", DEFAULT_MAX_BYTES, HARD_MAX_BYTES),
  }
}

function normalizeStepRecordInput(input: WakeSchedulerRecoveryWorkflowStepRecordInput | Record<string, unknown>): { workflow_id: string; step_id?: string; index?: number; status: "manually_done" | "skipped" | "blocked"; note?: string; requested_by: string } {
  const status = input.status
  if (status !== "manually_done" && status !== "skipped" && status !== "blocked") throw new Error("workflow step status must be manually_done, skipped, or blocked")
  const rawIndex = input.index
  return {
    workflow_id: cleanString(input.workflow_id ?? input.workflowId, "workflowId"),
    step_id: optionalString(input.step_id ?? input.stepId, "stepId"),
    index: rawIndex === undefined ? undefined : readIndex(rawIndex),
    status,
    note: optionalString(input.note, "note"),
    requested_by: previewText(String(input.requested_by ?? input.requestedBy ?? "operator")),
  }
}

function normalizeCancelInput(input: WakeSchedulerRecoveryWorkflowCancelInput | Record<string, unknown>): { workflow_id: string; reason?: string; requested_by: string } {
  return {
    workflow_id: cleanString(input.workflow_id ?? input.workflowId, "workflowId"),
    reason: optionalString(input.reason, "reason"),
    requested_by: previewText(String(input.requested_by ?? input.requestedBy ?? "operator")),
  }
}

function selectStep(workflow: WakeSchedulerRecoveryWorkflow, input: { step_id?: string; index?: number }): WakeSchedulerRecoveryWorkflowStep {
  const step = input.step_id
    ? workflow.steps.find((item) => item.step_id === input.step_id)
    : workflow.steps.find((item) => item.index === input.index)
  if (!step) throw new Error("wake scheduler recovery workflow step not found")
  return step
}

function workflowStatus(workflow: WakeSchedulerRecoveryWorkflow): WakeSchedulerRecoveryWorkflowStatus {
  if (workflow.status === "cancelled") return "cancelled"
  if (workflow.steps.some((step) => step.status === "blocked")) return "blocked"
  if (workflow.steps.length > 0 && workflow.steps.every((step) => step.status === "manually_done" || step.status === "verified" || step.status === "skipped")) return "completed"
  return "active"
}

function updateCounts(workflow: WakeSchedulerRecoveryWorkflow): void {
  workflow.completed_step_count = workflow.steps.filter((step) => step.status === "manually_done" || step.status === "verified").length
  workflow.skipped_step_count = workflow.steps.filter((step) => step.status === "skipped").length
  workflow.blocked_step_count = workflow.steps.filter((step) => step.status === "blocked").length
  workflow.status = workflowStatus(workflow)
}

function recordFromWorkflow(workflow: WakeSchedulerRecoveryWorkflow): WakeSchedulerRecoveryWorkflowRecord {
  return {
    workflow_id: workflow.workflow_id,
    recovery_id: workflow.recovery_id,
    status: workflow.status,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
    step_count: workflow.steps.length,
    completed_step_count: workflow.completed_step_count,
    skipped_step_count: workflow.skipped_step_count,
    blocked_step_count: workflow.blocked_step_count,
    summary_preview: summaryPreview(workflow),
    workflow_hash: workflow.workflow_hash,
  }
}

function summaryPreview(workflow: WakeSchedulerRecoveryWorkflow): string {
  return previewText(JSON.stringify({ workflow_id: workflow.workflow_id, recovery_id: workflow.recovery_id, status: workflow.status, steps: workflow.steps.length }))
}

function workflowId(recoveryId: string, recoveryHash: string | undefined, steps: WakeSchedulerRecoveryWorkflowStep[]): string {
  return `wake_scheduler_recovery_workflow_${hashPayload({ recoveryId, recoveryHash, commands: steps.map((step) => step.command) }).slice(0, 16)}`
}

function recoveryHashOf(recovery: WakeSchedulerRecovery | WakeSchedulerRecoveryPreview): string | undefined {
  return "recovery_hash" in recovery ? recovery.recovery_hash : undefined
}

function workflowStepId(recoveryId: string, index: number, command: string): string {
  return `wake_scheduler_recovery_step_${hashPayload({ recoveryId, index, command }).slice(0, 16)}`
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function dedupeCommands(commands: WakeSchedulerRecoveryCommand[]): WakeSchedulerRecoveryCommand[] {
  const seen = new Set<string>()
  const out: WakeSchedulerRecoveryCommand[] = []
  for (const command of commands) {
    const cleanCommand = previewText(command.command)
    if (seen.has(cleanCommand)) continue
    seen.add(cleanCommand)
    out.push({ ...command, command: cleanCommand, label: previewText(command.label), notes: command.notes ? previewText(command.notes) : undefined })
  }
  return out
}

function commandRank(command: string): number {
  const order = ["/scheduler-status", "/scheduler-bootstrap", "/wake-tick-preview", "/wake-tick-dry-run", "/wake-schedules", "/scheduler-start", "/scheduler-recovery-ack", "/scheduler-recovery-resolve", "/scheduler-recovery-dismiss"]
  const index = order.findIndex((prefix) => command.startsWith(prefix))
  return index < 0 ? 100 : index
}

function eventTime(event: JsonlEvent): string {
  return typeof event.created_at === "string" ? event.created_at : typeof event.recorded_at === "string" ? event.recorded_at : typeof event.timestamp === "string" ? event.timestamp : ""
}

function isWorkflow(value: unknown): value is WakeSchedulerRecoveryWorkflow {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as WakeSchedulerRecoveryWorkflow).workflow_id === "string" && Array.isArray((value as WakeSchedulerRecoveryWorkflow).steps)
}

function readLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : 20
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new Error(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`)
  return limit
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== "boolean") throw new Error("workflow boolean option must be true or false")
  return value
}

function readCappedInteger(value: unknown, field: string, fallback: number, hardMax: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(value, hardMax)
}

function readIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("workflow step index must be a non-negative integer")
  return value
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`)
  return previewText(value.trim())
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  return cleanString(value, field)
}

function previewText(value: string): string {
  return redactText(value).slice(0, PREVIEW_CHARS)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => previewText(value)).filter(Boolean))]
}
