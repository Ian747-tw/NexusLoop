import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { FakeOpenCodeAdapter, RuntimeServer } from "../../runtime/src/index"
import type { RuntimeEvent } from "../src/events"
import { runTuiEntrypoint } from "../src/launch"
import type { RuntimeClient } from "../src/runtime"
import { createTuiRuntimeClient } from "../src/runtime-client-factory"

class TestRuntimeClient implements RuntimeClient {
  constructor(private readonly firstEventDelayMs = 0) {}

  shutdownCount = 0
  commandNames: string[] = []

  async *stream(): AsyncIterable<RuntimeEvent> {
    if (this.firstEventDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.firstEventDelayMs))
    }
    yield { type: "RuntimeReady", projectName: "launch-test", runtimeStatus: "started" }
  }

  async sendUserMessage(_message: string): Promise<void> {}

  async sendCommand(_command: string): Promise<void> {}

  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.commandNames.push(name)
    if (name === "runtime.status") {
      return {
        runtimeStatus: "started",
        mode: "active",
        projectName: "launch-test",
        specApproved: true,
        lockHeld: false,
        adapterStatus: { kind: "test", phase: "idle" },
        missions: { pending_count: 0, failed_count: 0, active_claim_count: 0, completed_count: 0, cancelled_count: 0 },
        reviews: { pending_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0 },
        researchProjection: { mode: "disabled", ok: true, stale: false, pending_count: 0 },
      }
    }
    if (name === "runtime.list_recent_missions") return []
    if (name === "runtime.review_status") return { pending_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0 }
    if (name === "runtime.list_review_requests") return []
    if (name === "runtime.preview_opencode_process_smoke") return { status: "not_configured", can_execute: false, opt_in_required: true, opt_in_present: false, binary_detected: false, blockers: ["missing"], warnings: [], recommended_commands: [] }
    if (name === "runtime.execute_opencode_process_smoke") return { smoke_id: "smoke_test", status: "blocked", summary_preview: "blocked", diagnostics: [], requested_by: "operator", started_at: "2026-06-20T00:00:00.000Z", completed_at: "2026-06-20T00:00:00.000Z", smoke_hash: "hash" }
    if (name === "runtime.list_opencode_process_smokes") return []
    if (name === "runtime.preview_minimax_live_validation") return minimaxLiveValidationPreview()
    if (name === "runtime.execute_minimax_live_validation") return minimaxLiveValidationResult(payload?.dry_run === true ? "skipped" : "blocked")
    if (name === "runtime.list_minimax_live_validations") return []
    if (name === "runtime.get_minimax_live_validation") return null
    if (name === "runtime.preview_executor_review_proposal_review_decision") return {
      preview_id: "decision_preview_test",
      status: "blocked",
      can_decide: false,
      decision: payload?.decision ?? "approve",
      review_request_id: payload?.review_request_id ?? "review_test",
      proposal_title_preview: "Decision preview",
      proposal_summary_preview: "Decision preview",
      source_evidence_ids: [],
      source_finding_ids: [],
      blockers: ["review_request_id was not found"],
      warnings: [],
      recommended_commands: [],
      generated_at: "2026-06-20T00:00:00.000Z",
      redacted_summary_preview: "review_request_id was not found",
    }
    if (name === "runtime.decide_executor_review_proposal_review") return {
      decision_gate_id: "decision_gate_test",
      status: "blocked",
      decision: payload?.decision ?? "approve",
      review_request_id: payload?.review_request_id ?? "review_test",
      decided_at: "2026-06-20T00:00:00.000Z",
      decided_by: "operator",
      error: "review_request_id was not found",
      decision_hash: "hash",
      recommended_commands: [],
    }
    if (name === "runtime.list_executor_review_proposal_review_decisions") return []
    if (name === "runtime.get_executor_review_proposal_review_decision") return null
    if (name === "runtime.preview_executor_review_proposal_apply_readiness") return {
      readiness_id: "readiness_test",
      status: "unknown",
      can_apply_in_future: false,
      proposal_id: payload?.proposal_id ?? "unknown",
      proposal_title_preview: "Apply readiness preview",
      proposal_summary_preview: "Apply readiness preview",
      candidate_kind: "generic",
      candidate_risk: "medium",
      source_evidence_ids: [],
      source_finding_ids: [],
      blockers: ["apply readiness preview requires proposal_id, review_request_id, decision_gate_id, or create_id"],
      warnings: [],
      recommended_commands: [],
      generated_at: "2026-06-20T00:00:00.000Z",
      redacted_summary_preview: "Apply readiness preview requires an explicit target.",
    }
    if (name === "runtime.executor_review_proposal_apply_readiness_summary") return { total_considered: 0, ready_count: 0, blocked_count: 0, needs_review_count: 0, rejected_count: 0, generic_count: 0, high_risk_count: 0, generated_at: "2026-06-20T00:00:00.000Z" }
    if (name === "runtime.list_executor_review_proposal_apply_readiness") return []
    if (name === "runtime.get_executor_review_proposal_apply_readiness") return null
    if (name === "runtime.preview_opencode_result_review_packet") {
      return {
        packet_id: "packet_test",
        status: "blocked",
        title: "OpenCode result review packet has insufficient evidence",
        artifact_previews: [],
        evidence: [{ evidence_id: "authority:/handoff", kind: "authority", related_id: "/handoff", status: "high_impact_write", fresh: true, summary_preview: "/handoff authority", blockers: [], warnings: [] }],
        blockers: ["no OpenCode handoff evidence"],
        warnings: [],
        recommended_commands: [{ label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" }],
        generated_at: "2026-06-20T00:00:00.000Z",
        redacted_summary_preview: "no OpenCode handoff evidence",
      }
    }
    if (name === "runtime.opencode_result_review_summary") return { total_considered: 0, ready_count: 0, needs_result_count: 0, failed_count: 0, blocked_count: 0, stale_count: 0, generated_at: "2026-06-20T00:00:00.000Z" }
    if (name === "runtime.command_authority_get") {
      return {
        authority_id: "authority_opencode_smoke",
        slash_command: "/opencode-smoke",
        aliases: [],
        risk: "low_risk_write",
        gate: "opencode_runtime",
        owner: "opencode_handoff",
        mutates_events: true,
        creates_external_process: true,
        calls_provider: false,
        requires_active_runtime: true,
        requires_run_lock: true,
        requires_approval: false,
        expected_event_kinds: [],
        blocked_by_default: true,
        current_phase_status: "implemented",
        recommended_reads: [],
        validation_profile: { targeted_e2e: [] },
        notes: [],
        out_of_scope: [],
      }
    }
    if (name === "research.projection_status" || name === "research.rebuild_projection") {
      return { mode: "auto_rebuild", ok: true, stale: false, pending_count: 0, last_event_id: "research-event-1" }
    }
    if (name === "research.list_topics") {
      return [{ id: "topic-1", title: "Runtime bridge topic", status: "active" }]
    }
    if (name === "research.get_topic_snapshot") {
      return {
        topic: { id: "topic-1", title: "Runtime bridge topic", status: "active" },
        sources: [],
        notes: [],
        artifacts: [],
        stats: {
          source_count: 1,
          note_count: 2,
          artifact_count: 3,
          report_count: 0,
          reviewed_source_count: 1,
          rejected_source_count: 0,
        },
        latest_event: null,
      }
    }
    if (name === "research.search_notes") {
      return [{ id: "note-1", topic_id: "topic-1", source_id: "source-1", content: "Runtime note token=note-secret", tags: ["runtime"] }]
    }
    if (name === "research.list_events") {
      return [{ event_id: "research-event-1", event_type: "note_added", entity_type: "note", entity_id: "note-1", payload: { token: "event-secret" }, created_at: "2026-05-16T00:00:00Z" }]
    }
    return { ok: true }
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1
  }
}

function minimaxLiveValidationPreview() {
  return {
    status: "not_configured",
    can_execute: false,
    provider_kind: "fake",
    provider_id: "fake",
    enabled_surfaces: [],
    requested_surfaces: ["commander_executor_review"],
    opt_in_required: true,
    opt_in_present: false,
    timeout_ms: 10_000,
    blockers: ["MiniMax live validation is not configured"],
    warnings: [],
    redacted_summary_preview: "MiniMax live validation is not configured",
    recommended_commands: [{ label: "Preview validation", command: "/minimax-live-preview surface=commander_executor_review", command_type: "read" }],
    generated_at: "2026-06-20T00:00:00.000Z",
  }
}

function minimaxLiveValidationResult(status: "blocked" | "skipped") {
  return {
    validation_id: status === "skipped" ? "minimax-live-dry-run" : "minimax-live-blocked",
    status,
    provider_kind: "fake",
    provider_id: "fake",
    surfaces: [{ surface: "commander_executor_review", status, ok: false, parsed: false, error: "MiniMax live validation is not configured" }],
    started_at: "2026-06-20T00:00:00.000Z",
    completed_at: "2026-06-20T00:00:00.000Z",
    requested_by: "tui",
    validation_hash: `hash-${status}`,
    diagnostics: ["MiniMax live validation is not configured"],
    error: status === "blocked" ? "MiniMax live validation is not configured" : undefined,
  }
}

class SpyOpenCodeAdapter extends FakeOpenCodeAdapter {
  startCalls = 0

  override async startSession(...args: Parameters<FakeOpenCodeAdapter["startSession"]>): Promise<void> {
    this.startCalls += 1
    return await super.startSession(...args)
  }
}

class ErroringRuntimeClient extends TestRuntimeClient {
  async command(name: string): Promise<unknown> {
    if (name === "runtime.status") throw new Error("runtime failed token=launch-secret")
    return super.command(name)
  }
}

class DelayedFiniteRuntimeClient extends TestRuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {
    yield { type: "RuntimeReady", projectName: "launch-test", runtimeStatus: "started" }
    await new Promise((resolve) => setTimeout(resolve, 75))
    yield { type: "ProjectInitialized", projectDir: "/tmp/nxl-launch-delayed-finite" }
  }
}

class BlockingLongLivedRuntimeClient extends TestRuntimeClient {
  readonly streamMode = "long-lived" as const
  returnCalls = 0

  stream(): AsyncIterable<RuntimeEvent> {
    const self = this
    let eventCount = 0
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<RuntimeEvent>> {
            eventCount += 1
            if (eventCount === 1) {
              return { done: false, value: { type: "RuntimeReady", projectName: "launch-test", runtimeStatus: "started" } }
            }
            return await new Promise<IteratorResult<RuntimeEvent>>(() => {})
          },
          return(): Promise<IteratorResult<RuntimeEvent>> {
            self.returnCalls += 1
            return new Promise<IteratorResult<RuntimeEvent>>(() => {})
          },
        }
      },
    }
  }
}

const cleanup: string[] = []

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nxl-tui-launch-"))
  cleanup.push(dir)
  return dir
}

async function makeApprovedProject(dir: string): Promise<void> {
  await mkdir(join(dir, ".nxl", "spec"), { recursive: true })
  await writeFile(
    join(dir, ".nxl", "spec", "current.json"),
    JSON.stringify(
      {
        spec_id: "spec_launch",
        version: 1,
        status: "approved",
        objective: "TUI launch runtime surface test objective",
        project_mode: "build",
        domain: "test",
        success_metrics: ["snapshot includes runtime records"],
        evaluation_protocol: "run headless snapshot",
        approved_by: "tester",
        approved_at: "2026-05-10T00:00:00Z",
      },
      null,
      2,
    ),
  )
}

async function readEventKinds(dir: string): Promise<string[]> {
  try {
    return (await readFile(join(dir, ".nxl", "events.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).kind)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

describe("TUI launch boundary", () => {
  afterEach(async () => {
    while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
  })

  test("headless entrypoint shuts down owning runtime client after snapshot", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-headless",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("launch-test")
    expect(runtime.shutdownCount).toBe(1)
  })

  test("default headless entrypoint keeps fake client behavior without env", async () => {
    const dir = await tempProject()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1" },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("runtime=fake runtime connected")
    expect(snapshot).toContain("Project not initialized")
  })

  test("real headless runtime client shows status and mission summary", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Runtime")
    expect(snapshot).toContain("status=started")
    expect(snapshot).toContain("mode=active")
    expect(snapshot).toContain("projection=ok stale=false pending=0")
    expect(snapshot).toContain("missions_pending=0")
    expect(snapshot).toContain("recent_missions")
  })

  test("real headless runtime client submits a message and refreshes mission records", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "run mission token=message-secret" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("mission submitted")
    expect(snapshot).toContain("last_mission=mission_")
    expect(snapshot).toContain("recent_missions")
    expect(snapshot).toContain("[sent]")
    expect(snapshot).not.toContain("message-secret")
  })

  test("status and missions commands update runtime panels", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/status" },
      { type: "submit" },
      { type: "insert", text: "/missions" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("user command -> runtime: status")
    expect(snapshot).toContain("user command -> runtime: missions")
    expect(snapshot).toContain("status=started")
    expect(snapshot).toContain("recent_missions")
  })

  test("default fake headless snapshot includes research section after research command", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/research" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Research records")
    expect(snapshot).toContain("projection=ok stale=false pending=0")
    expect(snapshot).toContain("topic fake-topic-1 [active]: Fake runtime research topic")
    expect(snapshot).toContain("event topic_created topic/fake-topic-1")
  })

  test("default fake headless snapshot renders commander queues", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/request-review mission-demo Queue title -- Queue summary" },
      { type: "submit" },
      { type: "insert", text: "/queues" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Commander queues")
    expect(snapshot).toContain("summary needs_review=1")
    expect(snapshot).toContain("selected=needs_review")
    expect(snapshot).toContain("review:fake-review-1 [pending]")
  })

  test("default fake headless snapshot renders external API surface", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/apis" },
      { type: "submit" },
      { type: "insert", text: "/api-dry-run mock-research-api GET /status q=token=api-secret" },
      { type: "submit" },
      { type: "insert", text: "/api-ingest-dry-run mock-research-api GET /status topic=fake-topic-1 source=FakeAPI q=token=api-secret" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("External API")
    expect(snapshot).toContain("External API research ingestion")
    expect(snapshot).toContain("mock-research-api")
    expect(snapshot).toContain("last_result=fake-api-request")
    expect(snapshot).toContain("ingest_last_result=fake-api-ingestion")
    expect(snapshot).not.toContain("api-secret")
  })

  test("default fake headless snapshot renders research synthesis surface", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/synthesize-preview fake-topic-1 summarize evidence" },
      { type: "submit" },
      { type: "insert", text: "/synthesize-proposals fake-topic-1" },
      { type: "submit" },
      { type: "insert", text: "/syntheses" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Research synthesis")
    expect(snapshot).toContain("selected_synthesis=fake-synthesis")
    expect(snapshot).toContain("proposals=fake-proposal")
    expect(snapshot).not.toContain("secret")
  })

  test("default fake headless snapshot renders commander cycle surface", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/cycle-preview topic=fake-topic-1 inspect evidence token=cycle-secret" },
      { type: "submit" },
      { type: "insert", text: "/cycle-bundle topic=fake-topic-1" },
      { type: "submit" },
      { type: "insert", text: "/cycles" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Commander cycle")
    expect(snapshot).toContain("selected_cycle=fake-cycle")
    expect(snapshot).toContain("proposals=fake-proposal")
    expect(snapshot).toContain("bundle=fake-bundle")
    expect(snapshot).not.toContain("cycle-secret")
  })

  test("real headless runtime client loads projection and topics through research command", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/research" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Research records")
    expect(snapshot).toContain("projection=ok stale=false pending=0")
    expect(snapshot).toContain("topics=0")
  })

  test("real headless runtime client renders empty commander queue surface", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/queue-apply" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Commander queues")
    expect(snapshot).toContain("selected=ready_to_apply")
    expect(snapshot).toContain("rows")
  })

  test("default fake headless snapshot renders mission execution controls", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/claim mission-demo token=executor-secret" },
      { type: "submit" },
      { type: "insert", text: "/progress-add mission-demo fake-claim-1 working token=progress-secret" },
      { type: "submit" },
      { type: "insert", text: "/result mission-demo fake-claim-1 done token=result-secret" },
      { type: "submit" },
      { type: "insert", text: "/complete mission-demo --result=fake-result-3 complete token=completion-secret" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Mission execution")
    expect(snapshot).toContain("selected_mission=mission-demo [completed]")
    expect(snapshot).toContain("claim fake-claim-1 [completed] executor=[REDACTED]")
    expect(snapshot).toContain("progress fake-progress-2 claim=fake-claim-1: working [REDACTED]")
    expect(snapshot).toContain("result fake-result-3 [accepted] claim=fake-claim-1: done [REDACTED]")
    expect(snapshot).not.toContain("executor-secret")
    expect(snapshot).not.toContain("progress-secret")
    expect(snapshot).not.toContain("result-secret")
    expect(snapshot).not.toContain("completion-secret")
  })

  test("default fake headless snapshot renders playbooks and draft result", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/playbooks" },
      { type: "submit" },
      { type: "insert", text: "/draft-fail mission-1 Fail title -- reason token=playbook-secret" },
      { type: "submit" },
      { type: "insert", text: "/apply-preview proposal fake-proposal-1" },
      { type: "submit" },
      { type: "insert", text: "/audit proposal fake-proposal-1" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Commander playbooks")
    expect(snapshot).toContain("complete-from-result")
    expect(snapshot).toContain("playbook=fail-mission")
    expect(snapshot).toContain("Commander workbench")
    expect(snapshot).toContain("Commander apply")
    expect(snapshot).toContain("preview=proposal:fake-proposal-1 blocked")
    expect(snapshot).toContain("Commander audit")
    expect(snapshot).toContain("chain=proposal:fake-proposal-1")
    expect(snapshot).toContain("fail_mission")
    expect(snapshot).not.toContain("playbook-secret")
  })

  test("default fake headless release resets running mission and allows reclaim", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/claim mission-release executor-1" },
      { type: "submit" },
      { type: "insert", text: "/progress-add mission-release fake-claim-1 running token=progress-secret" },
      { type: "submit" },
      { type: "insert", text: "/release-claim fake-claim-1 release token=release-secret" },
      { type: "submit" },
      { type: "insert", text: "/mission mission-release" },
      { type: "submit" },
      { type: "insert", text: "/claim mission-release executor-2" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("selected_mission=mission-release [claimed]")
    expect(snapshot).toContain("claim fake-claim-1 [released] executor=executor-1")
    expect(snapshot).toContain("claim fake-claim-3 [active] executor=executor-2")
    expect(snapshot).toContain("- mission-release [claimed]")
    expect(snapshot).not.toContain("running]")
    expect(snapshot).not.toContain("progress-secret")
    expect(snapshot).not.toContain("release-secret")
  })

  test("research browsing commands render bounded records and redacted notes", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/topics" },
      { type: "submit" },
      { type: "insert", text: "/topic topic-1" },
      { type: "submit" },
      { type: "insert", text: "/notes topic-1 runtime" },
      { type: "submit" },
      { type: "insert", text: "/research-events" },
      { type: "submit" },
      { type: "insert", text: "/projection" },
      { type: "submit" },
      { type: "insert", text: "/rebuild-projection" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-research",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("topic topic-1 [active]: Runtime bridge topic")
    expect(snapshot).toContain("selected_topic=topic-1 [active]: Runtime bridge topic")
    expect(snapshot).toContain("selected_counts sources=1 notes=2 artifacts=3 reports=0")
    expect(snapshot).toContain("note note-1 topic=topic-1 source=source-1 tags=runtime: Runtime note [REDACTED]")
    expect(snapshot).toContain("event note_added note/note-1")
    expect(snapshot).not.toContain("note-secret")
    expect(snapshot).not.toContain("event-secret")
  })

  test("missing research command args render research command error", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/topic" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-research-error",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("research command error")
    expect(snapshot).toContain("command_error=topicId is required")
  })

  test("missing mission command args render mission execution command error", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/claim mission-1" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-mission-error",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("mission execution command error")
    expect(snapshot).toContain("command_error=executorId is required")
  })

  test("runtime command errors are redacted in headless state and snapshot", async () => {
    const runtime = new ErroringRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-error-redaction",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("command_error=runtime failed [REDACTED]")
    expect(snapshot).not.toContain("launch-secret")
  })

  test("headless OpenCode smoke inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/opencode-smoke-preview" },
      { type: "submit" },
      { type: "insert", text: "/opencode-smoke" },
      { type: "submit" },
      { type: "insert", text: "/authority-show /opencode-smoke" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-opencode-smoke-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode process smoke")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_process_smoke")
    expect(runtime.commandNames).toContain("runtime.execute_opencode_process_smoke")
    expect(runtime.commandNames).toContain("runtime.command_authority_get")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless OpenCode handoff readiness scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/handoff-readiness" },
      { type: "submit" },
      { type: "insert", text: "/opencode-handoff-readiness" },
      { type: "submit" },
      { type: "insert", text: "/handoff-readiness-summary" },
      { type: "submit" },
      { type: "insert", text: "/handoff-ready" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-handoff-readiness-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode handoff readiness")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_handoff_readiness")
    expect(runtime.commandNames).toContain("runtime.opencode_handoff_readiness_summary")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless OpenCode result review scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/result-review-packet" },
      { type: "submit" },
      { type: "insert", text: "/result-review-summary" },
      { type: "submit" },
      { type: "insert", text: "/opencode-result-review" },
      { type: "submit" },
      { type: "insert", text: "/authority-show /result-review-packet" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-result-review-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode result review packet")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_result_review_packet")
    expect(runtime.commandNames).toContain("runtime.opencode_result_review_summary")
    expect(runtime.commandNames).toContain("runtime.command_authority_get")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless MiniMax live inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/minimax-live-preview surface=commander_executor_review" },
      { type: "submit" },
      { type: "insert", text: "/minimax-live-dry-run" },
      { type: "submit" },
      { type: "insert", text: "/minimax-live-validations" },
      { type: "submit" },
      { type: "insert", text: "/authority-show /minimax-live-validate" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-minimax-live-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("MiniMax live validation")
    expect(runtime.commandNames).toContain("runtime.preview_minimax_live_validation")
    expect(runtime.commandNames).toContain("runtime.execute_minimax_live_validation")
    expect(runtime.commandNames).toContain("runtime.list_minimax_live_validations")
    expect(runtime.commandNames).toContain("runtime.command_authority_get")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless executor review proposal decision scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-review-decision-preview review=review-test decision=approve" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-review-decision-dry-run review=review-test decision=approve" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-review-approve review=review-test" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-review-decisions" },
      { type: "submit" },
      { type: "insert", text: "/authority-show /executor-review-proposal-review-approve" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-executor-review-decision-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Executor review proposal review decision")
    expect(runtime.commandNames).toContain("runtime.preview_executor_review_proposal_review_decision")
    expect(runtime.commandNames).toContain("runtime.decide_executor_review_proposal_review")
    expect(runtime.commandNames).toContain("runtime.list_executor_review_proposal_review_decisions")
    expect(runtime.commandNames).toContain("runtime.command_authority_get")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless executor review proposal apply-readiness scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-apply-readiness proposal=proposal-test" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-apply-readiness-summary" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-apply-readiness-list" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-apply-readiness-show readiness-test" },
      { type: "submit" },
      { type: "insert", text: "/authority-show /executor-review-proposal-apply-readiness" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-executor-review-apply-readiness-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Executor review proposal apply readiness")
    expect(runtime.commandNames).toContain("runtime.preview_executor_review_proposal_apply_readiness")
    expect(runtime.commandNames).toContain("runtime.executor_review_proposal_apply_readiness_summary")
    expect(runtime.commandNames).toContain("runtime.list_executor_review_proposal_apply_readiness")
    expect(runtime.commandNames).toContain("runtime.get_executor_review_proposal_apply_readiness")
    expect(runtime.commandNames).toContain("runtime.command_authority_get")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless MiniMax live validate script skips broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/minimax-live-validate surface=commander_executor_review" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-minimax-live-validate-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("MiniMax live validation")
    expect(runtime.commandNames).toContain("runtime.execute_minimax_live_validation")
    expect(runtime.commandNames).toContain("runtime.list_minimax_live_validations")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless executor review on stopped real runtime does not start OpenCode", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const adapter = new SpyOpenCodeAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })
    const runtime = createTuiRuntimeClient({ projectDir: dir, server, env: {} })
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/executor-review" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Commander executor review")
    expect(snapshot).toContain("runtime must be started before commander executor review writes")
    expect(await readEventKinds(dir)).not.toContain("runtime_started")
    expect(adapter.startCalls).toBe(0)
  })

  test("shutdown command does not report a false post-shutdown refresh error", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/shutdown" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("user command -> runtime: shutdown")
    expect(snapshot).not.toContain("command_error=")
    expect(snapshot).not.toContain("runtime client has been shut down")
  })

  test("headless staged command run produces deterministic operator snapshot", async () => {
    const dir = await tempProject()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/stage-command /queues" },
      { type: "submit" },
      { type: "insert", text: "/run-staged" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Operator actions")
    expect(snapshot).toContain("staged=none")
    expect(snapshot).toContain("last_result=ok")
    expect(snapshot).toContain("last_command=/queues")
    expect(snapshot).toContain("Commander queues")
    expect(snapshot).toContain("selected=needs_review")
  })

  test("headless entrypoint waits for the first runtime event before idle timeout", async () => {
    const runtime = new TestRuntimeClient(75)
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-delayed-headless",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("launch-test")
    expect(runtime.shutdownCount).toBe(1)
  })

  test("headless entrypoint consumes a full finite stream before rendering", async () => {
    const runtime = new DelayedFiniteRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-delayed-finite",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("screen=resume")
    expect(output.join("\n")).toContain("Resume previous run")
    expect(runtime.shutdownCount).toBe(1)
  })

  test("headless entrypoint does not hang when a long-lived stream idles with pending next", async () => {
    const runtime = new BlockingLongLivedRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-blocking-long-lived",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("launch-test")
    expect(runtime.returnCalls).toBe(1)
    expect(runtime.shutdownCount).toBe(1)
  })

  test("interactive entrypoint shuts down runtime client after OpenTUI returns", async () => {
    const runtime = new TestRuntimeClient()
    let called = false

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-interactive",
      env: {},
      runtime,
      runOpenTui: async (client, projectDir) => {
        called = client === runtime && projectDir === "/tmp/nxl-launch-interactive"
      },
    })

    expect(called).toBe(true)
    expect(runtime.shutdownCount).toBe(1)
  })

  test("interactive entrypoint shuts down runtime client when OpenTUI fails", async () => {
    const runtime = new TestRuntimeClient()

    await expect(runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-failure",
      env: {},
      runtime,
      runOpenTui: async () => {
        throw new Error("render failed")
      },
    })).rejects.toThrow("render failed")

    expect(runtime.shutdownCount).toBe(1)
  })
})
