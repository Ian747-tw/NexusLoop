import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { FakeRuntimeClient } from "../src/runtime"
import { reduceRuntimeEvent } from "../src/reducer"
import { initialState } from "../src/state"
import { createTuiRuntimeClient, isTuiRuntimeEvent, readRuntimeClientKind, TuiRuntimeServerClient } from "../src/runtime-client-factory"
import { ExternalApiConnectorRegistry, FakeExternalApiTransport, FakeOpenCodeAdapter, ResearchDb, RuntimeServer, type OpenCodeProcessEventSource, type OpenCodeSpawnedProcess } from "../../runtime/src/index"
import { applyRuntimeUiEffect } from "../src/runtime-effects"

const cleanup: string[] = []
const TEST_TIMEOUT_MS = 1000

afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nxl-tui-runtime-"))
  cleanup.push(dir)
  return dir
}

async function makeApprovedProject(dir: string): Promise<void> {
  await mkdir(join(dir, ".nxl", "spec"), { recursive: true })
  await writeFile(
    join(dir, ".nxl", "spec", "current.json"),
    JSON.stringify(
      {
        spec_id: "spec_test",
        version: 1,
        status: "approved",
        objective: "TUI runtime bridge test objective",
        project_mode: "build",
        domain: "test",
        success_metrics: ["tests pass"],
        evaluation_protocol: "run tests",
        approved_by: "tester",
        approved_at: "2026-05-10T00:00:00Z",
      },
      null,
      2,
    ),
  )
}

function minimaxConnector() {
  return {
    connector_id: "minimax-anthropic",
    title: "MiniMax Anthropic",
    base_url: "https://api.minimax.io/anthropic",
    allowed_hosts: ["api.minimax.io"],
    allowed_methods: ["POST" as const],
    credential_refs: [{ name: "minimax-key", source: "env" as const, env_name: "NXL_MINIMAX_API_KEY", inject_as: "header" as const, target_name: "Authorization", prefix: "Bearer " }],
    timeout_ms: 5000,
    max_response_bytes: 8192,
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
  }
}

function minimaxEnvelope(payload: Record<string, unknown>): string {
  return JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] })
}

class FakeProcessEventSource implements OpenCodeProcessEventSource {
  private readonly listeners: Array<(data: unknown) => void> = []

  on(_event: "data", listener: (data: unknown) => void): void {
    this.listeners.push(listener)
  }
}

class FakeSpawnedProcess implements OpenCodeSpawnedProcess {
  readonly stdout = new FakeProcessEventSource()
  readonly stderr = new FakeProcessEventSource()
  readonly stdinWrites: string[] = []
  private readonly spawnListeners: Array<() => void> = []
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly closeListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly errorListeners: Array<(error: Error) => void> = []

  stdin: OpenCodeSpawnedProcess["stdin"] = {
    write: (data: string, callback?: (error?: Error | null) => void) => {
      this.stdinWrites.push(data)
      queueMicrotask(() => callback?.())
      return true
    },
    end: () => {},
    writable: true,
    destroyed: false,
  }

  on(event: "spawn", listener: () => void): void
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "error", listener: (error: Error) => void): void
  on(event: "spawn" | "exit" | "close" | "error", listener: unknown): void {
    if (event === "spawn") {
      this.spawnListeners.push(listener as () => void)
      queueMicrotask(listener as () => void)
    } else if (event === "exit") this.exitListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else if (event === "close") this.closeListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else this.errorListeners.push(listener as (error: Error) => void)
  }

  kill(): void {}

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal)
    for (const listener of this.closeListeners) listener(code, signal)
  }
}

async function waitForJsonlWrite(process: FakeSpawnedProcess, type: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + TEST_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const line of process.stdinWrites) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type === type) return parsed
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${type}`)
}

async function readFirst<T>(stream: AsyncIterable<T>): Promise<T> {
  const deadline = Date.now() + TEST_TIMEOUT_MS
  const iterator = stream[Symbol.asyncIterator]()
  while (Date.now() < deadline) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((resolve) => setTimeout(() => resolve({ done: true, value: undefined as T }), 10)),
    ])
    if (!result.done) return result.value
  }
  throw new Error("timed out waiting for stream event")
}

describe("TUI runtime client factory", () => {
  test("no env keeps fake default behavior", async () => {
    const dir = await tempProject()
    const client = createTuiRuntimeClient({ projectDir: dir, env: {} })

    expect(client).toBeInstanceOf(FakeRuntimeClient)
  })

  test("NXL_RUNTIME_CLIENT=fake explicitly selects fake", async () => {
    const dir = await tempProject()
    const client = createTuiRuntimeClient({ projectDir: dir, env: { NXL_RUNTIME_CLIENT: "fake" } })

    expect(readRuntimeClientKind({ NXL_RUNTIME_CLIENT: "fake" })).toBe("fake")
    expect(client).toBeInstanceOf(FakeRuntimeClient)
  })

  test("NXL_RUNTIME_CLIENT=real creates RuntimeServer-backed client", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    })

    expect(client).toBeInstanceOf(TuiRuntimeServerClient)
    await (client as TuiRuntimeServerClient).runtime.shutdown()
  })

  test("real runtime client with fake OpenCode adapter starts safely", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    await expect(client.runtime.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })
    await client.runtime.shutdown()
  })

  test("real runtime client path can claim a submitted mission through TUI effects", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    let state = await applyRuntimeUiEffect(initialState(dir), client, {
      type: "send-user-message",
      message: "real mission execution path",
    })
    const missionId = state.header.activeMissionId
    state = await applyRuntimeUiEffect(state, client, {
      type: "send-command",
      command: "claim",
      args: [missionId, "executor-real"],
    })

    expect(state.missionExecution?.selectedMissionId).toBe(missionId)
    expect(state.missionExecution?.selectedClaimId).toMatch(/^claim_/)
    expect(state.missionExecution?.selectedMission?.status).toBe("claimed")

    await client.runtime.shutdown()
  })

  test("real runtime client with process config fake spawn writes session and mission envelopes", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const process = new FakeSpawnedProcess()
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    }) as TuiRuntimeServerClient

    await client.runtime.command("runtime.status")
    expect(await waitForJsonlWrite(process, "nxl.session_start")).toMatchObject({ type: "nxl.session_start" })

    await client.sendUserMessage("hello from TUI real client")
    expect(await waitForJsonlWrite(process, "nxl.mission_packet")).toMatchObject({
      type: "nxl.mission_packet",
      message: "hello from TUI real client",
    })

    const shutdown = client.runtime.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("invalid runtime client kind fails clearly", async () => {
    const dir = await tempProject()
    expect(() => createTuiRuntimeClient({ projectDir: dir, env: { NXL_RUNTIME_CLIENT: "server" } })).toThrow("unknown runtime client kind")
  })

  test("invalid OpenCode env fails before runtime start", async () => {
    const dir = await tempProject()
    expect(() => createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
        NXL_OPENCODE_ARGS_JSON: "not-json",
      },
    })).toThrow("NXL_OPENCODE_ARGS_JSON must be valid JSON")
  })

  test("invalid external API env config fails clearly without leaking default header secrets", async () => {
    const dir = await tempProject()
    expect(() => createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
        NXL_EXTERNAL_API_CONNECTORS_JSON: JSON.stringify([{
          connector_id: "bad-default-header",
          title: "Bad default header",
          base_url: "https://api.example.test",
          allowed_hosts: ["api.example.test"],
          allowed_methods: ["GET"],
          default_headers: { Authorization: "Bearer default-header-secret" },
          timeout_ms: 5000,
          max_response_bytes: 4096,
          created_at: "1970-01-01T00:00:00.000Z",
          updated_at: "1970-01-01T00:00:00.000Z",
        }]),
      },
    })).toThrow("connector[0].default_headers.Authorization must use credential_refs")
    try {
      createTuiRuntimeClient({
        projectDir: dir,
        env: {
          NXL_RUNTIME_CLIENT: "real",
          NXL_OPENCODE_ADAPTER: "fake",
          NXL_EXTERNAL_API_CONNECTORS_JSON: JSON.stringify([{
            connector_id: "bad-default-header",
            title: "Bad default header",
            base_url: "https://api.example.test",
            allowed_hosts: ["api.example.test"],
            allowed_methods: ["GET"],
            default_headers: { Authorization: "Bearer default-header-secret" },
            timeout_ms: 5000,
            max_response_bytes: 4096,
            created_at: "1970-01-01T00:00:00.000Z",
            updated_at: "1970-01-01T00:00:00.000Z",
          }]),
        },
      })
      throw new Error("expected invalid external API config")
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain("default-header-secret")
    }
  })

  test("direct injected client wins over env", async () => {
    const dir = await tempProject()
    const injected = new FakeRuntimeClient(dir, "injected")
    const client = createTuiRuntimeClient({
      projectDir: dir,
      client: injected,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "process", NXL_OPENCODE_COMMAND: "" },
    })

    expect(client).toBe(injected)
  })

  test("direct injected server selects real runtime client without env", async () => {
    const dir = await tempProject()
    const server = new RuntimeServer({ projectDir: dir, adapter: new FakeOpenCodeAdapter() })
    const client = createTuiRuntimeClient({ projectDir: dir, server, env: {} })

    expect(client).toBeInstanceOf(TuiRuntimeServerClient)
    expect((client as TuiRuntimeServerClient).runtime.server).toBe(server)
  })

  test("direct injected started server is attached without auto-starting again", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const server = new RuntimeServer({ projectDir: dir, adapter: new FakeOpenCodeAdapter() })
    await server.start()
    const client = createTuiRuntimeClient({ projectDir: dir, server, env: {} }) as TuiRuntimeServerClient

    await expect(client.runtime.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started", lockHeld: true })
    await client.runtime.shutdown({ force: true })
  })

  test("filters runtime events unsupported by the TUI reducer", () => {
    expect(isTuiRuntimeEvent({ type: "ResearchProjectionChecked", status: "ok" })).toBe(false)
    expect(isTuiRuntimeEvent({ type: "RuntimeReady", projectName: "proj", runtimeStatus: "started" })).toBe(true)
  })

  test("real runtime stream only yields reducer-safe TUI events", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const event = await readFirst(client.stream())
    expect(isTuiRuntimeEvent(event)).toBe(true)
    const state = reduceRuntimeEvent(initialState(dir), event)
    expect(state).toBeDefined()

    await client.runtime.shutdown()
  })

  test("real runtime client maps resume menu commands to runtime commands", async () => {
    const commands: string[] = []
    const shutdownOptions: unknown[] = []
    const runtime = {
      command: async (command: string) => {
        commands.push(command)
      },
      shutdown: async (options?: unknown) => {
        shutdownOptions.push(options)
      },
    }
    const client = new TuiRuntimeServerClient(runtime as unknown as TuiRuntimeServerClient["runtime"])

    await client.sendCommand("status")
    await client.sendCommand("missions")
    await client.sendCommand("resume")
    await client.sendCommand("new-session")
    await client.sendCommand("records")
    await client.sendCommand("shutdown")

    expect(commands).toEqual([
      "runtime.status",
      "runtime.list_recent_missions",
      "runtime.resume",
      "runtime.start_new_session",
      "runtime.view_records",
    ])
    expect(shutdownOptions).toEqual([{ force: true }])
  })

  test("real runtime client rejects unknown TUI commands", async () => {
    const client = new TuiRuntimeServerClient({
      command: async () => ({ ok: true }),
      shutdown: async () => {},
      submitUserMessage: async () => ({ accepted: true, missionId: "m", intentId: "i" }),
      stream: async function* () {},
    } as unknown as TuiRuntimeServerClient["runtime"])

    await expect(client.sendCommand("token=command-secret")).rejects.toThrow("unknown TUI command")
  })

  test("real runtime client path exercises review create list and approve with fake adapter", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const review = await client.command("runtime.create_review_request", {
      title: "Operator checkpoint",
      summary: "ready for approval",
      requestedBy: "tester",
    }) as { review_id: string }
    await expect(client.command("runtime.list_review_requests", { status: "pending" })).resolves.toMatchObject([
      { review_id: review.review_id, status: "pending" },
    ])
    await expect(client.command("runtime.approve_review_request", {
      reviewId: review.review_id,
      decidedBy: "tester",
      reason: "ok",
    })).resolves.toMatchObject({ review_id: review.review_id, status: "approved" })

    await client.runtime.shutdown()
  })

  test("real runtime client path exercises proposal create review approve and apply with fake adapter", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const submitted = await client.command("runtime.submit_user_message", { message: "proposal mission" }) as { missionId: string }
    const claim = await client.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "tester" }) as { claim_id: string }
    const proposal = await client.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Record progress",
      summary: "working",
      proposedBy: "tester",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "working" },
    }) as { proposal_id: string }
    const reviewed = await client.command("runtime.request_proposal_review", {
      proposalId: proposal.proposal_id,
      title: "Review progress",
      summary: "approve progress",
      requestedBy: "tester",
    }) as { review_id: string }

    await expect(client.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })).rejects.toThrow("approved linked review")
    await client.command("runtime.approve_review_request", { reviewId: reviewed.review_id, decidedBy: "tester", reason: "ok" })
    await expect(client.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      status: "applied",
    })

    await client.runtime.shutdown()
  })

  test("real runtime client path exercises opencode handoff with fake adapter", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const proposal = await client.command("runtime.create_commander_proposal", {
      actionKind: "opencode_handoff",
      title: "OpenCode handoff",
      summary: "send approved work to OpenCode",
      proposedBy: "tester",
      actionPayload: {
        objective: "implement handoff from approved proposal",
        evidence_ids: ["evidence-1"],
        requested_executor: "opencode",
      },
    }) as { proposal_id: string }
    await expect(client.command("runtime.preview_opencode_handoff", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      eligible: false,
    })
    const reviewed = await client.command("runtime.request_proposal_review", {
      proposalId: proposal.proposal_id,
      requestedBy: "tester",
    }) as { review_id: string }
    await client.command("runtime.approve_review_request", { reviewId: reviewed.review_id, decidedBy: "tester", reason: "ok" })
    await expect(client.command("runtime.preview_opencode_handoff", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      eligible: true,
      review_status: "approved",
    })
    await expect(client.command("runtime.execute_opencode_handoff", { proposalId: proposal.proposal_id, requestedBy: "tester", dryRun: true })).resolves.toMatchObject({
      handoff_id: "dry-run",
      sent: false,
      dry_run: true,
    })
    const result = await client.command("runtime.execute_opencode_handoff", { proposalId: proposal.proposal_id, requestedBy: "tester" }) as { handoff_id: string; mission_id: string }
    expect(result).toMatchObject({ proposal_id: proposal.proposal_id, sent: true })
    await expect(client.command("runtime.get_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      status: "applied",
      application_result: expect.stringContaining(result.handoff_id),
    })
    await expect(client.command("runtime.list_opencode_handoffs")).resolves.toMatchObject([
      { handoff_id: result.handoff_id, proposal_id: proposal.proposal_id, mission_id: result.mission_id },
    ])

    await client.runtime.shutdown()
  })

  test("real runtime client path exercises proposal bundle create add review approve and apply with fake adapter", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const submitted = await client.command("runtime.submit_user_message", { message: "proposal bundle mission" }) as { missionId: string }
    const claim = await client.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "tester" }) as { claim_id: string }
    const proposal = await client.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Record bundled progress",
      summary: "working",
      proposedBy: "tester",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "bundled progress" },
    }) as { proposal_id: string }
    const bundle = await client.command("runtime.create_proposal_bundle", {
      title: "Bundle progress",
      summary: "Apply progress proposal",
      createdBy: "tester",
    }) as { bundle_id: string }
    await expect(client.command("runtime.add_proposal_to_bundle", {
      bundleId: bundle.bundle_id,
      proposalId: proposal.proposal_id,
    })).resolves.toMatchObject({ bundle_id: bundle.bundle_id, proposal_ids: [proposal.proposal_id] })
    await expect(client.command("runtime.apply_proposal_bundle", { bundleId: bundle.bundle_id })).rejects.toThrow("not ready to apply")
    await expect(client.command("runtime.request_proposal_bundle_reviews", {
      bundleId: bundle.bundle_id,
      requestedBy: "tester",
    })).resolves.toMatchObject({ bundle_id: bundle.bundle_id, status: "review_requested" })
    const reviews = await client.command("runtime.list_review_requests", { status: "pending" }) as Array<{ review_id: string }>
    expect(reviews).toHaveLength(1)
    await client.command("runtime.approve_review_request", { reviewId: reviews[0].review_id, decidedBy: "tester", reason: "ok" })
    await expect(client.command("runtime.apply_proposal_bundle", { bundleId: bundle.bundle_id })).resolves.toMatchObject({
      bundle_id: bundle.bundle_id,
      status: "applied",
    })

    await client.runtime.shutdown()
  })

  test("real runtime client path exercises commander playbook draft with fake adapter", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    await expect(client.command("runtime.list_commander_playbooks")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ playbook_id: "record-progress" }),
    ]))
    const submitted = await client.command("runtime.submit_user_message", { message: "playbook mission" }) as { missionId: string }
    const claim = await client.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "tester" }) as { claim_id: string }
    const draft = await client.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      proposedBy: "tester",
      fields: {
        mission_id: submitted.missionId,
        claim_id: claim.claim_id,
        title: "Record progress",
        message: "working",
      },
    }) as { draft_id: string; proposal_ids: string[] }

    expect(draft.draft_id).toBeTruthy()
    expect(draft.proposal_ids).toHaveLength(1)
    await expect(client.command("runtime.get_commander_proposal", { proposalId: draft.proposal_ids[0] })).resolves.toMatchObject({
      action_kind: "record_progress",
      status: "proposed",
    })
    const reviewed = await client.command("runtime.request_commander_playbook_draft_reviews", { draftId: draft.draft_id, requestedBy: "tester" }) as { review_ids: string[] }
    expect(reviewed).toMatchObject({
      draft_id: draft.draft_id,
      status: "review_requested",
      review_ids: [expect.any(String)],
    })
    const reviews = await client.command("runtime.list_review_requests", { status: "pending" }) as Array<{ review_id: string }>
    await client.command("runtime.approve_review_request", { reviewId: reviews[0].review_id, decidedBy: "tester", reason: "ok" })
    await expect(client.command("runtime.commander_apply_preview", { targetType: "draft", targetId: draft.draft_id })).resolves.toMatchObject({
      ready_to_apply: true,
      would_apply: draft.proposal_ids,
    })
    await expect(client.command("runtime.apply_commander_target", { targetType: "draft", targetId: draft.draft_id })).resolves.toMatchObject({
      applied: true,
      applied_proposal_ids: draft.proposal_ids,
    })
    const auditTimeline = await client.command("runtime.commander_audit_timeline", { limit: 25 }) as { events: Array<{ kind: string }> }
    expect(auditTimeline.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "commander_playbook_draft_created",
      "commander_proposal_created",
      "review_request_created",
      "commander_proposal_applied",
    ]))
    const draftChain = await client.command("runtime.commander_authority_chain", { targetType: "draft", targetId: draft.draft_id }) as { events: Array<{ kind: string }> }
    expect(draftChain.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "commander_playbook_draft_created",
      "commander_proposal_created",
      "review_request_created",
      "commander_proposal_applied",
      "mission_progress_recorded",
    ]))

    await client.runtime.shutdown()
  })

  test("secret-looking env values do not leak through runtime status or event snapshots", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const process = new FakeSpawnedProcess()
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: {
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "/tmp/token=command-secret/opencode",
        NXL_OPENCODE_ARGS_JSON: "[\"--api-key=arg-secret\"]",
        NXL_TOKEN: "env-secret",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    }) as TuiRuntimeServerClient

    const status = await client.runtime.command("runtime.status")
    const serialized = JSON.stringify({ status, events: client.runtime.server.eventBus.snapshot() })

    expect(serialized).not.toContain("command-secret")
    expect(serialized).not.toContain("arg-secret")
    expect(serialized).not.toContain("env-secret")

    const shutdown = client.runtime.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("real runtime client path stages and runs target-context operator actions with fake adapter", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    const submitted = await client.command("runtime.submit_user_message", { message: "operator action mission" }) as { missionId: string }
    const claim = await client.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "tester" }) as { claim_id: string }
    const proposal = await client.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Record staged progress",
      summary: "working",
      proposedBy: "tester",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "working" },
    }) as { proposal_id: string }

    let state = await applyRuntimeUiEffect(initialState(dir), client, { type: "send-command", command: "open", args: ["proposal", proposal.proposal_id] })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "stage", args: ["1"] })
    expect(state.operatorActions?.staged).toMatchObject({ command: `/proposal ${proposal.proposal_id}`, command_type: "read" })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ ok: true, affected_target_type: "proposal", affected_target_id: proposal.proposal_id })
    expect(state.proposals?.selectedProposal?.proposal_id).toBe(proposal.proposal_id)

    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "stage-command", args: ["/apply-preview", "proposal", proposal.proposal_id] })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ ok: true, affected_target_type: "proposal", affected_target_id: proposal.proposal_id })
    expect(state.commanderApply?.preview).toMatchObject({ target_type: "proposal", target_id: proposal.proposal_id, ready_to_apply: false })
    await expect(client.command("runtime.get_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({ status: "proposed" })

    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "stage-command", args: ["/apply-target", "proposal", proposal.proposal_id] })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ ok: false, command: `/apply-target proposal ${proposal.proposal_id}` })
    expect(state.operatorActions?.staged?.command).toBe(`/apply-target proposal ${proposal.proposal_id}`)
    expect(state.operatorActions?.commandError).toContain("not ready")

    await client.runtime.shutdown()
  })

  test("real runtime client path exercises external API preview and dry-run without network", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const client = createTuiRuntimeClient({
      projectDir: dir,
      env: { NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
    }) as TuiRuntimeServerClient

    let state = await applyRuntimeUiEffect(initialState(dir), client, { type: "send-command", command: "apis" })
    expect(state.externalApi?.connectors.map((connector) => connector.connector_id)).toContain("mock-research-api")

    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "api-preview", args: ["mock-research-api", "GET", "/research", "q=token=api-secret"] })
    expect(state.externalApi?.preview).toMatchObject({ connector_id: "mock-research-api", allowed: true })
    expect(JSON.stringify(state)).not.toContain("api-secret")

    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "api-dry-run", args: ["mock-research-api", "GET", "/research"] })
    expect(state.externalApi?.lastResult).toMatchObject({ ok: true, dry_run: true })
    expect(state.externalApi?.audit).toEqual([])

    const db = ResearchDb.open(dir)
    db.createTopic({ id: "topic-api", title: "API ingestion topic", status: "active" })
    db.close()
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "api-ingest-preview", args: ["mock-research-api", "GET", "/research", "topic=topic-api", "source=Mock API", "q=token=api-secret"] })
    expect(state.externalApi?.research?.preview).toMatchObject({ connector_id: "mock-research-api", topic_id: "topic-api", allowed: true })
    expect(JSON.stringify(state)).not.toContain("api-secret")
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "api-ingest-dry-run", args: ["mock-research-api", "GET", "/research", "topic=topic-api", "source=Mock API"] })
    expect(state.externalApi?.research?.lastResult).toMatchObject({ ok: true, dry_run: true, ingested_bytes: 0 })
    expect(state.externalApi?.research?.ingestions ?? []).toEqual([])

    const synthDb = ResearchDb.open(dir)
    synthDb.addNote({ id: "note-synth", topic_id: "topic-api", content: "bounded synthesis evidence token=synth-secret", tags: ["evidence"] })
    synthDb.close()
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "synthesize-preview", args: ["topic-api", "summarize", "evidence"] })
    expect(state.researchSynthesis?.preview).toMatchObject({ topic_id: "topic-api" })
    expect(JSON.stringify(state)).not.toContain("synth-secret")
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "synthesize", args: ["topic-api"] })
    expect(state.researchSynthesis?.selected?.synthesis_id).toBeTruthy()
    expect(state.researchSynthesis?.selected?.proposal_ids).toEqual([])

    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "cycle-preview", args: ["topic=topic-api", "inspect", "bounded", "context"] })
    expect(state.commanderCycle?.preview).toMatchObject({ topic_id: "topic-api" })
    expect(JSON.stringify(state)).not.toContain("synth-secret")
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "cycle-proposals", args: ["topic=topic-api"] })
    expect(state.commanderCycle?.selected?.cycle_id).toBeTruthy()
    expect(state.commanderCycle?.selected?.proposal_ids?.length).toBe(1)
    expect(state.proposals?.recent.at(0)?.status).toBe("proposed")

    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "reasoning" })
    expect(state.reasoningProvider?.health).toMatchObject({ kind: "fake", status: "ok" })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "reasoning-smoke-preview", args: ["research"] })
    expect(state.reasoningProvider?.smokePreview).toMatchObject({ surface: "research_synthesis", would_call_network: false })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "reasoning-smoke-dry-run", args: ["cycle"] })
    expect(state.reasoningProvider?.lastSmoke).toMatchObject({ surface: "commander_cycle", ok: true, dry_run: true })

    await client.runtime.shutdown()
  })

  test("real runtime path can use injected MiniMax stub reasoning provider without leaking secrets", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const db = ResearchDb.open(dir)
    db.createTopic({ id: "topic-minimax", title: "MiniMax topic", status: "active" })
    db.addNote({ id: "note-minimax", topic_id: "topic-minimax", content: "bounded note token=tui-minimax-secret", tags: ["evidence"] })
    db.close()
    const transport = new FakeExternalApiTransport([
      { status_code: 200, body: minimaxEnvelope({
        title: "TUI MiniMax synthesis",
        summary: "Synthesis summary",
        findings: ["finding"],
        risks: ["risk"],
        open_questions: ["question"],
        recommended_actions: [{ title: "checkpoint", summary: "review", action_kind: "operator_checkpoint", evidence_ids: ["note-minimax"] }],
        confidence: "medium",
      }) },
      { status_code: 200, body: minimaxEnvelope({
        title: "TUI MiniMax cycle",
        summary: "Cycle summary",
        findings: ["finding"],
        risks: ["risk"],
        recommended_actions: [{ title: "checkpoint", summary: "review", action_kind: "operator_checkpoint", rationale: "bounded", evidence_ids: ["note-minimax"], synthesis_ids: [], related_target_type: "topic", related_target_id: "topic-minimax" }],
        should_create_proposals: false,
        confidence: "medium",
      }) },
    ])
    const server = new RuntimeServer({
      projectDir: dir,
      mode: "active",
      adapter: new FakeOpenCodeAdapter(),
      researchProjectionMode: "disabled",
      externalApiConnectorRegistry: new ExternalApiConnectorRegistry([minimaxConnector()]),
      externalApiTransport: transport,
      externalApiEnv: { NXL_MINIMAX_API_KEY: "raw-tui-minimax-secret" },
      reasoningProviderConfig: {
        kind: "minimax",
        provider_id: "minimax-tui",
        connector_id: "minimax-anthropic",
        model: "MiniMax-M2.7",
        max_input_bytes: 32768,
        max_output_bytes: 16384,
        enabled_for: ["research_synthesis", "commander_cycle"],
      },
    })
    const client = createTuiRuntimeClient({ projectDir: dir, server }) as TuiRuntimeServerClient

    let state = await applyRuntimeUiEffect(initialState(dir), client, { type: "send-command", command: "status" })
    expect(state.reasoningProvider).toMatchObject({ kind: "minimax", provider_id: "minimax-tui", connector_id: "minimax-anthropic" })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "synthesize", args: ["topic-minimax"] })
    expect(state.researchSynthesis?.selected).toMatchObject({ provider_id: "minimax-tui", title: "TUI MiniMax synthesis" })
    state = await applyRuntimeUiEffect(state, client, { type: "send-command", command: "cycle", args: ["topic=topic-minimax"] })
    expect(state.commanderCycle?.selected).toMatchObject({ provider_id: "minimax-tui", title: "TUI MiniMax cycle" })
    expect(transport.requests).toHaveLength(2)
    expect(JSON.stringify(state)).not.toContain("tui-minimax-secret")
    expect(JSON.stringify({ status: await client.runtime.command("runtime.status") })).not.toContain("raw-tui-minimax-secret")

    await client.runtime.shutdown()
  })
})
