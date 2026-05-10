import type { UiState, StreamLine } from "./state"

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
    out.push("Project not initialized")
    out.push(...state.initChoices.map((choice, index) => `${index === state.initSelection ? ">" : " "} ${choice.label}`))
    return out.join("\n")
  }

  if (state.screen === "resume") {
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
