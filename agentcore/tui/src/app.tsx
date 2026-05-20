import { createCliRenderer, type CliRendererConfig, type TextareaRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { applyKeyCommandWithEffects, type KeyCommand } from "./keyboard"
import { reduceRuntimeEvent } from "./reducer"
import { applyRuntimeUiEffect, refreshRuntimeRecords } from "./runtime-effects"
import { mergeRuntimeEffectState } from "./runtime-state-merge"
import { snapshotUiState } from "./state-snapshot"
import { initialState, type FocusTarget, type StreamLine, type UiState } from "./state"
import type { RuntimeClient } from "./runtime"

const color = {
  bg: "#0b0f14",
  panel: "#111821",
  panelAlt: "#0e151d",
  line: "#344255",
  focus: "#d6a84f",
  text: "#d6dde7",
  muted: "#8492a6",
  accent: "#7cc7c2",
  warning: "#e6bf70",
}

function rendererConfig(): CliRendererConfig {
  return {
    targetFps: 30,
    gatherStats: false,
    exitOnCtrlC: true,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    useMouse: true,
    externalOutputMode: "passthrough",
  }
}

function borderFor(state: UiState, focus: FocusTarget) {
  return state.focus === focus ? color.focus : color.line
}

function lineText(item: StreamLine) {
  return `${item.status ? `[${item.status}] ` : ""}${item.title}${item.detail ? ` - ${item.detail}` : ""}`
}

function Panel(props: {
  title: string
  focus: FocusTarget
  state: UiState
  children: unknown
  flexGrow?: number
  minHeight?: number
}) {
  return (
    <box
      flexGrow={props.flexGrow ?? 1}
      minHeight={props.minHeight ?? 4}
      minWidth={0}
      border
      borderStyle="rounded"
      borderColor={borderFor(props.state, props.focus)}
      backgroundColor={color.panel}
      title={` ${props.title} `}
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
    </box>
  )
}

function Header(props: { state: UiState }) {
  const s = props.state
  return (
    <box
      height={5}
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={color.line}
      backgroundColor={color.panelAlt}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={color.accent}>NexusLoop</text>
        <text fg={color.muted}>OpenTUI shell</text>
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={color.text}>project: {s.header.projectName}</text>
        <text fg={color.text}>runtime: {s.header.runtimeStatus}</text>
        <text fg={color.warning}>{s.header.providerStatus}</text>
        <text fg={color.warning}>{s.header.modelStatus}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={color.muted}>mission: {s.header.activeMissionId}</text>
        <text fg={color.muted}>training: {s.header.activeTrainingCount}</text>
        <text fg={color.muted}>obligations: {s.header.openObligationsCount}</text>
      </box>
    </box>
  )
}

function ChoiceScreen(props: { state: UiState; kind: "init" | "resume" }) {
  const choices = () => (props.kind === "init" ? props.state.initChoices : props.state.resumeChoices)
  const selection = () => (props.kind === "init" ? props.state.initSelection : props.state.resumeSelection)
  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" backgroundColor={color.bg}>
      <box
        width="70%"
        maxWidth={82}
        border
        borderStyle="rounded"
        borderColor={color.focus}
        backgroundColor={color.panel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <text fg={color.accent}>{props.kind === "init" ? "Project not initialized" : "Resume NexusLoop project"}</text>
        <text fg={color.muted}>
          {props.kind === "init"
            ? "No .nxl/ directory was found. Initialize to enter the onboarding shell."
            : "Existing .nxl/ state was detected. Choose how to enter the runtime shell."}
        </text>
        <For each={choices()}>
          {(choice, index) => (
            <text fg={index() === selection() ? color.bg : color.text} bg={index() === selection() ? color.focus : color.panel}>
              {index() === selection() ? "> " : "  "}
              {choice.label}
            </text>
          )}
        </For>
        <text fg={color.muted}>Enter selects. Up/Down changes selection. Esc cancels.</text>
      </box>
    </box>
  )
}

function StreamPanel(props: { title: string; focus: FocusTarget; state: UiState; items: StreamLine[]; empty: string }) {
  return (
    <Panel title={props.title} focus={props.focus} state={props.state}>
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        <Show when={props.items.length > 0} fallback={<text fg={color.muted}>{props.empty}</text>}>
          <For each={props.items}>{(item) => <text fg={color.text}>{lineText(item)}</text>}</For>
        </Show>
      </scrollbox>
    </Panel>
  )
}

function CommanderPanel(props: { state: UiState }) {
  const c = props.state.commander
  return (
    <Panel title="Commander" focus="commander" state={props.state}>
      <text fg={color.text}>program_state: {c.programState}</text>
      <text fg={color.text}>WorkIntent: {c.workIntent}</text>
      <text fg={color.text}>mission: {c.mission}</text>
      <text fg={color.text}>budget: {c.budget}</text>
      <text fg={color.muted}>obligations: {c.obligations.join(", ") || "none"}</text>
      <text fg={color.muted}>candidates: {c.candidates.join(", ") || "none"}</text>
      <For each={c.decisions}>{(item) => <text fg={color.accent}>{lineText(item)}</text>}</For>
    </Panel>
  )
}

function RuntimePanel(props: { state: UiState }) {
  const runtime = () => props.state.runtimeStatus
  const projection = () => props.state.researchProjection
  const missions = () => props.state.missions
  const adapter = () => props.state.adapterStatus
  return (
    <Panel title="Runtime" focus="system-actions" state={props.state}>
      <text fg={color.text}>
        status: {runtime()?.runtimeStatus ?? props.state.header.runtimeStatus} mode: {runtime()?.mode ?? "unknown"}
      </text>
      <text fg={color.muted}>
        spec: {runtime()?.specApproved ? "approved" : "not approved"} lock: {runtime()?.lockHeld ? "held" : "free"}
      </text>
      <Show when={adapter()}>
        {(value) => (
          <text fg={color.muted}>
            adapter: {String(value().kind ?? "unknown")} {String(value().phase ?? value().status ?? "")}
          </text>
        )}
      </Show>
      <Show when={projection()}>
        {(value) => (
          <text fg={value().ok ? color.accent : color.warning}>
            projection: {value().ok ? "ok" : "not-ok"} stale={String(value().stale)} pending={value().pending_count}
            {value().reason ? ` ${value().reason}` : ""}
          </text>
        )}
      </Show>
      <Show when={missions()}>
        {(value) => (
          <>
            <text fg={color.text}>
              missions: pending={value().pending_count} failed={value().failed_count} completed={value().completed_count ?? 0}
            </text>
            <text fg={color.muted}>last: {value().last_mission_id ?? "none"}</text>
            <For each={value().recent.slice(0, 3)}>
              {(mission) => <text fg={color.accent}>{mission.mission_id} [{mission.status}]</text>}
            </For>
          </>
        )}
      </Show>
      <Show when={props.state.runtimeCommandError}>
        {(value) => <text fg={color.warning}>error: {value()}</text>}
      </Show>
    </Panel>
  )
}

function SearchPanel(props: { state: UiState }) {
  const research = () => props.state.research
  const missionExecution = () => props.state.missionExecution
  return (
    <Panel title="Search / records" focus="search-records" state={props.state}>
      <text fg={color.text}>types: {props.state.search.recordFilters.join(", ")}</text>
      <text fg={color.text}>labels: {props.state.search.labelFilters.join(", ")}</text>
      <For each={props.state.search.records}>{(item) => <text fg={color.accent}>{lineText(item)}</text>}</For>
      <Show when={research()?.projection}>
        {(projection) => (
          <text fg={projection().ok ? color.accent : color.warning}>
            projection: {projection().mode} {projection().ok ? "ok" : "not-ok"} stale={String(projection().stale)} pending={projection().pending_count}
          </text>
        )}
      </Show>
      <text fg={color.text}>topics: {research()?.topics.length ?? 0}</text>
      <For each={(research()?.topics ?? []).slice(0, 5)}>
        {(topic) => <text fg={color.accent}>{topic.id} [{topic.status}] {topic.title}</text>}
      </For>
      <Show when={research()?.selectedTopic}>
        {(snapshot) => (
          <>
            <text fg={color.text}>selected: {snapshot().topic.id} [{snapshot().topic.status}] {snapshot().topic.title}</text>
            <text fg={color.muted}>
              counts: sources={snapshot().stats.source_count} notes={snapshot().stats.note_count} artifacts={snapshot().stats.artifact_count}
            </text>
          </>
        )}
      </Show>
      <For each={(research()?.notes ?? []).slice(0, 5)}>
        {(note) => <text fg={color.text}>note {note.id}: {note.content}</text>}
      </For>
      <For each={(research()?.events ?? []).slice(0, 5)}>
        {(event) => <text fg={color.muted}>event {event.event_type} {event.entity_type}/{event.entity_id}</text>}
      </For>
      <Show when={research()?.commandError}>
        {(value) => <text fg={color.warning}>research error: {value()}</text>}
      </Show>
      <Show when={missionExecution()}>
        {(execution) => (
          <>
            <text fg={color.text}>mission execution: {execution().selectedMission?.mission_id ?? execution().selectedMissionId ?? "none"}</text>
            <Show when={execution().selectedMission}>
              {(mission) => <text fg={color.muted}>selected: {mission().status} {mission().objective ?? ""}</text>}
            </Show>
            <For each={execution().claims.slice(0, 3)}>
              {(claim) => <text fg={color.accent}>claim {claim.claim_id} [{claim.status}] {claim.executor_id}</text>}
            </For>
            <For each={execution().progress.slice(0, 3)}>
              {(progress) => <text fg={color.text}>progress {progress.progress_id}: {progress.message}</text>}
            </For>
            <For each={execution().results.slice(0, 3)}>
              {(result) => <text fg={color.muted}>result {result.result_id} [{result.status}] {result.summary}</text>}
            </For>
            <Show when={execution().commandError}>
              {(value) => <text fg={color.warning}>mission error: {value()}</text>}
            </Show>
          </>
        )}
      </Show>
    </Panel>
  )
}

function ApprovalPanel(props: { state: UiState }) {
  const items = () => [
    ...props.state.approval.specApprovals,
    ...props.state.approval.candidateApprovals,
    ...props.state.approval.clarifications,
  ]
  const reviews = () => props.state.reviews
  const proposals = () => props.state.proposals
  return (
    <Panel title="Approval / clarification" focus="approval" state={props.state}>
      <For each={items()}>{(item) => <text fg={color.text}>{lineText(item)}</text>}</For>
      <Show when={reviews()?.summary}>
        {(summary) => (
          <text fg={color.text}>
            reviews: pending={summary().pending_count} approved={summary().approved_count} rejected={summary().rejected_count} cancelled={summary().cancelled_count}
          </text>
        )}
      </Show>
      <For each={(reviews()?.pending ?? []).slice(0, 5)}>
        {(review) => <text fg={color.accent}>{review.review_id} [{review.status}] {review.request_type} {review.mission_id ?? "none"} {review.title}</text>}
      </For>
      <Show when={reviews()?.selectedReview}>
        {(review) => (
          <>
            <text fg={color.text}>selected: {review().review_id} [{review().status}] {review().title}</text>
            <text fg={color.muted}>{review().summary}</text>
          </>
        )}
      </Show>
      <Show when={reviews()?.commandError}>
        {(value) => <text fg={color.warning}>review error: {value()}</text>}
      </Show>
      <Show when={proposals()?.summary}>
        {(summary) => (
          <text fg={color.text}>
            proposals: proposed={summary().proposed_count} review={summary().review_requested_count} approved={summary().approved_count} applied={summary().applied_count}
          </text>
        )}
      </Show>
      <For each={(proposals()?.recent ?? []).slice(0, 5)}>
        {(proposal) => <text fg={color.accent}>{proposal.proposal_id} [{proposal.status}] {proposal.action_kind} {proposal.mission_id ?? "none"} {proposal.title}</text>}
      </For>
      <Show when={proposals()?.selectedProposal}>
        {(proposal) => (
          <>
            <text fg={color.text}>proposal: {proposal().proposal_id} [{proposal().status}] {proposal().action_kind}</text>
            <text fg={color.muted}>review={proposal().review_id ?? "none"} {proposal().summary}</text>
          </>
        )}
      </Show>
      <Show when={proposals()?.commandError}>
        {(value) => <text fg={color.warning}>proposal error: {value()}</text>}
      </Show>
    </Panel>
  )
}

function OnboardingPanel(props: { state: UiState }) {
  const provider = props.state.providerOnboarding
  const project = props.state.projectOnboarding
  return (
    <Panel title="Onboarding" focus="system-actions" state={props.state}>
      <text fg={color.text}>provider: {provider.provider}</text>
      <text fg={color.text}>model: {provider.model}</text>
      <text fg={color.muted}>credential: {provider.credentialSource}</text>
      <text fg={color.muted}>connection: {provider.connectionStatus}</text>
      <text fg={color.text}>gpu quota: {project.gpuQuota}</text>
      <text fg={color.text}>wake hooks: {project.wakeHooks}</text>
      <text fg={color.text}>max parallel runs: {project.maxParallelRuns}</text>
      <text fg={color.muted}>approvals: {project.approvalRequirements.join(", ") || "none"}</text>
      <text fg={color.warning}>risky fields: {project.riskyFields.join(", ") || "none"}</text>
    </Panel>
  )
}

function MessageBox(props: { state: UiState; onDraft: (value: string) => void; onSubmit: () => void }) {
  let textarea: TextareaRenderable | undefined
  return (
    <box
      height={5}
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={borderFor(props.state, "message-box")}
      backgroundColor={color.panelAlt}
      title=" Message box "
      paddingLeft={1}
      paddingRight={1}
    >
      <textarea
        ref={(item) => (textarea = item)}
        focused={props.state.focus === "message-box"}
        height={3}
        width="100%"
        placeholder="Type all NexusLoop instructions, approvals, and clarifications here."
        onContentChange={() => props.onDraft(textarea?.plainText ?? "")}
        onSubmit={props.onSubmit}
      />
    </box>
  )
}

function MainShell(props: { state: UiState; onDraft: (value: string) => void; onSubmit: () => void }) {
  const dimensions = useTerminalDimensions()
  const compact = () => dimensions().width < 110
  return (
    <box width="100%" height="100%" backgroundColor={color.bg} paddingLeft={1} paddingRight={1} gap={1}>
      <Header state={props.state} />
      <Show
        when={!compact()}
        fallback={
          <box flexGrow={1} minHeight={0} gap={1}>
            <StreamPanel title="Executor" focus="executor" state={props.state} items={props.state.executor} empty="No executor activity yet." />
            <CommanderPanel state={props.state} />
            <StreamPanel
              title="Live system actions"
              focus="system-actions"
              state={props.state}
              items={props.state.systemActions}
              empty="No runtime actions yet."
            />
            <RuntimePanel state={props.state} />
            <SearchPanel state={props.state} />
            <ApprovalPanel state={props.state} />
          </box>
        }
      >
        <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
          <box flexGrow={3} minWidth={0} gap={1}>
            <StreamPanel title="Executor" focus="executor" state={props.state} items={props.state.executor} empty="No executor activity yet." />
            <StreamPanel
              title="Live system actions"
              focus="system-actions"
              state={props.state}
              items={props.state.systemActions}
              empty="No runtime actions yet."
            />
            <RuntimePanel state={props.state} />
            <OnboardingPanel state={props.state} />
          </box>
          <box flexGrow={2} minWidth={0} gap={1}>
            <CommanderPanel state={props.state} />
            <SearchPanel state={props.state} />
            <ApprovalPanel state={props.state} />
          </box>
        </box>
      </Show>
      <MessageBox state={props.state} onDraft={props.onDraft} onSubmit={props.onSubmit} />
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text fg={color.muted}>Tab/Shift-Tab focus. Enter submits. Esc clears/cancels.</text>
        <text fg={color.muted}>Dashboard is deprecated.</text>
      </box>
    </box>
  )
}

function toCommand(evt: { name: string; shift: boolean; ctrl: boolean; raw?: string }): KeyCommand | undefined {
  if (evt.ctrl && evt.name === "c") return undefined
  if (evt.name === "tab") return evt.shift ? { type: "focus-prev" } : { type: "focus-next" }
  if (evt.name === "up") return { type: "select-prev" }
  if (evt.name === "down") return { type: "select-next" }
  if (evt.name === "return") return { type: "submit" }
  if (evt.name === "escape") return { type: "cancel" }
  if (evt.name === "backspace") return { type: "backspace" }
  if (evt.raw && evt.raw.length === 1 && !evt.ctrl) return { type: "insert", text: evt.raw }
  return undefined
}

export function NexusLoopTui(props: { runtime: RuntimeClient; initial: UiState }) {
  const renderer = useRenderer()
  const [state, setState] = createStore<UiState>(props.initial)

  function apply(command: KeyCommand) {
    const result = applyKeyCommandWithEffects(state, command)
    setState(result.state)
    for (const effect of result.effects) {
      const baseline = snapshotUiState(result.state)
      void (async () => {
        const next = await applyRuntimeUiEffect(baseline, props.runtime, effect)
        setState((current) => mergeRuntimeEffectState(current, next, baseline.systemActions.length, baseline))
        renderer.requestRender()
      })()
    }
    renderer.requestRender()
  }

  onMount(() => {
    void (async () => {
      for await (const event of props.runtime.stream()) {
        setState((current) => reduceRuntimeEvent(current, event))
        renderer.requestRender()
      }
    })()
    const baseline = snapshotUiState(state)
    void (async () => {
      const next = await refreshRuntimeRecords(baseline, props.runtime)
      setState((current) => mergeRuntimeEffectState(current, next, 0, baseline))
      renderer.requestRender()
    })()
  })

  useKeyboard((evt) => {
    const command = toCommand(evt)
    if (!command) return
    evt.preventDefault()
    apply(command)
  })

  createEffect(() => {
    renderer.setTerminalTitle(`NexusLoop - ${state.header.projectName}`)
  })

  return (
    <Show
      when={state.screen === "main" || state.screen === "boot"}
      fallback={<ChoiceScreen state={state} kind={state.screen === "init" ? "init" : "resume"} />}
    >
      <MainShell state={state} onDraft={(value) => setState("messageDraft", value)} onSubmit={() => apply({ type: "submit" })} />
    </Show>
  )
}

export async function runOpenTui(runtime: RuntimeClient, projectDir: string) {
  const renderer = await createCliRenderer(rendererConfig())
  await render(() => <NexusLoopTui runtime={runtime} initial={initialState(projectDir)} />, renderer)
}
