import type { UiState, StreamLine } from "./state"
import { redactText } from "./redaction"

function lines(items: StreamLine[]): string[] {
  if (items.length === 0) return ["  - empty"]
  return items.map((item) => `  - ${item.title}${item.status ? ` [${item.status}]` : ""}${item.detail ? `: ${item.detail}` : ""}`)
}

export function layoutSnapshot(state: UiState): string {
  const out = [
    `NexusLoop OpenTUI shell`,
    `screen=${state.screen}`,
    `focus=${state.focus}`,
    `project=${state.header.projectName}`,
    `runtime=${state.header.runtimeStatus}`,
    state.header.providerStatus,
    state.header.modelStatus,
    `mission=${state.header.activeMissionId}`,
    `active_training=${state.header.activeTrainingCount}`,
    `open_obligations=${state.header.openObligationsCount}`,
  ]

  if (state.screen === "init") {
    out.push(...runtimeLines(state))
    out.push("Project not initialized")
    out.push(...state.initChoices.map((choice, index) => `${index === state.initSelection ? ">" : " "} ${choice.label}`))
    return out.join("\n")
  }

  if (state.screen === "resume") {
    out.push(...runtimeLines(state))
    out.push("Resume")
    out.push(...state.resumeChoices.map((choice, index) => `${index === state.resumeSelection ? ">" : " "} ${choice.label}`))
    return out.join("\n")
  }

  out.push("Executor")
  out.push(...lines(state.executor))
  out.push("Commander")
  out.push(`  program_state=${state.commander.programState}`)
  out.push(`  work_intent=${state.commander.workIntent}`)
  out.push(`  budget=${state.commander.budget}`)
  out.push(`  obligations=${state.commander.obligations.join(", ") || "none"}`)
  out.push(`  candidates=${state.commander.candidates.join(", ") || "none"}`)
  out.push(...runtimeLines(state))
  out.push("Live system actions")
  out.push(...lines(state.systemActions))
  out.push("Onboarding")
  out.push(`  provider=${state.providerOnboarding.provider}`)
  out.push(`  model=${state.providerOnboarding.model}`)
  out.push(`  credential=${state.providerOnboarding.credentialSource}`)
  out.push(`  connection=${state.providerOnboarding.connectionStatus}`)
  out.push(`  gpu_quota=${state.projectOnboarding.gpuQuota}`)
  out.push(`  wake_hooks=${state.projectOnboarding.wakeHooks}`)
  out.push(`  max_parallel_runs=${state.projectOnboarding.maxParallelRuns}`)
  out.push(`  approvals=${state.projectOnboarding.approvalRequirements.join(", ") || "none"}`)
  out.push(`  risky_fields=${state.projectOnboarding.riskyFields.join(", ") || "none"}`)
  out.push("Search / records")
  out.push(`  filters=${state.search.recordFilters.join(", ")}`)
  out.push(`  labels=${state.search.labelFilters.join(", ")}`)
  out.push(...lines(state.search.records))
  out.push("Approval / clarification")
  out.push(...lines([...state.approval.specApprovals, ...state.approval.candidateApprovals, ...state.approval.clarifications]))
  out.push(`Message box: ${state.messageDraft}`)
  return out.join("\n")
}

function runtimeLines(state: UiState): string[] {
  const out = ["Runtime"]
  if (state.runtimeStatus) {
    out.push(`  status=${state.runtimeStatus.runtimeStatus}`)
    out.push(`  mode=${state.runtimeStatus.mode}`)
    out.push(`  spec_approved=${state.runtimeStatus.specApproved}`)
    out.push(`  lock_held=${state.runtimeStatus.lockHeld}`)
  } else {
    out.push("  status=unknown")
  }
  if (state.adapterStatus) {
    out.push(`  adapter=${adapterSummary(state.adapterStatus)}`)
  }
  if (state.researchProjection) {
    out.push(`  projection=${state.researchProjection.ok ? "ok" : "not-ok"} stale=${state.researchProjection.stale} pending=${state.researchProjection.pending_count}`)
    if (state.researchProjection.reason) out.push(`  projection_reason=${state.researchProjection.reason}`)
  }
  if (state.missions) {
    out.push(`  missions_pending=${state.missions.pending_count}`)
    out.push(`  missions_failed=${state.missions.failed_count}`)
    out.push(`  missions_active_claims=${state.missions.active_claim_count ?? 0}`)
    out.push(`  missions_completed=${state.missions.completed_count ?? 0}`)
    out.push(`  missions_cancelled=${state.missions.cancelled_count ?? 0}`)
    out.push(`  last_mission=${state.missions.last_mission_id ?? "none"}`)
    out.push("  recent_missions")
    if (state.missions.recent.length === 0) out.push("    - empty")
    else out.push(...state.missions.recent.map((mission) => `    - ${mission.mission_id} [${mission.status}]`))
  }
  if (state.runtimeCommandError) out.push(`  command_error=${redactText(state.runtimeCommandError)}`)
  return out
}

function adapterSummary(adapter: Record<string, unknown>): string {
  const fields = ["kind", "phase", "status", "message"]
    .map((key) => {
      const value = adapter[key]
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? `${key}=${redactText(String(value))}`
        : undefined
    })
    .filter(Boolean)
  return fields.join(" ") || "present"
}
