import { createCliRenderer, type CliRendererConfig, type TextareaRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { applyKeyCommand, type KeyCommand } from "./keyboard"
import { reduceRuntimeEvent } from "./reducer"
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

function SearchPanel(props: { state: UiState }) {
  return (
    <Panel title="Search / records" focus="search-records" state={props.state}>
      <text fg={color.muted}>Search placeholder: indexed runtime records will plug in here.</text>
      <text fg={color.text}>types: {props.state.search.recordFilters.join(", ")}</text>
      <text fg={color.text}>labels: {props.state.search.labelFilters.join(", ")}</text>
      <For each={props.state.search.records}>{(item) => <text fg={color.accent}>{lineText(item)}</text>}</For>
    </Panel>
  )
}

function ApprovalPanel(props: { state: UiState }) {
  const items = () => [
    ...props.state.approval.specApprovals,
    ...props.state.approval.candidateApprovals,
    ...props.state.approval.clarifications,
  ]
  return (
    <Panel title="Approval / clarification" focus="approval" state={props.state}>
      <For each={items()}>{(item) => <text fg={color.text}>{lineText(item)}</text>}</For>
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
    const beforeDraft = state.messageDraft
    const beforeScreen = state.screen
    const next = applyKeyCommand(state, command)
    setState(next)
    if (command.type === "submit" && beforeScreen === "main" && beforeDraft.trim()) {
      void props.runtime.sendUserMessage(beforeDraft)
    }
    if (command.type === "submit" && next.lastCommand && beforeScreen !== "main") {
      void props.runtime.sendCommand(next.lastCommand)
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
