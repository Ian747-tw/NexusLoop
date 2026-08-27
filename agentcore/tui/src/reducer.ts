import type { RuntimeEvent } from "./events"
import type { KeyCommand } from "./keyboard"
import { initialState, type UiState } from "./state"
import { redactText } from "./redaction"

function append<T>(items: T[], item: T, limit = 12): T[] {
  return [...items, item].slice(-limit)
}

export function reduceRuntimeEvent(state: UiState, event: RuntimeEvent): UiState {
  switch (event.type) {
    case "RuntimeReady":
      return {
        ...state,
        header: {
          ...state.header,
          projectName: event.projectName,
          runtimeStatus: event.runtimeStatus,
          providerStatus: event.providerLabel ? `provider: ${event.providerLabel}` : "provider: not connected",
          modelStatus: event.modelLabel ? `model: ${event.modelLabel}` : "model: placeholder",
        },
      }
    case "ProjectUninitialized":
      return { ...state, screen: "init", projectDir: event.projectDir, focus: "init-choice" }
    case "ProjectInitialized":
      return { ...state, screen: "resume", projectDir: event.projectDir, focus: "resume-choice" }
    case "ResumeSummaryLoaded":
      return {
        ...state,
        header: {
          ...state.header,
          activeMissionId: event.activeMissionId ?? state.header.activeMissionId,
        },
        systemActions: append(state.systemActions, {
          title: "Resume summary loaded",
          detail: `last_run=${event.lastRunId ?? "none"} records=${event.recordsCount ?? 0}`,
        }),
      }
    case "MissionStarted":
      return {
        ...state,
        screen: "main",
        focus: "message-box",
        header: { ...state.header, activeMissionId: event.missionId },
        commander: {
          ...state.commander,
          programState: event.programState,
          workIntent: event.workIntent,
          mission: event.missionId,
          budget: event.budget,
        },
        systemActions: append(state.systemActions, {
          title: "Mission started",
          detail: `${event.missionId}: ${event.workIntent}`,
        }),
      }
    case "MissionBriefUpdated": {
      const obligations = event.obligations ?? state.commander.obligations
      return {
        ...state,
        header: { ...state.header, openObligationsCount: obligations.length },
        commander: {
          ...state.commander,
          workIntent: event.brief,
          obligations,
          candidates: event.candidates ?? state.commander.candidates,
        },
      }
    }
    case "ExecutorToolStarted":
      return {
        ...state,
        executor: append(state.executor, {
          title: `tool started: ${event.tool}`,
          detail: event.command ?? event.target,
          status: "running",
        }),
      }
    case "ExecutorToolCompleted":
      return {
        ...state,
        executor: append(state.executor, {
          title: `tool ${event.status}: ${event.tool}`,
          detail: [event.output, ...(event.editedFiles ?? []).map((file) => `edit: ${file}`)].filter(Boolean).join(" | "),
          status: event.status,
        }),
      }
    case "CommanderDecisionRecorded":
      return {
        ...state,
        commander: {
          ...state.commander,
          decisions: append(state.commander.decisions, { title: event.decision, detail: event.reason }),
        },
        systemActions: append(state.systemActions, {
          title: "commander -> executor",
          detail: event.decision,
        }),
      }
    case "UserInterventionReceived":
      return {
        ...state,
        systemActions: append(state.systemActions, {
          title: "user intervention routing",
          detail: redactText(`${event.route}: ${event.message}`),
        }),
      }
    case "WakeHookFired":
      return {
        ...state,
        systemActions: append(state.systemActions, { title: "wake hook fired", detail: event.hook }),
      }
    case "TrainingProgressObserved":
      return {
        ...state,
        header: { ...state.header, activeTrainingCount: event.activeCount },
        executor: append(state.executor, {
          title: "training progress",
          detail: event.summary,
          status: `${event.activeCount} active`,
        }),
      }
    case "ResearchResultAccepted":
      return {
        ...state,
        search: {
          ...state.search,
          records: append(state.search.records, {
            title: `${event.label}: ${event.resultId}`,
            detail: event.summary,
          }),
        },
      }
    case "ApprovalRequested": {
      const item = { title: `${event.kind} approval: ${event.approvalId}`, detail: redactText(event.prompt) }
      return {
        ...state,
        focus: "approval",
        approval:
          event.kind === "spec"
            ? { ...state.approval, specApprovals: append(state.approval.specApprovals, item) }
            : { ...state.approval, candidateApprovals: append(state.approval.candidateApprovals, item) },
      }
    }
    case "ClarificationRequested":
      return {
        ...state,
        focus: "approval",
        approval: {
          ...state.approval,
          clarifications: append(state.approval.clarifications, {
            title: `${event.source} clarification: ${event.clarificationId}`,
            detail: redactText(event.prompt),
          }),
        },
      }
    case "ProviderOnboardingState":
      return {
        ...state,
        providerOnboarding: {
          provider: event.provider,
          model: event.model,
          credentialSource: event.credentialSource,
          localEndpoint: event.localEndpoint ?? "",
          connectionStatus: event.connectionStatus,
        },
        header: {
          ...state.header,
          providerStatus: `provider: ${event.provider}`,
          modelStatus: `model: ${event.model}`,
        },
      }
    case "ProjectSpecOnboardingState":
      return {
        ...state,
        projectOnboarding: {
          ...state.projectOnboarding,
          plainTextSpec: redactText(event.plainTextSpec ?? state.projectOnboarding.plainTextSpec),
          gpuQuota: event.gpuQuota,
          wakeHooks: event.wakeHooks,
          maxParallelRuns: event.maxParallelRuns,
          approvalRequirements: event.approvalRequirements,
        },
      }
    case "SpecApprovalSummary":
      return {
        ...state,
        focus: "approval",
        projectOnboarding: { ...state.projectOnboarding, riskyFields: event.riskyFields },
        approval: {
          ...state.approval,
          specApprovals: append(state.approval.specApprovals, {
            title: `spec approval summary: ${event.specId}`,
            detail: redactText([
              event.objective,
              `metrics=${event.successMetrics.join(", ")}`,
              `compute=${event.computeLimits}`,
              `wake=${event.wakeHookPolicy}`,
              `rules=${event.userRules.join(", ") || "none"}`,
              `risky=${event.riskyFields.join(", ") || "none"}`,
            ].join(" | ")),
          }),
        },
      }
    case "SpecChangeIntentDetected":
      return {
        ...state,
        focus: "approval",
        systemActions: append(state.systemActions, {
          title: "spec change intent detected",
          detail: `${redactText(event.summary)}${event.pauseRecommended ? " | commander should review pause" : ""}`,
        }),
      }
  }
}

export type ModelSetupStartupGate = "pending" | "required" | "clear" | "blocked"

export function modelSetupStartupGateAllowsInput(gate: ModelSetupStartupGate): boolean {
  return gate === "required" || gate === "clear"
}

export function modelSetupStartupGateAllowsCommand(state: UiState, command: KeyCommand, gate: ModelSetupStartupGate): boolean {
  return modelSetupStartupGateAllowsInput(gate)
    || (gate === "blocked"
      && command.type === "submit"
      && state.screen === "model-setup"
      && state.modelSetup.stage === "loading"
      && state.modelSetup.commandError !== undefined)
}

export function reduceRuntimeEventDuringModelSetupGate(
  state: UiState,
  event: RuntimeEvent,
  gate: ModelSetupStartupGate,
): UiState {
  const next = reduceRuntimeEvent(state, event)
  if (event.type !== "ProjectInitialized" || gate === "clear") return next
  return {
    ...next,
    screen: gate === "pending" ? "boot" : state.screen,
    focus: state.focus,
  }
}

export function reduceRuntimeEvents(projectDir: string, events: RuntimeEvent[]): UiState {
  return events.reduce(reduceRuntimeEvent, initialState(projectDir))
}
