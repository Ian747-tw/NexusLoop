import { describe, expect, test } from "bun:test"
import {
  modelSetupStartupGateAllowsInput,
  modelSetupStartupGateAllowsCommand,
  reduceRuntimeEvent,
  reduceRuntimeEventDuringModelSetupGate,
} from "../src/reducer"
import { layoutSnapshot } from "../src/snapshot"
import { initialState } from "../src/state"

describe("TUI runtime event reducer", () => {
  test("ProjectInitialized cannot expose Resume before model setup authority settles", () => {
    const boot = initialState("/tmp/demo")
    const initialized = { type: "ProjectInitialized", projectDir: "/tmp/demo" } as const
    expect(reduceRuntimeEventDuringModelSetupGate(boot, initialized, "pending")).toMatchObject({
      screen: "boot",
      projectDir: "/tmp/demo",
    })

    const setup = { ...boot, screen: "model-setup" as const, focus: "init-choice" as const }
    expect(reduceRuntimeEventDuringModelSetupGate(setup, initialized, "required")).toMatchObject({
      screen: "model-setup",
      focus: "init-choice",
    })
    expect(reduceRuntimeEventDuringModelSetupGate(boot, initialized, "clear")).toMatchObject({
      screen: "resume",
      focus: "resume-choice",
    })
    expect(modelSetupStartupGateAllowsInput("pending")).toBe(false)
    expect(modelSetupStartupGateAllowsInput("blocked")).toBe(false)
    expect(modelSetupStartupGateAllowsInput("required")).toBe(false)
    expect(modelSetupStartupGateAllowsInput("clear")).toBe(true)
    expect(modelSetupStartupGateAllowsCommand(setup, { type: "submit" }, "required")).toBe(true)
    expect(modelSetupStartupGateAllowsCommand({ ...setup, screen: "main" }, { type: "submit" }, "required")).toBe(false)
    const failed = {
      ...initialState("/tmp/demo"),
      screen: "model-setup" as const,
      modelSetup: { ...initialState("/tmp/demo").modelSetup, stage: "loading" as const, commandError: "setup unavailable" },
    }
    expect(modelSetupStartupGateAllowsCommand(failed, { type: "submit" }, "blocked")).toBe(true)
    expect(modelSetupStartupGateAllowsCommand(failed, { type: "insert", text: "x" }, "blocked")).toBe(false)
  })
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

  test("layout snapshot renders bounded proposal bundle state", () => {
    const state = {
      ...initialState("/tmp/demo"),
      proposalBundles: {
        summary: {
          open_count: 1,
          review_requested_count: 0,
          approved_count: 0,
          partially_approved_count: 1,
          applied_count: 0,
          partially_applied_count: 0,
          cancelled_count: 0,
          last_bundle_id: "bundle-2",
        },
        recent: [{
          bundle_id: "bundle-2",
          title: "Bundle title",
          summary: "summary",
          created_by: "operator",
          status: "partially_approved",
          proposal_ids: ["proposal-1", "proposal-2"],
        }],
        selectedBundle: {
          bundle_id: "bundle-2",
          title: "Bundle title",
          summary: "summary secret=bundle-snapshot-secret",
          created_by: "operator",
          status: "partially_approved",
          proposal_ids: ["proposal-1", "proposal-2"],
        },
        readiness: {
          bundle_id: "bundle-2",
          proposal_count: 2,
          proposed_count: 1,
          review_requested_count: 0,
          approved_count: 1,
          rejected_count: 0,
          cancelled_count: 0,
          applied_count: 0,
          blocked_count: 1,
          ready_to_apply: false,
          blockers: ["proposal proposal-1 status is proposed secret=bundle-blocker-secret"],
        },
      },
    }

    const snapshot = layoutSnapshot(state)

    expect(snapshot).toContain("Proposal bundles")
    expect(snapshot).toContain("partially_approved=1")
    expect(snapshot).toContain("bundle-2 [partially_approved] proposals=2")
    expect(snapshot).toContain("readiness=blocked proposals=2")
    expect(snapshot).not.toContain("bundle-snapshot-secret")
    expect(snapshot).not.toContain("bundle-blocker-secret")
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
