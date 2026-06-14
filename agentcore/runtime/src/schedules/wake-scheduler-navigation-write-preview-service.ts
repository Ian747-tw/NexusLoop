import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationService } from "./wake-scheduler-navigation-service"
import type {
  WakeSchedulerNavigationFutureStagePolicy,
  WakeSchedulerNavigationWriteAuthorityGate,
  WakeSchedulerNavigationWriteBoard,
  WakeSchedulerNavigationWriteBoardInput,
  WakeSchedulerNavigationWriteCommand,
  WakeSchedulerNavigationWriteEligibilityStatus,
  WakeSchedulerNavigationWritePrerequisite,
  WakeSchedulerNavigationWritePreview,
  WakeSchedulerNavigationWritePreviewInput,
  WakeSchedulerNavigationWriteRisk,
} from "./wake-scheduler-navigation-write-preview-types"

const PREVIEW_CHARS = 220
const DEFAULT_LIMIT = 20
const HARD_LIMIT = 50

interface NormalizedBoardInput {
  command?: string
  related_id?: string
  incident_id?: string
  staged_id?: string
  include_high_impact: boolean
  limit: number
}

interface WriteSpec {
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  status: WakeSchedulerNavigationWriteEligibilityStatus
  target_kind: string
  equivalent_runtime_command?: string
  requires_target?: "first" | "workflow_step" | "wake_key"
  safer_reads: (args: ParsedCommand) => WakeSchedulerNavigationWriteCommand[]
  prerequisites?: (args: ParsedCommand) => WakeSchedulerNavigationWritePrerequisite[]
  warnings?: string[]
}

interface ParsedCommand {
  command: string
  command_name: string
  parts: string[]
  key_values: Record<string, string>
  target_id?: string
  step_index?: string
}

interface BoardCommandSource {
  commands: string[]
  blockers: string[]
  warnings: string[]
}

const APPROVAL_REQUIRED_COMMANDS = new Set([
  "/checkpoint",
  "/scheduler-recovery-ack",
  "/scheduler-recovery-resolve",
  "/scheduler-recovery-dismiss",
  "/scheduler-recovery-workflow",
  "/scheduler-recovery-step-done",
  "/scheduler-recovery-step-skip",
  "/scheduler-recovery-step-block",
  "/scheduler-recovery-workflow-cancel",
  "/continue-plan",
  "/continue-pause",
  "/continue-cancel",
])

export class WakeSchedulerNavigationWritePreviewService {
  constructor(
    private readonly navigationService: WakeSchedulerNavigationService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preview(input: WakeSchedulerNavigationWritePreviewInput): Promise<WakeSchedulerNavigationWritePreview> {
    return this.previewCommand(cleanCommand(input.command))
  }

  async board(input: WakeSchedulerNavigationWriteBoardInput = {}): Promise<WakeSchedulerNavigationWriteBoard> {
    const normalized = normalizeBoardInput(input)
    const commandSource = await this.commandsForBoard(normalized)
    let omittedReadCount = 0
    let highImpactCount = 0
    const previews: WakeSchedulerNavigationWritePreview[] = []
    const seen = new Set<string>()
    for (const command of commandSource.commands) {
      if (seen.has(command)) continue
      seen.add(command)
      const previewRecord = this.previewCommand(command)
      if (previewRecord.command_type !== "write") continue
      if (previewRecord.risk === "unsupported") {
        previews.push(previewRecord)
      } else if (previewRecord.risk === "high_impact_write") {
        highImpactCount += 1
        if (normalized.include_high_impact) previews.push(previewRecord)
      } else {
        previews.push(previewRecord)
      }
      if (previews.length >= normalized.limit) break
    }
    const source = normalized.command
      ? { kind: "command" as const }
      : normalized.related_id
        ? { kind: "related_id" as const, related_id: normalized.related_id }
        : normalized.incident_id
          ? { kind: "incident" as const, incident_id: normalized.incident_id }
          : normalized.staged_id
            ? { kind: "staged_read_group" as const, staged_id: normalized.staged_id }
            : { kind: "navigation_board" as const }
    const warnings = [
      ...commandSource.warnings,
      normalized.include_high_impact ? undefined : `${highImpactCount} high-impact write previews omitted by include_high_impact=false`,
      "write eligibility preview is read-only; no write command is staged or executed",
    ].filter((item): item is string => Boolean(item))
    return redactValue({
      board_id: `wake_scheduler_write_board_${hashText(JSON.stringify(source) + commandSource.commands.join("\n")).slice(0, 16)}`,
      source,
      previews,
      omitted_read_count: omittedReadCount,
      unsupported_count: previews.filter((item) => item.risk === "unsupported").length,
      high_impact_count: highImpactCount,
      blockers: commandSource.blockers.map(preview),
      warnings: warnings.map(preview),
      generated_at: this.now(),
    })
  }

  private previewCommand(command: string): WakeSchedulerNavigationWritePreview {
    const parsed = parseCommand(command)
    if (!parsed) return unsupportedPreview(command, "command must be a single whitelisted slash command")
    const spec = WRITE_SPECS[parsed.command_name]
    if (!spec) return unsupportedPreview(parsed.command, "command is not in the scheduler write preview whitelist")
    const missingTarget = targetMissing(parsed, spec.requires_target)
    const highImpact = spec.risk === "high_impact_write"
    const unsupported = spec.risk === "unsupported"
    const blockers = [
      "Branch 7T previews write eligibility only; can_stage_now=false and can_execute_now=false",
      missingTarget,
      highImpact ? "high-impact writes are blocked from staging/execution by this preview surface" : undefined,
      unsupported ? "unsupported commands fail closed" : undefined,
    ].filter((item): item is string => Boolean(item))
    const prerequisites = [
      prerequisite("command_recognized", true, "info", "command matched the explicit write-preview whitelist"),
      prerequisite("active_runtime_future_gate", false, "warning", "future write staging/execution would require an active runtime"),
      prerequisite("run_lock_future_gate", false, "warning", "future write staging/execution would require the runtime run lock"),
      prerequisite("current_branch_support", false, "error", "Branch 7T does not stage or execute write commands"),
      missingTarget ? prerequisite("target_id_present", false, "error", missingTarget) : prerequisite("target_id_present", true, "info", "required target arguments are present or not required"),
      ...(spec.prerequisites?.(parsed) ?? []),
    ]
    const status: WakeSchedulerNavigationWriteEligibilityStatus = highImpact ? "high_impact_blocked" : missingTarget ? "blocked" : spec.status
    return redactValue({
      command: parsed.command,
      command_name: parsed.command_name,
      command_type: "write" as const,
      risk: spec.risk,
      authority_gate: spec.authority_gate,
      equivalent_runtime_command: spec.equivalent_runtime_command,
      status,
      can_stage_now: false as const,
      can_execute_now: false as const,
      target_kind: spec.target_kind,
      target_id: parsed.target_id,
      parsed_args: parsed.key_values,
      prerequisites,
      blockers: blockers.map(preview),
      warnings: [...(spec.warnings ?? []), "recommended commands are informational and must be run manually"].map(preview),
      safer_read_commands: spec.safer_reads(parsed).slice(0, 10),
      future_stage_policy: futurePolicy({
        dryRunFirst: parsed.command_name === "/wake-tick" || parsed.command_name === "/scheduler-start" || parsed.command_name.startsWith("/continue") || highImpact,
        approval: highImpact || APPROVAL_REQUIRED_COMMANDS.has(parsed.command_name),
      }),
      redacted_summary_preview: preview(`${spec.risk} ${spec.authority_gate} ${parsed.command}`),
    })
  }

  private async commandsForBoard(input: NormalizedBoardInput): Promise<BoardCommandSource> {
    if (input.command) return { commands: [input.command], blockers: [], warnings: [] }
    if (input.related_id || input.incident_id) {
      const board = await this.navigationService.board({
        related_id: input.related_id,
        incident_id: input.incident_id,
        include_write: true,
        limit: input.limit,
      })
      return {
        commands: board.cards.filter((card) => card.command_type === "write" || card.risk === "high_impact_write").map((card) => card.command),
        blockers: board.blockers,
        warnings: board.warnings,
      }
    }
    if (input.staged_id) return { commands: [`/scheduler-nav-run ${input.staged_id}`], blockers: [], warnings: [] }
    return { commands: ["/wake-tick-dry-run", "/checkpoint full manual-checkpoint", "/scheduler-start dry-run every=60s", "/wake-tick", "/proposal-review <proposalId>"], blockers: [], warnings: [] }
  }
}

export function readWakeSchedulerNavigationWritePreviewInput(value: unknown): WakeSchedulerNavigationWritePreviewInput {
  if (!isRecord(value)) throw new Error("scheduler write preview input must be an object")
  return {
    command: cleanCommand(value.command),
    source_related_id: optionalString(value.source_related_id ?? value.sourceRelatedId),
    source_incident_id: optionalString(value.source_incident_id ?? value.sourceIncidentId),
  }
}

export function readWakeSchedulerNavigationWriteBoardInput(value: unknown): WakeSchedulerNavigationWriteBoardInput {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new Error("scheduler write board input must be an object")
  return {
    command: value.command === undefined ? undefined : cleanCommand(value.command),
    related_id: optionalString(value.related_id ?? value.relatedId),
    incident_id: optionalString(value.incident_id ?? value.incidentId),
    staged_id: optionalString(value.staged_id ?? value.stagedId),
    include_high_impact: value.include_high_impact === false || value.includeHighImpact === false ? false : true,
    limit: value.limit === undefined ? undefined : readLimit(value.limit),
  }
}

const WRITE_SPECS: Record<string, WriteSpec> = {
  "/wake-tick-dry-run": {
    risk: "low_risk_write",
    authority_gate: "wake_schedule_tick",
    status: "eligible_for_future_staging",
    target_kind: "wake_tick",
    equivalent_runtime_command: "runtime.execute_wake_schedule_tick(dryRun=true)",
    safer_reads: () => [readCommand("Wake tick preview", "/wake-tick-preview"), readCommand("Wake schedules", "/wake-schedules"), readCommand("Scheduler status", "/scheduler-status")],
    warnings: ["dry-run is still an explicit operator command and is not staged in 7T"],
  },
  "/scheduler-start": {
    risk: "medium_risk_write",
    authority_gate: "wake_scheduler_runtime",
    status: "blocked",
    target_kind: "scheduler_status",
    equivalent_runtime_command: "runtime.start_wake_scheduler",
    safer_reads: () => [readCommand("Scheduler status", "/scheduler-status"), readCommand("Scheduler bootstrap", "/scheduler-bootstrap"), readCommand("Wake tick preview", "/wake-tick-preview")],
  },
  "/scheduler-stop": {
    risk: "medium_risk_write",
    authority_gate: "wake_scheduler_runtime",
    status: "blocked",
    target_kind: "scheduler_status",
    equivalent_runtime_command: "runtime.stop_wake_scheduler",
    safer_reads: () => [readCommand("Scheduler status", "/scheduler-status"), readCommand("Scheduler events", "/scheduler-events")],
  },
  "/scheduler-nav-run": {
    risk: "low_risk_write",
    authority_gate: "wake_scheduler_runtime",
    status: "blocked",
    target_kind: "scheduler_navigation_staged_read",
    equivalent_runtime_command: "runtime.execute_wake_scheduler_navigation_staged_read",
    requires_target: "first",
    safer_reads: (args) => [readCommand("Staged read preview", `/scheduler-nav-run-preview ${args.target_id ?? "<stagedId>"}`), readCommand("Staged navigation commands", "/scheduler-nav-staged"), readCommand("Staged read history", args.target_id ? `/scheduler-nav-read-history staged=${args.target_id}` : "/scheduler-nav-read-history")],
    warnings: ["staged read execution records a bounded read result event only when run through the explicit 7R command"],
  },
  "/checkpoint": {
    risk: "medium_risk_write",
    authority_gate: "checkpoint_runtime",
    status: "blocked",
    target_kind: "checkpoint",
    equivalent_runtime_command: "runtime.create_runtime_checkpoint",
    safer_reads: () => [readCommand("Checkpoints", "/checkpoints"), readCommand("Runtime status", "/scheduler-status")],
  },
  "/scheduler-recovery-ack": recoverySpec("runtime.acknowledge_wake_scheduler_recovery", "acknowledge recovery"),
  "/scheduler-recovery-resolve": recoverySpec("runtime.acknowledge_wake_scheduler_recovery", "resolve recovery"),
  "/scheduler-recovery-dismiss": recoverySpec("runtime.acknowledge_wake_scheduler_recovery", "dismiss recovery"),
  "/scheduler-recovery-workflow": recoveryWorkflowCreateSpec(),
  "/scheduler-recovery-step-done": workflowStepSpec("runtime.record_wake_scheduler_recovery_workflow_step", "mark recovery workflow step done"),
  "/scheduler-recovery-step-skip": workflowStepSpec("runtime.record_wake_scheduler_recovery_workflow_step", "mark recovery workflow step skipped"),
  "/scheduler-recovery-step-block": workflowStepSpec("runtime.record_wake_scheduler_recovery_workflow_step", "mark recovery workflow step blocked"),
  "/scheduler-recovery-workflow-cancel": workflowSpec("runtime.cancel_wake_scheduler_recovery_workflow", "cancel recovery workflow"),
  "/continue-plan": {
    risk: "medium_risk_write",
    authority_gate: "continuation_runtime",
    status: "blocked",
    target_kind: "continuation_plan",
    equivalent_runtime_command: "runtime.create_continuation_plan",
    requires_target: "wake_key",
    safer_reads: (args) => [readCommand("Wake assessment", `/wake-show ${args.key_values.wake ?? "<wakeId>"}`), readCommand("Continuations", "/continuations")],
  },
  "/continue-step": continuationSpec("runtime.execute_continuation_step", "execute continuation step"),
  "/continue-pause": continuationSpec("runtime.pause_continuation_plan", "pause continuation plan"),
  "/continue-cancel": continuationSpec("runtime.cancel_continuation_plan", "cancel continuation plan"),
  "/wake-tick": highImpactSpec("wake_schedule_tick", "wake_tick", "runtime.execute_wake_schedule_tick", [readCommand("Wake tick preview", "/wake-tick-preview"), readCommand("Wake tick dry run", "/wake-tick-dry-run")]),
  "/handoff": highImpactSpec("handoff_runtime", "handoff_followup", "runtime.execute_opencode_handoff", [readCommand("Handoff follow-ups", "/handoff-followups")]),
  "/apply": highImpactSpec("proposal_review_runtime", "unknown", undefined, [readCommand("Missions", "/missions")]),
  "/request-review": highImpactSpec("proposal_review_runtime", "unknown", "runtime.create_review_request", [readCommand("Reviews", "/reviews"), readCommand("Proposals", "/proposals")]),
  "/approve": highImpactSpec("proposal_review_runtime", "unknown", undefined, [readCommand("Missions", "/missions")]),
  "/reject": highImpactSpec("proposal_review_runtime", "unknown", undefined, [readCommand("Missions", "/missions")]),
  "/cancel-review": highImpactSpec("proposal_review_runtime", "unknown", "runtime.cancel_review_request", [readCommand("Reviews", "/reviews")]),
  "/proposal-review": highImpactSpec("proposal_review_runtime", "unknown", "runtime.request_proposal_review", [readCommand("Proposals", "/proposals"), readCommand("Reviews", "/reviews")]),
  "/apply-proposal": highImpactSpec("proposal_review_runtime", "unknown", "runtime.apply_proposal", [readCommand("Proposals", "/proposals"), readCommand("Reviews", "/reviews")]),
  "/cancel-proposal": highImpactSpec("proposal_review_runtime", "unknown", "runtime.cancel_proposal", [readCommand("Proposals", "/proposals")]),
  "/bundle-review": highImpactSpec("proposal_review_runtime", "unknown", "runtime.request_proposal_bundle_reviews", [readCommand("Bundles", "/bundles"), readCommand("Reviews", "/reviews")]),
  "/apply-bundle": highImpactSpec("proposal_review_runtime", "unknown", "runtime.apply_proposal_bundle", [readCommand("Bundles", "/bundles"), readCommand("Reviews", "/reviews")]),
  "/cancel-bundle": highImpactSpec("proposal_review_runtime", "unknown", "runtime.cancel_proposal_bundle", [readCommand("Bundles", "/bundles")]),
  "/draft-review": highImpactSpec("proposal_review_runtime", "unknown", "runtime.request_playbook_draft_reviews", [readCommand("Drafts", "/drafts"), readCommand("Reviews", "/reviews")]),
  "/cancel-draft": highImpactSpec("proposal_review_runtime", "unknown", "runtime.cancel_playbook_draft", [readCommand("Drafts", "/drafts")]),
  "/apply-target": highImpactSpec("proposal_review_runtime", "unknown", "runtime.commander_apply_target", [readCommand("Commander apply preview", "/apply-preview"), readCommand("Proposals", "/proposals")]),
  "/apply-partial": highImpactSpec("proposal_review_runtime", "unknown", "runtime.commander_apply_target", [readCommand("Commander apply preview", "/apply-preview"), readCommand("Proposals", "/proposals")]),
  "/complete": highImpactSpec("mission_runtime", "mission", undefined, [readCommand("Missions", "/missions")]),
  "/fail": highImpactSpec("mission_runtime", "mission", undefined, [readCommand("Missions", "/missions")]),
  "/cancel": highImpactSpec("mission_runtime", "mission", undefined, [readCommand("Missions", "/missions")]),
  "/synthesize": highImpactSpec("reasoning_provider_runtime", "unknown", "runtime.execute_research_synthesis", [readCommand("Reasoning", "/reasoning")]),
  "/cycle": highImpactSpec("reasoning_provider_runtime", "unknown", "runtime.execute_commander_cycle", [readCommand("Reasoning", "/reasoning")]),
  "/api-call": highImpactSpec("reasoning_provider_runtime", "unknown", "runtime.execute_external_api_request", [readCommand("Reasoning", "/reasoning")]),
}

function recoverySpec(runtimeCommand: string, label: string): WriteSpec {
  return {
    risk: "medium_risk_write",
    authority_gate: "recovery_runtime",
    status: "blocked",
    target_kind: "scheduler_recovery",
    equivalent_runtime_command: runtimeCommand,
    requires_target: "first",
    safer_reads: (args) => [readCommand("Scheduler recovery", `/scheduler-recovery-show ${args.target_id ?? "<recoveryId>"}`), readCommand("Scheduler recoveries", "/scheduler-recoveries"), readCommand("Scheduler recovery preview", "/scheduler-recovery")],
    warnings: [`${label} remains an explicit recovery command outside 7T`],
  }
}

function workflowSpec(runtimeCommand: string, label: string): WriteSpec {
  return {
    risk: "medium_risk_write",
    authority_gate: "recovery_workflow_runtime",
    status: "blocked",
    target_kind: "scheduler_recovery_workflow",
    equivalent_runtime_command: runtimeCommand,
    requires_target: "first",
    safer_reads: (args) => [readCommand("Recovery workflow", `/scheduler-recovery-workflow-show ${args.target_id ?? "<workflowId>"}`), readCommand("Recovery workflows", "/scheduler-recovery-workflows")],
    warnings: [`${label} remains an explicit recovery workflow command outside 7T`],
  }
}

function recoveryWorkflowCreateSpec(): WriteSpec {
  return {
    risk: "medium_risk_write",
    authority_gate: "recovery_workflow_runtime",
    status: "blocked",
    target_kind: "scheduler_recovery",
    equivalent_runtime_command: "runtime.create_wake_scheduler_recovery_workflow",
    requires_target: "first",
    safer_reads: (args) => [readCommand("Recovery", `/scheduler-recovery-show ${args.target_id ?? "<recoveryId>"}`), readCommand("Recovery workflow preview", `/scheduler-recovery-workflow-preview ${args.target_id ?? "<recoveryId>"}`), readCommand("Recovery workflows", "/scheduler-recovery-workflows")],
    warnings: ["creating a recovery workflow targets a recovery id and remains an explicit recovery workflow command outside 7T"],
  }
}

function workflowStepSpec(runtimeCommand: string, label: string): WriteSpec {
  return {
    risk: "medium_risk_write",
    authority_gate: "recovery_workflow_runtime",
    status: "blocked",
    target_kind: "scheduler_recovery_workflow",
    equivalent_runtime_command: runtimeCommand,
    requires_target: "workflow_step",
    safer_reads: (args) => [readCommand("Recovery workflow", `/scheduler-recovery-workflow-show ${args.target_id ?? "<workflowId>"}`), readCommand("Recovery workflows", "/scheduler-recovery-workflows")],
    warnings: [`${label} records operator state only when run through the explicit owner command`],
  }
}

function continuationSpec(runtimeCommand: string, label: string): WriteSpec {
  return {
    risk: "medium_risk_write",
    authority_gate: "continuation_runtime",
    status: "blocked",
    target_kind: "continuation_plan",
    equivalent_runtime_command: runtimeCommand,
    requires_target: "first",
    safer_reads: (args) => [readCommand("Continuation plan", `/continue-show ${args.target_id ?? "<planId>"}`), readCommand("Continuations", "/continuations")],
    warnings: [`${label} is never executed by scheduler navigation preview`],
  }
}

function highImpactSpec(authorityGate: WakeSchedulerNavigationWriteAuthorityGate, targetKind: string, runtimeCommand: string | undefined, saferReads: WakeSchedulerNavigationWriteCommand[]): WriteSpec {
  return {
    risk: "high_impact_write",
    authority_gate: authorityGate,
    status: "high_impact_blocked",
    target_kind: targetKind,
    equivalent_runtime_command: runtimeCommand,
    safer_reads: () => saferReads,
    warnings: ["high-impact writes require explicit owner-surface review and are blocked here"],
  }
}

function parseCommand(command: string): ParsedCommand | null {
  if (!command.startsWith("/") || command.startsWith("//") || command.startsWith("/tmp/") || command.startsWith("/path")) return null
  const parts = command.split(/\s+/).filter(Boolean)
  const commandName = parts[0]
  if (!commandName || commandName.includes("=")) return null
  const keyValues: Record<string, string> = {}
  for (const part of parts.slice(1)) {
    if (!part.includes("=")) continue
    const [key, ...rest] = part.split("=")
    const value = rest.join("=")
    if (!key || !value) return null
    keyValues[preview(key)] = preview(value)
  }
  const arg1 = parts[1] && !parts[1].includes("=") ? preview(parts[1]) : undefined
  const arg2 = parts[2] && !parts[2].includes("=") ? preview(parts[2]) : undefined
  return { command, command_name: commandName, parts, key_values: keyValues, target_id: arg1, step_index: arg2 }
}

function targetMissing(args: ParsedCommand, required?: WriteSpec["requires_target"]): string | undefined {
  if (!required) return undefined
  if (required === "first" && !args.target_id) return "target id is required"
  if (required === "wake_key" && !args.key_values.wake) return "wake=<wakeId> is required"
  if (required === "workflow_step") {
    if (!args.target_id) return "workflow id is required"
    if (!args.step_index || !/^\d+$/.test(args.step_index)) return "numeric workflow step index is required"
  }
  return undefined
}

function unsupportedPreview(command: string, reason: string): WakeSchedulerNavigationWritePreview {
  return redactValue({
    command: preview(command),
    command_name: command.split(/\s+/)[0] ?? "",
    command_type: "write" as const,
    risk: "unsupported" as const,
    authority_gate: "unknown" as const,
    status: "unsupported" as const,
    can_stage_now: false as const,
    can_execute_now: false as const,
    target_kind: "unknown",
    parsed_args: {},
    prerequisites: [prerequisite("command_recognized", false, "error", reason), prerequisite("current_branch_support", false, "error", "Branch 7T does not stage or execute write commands")],
    blockers: [reason, "unsupported commands fail closed"].map(preview),
    warnings: ["path-like, unknown, and malformed commands are text only"].map(preview),
    safer_read_commands: [readCommand("Scheduler navigation", "/scheduler-nav"), readCommand("Scheduler audit", "/scheduler-audit")],
    future_stage_policy: futurePolicy({ dryRunFirst: false, approval: true }),
    redacted_summary_preview: preview(`unsupported ${command}`),
  })
}

function prerequisite(name: string, satisfied: boolean, severity: "info" | "warning" | "error", summary: string): WakeSchedulerNavigationWritePrerequisite {
  return { name, satisfied, severity, summary: preview(summary) }
}

function readCommand(label: string, command: string): WakeSchedulerNavigationWriteCommand {
  return { label: preview(label), command: preview(command), command_type: "read" }
}

function futurePolicy(input: { dryRunFirst: boolean; approval: boolean }): WakeSchedulerNavigationFutureStagePolicy {
  return {
    would_require_active_runtime: true,
    would_require_run_lock: true,
    would_require_confirmation: true,
    would_require_approval_record: input.approval,
    would_require_dry_run_first: input.dryRunFirst,
    would_require_recent_read_evidence: true,
    allowed_in_7t: false,
  }
}

function normalizeBoardInput(input: WakeSchedulerNavigationWriteBoardInput): NormalizedBoardInput {
  return {
    command: input.command === undefined ? undefined : cleanCommand(input.command),
    related_id: optionalString(input.related_id ?? input.relatedId),
    incident_id: optionalString(input.incident_id ?? input.incidentId),
    staged_id: optionalString(input.staged_id ?? input.stagedId),
    include_high_impact: input.include_high_impact === false || input.includeHighImpact === false ? false : true,
    limit: input.limit === undefined ? DEFAULT_LIMIT : readLimit(input.limit),
  }
}

function cleanCommand(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("scheduler write preview command is required")
  return preview(value.trim())
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !value.trim()) throw new Error("scheduler write preview id must be a non-empty string")
  return preview(value.trim())
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler write preview limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS - 3)}...` : clean
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
