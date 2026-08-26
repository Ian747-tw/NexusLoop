import { describe, expect, test } from "bun:test"
import { withExecutionCommand } from "../src/operator-actions"
import { mergeRuntimeEffectState } from "../src/runtime-state-merge"
import { initialState, type UiState } from "../src/state"

describe("interactive runtime effect state merge", () => {
  test("applies async navigation only while the initiating screen and focus remain current", () => {
    const baseline: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box" }
    const effectResult: UiState = {
      ...baseline,
      screen: "model-setup",
      focus: "init-choice",
      modelSetup: { ...baseline.modelSetup, origin: "main", stage: "commander" },
    }
    expect(mergeRuntimeEffectState(baseline, effectResult, 0, baseline)).toMatchObject({
      screen: "model-setup",
      focus: "init-choice",
    })

    const moved: UiState = { ...baseline, screen: "resume", focus: "resume-choice" }
    expect(mergeRuntimeEffectState(moved, effectResult, 0, baseline)).toMatchObject({
      screen: "resume",
      focus: "resume-choice",
    })
  })

  test("lets missing setup supersede the stream-driven boot to resume transition", () => {
    const baseline = initialState("/tmp/demo")
    const streamInitialized: UiState = {
      ...baseline,
      screen: "resume",
      focus: "resume-choice",
    }
    const missingSetup: UiState = {
      ...baseline,
      screen: "model-setup",
      focus: "init-choice",
      modelSetup: { ...baseline.modelSetup, origin: "main", stage: "commander" },
    }

    expect(mergeRuntimeEffectState(streamInitialized, missingSetup, 0, baseline)).toMatchObject({
      screen: "model-setup",
      focus: "init-choice",
    })

    const operatorMoved = { ...streamInitialized, resumeSelection: 1 }
    expect(mergeRuntimeEffectState(operatorMoved, missingSetup, 0, baseline)).toMatchObject({
      screen: "resume",
      focus: "resume-choice",
      resumeSelection: 1,
    })
  })

  test("rebases async runtime effect fields without dropping newer stream state", () => {
    const base: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "user command -> runtime", detail: "status" }],
    }
    const current: UiState = {
      ...base,
      executor: [{ title: "tool started: runtime.connect", status: "running" }],
      systemActions: [...base.systemActions, { title: "stream event", detail: "arrived while command was in flight" }],
    }
    const effectResult: UiState = {
      ...base,
      runtimeStatus: {
        runtimeStatus: "started",
        mode: "active",
        projectName: "demo",
        specApproved: true,
        lockHeld: true,
      },
      header: {
        ...base.header,
        projectName: "demo",
        runtimeStatus: "started",
        activeMissionId: "mission-1",
      },
      systemActions: [...base.systemActions, { title: "runtime command error", detail: "none" }],
    }

    const merged = mergeRuntimeEffectState(current, effectResult, base.systemActions.length)

    expect(merged.executor).toEqual(current.executor)
    expect(merged.systemActions).toEqual([
      { title: "user command -> runtime", detail: "status" },
      { title: "stream event", detail: "arrived while command was in flight" },
      { title: "runtime command error", detail: "none" },
    ])
    expect(merged.runtimeStatus?.runtimeStatus).toBe("started")
    expect(merged.header.activeMissionId).toBe("mission-1")
  })

  test("preserves newer runtime surface while keeping older effect outcome actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "user command -> runtime", detail: "status" }],
      header: {
        ...initialState("/tmp/demo").header,
        activeMissionId: "mission-old",
      },
      missions: {
        pending_count: 1,
        failed_count: 0,
        active_claim_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        last_mission_id: "mission-old",
        recent: [{ mission_id: "mission-old", status: "pending" }],
      },
    }
    const current: UiState = {
      ...baseline,
      runtimeCommandError: undefined,
      lastCommand: "missions",
      header: {
        ...baseline.header,
        activeMissionId: "mission-new",
      },
      missions: {
        ...baseline.missions!,
        last_mission_id: "mission-new",
        recent: [{ mission_id: "mission-new", status: "pending" }],
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      runtimeCommandError: "older command failed",
      lastCommand: "status",
      systemActions: [
        ...baseline.systemActions,
        { title: "runtime command error", detail: "older command failed", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.missions?.last_mission_id).toBe("mission-new")
    expect(merged.header.activeMissionId).toBe("mission-new")
    expect(merged.lastCommand).toBe("missions")
    expect(merged.runtimeCommandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "runtime command error",
      detail: "older command failed",
      status: "failed",
    })
  })

  test("default merge preserves startup refresh error actions", () => {
    const current: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "stream event", detail: "ready" }],
    }
    const effectResult: UiState = {
      ...initialState("/tmp/demo"),
      runtimeCommandError: "runtime failed",
      systemActions: [{ title: "runtime command error", detail: "runtime failed", status: "failed" }],
    }

    const merged = mergeRuntimeEffectState(current, effectResult)

    expect(merged.systemActions).toEqual([
      { title: "stream event", detail: "ready" },
      { title: "runtime command error", detail: "runtime failed", status: "failed" },
    ])
    expect(merged.runtimeCommandError).toBe("runtime failed")
  })

  test("preserves new effect action when effect result action list is capped", () => {
    const baselineActions = Array.from({ length: 12 }, (_, index) => ({ title: `baseline-${index + 1}` }))
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: baselineActions,
    }
    const current: UiState = {
      ...baseline,
      systemActions: baselineActions,
    }
    const effectAction = { title: "mission submitted", detail: "mission_id=mission-1 intent_id=intent-1" }
    const effectResult: UiState = {
      ...baseline,
      systemActions: [...baselineActions, effectAction].slice(-12),
    }

    const merged = mergeRuntimeEffectState(current, effectResult, baseline.systemActions.length, baseline)

    expect(merged.systemActions).toHaveLength(12)
    expect(merged.systemActions.at(-1)).toEqual(effectAction)
    expect(merged.systemActions[0]).toEqual({ title: "baseline-2" })
  })

  test("preserves newer research state while keeping older research effect actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      research: {
        topics: [{ id: "topic-old", title: "Old topic", status: "open" }],
        selectedTopic: null,
        notes: [],
        events: [],
      },
      systemActions: [{ title: "user command -> runtime", detail: "topics" }],
    }
    const current: UiState = {
      ...baseline,
      research: {
        ...baseline.research!,
        topics: [{ id: "topic-new", title: "New topic", status: "active" }],
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      research: {
        ...baseline.research!,
        topics: [{ id: "topic-older-result", title: "Older result", status: "paused" }],
        commandError: "older failure",
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "research command error", detail: "older failure", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.research?.topics[0]?.id).toBe("topic-new")
    expect(merged.research?.commandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "research command error",
      detail: "older failure",
      status: "failed",
    })
  })

  test("preserves newer research memory state while keeping older effect actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      researchMemory: {
        summary: null,
        retrievalPreview: {
          preview_id: "preview-old",
          status: "ready",
          query_preview: "old query",
          labels: [],
          limit: 3,
          candidates: [],
          omitted_count: 0,
          retrieval_policy: "fake",
          blockers: [],
          warnings: [],
          recommended_commands: [],
          generated_at: "2026-06-30T00:00:00.000Z",
          redacted_summary_preview: "old",
          retrieval_hash: "hash-old",
        },
        noveltyPreview: null,
      },
      systemActions: [{ title: "user command -> runtime", detail: "research-memory-search" }],
    }
    const current: UiState = {
      ...baseline,
      researchMemory: {
        ...baseline.researchMemory!,
        retrievalPreview: {
          ...baseline.researchMemory!.retrievalPreview!,
          preview_id: "preview-new",
          query_preview: "new query",
          redacted_summary_preview: "new",
          retrieval_hash: "hash-new",
        },
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      researchMemory: {
        ...baseline.researchMemory!,
        retrievalPreview: {
          ...baseline.researchMemory!.retrievalPreview!,
          preview_id: "preview-older-result",
          query_preview: "older result",
          redacted_summary_preview: "older",
          retrieval_hash: "hash-older",
        },
        commandError: "older memory failure",
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "research memory command error", detail: "older memory failure", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.researchMemory?.retrievalPreview?.preview_id).toBe("preview-new")
    expect(merged.researchMemory?.commandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "research memory command error",
      detail: "older memory failure",
      status: "failed",
    })
  })

  test("preserves newer mission execution state while keeping older effect actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      missionExecution: {
        selectedMissionId: "mission-old",
        claims: [{ claim_id: "claim-old", mission_id: "mission-old", executor_id: "executor-old", status: "active" }],
        progress: [],
        results: [],
      },
      systemActions: [{ title: "user command -> runtime", detail: "claim mission-old executor-old" }],
    }
    const current: UiState = {
      ...baseline,
      missionExecution: {
        selectedMissionId: "mission-new",
        selectedClaimId: "claim-new",
        claims: [{ claim_id: "claim-new", mission_id: "mission-new", executor_id: "executor-new", status: "active" }],
        progress: [],
        results: [],
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      missionExecution: {
        ...baseline.missionExecution!,
        commandError: "older claim failed",
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "mission execution command error", detail: "older claim failed", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.missionExecution?.selectedMissionId).toBe("mission-new")
    expect(merged.missionExecution?.selectedClaimId).toBe("claim-new")
    expect(merged.missionExecution?.commandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "mission execution command error",
      detail: "older claim failed",
      status: "failed",
    })
  })

  test("preserves staged operator actions through command effect merges", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "user command -> runtime", detail: "stage-command /queues" }],
    }
    const stagedResult: UiState = {
      ...baseline,
      operatorActions: {
        staged: {
          label: "Explicit command",
          command: "/queues",
          command_type: "read",
        },
        lastResult: null,
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "operator command staged", detail: "/queues", status: "read" },
      ],
    }

    const merged = mergeRuntimeEffectState(baseline, stagedResult, baseline.systemActions.length, baseline)

    expect(merged.operatorActions?.staged?.command).toBe("/queues")
    expect(merged.systemActions.at(-1)).toEqual({ title: "operator command staged", detail: "/queues", status: "read" })

    const currentWithNewerStage: UiState = {
      ...baseline,
      operatorActions: {
        staged: {
          label: "Explicit command",
          command: "/records",
          command_type: "read",
        },
        lastResult: null,
      },
    }
    const olderClearResult: UiState = {
      ...baseline,
      operatorActions: {
        staged: null,
        lastResult: null,
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "operator command cleared", detail: "staged=none", status: "cleared" },
      ],
    }

    const staleMerged = mergeRuntimeEffectState(currentWithNewerStage, olderClearResult, baseline.systemActions.length, baseline)

    expect(staleMerged.operatorActions?.staged?.command).toBe("/records")
    expect(staleMerged.systemActions.at(-1)).toEqual({ title: "operator command cleared", detail: "staged=none", status: "cleared" })

    const baselineWithRedactedStage: UiState = {
      ...baseline,
      operatorActions: {
        staged: withExecutionCommand({
          label: "Explicit command",
          command: "/notes topic-1 [REDACTED]",
          command_type: "read" as const,
        }, "/notes topic-1 token=old-secret"),
        lastResult: null,
      },
    }
    const currentWithSameVisibleStage: UiState = {
      ...baselineWithRedactedStage,
      operatorActions: {
        staged: withExecutionCommand({
          label: "Explicit command",
          command: "/notes topic-1 [REDACTED]",
          command_type: "read" as const,
        }, "/notes topic-1 token=new-secret"),
        lastResult: null,
      },
    }
    const olderRunResult: UiState = {
      ...baselineWithRedactedStage,
      operatorActions: {
        staged: null,
        lastResult: {
          command: "/notes topic-1 [REDACTED]",
          ok: true,
          summary: "executed notes",
          executed_at: "2026-05-23T00:00:00.000Z",
        },
      },
    }

    const rawAwareMerged = mergeRuntimeEffectState(currentWithSameVisibleStage, olderRunResult, baseline.systemActions.length, baselineWithRedactedStage)

    expect(rawAwareMerged.operatorActions?.staged?.command).toBe("/notes topic-1 [REDACTED]")
    expect(rawAwareMerged.operatorActions?.lastResult).toBeNull()
  })

  test("keeps header mission aligned when mission execution rebases over newer mission summary", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      header: {
        ...initialState("/tmp/demo").header,
        activeMissionId: "mission-a",
      },
      missions: {
        pending_count: 1,
        failed_count: 0,
        recent: [{ mission_id: "mission-a", status: "sent" }],
      },
      missionExecution: {
        selectedMissionId: "mission-a",
        selectedMission: { mission_id: "mission-a", status: "sent" },
        claims: [],
        progress: [],
        results: [],
      },
      systemActions: [{ title: "user command -> runtime", detail: "mission mission-b" }],
    }
    const current: UiState = {
      ...baseline,
      header: {
        ...baseline.header,
        activeMissionId: "mission-a",
      },
      missions: {
        pending_count: 1,
        failed_count: 0,
        recent: [{ mission_id: "mission-stream", status: "sent" }],
        last_mission_id: "mission-stream",
      },
    }
    const effectResult: UiState = {
      ...baseline,
      header: {
        ...baseline.header,
        activeMissionId: "mission-b",
      },
      missionExecution: {
        selectedMissionId: "mission-b",
        selectedMission: { mission_id: "mission-b", status: "sent" },
        claims: [],
        progress: [],
        results: [],
      },
    }

    const merged = mergeRuntimeEffectState(current, effectResult, baseline.systemActions.length, baseline)

    expect(merged.missions?.last_mission_id).toBe("mission-stream")
    expect(merged.missionExecution?.selectedMissionId).toBe("mission-b")
    expect(merged.header.activeMissionId).toBe("mission-b")
  })

  test("preserves newer external API state through older effect merges", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      externalApi: {
        connectors: [],
        selectedConnector: null,
        preview: null,
        lastResult: null,
        audit: [],
      },
    }
    const current: UiState = {
      ...baseline,
      externalApi: {
        ...baseline.externalApi!,
        preview: {
          connector_id: "mock-research-api",
          method: "GET",
          url: "https://api.example.test/new",
          allowed: true,
          blockers: [],
          redacted_headers: {},
          has_body: false,
          body_bytes: 0,
          credential_refs_used: [],
        },
      },
    }
    const effectResult: UiState = {
      ...baseline,
      externalApi: {
        ...baseline.externalApi!,
        connectors: [{ connector_id: "mock-research-api", title: "Mock", base_url: "https://api.example.test", allowed_hosts: ["api.example.test"], allowed_methods: ["GET"], timeout_ms: 5000, max_response_bytes: 4096 }],
      },
    }

    const merged = mergeRuntimeEffectState(current, effectResult, baseline.systemActions.length, baseline)

    expect(merged.externalApi?.preview?.url).toBe("https://api.example.test/new")
    expect(merged.externalApi?.connectors).toEqual([])
  })

  test("preserves OpenCode process smoke updates from async runtime effects", () => {
    const baseline = initialState("/tmp/demo")
    const current = initialState("/tmp/demo")
    const effectResult = initialState("/tmp/demo")
    effectResult.opencodeProcessSmoke = {
      preview: {
        status: "not_configured",
        can_execute: false,
        project_dir: "/tmp/demo",
        binary_detected: false,
        opt_in_required: true,
        opt_in_present: false,
        timeout_ms: 10000,
        blockers: ["OpenCode process command is not configured."],
        warnings: [],
        redacted_summary_preview: "OpenCode process command is not configured.",
      },
      latestResult: null,
      records: [],
      selected: null,
    }

    const merged = mergeRuntimeEffectState(current, effectResult, 0, baseline)

    expect(merged.opencodeProcessSmoke?.preview?.status).toBe("not_configured")
    expect(merged.opencodeProcessSmoke?.preview?.blockers).toContain("OpenCode process command is not configured.")
  })

  test("preserves OpenCode handoff readiness updates from async runtime effects", () => {
    const baseline = initialState("/tmp/demo")
    const current = initialState("/tmp/demo")
    const effectResult = initialState("/tmp/demo")
    effectResult.opencodeHandoffReadiness = {
      preview: {
        readiness_id: "readiness-1",
        status: "needs_smoke",
        can_execute_now: false,
        authority: {
          command: "/handoff",
          slash_command: "/handoff",
          risk: "high_impact_write",
          gate: "handoff_runtime",
          owner: "opencode_handoff",
          blocked_by_default: true,
        },
        required_evidence: [],
        optional_evidence: [],
        blockers: ["no OpenCode process smoke record found"],
        warnings: [],
        recommended_commands: [],
        generated_at: "1970-01-01T00:00:00.000Z",
        redacted_summary_preview: "handoff readiness needs_smoke",
      },
      summary: null,
    }

    const merged = mergeRuntimeEffectState(current, effectResult, 0, baseline)

    expect(merged.opencodeHandoffReadiness?.preview?.status).toBe("needs_smoke")
    expect(merged.opencodeHandoffReadiness?.preview?.blockers).toContain("no OpenCode process smoke record found")
  })

  test("preserves OpenCode result review packet updates from async runtime effects", () => {
    const baseline = initialState("/tmp/demo")
    const current = initialState("/tmp/demo")
    const effectResult = initialState("/tmp/demo")
    effectResult.opencodeResultReview = {
      packet: {
        packet_id: "packet-1",
        status: "needs_result",
        handoff_id: "handoff-1",
        title: "OpenCode executor handoff needs a mission result",
        artifact_previews: [],
        evidence: [],
        blockers: [],
        warnings: ["executor outcome has no submitted mission result yet"],
        recommended_commands: [],
        generated_at: "1970-01-01T00:00:00.000Z",
        redacted_summary_preview: "executor outcome has no submitted mission result yet",
      },
      summary: null,
      records: [],
    }

    const merged = mergeRuntimeEffectState(current, effectResult, 0, baseline)

    expect(merged.opencodeResultReview?.packet?.status).toBe("needs_result")
    expect(merged.opencodeResultReview?.packet?.warnings).toContain("executor outcome has no submitted mission result yet")
  })

  test("preserves OpenCode asks Commander updates from async runtime effects", () => {
    const baseline = initialState("/tmp/demo")
    const current = initialState("/tmp/demo")
    const effectResult = initialState("/tmp/demo")
    effectResult.opencodeCommanderQuestions = {
      preview: null,
      latestResult: {
        question_id: "question-1",
        status: "created",
        question_status: "pending_commander",
        session_id: "session-1",
        question_type: "clarification",
        urgency: "normal",
        question_preview: "Should I choose option A?",
        context_summary_preview: "bounded runtime metadata",
        options_considered_preview: [],
        created_at: "1970-01-01T00:00:00.000Z",
        created_by: "operator",
        source_kind: "manual",
        question_hash: "question-hash-1",
        recommended_commands: [],
      },
      records: [{
        question_id: "question-1",
        status: "pending_commander",
        session_id: "session-1",
        question_type: "clarification",
        urgency: "normal",
        question_preview: "Should I choose option A?",
        source_kind: "manual",
        created_at: "1970-01-01T00:00:00.000Z",
        created_by: "operator",
        has_options: false,
        has_recommendation: false,
        question_hash: "question-hash-1",
      }],
    }

    const merged = mergeRuntimeEffectState(current, effectResult, 0, baseline)

    expect(merged.opencodeCommanderQuestions?.latestResult?.question_id).toBe("question-1")
    expect(merged.opencodeCommanderQuestions?.records.map((record) => record.question_id)).toEqual(["question-1"])
  })

  test("does not let a stale recovery execute effect overwrite a newer cancellation state", () => {
    const baseline = initialState("/tmp/demo")
    const current = initialState("/tmp/demo")
    current.commanderRecovery = {
      ...current.commanderRecovery!,
      operation: { operation_id: "operation-1", status: "running" },
      cancellation: { operation_id: "operation-1", status: "cancellation_requested" },
    }
    const effectResult = initialState("/tmp/demo")
    effectResult.commanderRecovery = {
      ...effectResult.commanderRecovery!,
      operation: { operation_id: "operation-1", status: "running" },
      cancellation: null,
    }

    const merged = mergeRuntimeEffectState(current, effectResult, 0, baseline)

    expect(merged.commanderRecovery?.cancellation).toMatchObject({ status: "cancellation_requested" })
  })
})
