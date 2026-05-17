import { describe, expect, test } from "bun:test"
import { reduceRuntimeEvent } from "../src/reducer"
import { layoutSnapshot } from "../src/snapshot"
import { initialState } from "../src/state"

describe("TUI runtime event reducer", () => {
  test("ProjectUninitialized routes to init screen", () => {
    const state = reduceRuntimeEvent(initialState("/tmp/demo"), { type: "ProjectUninitialized", projectDir: "/tmp/demo" })

    expect(state.screen).toBe("init")
    expect(state.focus).toBe("init-choice")
  })

  test("ProjectInitialized routes to resume screen", () => {
    const state = reduceRuntimeEvent(initialState("/tmp/demo"), { type: "ProjectInitialized", projectDir: "/tmp/demo" })

    expect(state.screen).toBe("resume")
    expect(state.focus).toBe("resume-choice")
  })

  test("MissionStarted updates commander block", () => {
    const state = reduceRuntimeEvent(initialState("/tmp/demo"), {
      type: "MissionStarted",
      missionId: "mission-1",
      workIntent: "investigate",
      budget: "2h",
      programState: "running",
    })

    expect(state.screen).toBe("main")
    expect(state.header.activeMissionId).toBe("mission-1")
    expect(state.commander.programState).toBe("running")
    expect(state.commander.workIntent).toBe("investigate")
    expect(state.commander.budget).toBe("2h")
    expect(state.systemActions.at(-1)?.title).toBe("Mission started")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Mission started")
    expect(snapshot).not.toContain("Mission claim")
  })

  test("ExecutorToolStarted and ExecutorToolCompleted update executor block", () => {
    let state = initialState("/tmp/demo")
    state = reduceRuntimeEvent(state, { type: "ExecutorToolStarted", tool: "bash", command: "pytest" })
    state = reduceRuntimeEvent(state, { type: "ExecutorToolCompleted", tool: "bash", status: "completed", output: "passed" })

    expect(state.executor).toHaveLength(2)
    expect(state.executor[0]?.title).toBe("tool started: bash")
    expect(state.executor[1]?.title).toBe("tool completed: bash")
    expect(state.executor[1]?.detail).toContain("passed")
  })

  test("ApprovalRequested updates approval block", () => {
    const state = reduceRuntimeEvent(initialState("/tmp/demo"), {
      type: "ApprovalRequested",
      approvalId: "approval-1",
      kind: "spec",
      prompt: "Approve spec candidate?",
    })

    expect(state.focus).toBe("approval")
    expect(state.approval.specApprovals.at(-1)?.title).toBe("spec approval: approval-1")
    expect(state.approval.specApprovals.at(-1)?.detail).toBe("Approve spec candidate?")
  })

  test("layout snapshot renders bounded review approval state", () => {
    const state = {
      ...initialState("/tmp/demo"),
      reviews: {
        summary: { pending_count: 1, approved_count: 1, rejected_count: 0, cancelled_count: 0, last_review_id: "review-2" },
        pending: [{
          review_id: "review-2",
          mission_id: "mission-1",
          request_type: "mission_completion",
          title: "Complete mission",
          summary: "summary",
          requested_by: "operator",
          status: "pending",
        }],
        recent: [{
          review_id: "review-1",
          request_type: "operator_checkpoint",
          title: "Checkpoint",
          summary: "done",
          requested_by: "operator",
          status: "approved",
        }],
        selectedReview: {
          review_id: "review-2",
          mission_id: "mission-1",
          request_type: "mission_completion",
          title: "Complete mission",
          summary: "summary secret=snapshot-secret",
          requested_by: "operator",
          status: "pending",
        },
      },
    }

    const snapshot = layoutSnapshot(state)

    expect(snapshot).toContain("Reviews / approvals")
    expect(snapshot).toContain("pending=1 approved=1 rejected=0 cancelled=0")
    expect(snapshot).toContain("review-2 [pending] mission_completion mission=mission-1")
    expect(snapshot).not.toContain("snapshot-secret")
  })

  test("provider and spec onboarding state never stores API keys", () => {
    let state = initialState("/tmp/demo")
    state = reduceRuntimeEvent(state, {
      type: "ProviderOnboardingState",
      provider: "openai",
      model: "gpt-test",
      credentialSource: "secure_store",
      connectionStatus: "not tested",
    })
    state = reduceRuntimeEvent(state, {
      type: "ProjectSpecOnboardingState",
      plainTextSpec: "Build with sk-test-SECRET123",
      gpuQuota: "0 GB",
      wakeHooks: "30-120 min",
      maxParallelRuns: 1,
      approvalRequirements: ["spec_changes"],
    })
    state = reduceRuntimeEvent(state, {
      type: "SpecApprovalSummary",
      specId: "spec_1",
      objective: "Use sk-test-SECRET123",
      successMetrics: ["reward >= 475"],
      computeLimits: "cpu only",
      wakeHookPolicy: "default 60 min",
      userRules: ["never log Bearer abc.def.ghi"],
      riskyFields: ["objective"],
    })

    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain("sk-test-SECRET123")
    expect(serialized).not.toContain("Bearer abc.def.ghi")
    expect(serialized).toContain("[REDACTED]")
    expect(state.providerOnboarding.provider).toBe("openai")
    expect(state.projectOnboarding.gpuQuota).toBe("0 GB")
  })
})
