import type { CommandAuthorityGate, CommandAuthorityOwner, CommandAuthorityRecord, CommandAuthorityRisk, CommandValidationProfile } from "./command-authority-types"

const always = "Run full historical E2E only for release-candidate gates, shared parser/global dispatch changes, broad snapshot/state merge changes, or explicit reviewer request."

function profile(targeted: string[], optional: string[] = []): CommandValidationProfile {
  return {
    unit_runtime: true,
    unit_tui: true,
    typecheck_runtime: true,
    typecheck_tui: true,
    integration_cli: true,
    targeted_e2e: targeted,
    optional_regression_e2e: optional,
    full_e2e_required_when: [always],
    live_provider_required: false,
    real_opencode_required: false,
  }
}

const profiles = {
  authority: profile(["tests/e2e_user/scenarios/test_command_authority_inventory_tui.py"]),
  status: profile(["tests/e2e_user/scenarios/test_spec_onboarding_tui.py"]),
  research: profile(["tests/e2e_user/scenarios/test_research_synthesis_tui.py"]),
  reasoning: profile(["tests/e2e_user/scenarios/test_reasoning_provider_tui.py"]),
  synthesis: profile(["tests/e2e_user/scenarios/test_research_synthesis_tui.py"]),
  cycle: profile(["tests/e2e_user/scenarios/test_commander_cycle_tui.py"]),
  handoff: profile(["tests/e2e_user/scenarios/test_opencode_handoff_tui.py", "tests/e2e_user/scenarios/test_opencode_handoff_followup_tui.py"]),
  checkpoint: profile(["tests/e2e_user/scenarios/test_runtime_checkpoint_tui.py"]),
  restore: profile(["tests/e2e_user/scenarios/test_runtime_restore_tui.py"]),
  wake: profile(["tests/e2e_user/scenarios/test_wake_hook_tui.py"]),
  continuation: profile(["tests/e2e_user/scenarios/test_continuation_tui.py"]),
  wakeSchedule: profile(["tests/e2e_user/scenarios/test_wake_schedule_tui.py"]),
  scheduler: profile(["tests/e2e_user/scenarios/test_wake_scheduler_tui.py", "tests/e2e_user/scenarios/test_wake_scheduler_bootstrap_tui.py"]),
  recovery: profile(["tests/e2e_user/scenarios/test_wake_scheduler_recovery_tui.py"]),
  workflow: profile(["tests/e2e_user/scenarios/test_wake_scheduler_recovery_workflow_tui.py"]),
  audit: profile(["tests/e2e_user/scenarios/test_wake_scheduler_audit_tui.py"]),
  nav: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_tui.py"]),
  navStage: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_staging_tui.py"]),
  stagedRead: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_staged_read_tui.py"]),
  stagedReadCompare: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_staged_read_compare_tui.py"]),
  writePreview: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_write_preview_tui.py"]),
  writeStage: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_write_staging_tui.py"]),
  writeRun: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_write_run_tui.py"]),
  writeRunCompare: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_write_run_compare_tui.py"]),
  approval: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_write_approval_tui.py"]),
  checkpointWrite: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_checkpoint_write_tui.py"]),
  checkpointCompare: profile(["tests/e2e_user/scenarios/test_wake_scheduler_navigation_checkpoint_write_compare_tui.py"]),
  mission: profile(["tests/e2e_user/scenarios/test_commander_cycle_tui.py"]),
  proposal: profile(["tests/e2e_user/scenarios/test_commander_cycle_tui.py"]),
  apply: profile(["tests/e2e_user/scenarios/test_commander_cycle_tui.py"]),
  externalApi: profile(["tests/e2e_user/scenarios/test_reasoning_provider_tui.py"]),
}

type BaseRecord = Omit<CommandAuthorityRecord, "authority_id" | "aliases" | "creates_external_process" | "calls_provider" | "requires_run_lock" | "blocked_by_default" | "expected_event_kinds" | "recommended_reads" | "notes" | "out_of_scope">

function idFor(command: string): string {
  return `command_authority_${command.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "unknown"}`
}

function record(base: BaseRecord & {
  aliases?: string[]
  creates_external_process?: boolean
  calls_provider?: boolean
  requires_run_lock?: boolean
  blocked_by_default?: boolean
  expected_event_kinds?: string[]
  recommended_reads?: string[]
  notes?: string[]
  out_of_scope?: string[]
}): CommandAuthorityRecord {
  return {
    authority_id: idFor(base.slash_command),
    ...base,
    aliases: base.aliases ?? [],
    creates_external_process: base.creates_external_process ?? false,
    calls_provider: base.calls_provider ?? false,
    requires_run_lock: base.requires_run_lock ?? base.mutates_events,
    blocked_by_default: base.blocked_by_default ?? (base.risk === "high_impact_write" || base.risk === "unsupported"),
    expected_event_kinds: base.expected_event_kinds ?? [],
    recommended_reads: base.recommended_reads ?? [],
    notes: base.notes ?? [],
    out_of_scope: base.out_of_scope ?? [],
  }
}

function read(slash: string, runtime: string | undefined, owner: CommandAuthorityOwner, gate: CommandAuthorityGate, validation_profile: CommandValidationProfile, aliases: string[] = []): CommandAuthorityRecord {
  return record({
    slash_command: slash,
    runtime_command: runtime,
    aliases,
    risk: "safe_read",
    gate,
    owner,
    mutates_events: false,
    requires_active_runtime: false,
    requires_approval: false,
    current_phase_status: "implemented",
    validation_profile,
  })
}

function write(args: {
  slash: string
  runtime?: string
  risk: CommandAuthorityRisk
  gate: CommandAuthorityGate
  owner: CommandAuthorityOwner
  status?: CommandAuthorityRecord["current_phase_status"]
  approval?: string
  execution?: string
  events?: string[]
  reads?: string[]
  aliases?: string[]
  provider?: boolean
  process?: boolean
  notes?: string[]
  out?: string[]
  profile: CommandValidationProfile
}): CommandAuthorityRecord {
  return record({
    slash_command: args.slash,
    runtime_command: args.runtime,
    aliases: args.aliases,
    risk: args.risk,
    gate: args.gate,
    owner: args.owner,
    mutates_events: true,
    creates_external_process: args.process,
    calls_provider: args.provider,
    requires_active_runtime: true,
    requires_run_lock: true,
    requires_approval: Boolean(args.approval),
    approval_surface: args.approval,
    execution_surface: args.execution,
    expected_event_kinds: args.events,
    current_phase_status: args.status ?? "implemented",
    recommended_reads: args.reads,
    validation_profile: args.profile,
    notes: args.notes,
    out_of_scope: args.out,
    blocked_by_default: args.risk === "high_impact_write" || args.status === "blocked",
  })
}

export const COMMAND_AUTHORITY_REGISTRY: CommandAuthorityRecord[] = [
  read("/authority", "runtime.command_authority_summary", "runtime_status", "none", profiles.authority, ["/command-authority", "/command-map"]),
  read("/authority-summary", "runtime.command_authority_summary", "runtime_status", "none", profiles.authority),
  read("/authority-list", "runtime.command_authority_list", "runtime_status", "none", profiles.authority),
  read("/authority-show", "runtime.command_authority_get", "runtime_status", "none", profiles.authority),
  read("/authority-profile", "runtime.command_authority_validation_profile", "runtime_status", "none", profiles.authority),
  read("/status", "runtime.status", "runtime_status", "none", profiles.status),
  read("/missions", "runtime.list_recent_missions", "mission", "none", profiles.mission),
  read("/mission", "runtime.get_mission", "mission", "none", profiles.mission),
  read("/reasoning", "runtime.reasoning_provider_status", "reasoning_provider", "none", profiles.reasoning),
  read("/reasoning-health", "runtime.reasoning_provider_health", "reasoning_provider", "none", profiles.reasoning),
  read("/reasoning-smoke-preview", "runtime.preview_reasoning_provider_smoke", "reasoning_provider", "reasoning_provider_runtime", profiles.reasoning),
  write({ slash: "/reasoning-smoke", runtime: "runtime.execute_reasoning_provider_smoke", risk: "low_risk_write", gate: "reasoning_provider_runtime", owner: "reasoning_provider", events: ["runtime_reasoning_provider_smoke_executed"], provider: true, reads: ["/reasoning-health"], profile: profiles.reasoning }),
  read("/research", "research.list_topics", "research", "research_runtime", profiles.research, ["/topics"]),
  read("/topic", "research.get_topic_snapshot", "research", "research_runtime", profiles.research),
  read("/notes", "research.search_notes", "research", "research_runtime", profiles.research),
  read("/research-events", "research.list_events", "research", "research_runtime", profiles.research),
  read("/projection", "research.projection_status", "research", "research_runtime", profiles.research),
  record({ slash_command: "/rebuild-projection", runtime_command: "research.rebuild_projection", risk: "low_risk_write", gate: "research_runtime", owner: "research", mutates_events: false, requires_active_runtime: false, requires_approval: false, current_phase_status: "implemented", validation_profile: profiles.research, notes: ["Rebuilds research.db projection but does not append runtime events."] }),
  read("/checkpoints", "runtime.list_runtime_checkpoints", "runtime_checkpoint", "checkpoint_runtime", profiles.checkpoint),
  read("/checkpoint-show", "runtime.get_runtime_checkpoint", "runtime_checkpoint", "checkpoint_runtime", profiles.checkpoint),
  read("/checkpoint-preview", "runtime.preview_runtime_checkpoint", "runtime_checkpoint", "checkpoint_runtime", profiles.checkpoint),
  write({ slash: "/checkpoint", runtime: "runtime.create_runtime_checkpoint", risk: "medium_risk_write", gate: "checkpoint_runtime", owner: "runtime_checkpoint", events: ["runtime_checkpoint_created"], reads: ["/checkpoint-preview", "/checkpoints"], profile: profiles.checkpoint }),
  read("/resume-anchors", "runtime.list_checkpoint_resume_anchors", "runtime_restore", "checkpoint_runtime", profiles.restore),
  read("/resume-anchor", "runtime.get_checkpoint_resume_anchor", "runtime_restore", "checkpoint_runtime", profiles.restore),
  read("/restore-preview", "runtime.preview_checkpoint_restore", "runtime_restore", "checkpoint_runtime", profiles.restore, ["/resume-preview"]),
  write({ slash: "/resume-mark", runtime: "runtime.mark_checkpoint_resume_anchor", risk: "medium_risk_write", gate: "checkpoint_runtime", owner: "runtime_restore", events: ["runtime_checkpoint_resume_anchor_marked"], reads: ["/restore-preview", "/resume-anchors"], profile: profiles.restore }),
  read("/wake-preview", "runtime.preview_wake_assessment", "wake_assessment", "none", profiles.wake),
  read("/wakes", "runtime.list_wake_assessments", "wake_assessment", "none", profiles.wake),
  read("/wake-show", "runtime.get_wake_assessment", "wake_assessment", "none", profiles.wake),
  write({ slash: "/wake", runtime: "runtime.create_wake_assessment", risk: "medium_risk_write", gate: "none", owner: "wake_assessment", events: ["runtime_wake_assessment_created"], reads: ["/wake-preview", "/wakes"], profile: profiles.wake }),
  read("/wake-tick-preview", "runtime.preview_wake_schedule_tick", "wake_schedule", "wake_schedule_tick", profiles.wakeSchedule),
  record({ slash_command: "/wake-tick-dry-run", runtime_command: "runtime.execute_wake_schedule_tick", risk: "low_risk_write", gate: "wake_schedule_tick", owner: "wake_schedule", mutates_events: false, requires_active_runtime: true, requires_run_lock: true, requires_approval: false, current_phase_status: "implemented", validation_profile: profiles.wakeSchedule, recommended_reads: ["/wake-tick-preview"], notes: ["Dry-run tick computes due work without appending tick-completed events."] }),
  write({ slash: "/wake-tick", runtime: "runtime.execute_wake_schedule_tick", risk: "high_impact_write", gate: "wake_schedule_tick", owner: "wake_schedule", events: ["runtime_wake_schedule_tick_completed"], reads: ["/wake-tick-preview", "/wake-tick-dry-run"], profile: profiles.wakeSchedule, out: ["automatic wake tick execution"] }),
  read("/wake-ticks", "runtime.list_wake_schedule_ticks", "wake_schedule", "wake_schedule_tick", profiles.wakeSchedule),
  read("/wake-tick-show", "runtime.get_wake_schedule_tick", "wake_schedule", "wake_schedule_tick", profiles.wakeSchedule),
  read("/schedule-wake-preview", "runtime.preview_wake_schedule", "wake_schedule", "wake_schedule_tick", profiles.wakeSchedule),
  read("/wake-schedules", "runtime.list_wake_schedules", "wake_schedule", "wake_schedule_tick", profiles.wakeSchedule),
  read("/wake-schedule", "runtime.get_wake_schedule", "wake_schedule", "wake_schedule_tick", profiles.wakeSchedule),
  write({ slash: "/schedule-wake", runtime: "runtime.create_wake_schedule", risk: "medium_risk_write", gate: "wake_schedule_tick", owner: "wake_schedule", events: ["runtime_wake_schedule_created"], reads: ["/schedule-wake-preview", "/wake-schedules"], profile: profiles.wakeSchedule }),
  write({ slash: "/wake-schedule-pause", runtime: "runtime.pause_wake_schedule", risk: "medium_risk_write", gate: "wake_schedule_tick", owner: "wake_schedule", events: ["runtime_wake_schedule_paused"], reads: ["/wake-schedule", "/wake-schedules"], profile: profiles.wakeSchedule }),
  write({ slash: "/wake-schedule-resume", runtime: "runtime.resume_wake_schedule", risk: "medium_risk_write", gate: "wake_schedule_tick", owner: "wake_schedule", events: ["runtime_wake_schedule_resumed"], reads: ["/wake-schedule", "/wake-schedules"], profile: profiles.wakeSchedule }),
  write({ slash: "/wake-schedule-cancel", runtime: "runtime.cancel_wake_schedule", risk: "medium_risk_write", gate: "wake_schedule_tick", owner: "wake_schedule", events: ["runtime_wake_schedule_cancelled"], reads: ["/wake-schedule", "/wake-schedules"], profile: profiles.wakeSchedule }),
  read("/scheduler-status", "runtime.wake_scheduler_status", "wake_scheduler", "wake_scheduler_runtime", profiles.scheduler),
  read("/scheduler-events", "runtime.list_wake_scheduler_events", "wake_scheduler", "wake_scheduler_runtime", profiles.scheduler),
  read("/scheduler-bootstrap", "runtime.wake_scheduler_bootstrap_status", "wake_scheduler", "wake_scheduler_runtime", profiles.scheduler),
  read("/scheduler-bootstrap-preview", "runtime.preview_wake_scheduler_bootstrap", "wake_scheduler", "wake_scheduler_runtime", profiles.scheduler),
  read("/scheduler-preview", "runtime.preview_wake_scheduler_start", "wake_scheduler", "wake_scheduler_runtime", profiles.scheduler, ["/wake-scheduler-preview"]),
  write({ slash: "/scheduler-start", runtime: "runtime.start_wake_scheduler", risk: "high_impact_write", gate: "wake_scheduler_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_started"], reads: ["/scheduler-preview", "/scheduler-status"], profile: profiles.scheduler, out: ["automatic scheduler start"] }),
  write({ slash: "/scheduler-stop", runtime: "runtime.stop_wake_scheduler", risk: "high_impact_write", gate: "wake_scheduler_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_stopped"], reads: ["/scheduler-status"], profile: profiles.scheduler, out: ["automatic scheduler stop"] }),
  read("/scheduler-recovery", "runtime.preview_wake_scheduler_recovery", "wake_scheduler", "recovery_runtime", profiles.recovery, ["/scheduler-recovery-preview"]),
  read("/scheduler-recoveries", "runtime.list_wake_scheduler_recoveries", "wake_scheduler", "recovery_runtime", profiles.recovery),
  read("/scheduler-recovery-show", "runtime.get_wake_scheduler_recovery", "wake_scheduler", "recovery_runtime", profiles.recovery),
  write({ slash: "/scheduler-recovery-ack", runtime: "runtime.acknowledge_wake_scheduler_recovery", risk: "medium_risk_write", gate: "recovery_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_acknowledged"], reads: ["/scheduler-recovery-show"], profile: profiles.recovery }),
  write({ slash: "/scheduler-recovery-resolve", runtime: "runtime.acknowledge_wake_scheduler_recovery", risk: "medium_risk_write", gate: "recovery_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_resolved"], reads: ["/scheduler-recovery-show"], profile: profiles.recovery }),
  write({ slash: "/scheduler-recovery-dismiss", runtime: "runtime.acknowledge_wake_scheduler_recovery", risk: "medium_risk_write", gate: "recovery_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_dismissed"], reads: ["/scheduler-recovery-show"], profile: profiles.recovery }),
  read("/scheduler-recovery-workflow-preview", "runtime.preview_wake_scheduler_recovery_workflow", "wake_scheduler", "recovery_workflow_runtime", profiles.workflow),
  read("/scheduler-recovery-workflows", "runtime.list_wake_scheduler_recovery_workflows", "wake_scheduler", "recovery_workflow_runtime", profiles.workflow),
  read("/scheduler-recovery-workflow-show", "runtime.get_wake_scheduler_recovery_workflow", "wake_scheduler", "recovery_workflow_runtime", profiles.workflow),
  read("/scheduler-recovery-workflow-verify", "runtime.verify_wake_scheduler_recovery_workflow", "wake_scheduler", "recovery_workflow_runtime", profiles.workflow),
  write({ slash: "/scheduler-recovery-workflow", runtime: "runtime.create_wake_scheduler_recovery_workflow", risk: "medium_risk_write", gate: "recovery_workflow_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_workflow_created"], reads: ["/scheduler-recovery-workflow-preview"], profile: profiles.workflow }),
  write({ slash: "/scheduler-recovery-step-done", runtime: "runtime.record_wake_scheduler_recovery_workflow_step", risk: "medium_risk_write", gate: "recovery_workflow_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_workflow_step_recorded"], reads: ["/scheduler-recovery-workflow-show"], profile: profiles.workflow }),
  write({ slash: "/scheduler-recovery-step-skip", runtime: "runtime.record_wake_scheduler_recovery_workflow_step", risk: "medium_risk_write", gate: "recovery_workflow_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_workflow_step_recorded"], reads: ["/scheduler-recovery-workflow-show"], profile: profiles.workflow }),
  write({ slash: "/scheduler-recovery-step-block", runtime: "runtime.record_wake_scheduler_recovery_workflow_step", risk: "medium_risk_write", gate: "recovery_workflow_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_workflow_step_recorded"], reads: ["/scheduler-recovery-workflow-show"], profile: profiles.workflow }),
  write({ slash: "/scheduler-recovery-workflow-cancel", runtime: "runtime.cancel_wake_scheduler_recovery_workflow", risk: "medium_risk_write", gate: "recovery_workflow_runtime", owner: "wake_scheduler", events: ["runtime_wake_scheduler_recovery_workflow_cancelled"], reads: ["/scheduler-recovery-workflow-show"], profile: profiles.workflow }),
  read("/scheduler-audit", "runtime.wake_scheduler_audit_summary", "scheduler_navigation", "none", profiles.audit, ["/wake-scheduler-audit"]),
  read("/scheduler-audit-summary", "runtime.wake_scheduler_audit_summary", "scheduler_navigation", "none", profiles.audit),
  read("/scheduler-audit-timeline", "runtime.wake_scheduler_audit_timeline", "scheduler_navigation", "none", profiles.audit),
  read("/scheduler-audit-chain", "runtime.wake_scheduler_audit_chain", "scheduler_navigation", "none", profiles.audit),
  read("/scheduler-audit-incidents", "runtime.wake_scheduler_audit_incidents", "scheduler_navigation", "none", profiles.audit),
  read("/scheduler-nav", "runtime.wake_scheduler_navigation_board", "scheduler_navigation", "none", profiles.nav, ["/scheduler-navigation", "/wake-scheduler-nav"]),
  read("/scheduler-nav-command", "runtime.preview_wake_scheduler_navigation_command", "scheduler_navigation", "none", profiles.nav),
  read("/scheduler-nav-target", "runtime.get_wake_scheduler_navigation_target", "scheduler_navigation", "none", profiles.nav),
  read("/scheduler-nav-stage-preview", "runtime.preview_wake_scheduler_navigation_stage", "scheduler_navigation_staging", "none", profiles.navStage),
  write({ slash: "/scheduler-nav-stage", runtime: "runtime.stage_wake_scheduler_navigation_command", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_staging", status: "staged_only", events: ["runtime_wake_scheduler_navigation_command_staged"], reads: ["/scheduler-nav-stage-preview", "/scheduler-nav-staged"], profile: profiles.navStage }),
  read("/scheduler-nav-staged", "runtime.list_wake_scheduler_navigation_staged_commands", "scheduler_navigation_staging", "none", profiles.navStage),
  write({ slash: "/scheduler-nav-unstage", runtime: "runtime.remove_wake_scheduler_navigation_staged_command", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_staging", events: ["runtime_wake_scheduler_navigation_command_removed"], reads: ["/scheduler-nav-staged"], profile: profiles.navStage }),
  write({ slash: "/scheduler-nav-stage-clear", runtime: "runtime.clear_wake_scheduler_navigation_staged_commands", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_staging", events: ["runtime_wake_scheduler_navigation_commands_cleared"], reads: ["/scheduler-nav-staged"], profile: profiles.navStage }),
  read("/scheduler-nav-run-preview", "runtime.preview_wake_scheduler_navigation_staged_read", "scheduler_navigation_staged_read", "none", profiles.stagedRead, ["/scheduler-nav-read-preview"]),
  write({ slash: "/scheduler-nav-run", runtime: "runtime.execute_wake_scheduler_navigation_staged_read", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_staged_read", events: ["runtime_wake_scheduler_navigation_staged_read_started", "runtime_wake_scheduler_navigation_staged_read_succeeded"], reads: ["/scheduler-nav-run-preview", "/scheduler-nav-runs"], profile: profiles.stagedRead, aliases: ["/scheduler-nav-read"] }),
  read("/scheduler-nav-runs", "runtime.list_wake_scheduler_navigation_staged_read_runs", "scheduler_navigation_staged_read", "none", profiles.stagedRead),
  read("/scheduler-nav-run-show", "runtime.get_wake_scheduler_navigation_staged_read_run", "scheduler_navigation_staged_read", "none", profiles.stagedRead),
  read("/scheduler-nav-read-history", "runtime.wake_scheduler_navigation_staged_read_history", "scheduler_navigation_staged_read", "none", profiles.stagedReadCompare, ["/scheduler-nav-run-history"]),
  read("/scheduler-nav-read-compare", "runtime.wake_scheduler_navigation_staged_read_compare", "scheduler_navigation_staged_read", "none", profiles.stagedReadCompare, ["/scheduler-nav-run-compare"]),
  read("/scheduler-nav-read-stale", "runtime.wake_scheduler_navigation_staged_read_stale", "scheduler_navigation_staged_read", "none", profiles.stagedReadCompare),
  read("/scheduler-nav-write-preview", "runtime.preview_wake_scheduler_navigation_write_command", "scheduler_navigation_write_preview", "none", profiles.writePreview, ["/scheduler-write-preview"]),
  read("/scheduler-nav-write-board", "runtime.wake_scheduler_navigation_write_board", "scheduler_navigation_write_preview", "none", profiles.writePreview, ["/scheduler-write-board"]),
  read("/scheduler-nav-write-stage-preview", "runtime.preview_wake_scheduler_navigation_write_stage", "scheduler_navigation_write_staging", "none", profiles.writeStage, ["/scheduler-write-stage-preview"]),
  write({ slash: "/scheduler-nav-write-stage", runtime: "runtime.stage_wake_scheduler_navigation_write_command", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_write_staging", status: "staged_only", events: ["runtime_wake_scheduler_navigation_write_command_staged"], reads: ["/scheduler-nav-write-stage-preview", "/scheduler-nav-write-staged"], profile: profiles.writeStage, aliases: ["/scheduler-write-stage"] }),
  write({ slash: "/scheduler-nav-write-stage-medium", runtime: "runtime.stage_wake_scheduler_navigation_write_command", risk: "medium_risk_write", gate: "none", owner: "scheduler_navigation_write_staging", status: "staged_only", events: ["runtime_wake_scheduler_navigation_write_command_staged"], reads: ["/scheduler-nav-write-stage-preview", "/scheduler-nav-write-staged"], profile: profiles.writeStage }),
  read("/scheduler-nav-write-staged", "runtime.list_wake_scheduler_navigation_staged_write_commands", "scheduler_navigation_write_staging", "none", profiles.writeStage, ["/scheduler-write-staged"]),
  write({ slash: "/scheduler-nav-write-unstage", runtime: "runtime.remove_wake_scheduler_navigation_staged_write_command", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_write_staging", events: ["runtime_wake_scheduler_navigation_write_command_removed"], reads: ["/scheduler-nav-write-staged"], profile: profiles.writeStage }),
  read("/scheduler-nav-write-run-preview", "runtime.preview_wake_scheduler_navigation_write_run", "scheduler_navigation_write_run", "none", profiles.writeRun, ["/scheduler-write-run-preview"]),
  write({ slash: "/scheduler-nav-write-run", runtime: "runtime.execute_wake_scheduler_navigation_write_run", risk: "low_risk_write", gate: "none", owner: "scheduler_navigation_write_run", events: ["runtime_wake_scheduler_navigation_write_run_started", "runtime_wake_scheduler_navigation_write_run_succeeded"], reads: ["/scheduler-nav-write-run-preview", "/scheduler-nav-write-runs"], profile: profiles.writeRun, aliases: ["/scheduler-write-run"] }),
  read("/scheduler-nav-write-runs", "runtime.list_wake_scheduler_navigation_write_runs", "scheduler_navigation_write_run", "none", profiles.writeRun, ["/scheduler-write-runs"]),
  read("/scheduler-nav-write-run-history", "runtime.wake_scheduler_navigation_write_run_history", "scheduler_navigation_write_run", "none", profiles.writeRunCompare, ["/scheduler-write-run-history"]),
  read("/scheduler-nav-write-run-compare", "runtime.wake_scheduler_navigation_write_run_compare", "scheduler_navigation_write_run", "none", profiles.writeRunCompare, ["/scheduler-write-run-compare"]),
  read("/scheduler-nav-write-run-stale", "runtime.wake_scheduler_navigation_write_run_stale", "scheduler_navigation_write_run", "none", profiles.writeRunCompare, ["/scheduler-write-run-stale"]),
  read("/scheduler-nav-write-readiness", "runtime.preview_wake_scheduler_navigation_write_readiness", "scheduler_navigation_write_approval", "none", profiles.approval, ["/scheduler-write-readiness"]),
  write({ slash: "/scheduler-nav-write-approve", runtime: "runtime.approve_wake_scheduler_navigation_staged_write", risk: "medium_risk_write", gate: "none", owner: "scheduler_navigation_write_approval", events: ["runtime_wake_scheduler_navigation_write_approval_recorded"], reads: ["/scheduler-nav-write-readiness", "/scheduler-nav-write-approvals"], profile: profiles.approval, aliases: ["/scheduler-write-approve"] }),
  write({ slash: "/scheduler-nav-write-reject", runtime: "runtime.reject_wake_scheduler_navigation_staged_write", risk: "medium_risk_write", gate: "none", owner: "scheduler_navigation_write_approval", events: ["runtime_wake_scheduler_navigation_write_approval_recorded"], reads: ["/scheduler-nav-write-readiness", "/scheduler-nav-write-approvals"], profile: profiles.approval, aliases: ["/scheduler-write-reject"] }),
  write({ slash: "/scheduler-nav-write-approval-revoke", runtime: "runtime.revoke_wake_scheduler_navigation_write_approval", risk: "medium_risk_write", gate: "none", owner: "scheduler_navigation_write_approval", events: ["runtime_wake_scheduler_navigation_write_approval_revoked"], reads: ["/scheduler-nav-write-approvals"], profile: profiles.approval }),
  read("/scheduler-nav-write-approvals", "runtime.list_wake_scheduler_navigation_write_approvals", "scheduler_navigation_write_approval", "none", profiles.approval, ["/scheduler-write-approvals"]),
  read("/scheduler-nav-checkpoint-run-preview", "runtime.preview_wake_scheduler_navigation_checkpoint_write_run", "scheduler_navigation_checkpoint_write", "checkpoint_runtime", profiles.checkpointWrite, ["/scheduler-checkpoint-run-preview"]),
  write({ slash: "/scheduler-nav-checkpoint-run", runtime: "runtime.execute_wake_scheduler_navigation_checkpoint_write_run", risk: "medium_risk_write", gate: "checkpoint_runtime", owner: "scheduler_navigation_checkpoint_write", status: "approved_execution", approval: "/scheduler-nav-write-approve", execution: "checkpoint_create", events: ["runtime_wake_scheduler_navigation_checkpoint_write_run_started", "runtime_wake_scheduler_navigation_checkpoint_write_run_succeeded", "runtime_checkpoint_created"], reads: ["/scheduler-nav-checkpoint-run-preview", "/scheduler-nav-checkpoint-runs"], profile: profiles.checkpointWrite, aliases: ["/scheduler-checkpoint-run"] }),
  read("/scheduler-nav-checkpoint-runs", "runtime.list_wake_scheduler_navigation_checkpoint_write_runs", "scheduler_navigation_checkpoint_write", "checkpoint_runtime", profiles.checkpointWrite, ["/scheduler-checkpoint-runs"]),
  read("/scheduler-nav-checkpoint-history", "runtime.wake_scheduler_navigation_checkpoint_write_history", "scheduler_navigation_checkpoint_compare", "none", profiles.checkpointCompare, ["/scheduler-checkpoint-history"]),
  read("/scheduler-nav-checkpoint-compare", "runtime.wake_scheduler_navigation_checkpoint_write_compare", "scheduler_navigation_checkpoint_compare", "none", profiles.checkpointCompare, ["/scheduler-checkpoint-compare"]),
  read("/scheduler-nav-checkpoint-stale", "runtime.wake_scheduler_navigation_checkpoint_write_stale", "scheduler_navigation_checkpoint_compare", "none", profiles.checkpointCompare, ["/scheduler-checkpoint-stale"]),
  read("/scheduler-nav-checkpoint-approval-usage", "runtime.wake_scheduler_navigation_checkpoint_write_approval_usage", "scheduler_navigation_checkpoint_compare", "none", profiles.checkpointCompare),
  read("/continuations", "runtime.list_continuation_plans", "continuation", "continuation_runtime", profiles.continuation),
  read("/continue-show", "runtime.get_continuation_plan", "continuation", "continuation_runtime", profiles.continuation),
  read("/continue-preview", "runtime.preview_continuation_plan", "continuation", "continuation_runtime", profiles.continuation),
  write({ slash: "/continue-plan", runtime: "runtime.create_continuation_plan", risk: "medium_risk_write", gate: "continuation_runtime", owner: "continuation", events: ["runtime_continuation_plan_created"], reads: ["/continue-preview", "/continuations"], profile: profiles.continuation }),
  write({ slash: "/continue-step", runtime: "runtime.execute_continuation_step", risk: "high_impact_write", gate: "continuation_runtime", owner: "continuation", events: ["runtime_continuation_step_completed"], reads: ["/continue-show", "/continue-dry-run"], profile: profiles.continuation }),
  write({ slash: "/continue-pause", runtime: "runtime.pause_continuation_plan", risk: "medium_risk_write", gate: "continuation_runtime", owner: "continuation", events: ["runtime_continuation_plan_paused"], reads: ["/continue-show"], profile: profiles.continuation }),
  write({ slash: "/continue-cancel", runtime: "runtime.cancel_continuation_plan", risk: "medium_risk_write", gate: "continuation_runtime", owner: "continuation", events: ["runtime_continuation_plan_cancelled"], reads: ["/continue-show"], profile: profiles.continuation }),
  read("/handoff-followups", "runtime.list_opencode_handoff_followups", "opencode_handoff", "handoff_runtime", profiles.handoff),
  read("/handoff-followup", "runtime.get_opencode_handoff_followup", "opencode_handoff", "handoff_runtime", profiles.handoff),
  read("/handoff-preview", "runtime.preview_opencode_handoff", "opencode_handoff", "handoff_runtime", profiles.handoff),
  record({ slash_command: "/handoff-dry-run", runtime_command: "runtime.execute_opencode_handoff", risk: "low_risk_write", gate: "handoff_runtime", owner: "opencode_handoff", mutates_events: false, creates_external_process: false, calls_provider: false, requires_active_runtime: true, requires_run_lock: true, requires_approval: false, current_phase_status: "implemented", validation_profile: profiles.handoff, recommended_reads: ["/handoff-preview", "/handoff-followups"], notes: ["Dry-run handoff validates the handoff execution path without launching OpenCode, applying a proposal, sending a mission, or appending handoff events."] }),
  write({ slash: "/handoff", runtime: "runtime.execute_opencode_handoff", risk: "high_impact_write", gate: "handoff_runtime", owner: "opencode_handoff", events: ["opencode_handoff_started", "opencode_handoff_created", "opencode_handoff_failed"], reads: ["/handoff-preview", "/handoff-followups"], process: true, profile: profiles.handoff }),
  write({ slash: "/synthesize", runtime: "runtime.execute_research_synthesis", risk: "high_impact_write", gate: "reasoning_provider_runtime", owner: "reasoning_provider", events: ["research_synthesis_created"], provider: true, reads: ["/synthesize-preview", "/syntheses"], profile: profiles.synthesis }),
  write({ slash: "/cycle", runtime: "runtime.execute_commander_cycle", risk: "high_impact_write", gate: "reasoning_provider_runtime", owner: "commander_cycle", events: ["commander_cycle_completed"], provider: true, reads: ["/cycle-preview", "/cycles"], profile: profiles.cycle }),
  read("/api-preview", "runtime.preview_external_api_request", "reasoning_provider", "external_api_runtime", profiles.externalApi),
  write({ slash: "/api-dry-run", runtime: "runtime.execute_external_api_request", risk: "low_risk_write", gate: "external_api_runtime", owner: "reasoning_provider", status: "preview_only", events: [], reads: ["/api-preview", "/api-audit"], profile: profiles.externalApi, notes: ["Dry-run external API request does not append audit events or call live transport."] }),
  read("/api-audit", "runtime.list_external_api_audit", "reasoning_provider", "external_api_runtime", profiles.externalApi),
  write({ slash: "/api-call", runtime: "runtime.execute_external_api_request", risk: "high_impact_write", gate: "external_api_runtime", owner: "reasoning_provider", events: ["external_api_request_executed", "external_api_request_failed"], reads: ["/api-preview", "/api-audit"], profile: profiles.externalApi }),
  read("/api-ingest-preview", "runtime.preview_external_api_research_ingestion", "research", "external_api_runtime", profiles.externalApi),
  record({ slash_command: "/api-ingest-dry-run", runtime_command: "runtime.execute_external_api_research_ingestion", risk: "low_risk_write", gate: "external_api_runtime", owner: "research", mutates_events: false, requires_active_runtime: true, requires_run_lock: true, requires_approval: false, current_phase_status: "preview_only", validation_profile: profiles.externalApi, recommended_reads: ["/api-ingest-preview", "/api-ingestions"], notes: ["Dry-run research ingestion validates the write path without transport, ResearchDb writes, or event appends."] }),
  read("/api-ingestions", "runtime.list_external_api_research_ingestions", "research", "external_api_runtime", profiles.externalApi),
  write({ slash: "/api-ingest", runtime: "runtime.execute_external_api_research_ingestion", risk: "high_impact_write", gate: "external_api_runtime", owner: "research", events: ["external_api_request_executed", "external_api_request_failed", "external_api_research_ingestion_succeeded", "external_api_research_ingestion_failed"], reads: ["/api-ingest-preview", "/api-ingestions", "/api-audit"], profile: profiles.externalApi, provider: true, notes: ["Non-dry-run ingestion can call an external API and write ResearchDb source, note, and artifact rows."] }),
  write({ slash: "/claim", runtime: "runtime.claim_mission", risk: "medium_risk_write", gate: "mission_runtime", owner: "mission", events: ["mission_claimed"], reads: ["/mission"], profile: profiles.mission }),
  write({ slash: "/progress-add", runtime: "runtime.record_mission_progress", risk: "medium_risk_write", gate: "mission_runtime", owner: "mission", events: ["mission_progress_recorded"], reads: ["/progress"], profile: profiles.mission }),
  write({ slash: "/result", runtime: "runtime.submit_mission_result", risk: "medium_risk_write", gate: "mission_runtime", owner: "mission", events: ["mission_result_submitted"], reads: ["/results"], profile: profiles.mission }),
  write({ slash: "/complete", runtime: "runtime.complete_mission", risk: "high_impact_write", gate: "mission_runtime", owner: "mission", events: ["mission_completed"], reads: ["/mission"], profile: profiles.mission }),
  write({ slash: "/fail", runtime: "runtime.fail_mission", risk: "high_impact_write", gate: "mission_runtime", owner: "mission", events: ["mission_failed"], reads: ["/mission"], profile: profiles.mission }),
  record({ slash_command: "/cancel", risk: "safe_read", gate: "none", owner: "runtime_status", mutates_events: false, creates_external_process: false, calls_provider: false, requires_active_runtime: false, requires_run_lock: false, requires_approval: false, current_phase_status: "implemented", validation_profile: profiles.status, notes: ["Local TUI cancel/escape command. It clears UI state only and does not call runtime.cancel_mission."] }),
  write({ slash: "/cancel-mission", runtime: "runtime.cancel_mission", risk: "high_impact_write", gate: "mission_runtime", owner: "mission", events: ["mission_cancelled"], reads: ["/mission"], profile: profiles.mission }),
  write({ slash: "/release-claim", runtime: "runtime.release_mission_claim", risk: "medium_risk_write", gate: "mission_runtime", owner: "mission", events: ["mission_claim_released"], reads: ["/claims"], profile: profiles.mission }),
  read("/reviews", "runtime.list_review_requests", "review", "proposal_review_runtime", profiles.proposal),
  write({ slash: "/approve", runtime: "runtime.approve_review_request", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "review", events: ["review_request_approved"], reads: ["/review"], profile: profiles.proposal }),
  write({ slash: "/reject", runtime: "runtime.reject_review_request", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "review", events: ["review_request_rejected"], reads: ["/review"], profile: profiles.proposal }),
  read("/proposals", "runtime.list_commander_proposals", "proposal", "proposal_review_runtime", profiles.proposal),
  read("/proposal", "runtime.get_commander_proposal", "proposal", "proposal_review_runtime", profiles.proposal),
  write({ slash: "/proposal-review", runtime: "runtime.request_proposal_review", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "proposal", events: ["commander_proposal_review_requested"], reads: ["/proposal"], profile: profiles.proposal }),
  write({ slash: "/apply-proposal", runtime: "runtime.apply_commander_proposal", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "proposal", events: ["commander_proposal_applied"], reads: ["/proposal"], profile: profiles.apply }),
  write({ slash: "/bundle-review", runtime: "runtime.request_proposal_bundle_reviews", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "proposal", events: ["commander_proposal_bundle_reviews_requested"], reads: ["/bundle"], profile: profiles.proposal }),
  write({ slash: "/apply-bundle", runtime: "runtime.apply_proposal_bundle", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "proposal", events: ["commander_proposal_bundle_applied"], reads: ["/bundle"], profile: profiles.apply }),
  write({ slash: "/draft-review", runtime: "runtime.request_commander_playbook_draft_reviews", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "playbook", events: ["commander_playbook_draft_reviews_requested"], reads: ["/draft"], profile: profiles.proposal }),
  write({ slash: "/apply-target", runtime: "runtime.apply_commander_target", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "commander_apply", events: ["commander_target_applied"], reads: ["/apply-preview"], profile: profiles.apply }),
  write({ slash: "/apply-partial", runtime: "runtime.apply_commander_target", risk: "high_impact_write", gate: "proposal_review_runtime", owner: "commander_apply", events: ["commander_target_applied"], reads: ["/apply-preview"], profile: profiles.apply }),
]
