import { redactText, redactValue } from "../security/redaction"
import { classifyWakeSchedulerNavigationCommand } from "./wake-scheduler-navigation-service"
import type { WakeSchedulerNavigationReadExecution, WakeSchedulerNavigationReadExecutorContext } from "./wake-scheduler-navigation-read-executor-types"
import type { WakeSchedulerNavigationStageTargetKind } from "./wake-scheduler-navigation-staging-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const SUMMARY_CHARS = 1024
const TOKEN_CHARS = 180

export class WakeSchedulerNavigationReadExecutor {
  constructor(private readonly runtime: WakeSchedulerNavigationReadExecutorContext) {}

  supports(command: string): boolean {
    try {
      return this.plan(command).supported
    } catch {
      return false
    }
  }

  async execute(command: string): Promise<WakeSchedulerNavigationReadExecution> {
    const plan = this.plan(command)
    if (!plan.supported) throw new Error(plan.blocker ?? "safe-read command is not executable by staged read executor yet")
    const raw = await plan.run()
    return redactValue({
      command: plan.command,
      target_kind: plan.target_kind,
      target_id: plan.target_id,
      result_kind: plan.result_kind,
      result_summary: summarizeResult(plan.result_kind, raw),
      raw_result: raw,
      warnings: plan.warnings,
    })
  }

  private plan(commandValue: string): ReadPlan {
    const command = cleanCommand(commandValue)
    const classified = classifyWakeSchedulerNavigationCommand(command)
    if (classified.command_type !== "read" || classified.risk !== "safe_read" || !classified.supported) {
      return blocked(command, classified.target_kind, classified.target_id, classified.blockers.join("; ") || "command is not a supported safe read")
    }
    const tokens = command.split(/\s+/)
    const name = tokens[0] ?? ""
    const args = tokens.slice(1)
    switch (name) {
      case "/scheduler-status":
        noArgs(args, name)
        return readPlan(command, "scheduler_status", undefined, "scheduler_status", () => this.runtime.wakeSchedulerStatus())
      case "/scheduler-events":
        return readPlan(command, "scheduler_status", undefined, "scheduler_events", () => this.runtime.listWakeSchedulerEvents(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/scheduler-bootstrap":
        noArgs(args, name)
        return readPlan(command, "scheduler_bootstrap", undefined, "scheduler_bootstrap_status", () => this.runtime.wakeSchedulerBootstrapStatus())
      case "/scheduler-bootstrap-preview":
        noArgs(args, name)
        return readPlan(command, "scheduler_bootstrap", undefined, "scheduler_bootstrap_preview", () => this.runtime.previewWakeSchedulerBootstrap())
      case "/scheduler-recovery":
      case "/scheduler-recovery-preview":
        noArgs(args, name)
        return readPlan(command, "scheduler_recovery", undefined, "scheduler_recovery_preview", () => this.runtime.previewWakeSchedulerRecovery())
      case "/scheduler-recoveries":
        return readPlan(command, "scheduler_recovery", undefined, "scheduler_recoveries", () => this.runtime.listWakeSchedulerRecoveries(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/scheduler-recovery-show": {
        const id = singleId(args, "recoveryId")
        return readPlan(command, "scheduler_recovery", id, "scheduler_recovery", () => this.runtime.getWakeSchedulerRecovery(id))
      }
      case "/scheduler-recovery-workflows":
        return readPlan(command, "scheduler_recovery_workflow", undefined, "scheduler_recovery_workflows", () => this.runtime.listWakeSchedulerRecoveryWorkflows(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/scheduler-recovery-workflow-show": {
        const id = singleId(args, "workflowId")
        return readPlan(command, "scheduler_recovery_workflow", id, "scheduler_recovery_workflow", () => this.runtime.getWakeSchedulerRecoveryWorkflow(id))
      }
      case "/scheduler-recovery-workflow-verify": {
        const id = singleId(args, "workflowId")
        return readPlan(command, "scheduler_recovery_workflow", id, "scheduler_recovery_workflow_verification", () => this.runtime.verifyWakeSchedulerRecoveryWorkflow(id))
      }
      case "/scheduler-audit":
        noArgs(args, name)
        return readPlan(command, "scheduler_audit", undefined, "scheduler_audit", async () => ({
          summary: await this.runtime.wakeSchedulerAuditSummary(),
          timeline: await this.runtime.wakeSchedulerAuditTimeline({ limit: 10 }),
        }))
      case "/scheduler-audit-summary":
        noArgs(args, name)
        return readPlan(command, "scheduler_audit", undefined, "scheduler_audit_summary", () => this.runtime.wakeSchedulerAuditSummary())
      case "/scheduler-audit-timeline": {
        const query = auditTimelineArgs(args)
        return readPlan(command, "scheduler_audit", query.related_id, "scheduler_audit_timeline", () => this.runtime.wakeSchedulerAuditTimeline(query))
      }
      case "/scheduler-audit-chain": {
        const id = singleId(args, "relatedId")
        return readPlan(command, "scheduler_audit", id, "scheduler_audit_chain", () => this.runtime.wakeSchedulerAuditChain(id, optionLimit(args.slice(1)) ?? DEFAULT_LIMIT))
      }
      case "/scheduler-audit-incidents": {
        const query = incidentArgs(args)
        return readPlan(command, "scheduler_audit", undefined, "scheduler_audit_incidents", () => this.runtime.wakeSchedulerAuditIncidents(query))
      }
      case "/scheduler-nav-staged":
        return readPlan(command, "scheduler_audit", undefined, "scheduler_navigation_staged_commands", () => this.runtime.listWakeSchedulerNavigationStagedCommands(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/wake-tick-preview":
        return readPlan(command, "wake_tick", undefined, "wake_tick_preview", () => this.runtime.previewWakeScheduleTick({ max_due_items: optionLimit(args), requested_by: "scheduler-navigation-staged-read" }))
      case "/wake-schedules":
        return readPlan(command, "wake_schedule", undefined, "wake_schedules", () => this.runtime.listWakeSchedules(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/wake-schedule": {
        const id = singleId(args, "scheduleId")
        return readPlan(command, "wake_schedule", id, "wake_schedule", () => this.runtime.getWakeSchedule(id))
      }
      case "/wake-ticks":
        return readPlan(command, "wake_tick", undefined, "wake_ticks", () => this.runtime.listWakeScheduleTicks(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/wake-tick-show": {
        const id = singleId(args, "tickId")
        return readPlan(command, "wake_tick", id, "wake_tick", () => this.runtime.getWakeScheduleTick(id))
      }
      case "/wake-preview": {
        const resumeId = requiredOption(args, "resume", "resumeId")
        return readPlan(command, "wake_assessment", resumeId, "wake_preview", () => this.runtime.previewWakeAssessment({ resume_id: resumeId, requested_by: "scheduler-navigation-staged-read" }))
      }
      case "/wake-show": {
        const id = singleId(args, "wakeId")
        return readPlan(command, "wake_assessment", id, "wake_assessment", () => this.runtime.getWakeAssessment(id))
      }
      case "/continuations":
        return readPlan(command, "continuation_plan", undefined, "continuation_plans", () => this.runtime.listContinuationPlans(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/continue-show": {
        const id = singleId(args, "planId")
        return readPlan(command, "continuation_plan", id, "continuation_plan", () => this.runtime.getContinuationPlan(id))
      }
      case "/checkpoints":
        return readPlan(command, "checkpoint", undefined, "checkpoints", () => this.runtime.listRuntimeCheckpoints(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/checkpoint-show": {
        const id = singleId(args, "checkpointId")
        return readPlan(command, "checkpoint", id, "checkpoint", () => this.runtime.getRuntimeCheckpoint(id))
      }
      case "/resume-anchors":
        return readPlan(command, "resume_anchor", undefined, "resume_anchors", () => this.runtime.listCheckpointResumeAnchors(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/resume-anchor": {
        const id = singleId(args, "resumeId")
        return readPlan(command, "resume_anchor", id, "resume_anchor", () => this.runtime.getCheckpointResumeAnchor(id))
      }
      case "/handoff-followups":
        return readPlan(command, "handoff_followup", undefined, "handoff_followups", () => this.runtime.listOpenCodeHandoffFollowups({ limit: optionLimit(args) ?? DEFAULT_LIMIT }))
      case "/handoff-followup": {
        const id = singleId(args, "handoffId")
        return readPlan(command, "handoff_followup", id, "handoff_followup", () => this.runtime.getOpenCodeHandoffFollowup(id))
      }
      case "/missions":
        return readPlan(command, "mission", undefined, "missions", () => this.runtime.listRecentMissions(optionLimit(args) ?? DEFAULT_LIMIT))
      case "/mission": {
        const id = singleId(args, "missionId")
        return readPlan(command, "mission", id, "mission", () => this.runtime.getMission(id))
      }
      case "/reasoning":
        noArgs(args, name)
        return readPlan(command, "unknown", undefined, "reasoning", async () => ({ status: this.runtime.reasoningProviderStatus(), health: await this.runtime.reasoningProviderHealth() }))
      default:
        return blocked(command, classified.target_kind, classified.target_id, "safe-read command is not executable by staged read executor yet")
    }
  }
}

interface ReadPlan {
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  result_kind: string
  supported: boolean
  blocker?: string
  warnings: string[]
  run: () => Promise<unknown>
}

function readPlan(command: string, targetKind: WakeSchedulerNavigationStageTargetKind, targetId: string | undefined, resultKind: string, run: () => Promise<unknown>): ReadPlan {
  return { command, target_kind: targetKind, target_id: targetId, result_kind: resultKind, supported: true, warnings: [], run }
}

function blocked(command: string, targetKind: WakeSchedulerNavigationStageTargetKind, targetId: string | undefined, blocker: string): ReadPlan {
  return { command, target_kind: targetKind, target_id: targetId, result_kind: "blocked", supported: false, blocker: preview(blocker), warnings: [], run: async () => null }
}

function noArgs(args: string[], name: string): void {
  if (args.length > 0) throw new Error(`${name} does not accept staged read arguments`)
}

function auditTimelineArgs(args: string[]): { limit?: number; kind?: string; kinds?: string[]; severity?: string; related_id?: string } {
  const out: { limit?: number; kind?: string; kinds?: string[]; severity?: string; related_id?: string } = { limit: DEFAULT_LIMIT }
  for (const arg of args) {
    const [key, rawValue] = keyValue(arg)
    if (key === "limit") out.limit = readLimitValue(rawValue)
    else if (key === "kind") out.kind = cleanToken(rawValue, "kind")
    else if (key === "severity") out.severity = cleanToken(rawValue, "severity")
    else if (key === "related") out.related_id = cleanToken(rawValue, "related")
    else throw new Error("scheduler staged read audit timeline argument is not supported")
  }
  return out
}

function incidentArgs(args: string[]): { limit?: number; status?: string; severity?: string } {
  const out: { limit?: number; status?: string; severity?: string } = { limit: DEFAULT_LIMIT }
  for (const arg of args) {
    if (!arg.includes("=")) {
      out.status = cleanToken(arg, "status")
      continue
    }
    const [key, rawValue] = keyValue(arg)
    if (key === "limit") out.limit = readLimitValue(rawValue)
    else if (key === "status") out.status = cleanToken(rawValue, "status")
    else if (key === "severity") out.severity = cleanToken(rawValue, "severity")
    else throw new Error("scheduler staged read incident argument is not supported")
  }
  return out
}

function optionLimit(args: string[]): number | undefined {
  let limit: number | undefined
  for (const arg of args) {
    if (!arg.startsWith("limit=") && !arg.startsWith("max_due_items=") && !arg.startsWith("maxDueItems=")) throw new Error("scheduler staged read argument is not supported")
    const [, rawValue] = keyValue(arg)
    limit = readLimitValue(rawValue)
  }
  return limit
}

function requiredOption(args: string[], key: string, field: string): string {
  if (args.length !== 1) throw new Error(`${field} is required`)
  const [actual, value] = keyValue(args[0])
  if (actual !== key) throw new Error(`${field} is required`)
  return cleanToken(value, field)
}

function singleId(args: string[], field: string): string {
  if (args.length !== 1) throw new Error(`${field} is required`)
  if (args[0]?.includes("=")) throw new Error(`${field} must be a single id`)
  return cleanToken(args[0], field)
}

function keyValue(arg: string): [string, string] {
  const index = arg.indexOf("=")
  if (index <= 0) throw new Error("scheduler staged read argument must be key=value")
  return [arg.slice(0, index), arg.slice(index + 1)]
}

function readLimitValue(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("scheduler staged read limit must be a positive integer")
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("scheduler staged read limit must be a positive integer")
  return Math.min(limit, HARD_LIMIT)
}

function cleanCommand(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("scheduler staged read command is required")
  return preview(value.trim())
}

function cleanToken(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  const clean = preview(value.trim())
  if (clean.length > TOKEN_CHARS) return `${clean.slice(0, TOKEN_CHARS - 3)}...`
  return clean
}

function summarizeResult(kind: string, raw: unknown): string {
  const summary = `${kind}: ${summarizeValue(raw)}`
  return preview(summary)
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (Array.isArray(value)) return `items=${value.length}`
  if (typeof value !== "object") return String(value)
  const record = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of ["status", "runtimeStatus", "scheduler_status", "mode", "event_count", "due_count", "eligible_count", "blocked_count", "workflow_id", "recovery_id", "schedule_id", "tick_id", "wake_id", "plan_id", "checkpoint_id", "resume_id", "mission_id"]) {
    const raw = record[key]
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") parts.push(`${key}=${raw}`)
  }
  for (const key of ["events", "items", "cards", "entries", "incidents", "recoveries", "workflows", "steps", "records", "timeline"]) {
    const raw = record[key]
    if (Array.isArray(raw)) parts.push(`${key}=${raw.length}`)
  }
  return parts.length > 0 ? parts.join(" ") : `keys=${Object.keys(record).slice(0, 8).join(",")}`
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > SUMMARY_CHARS ? `${clean.slice(0, SUMMARY_CHARS - 3)}...` : clean
}
