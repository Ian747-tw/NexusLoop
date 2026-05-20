import { describe, expect, test } from "bun:test"
import type { RuntimeEvent } from "../src/events"
import { applyRuntimeUiEffect } from "../src/runtime-effects"
import { FakeRuntimeClient, type RuntimeClient } from "../src/runtime"
import { initialState, type UiState } from "../src/state"

class RecentMissionRuntime implements RuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string): Promise<unknown> {
    if (name === "runtime.list_recent_missions") {
      return [
        {
          mission_id: "mission-new",
          intent_id: "intent-new",
          status: "sent",
          objective: "new mission",
          created_at: "2026-05-16T00:00:00Z",
          updated_at: "2026-05-16T00:00:00Z",
        },
      ]
    }
    return { ok: true }
  }
}

class RejectingRuntime implements RuntimeClient {
  commandCalls = 0
  sendCommandCalls = 0

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    this.sendCommandCalls += 1
    throw new Error("runtime should not receive init command")
  }
  async command(): Promise<unknown> {
    this.commandCalls += 1
    throw new Error("runtime should not receive init command")
  }
}

class RefreshFailAfterSubmitRuntime implements RuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<{ accepted: true; missionId: string; intentId: string }> {
    return { accepted: true, missionId: "mission-created", intentId: "intent-created" }
  }
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(): Promise<unknown> {
    throw new Error("refresh failed after accepted mission")
  }
}

class CountingRuntime implements RuntimeClient {
  readonly calls: string[] = []

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string): Promise<unknown> {
    this.calls.push(name)
    if (name === "runtime.list_recent_missions") return []
    if (name === "runtime.review_status") return { pending_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0 }
    if (name === "runtime.list_review_requests") return []
    if (name === "runtime.proposal_status") return { proposed_count: 0, review_requested_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0, applied_count: 0 }
    if (name === "runtime.list_commander_proposals") return []
    return {
      runtimeStatus: "started",
      mode: "active",
      projectName: "demo",
      specApproved: true,
      lockHeld: true,
    }
  }
}

class ResearchRuntime implements RuntimeClient {
  readonly calls: string[] = []

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(`${name}:${JSON.stringify(payload ?? {})}`)
    switch (name) {
      case "research.list_topics":
        return [
          { id: "topic-secret", title: "token=topic-secret", status: "active", created_at: "2026-05-16T00:00:00Z" },
          { id: "topic-2", title: "Second topic", status: "open" },
        ]
      case "research.get_topic_snapshot":
        return {
          topic: { id: payload?.topicId, title: "Selected topic", status: "active" },
          sources: [],
          notes: [],
          artifacts: [],
          stats: {
            source_count: 2,
            note_count: 3,
            artifact_count: 4,
            report_count: 1,
            reviewed_source_count: 1,
            rejected_source_count: 0,
          },
          latest_event: {
            event_id: "event-1",
            event_type: "topic_created",
            entity_type: "topic",
            entity_id: payload?.topicId,
            payload: { secret: "not rendered" },
            created_at: "2026-05-16T00:00:00Z",
          },
        }
      case "research.search_notes":
        return [
          {
            id: "note-1",
            topic_id: payload?.topicId,
            source_id: "source-1",
            content: `note token=note-secret ${(payload?.query as string) ?? ""}`,
            tags: ["secret=tag-secret", "safe"],
            created_at: "2026-05-16T00:00:00Z",
          },
        ]
      case "research.list_events":
        return [
          {
            event_id: "event-1",
            event_type: "note_added",
            entity_type: "note",
            entity_id: "note-1",
            payload: { token: "payload-secret" },
            created_at: "2026-05-16T00:00:00Z",
          },
        ]
      case "research.projection_status":
      case "research.rebuild_projection":
        return { mode: "auto_rebuild", ok: true, stale: false, reason: "token=projection-secret", pending_count: 0, last_event_id: "event-1" }
      default:
        return { ok: true }
    }
  }
}

class FailingResearchRuntime extends ResearchRuntime {
  async command(name: string): Promise<unknown> {
    if (name.startsWith("research.")) throw new Error("research failed token=research-secret")
    return super.command(name)
  }
}

class ProjectionFailingResearchRuntime extends ResearchRuntime {
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (name === "research.projection_status") throw new Error("projection failed token=projection-secret")
    return super.command(name, payload)
  }
}

class MissionExecutionRuntime implements RuntimeClient {
  readonly calls: string[] = []
  readonly missions = new Map<string, Record<string, unknown>>([
    [
      "mission-1",
      {
        mission_id: "mission-1",
        intent_id: "intent-1",
        objective: "mission objective",
        status: "sent",
        created_at: "2026-05-16T00:00:00Z",
        updated_at: "2026-05-16T00:00:00Z",
      },
    ],
  ])
  readonly claims = new Map<string, Record<string, unknown>>()
  readonly progress = new Map<string, Record<string, unknown>>()
  readonly results = new Map<string, Record<string, unknown>>()
  readonly reviews = new Map<string, Record<string, unknown>>()
  private sequence = 0

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push(`${name}:${JSON.stringify(payload)}`)
    const missionId = String(payload.missionId ?? payload.mission_id ?? "mission-1")
    switch (name) {
      case "runtime.status":
        return {
          runtimeStatus: "started",
          mode: "active",
          projectName: "demo",
          specApproved: true,
          lockHeld: true,
          missions: {
            pending_count: [...this.missions.values()].filter((mission) => mission.status === "sent").length,
            failed_count: [...this.missions.values()].filter((mission) => mission.status === "failed").length,
            active_claim_count: [...this.claims.values()].filter((claim) => claim.status === "active").length,
            completed_count: [...this.missions.values()].filter((mission) => mission.status === "completed").length,
            cancelled_count: [...this.missions.values()].filter((mission) => mission.status === "cancelled").length,
            last_mission_id: missionId,
          },
          reviews: this.reviewSummary(),
        }
      case "runtime.list_recent_missions":
        return [...this.missions.values()]
      case "runtime.get_mission":
        return this.missions.get(missionId) ?? null
      case "runtime.list_mission_claims":
        return [...this.claims.values()].filter((claim) => claim.mission_id === missionId)
      case "runtime.list_mission_progress":
        return [...this.progress.values()].filter((item) => item.mission_id === missionId)
      case "runtime.list_mission_results":
        return [...this.results.values()].filter((result) => result.mission_id === missionId)
      case "runtime.review_status":
        return this.reviewSummary()
      case "runtime.list_review_requests":
        return [...this.reviews.values()].filter((review) => payload.status === undefined || review.status === payload.status)
      case "runtime.get_review_request":
        return this.reviews.get(String(payload.reviewId ?? "")) ?? null
      case "runtime.create_review_request":
        return this.createReview(payload)
      case "runtime.approve_review_request":
        return this.decideReview(String(payload.reviewId ?? ""), "approved", payload)
      case "runtime.reject_review_request":
        return this.decideReview(String(payload.reviewId ?? ""), "rejected", payload)
      case "runtime.cancel_review_request":
        return this.decideReview(String(payload.reviewId ?? ""), "cancelled", payload)
      case "runtime.claim_mission":
        return this.claimMission(missionId, String(payload.executorId ?? ""))
      case "runtime.record_mission_progress":
        return this.recordProgress(missionId, String(payload.claimId ?? ""), String(payload.message ?? ""))
      case "runtime.submit_mission_result":
        return this.submitResult(missionId, String(payload.claimId ?? ""), String(payload.summary ?? ""))
      case "runtime.complete_mission":
        return this.completeMission(missionId, typeof payload.resultId === "string" ? payload.resultId : undefined, typeof payload.summary === "string" ? payload.summary : undefined)
      case "runtime.fail_mission":
        return this.updateMission(missionId, { status: "failed", failure_reason: payload.reason })
      case "runtime.cancel_mission":
        return this.updateMission(missionId, { status: "cancelled", cancellation_reason: payload.reason })
      case "runtime.release_mission_claim": {
        const claimId = String(payload.claimId ?? "")
        const claim = this.claims.get(claimId)
        if (!claim) throw new Error(`unknown claim token=claim-secret ${claimId}`)
        claim.status = "released"
        claim.released_at = "2026-05-16T00:00:00Z"
        claim.release_reason = payload.reason
        return claim
      }
      default:
        return { ok: true }
    }
  }

  private claimMission(missionId: string, executorId: string): Record<string, unknown> {
    this.sequence += 1
    const claim = {
      claim_id: `claim-${this.sequence}`,
      mission_id: missionId,
      executor_id: executorId,
      status: "active",
      claimed_at: "2026-05-16T00:00:00Z",
    }
    this.claims.set(claim.claim_id, claim)
    this.updateMission(missionId, { status: "claimed" })
    return claim
  }

  private recordProgress(missionId: string, claimId: string, message: string): Record<string, unknown> {
    this.sequence += 1
    const progress = {
      progress_id: `progress-${this.sequence}`,
      mission_id: missionId,
      claim_id: claimId,
      message,
      created_at: "2026-05-16T00:00:00Z",
    }
    this.progress.set(progress.progress_id, progress)
    this.updateMission(missionId, { status: "running" })
    return progress
  }

  private submitResult(missionId: string, claimId: string, summary: string): Record<string, unknown> {
    this.sequence += 1
    const result = {
      result_id: `result-${this.sequence}`,
      mission_id: missionId,
      claim_id: claimId,
      summary,
      status: "submitted",
      created_at: "2026-05-16T00:00:00Z",
    }
    this.results.set(result.result_id, result)
    return result
  }

  private completeMission(missionId: string, resultId: string | undefined, summary: string | undefined): Record<string, unknown> {
    const latestResult = resultId ? this.results.get(resultId) : [...this.results.values()].find((result) => result.mission_id === missionId)
    return this.updateMission(missionId, {
      status: "completed",
      completion_result_id: latestResult?.result_id,
      completion_summary: summary,
    })
  }

  private updateMission(missionId: string, patch: Record<string, unknown>): Record<string, unknown> {
    const mission = this.missions.get(missionId)
    if (!mission) throw new Error(`unknown mission token=mission-secret ${missionId}`)
    Object.assign(mission, patch, { updated_at: "2026-05-16T00:00:00Z" })
    return mission
  }

  private createReview(payload: Record<string, unknown>): Record<string, unknown> {
    this.sequence += 1
    const review = {
      review_id: `review-${this.sequence}`,
      mission_id: payload.missionId,
      request_type: payload.requestType ?? "other",
      title: payload.title,
      summary: payload.summary,
      requested_by: payload.requestedBy,
      status: "pending",
      created_at: "2026-05-16T00:00:00Z",
      updated_at: "2026-05-16T00:00:00Z",
    }
    this.reviews.set(review.review_id, review)
    return review
  }

  private decideReview(reviewId: string, status: string, payload: Record<string, unknown>): Record<string, unknown> {
    const review = this.reviews.get(reviewId)
    if (!review) throw new Error(`unknown review token=review-secret ${reviewId}`)
    Object.assign(review, {
      status,
      updated_at: "2026-05-16T00:00:00Z",
      decision_at: "2026-05-16T00:00:00Z",
      decision_by: payload.decidedBy,
      decision_reason: payload.reason,
    })
    return review
  }

  private reviewSummary(): Record<string, unknown> {
    const reviews = [...this.reviews.values()]
    return {
      pending_count: reviews.filter((review) => review.status === "pending").length,
      approved_count: reviews.filter((review) => review.status === "approved").length,
      rejected_count: reviews.filter((review) => review.status === "rejected").length,
      cancelled_count: reviews.filter((review) => review.status === "cancelled").length,
      last_review_id: reviews.at(-1)?.review_id,
    }
  }
}

class FailingMissionExecutionRuntime extends MissionExecutionRuntime {
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (name === "runtime.claim_mission") throw new Error("claim failed token=mission-command-secret")
    return super.command(name, payload)
  }
}

describe("runtime UI effects", () => {
  test("recent mission refresh advances last and active mission to newest row", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      lastCommand: "missions",
      runtimeCommandError: "previous failure",
      missions: {
        pending_count: 0,
        failed_count: 0,
        active_claim_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        last_mission_id: "mission-old",
        recent: [{ mission_id: "mission-old", status: "sent" }],
      },
      header: {
        ...initialState("/tmp/demo").header,
        activeMissionId: "mission-old",
      },
    }

    const next = await applyRuntimeUiEffect(state, new RecentMissionRuntime(), { type: "load-recent-missions" })

    expect(next.missions?.last_mission_id).toBe("mission-new")
    expect(next.header.activeMissionId).toBe("mission-new")
    expect(next.runtimeCommandError).toBeUndefined()
    expect(next.missions?.recent).toEqual([
      {
        mission_id: "mission-new",
        intent_id: "intent-new",
        objective: "new mission",
        status: "sent",
        created_at: "2026-05-16T00:00:00Z",
        updated_at: "2026-05-16T00:00:00Z",
      },
    ])
  })

  test("init-only commands are handled locally without runtime dispatch", async () => {
    const runtime = new RejectingRuntime()
    const state = initialState("/tmp/demo")

    const next = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "initialize" })

    expect(next.lastCommand).toBe("initialize")
    expect(next.runtimeCommandError).toBeUndefined()
    expect(runtime.commandCalls).toBe(0)
    expect(runtime.sendCommandCalls).toBe(0)
  })

  test("post-submit refresh failure preserves accepted mission state", async () => {
    const state = initialState("/tmp/demo")

    const next = await applyRuntimeUiEffect(state, new RefreshFailAfterSubmitRuntime(), {
      type: "send-user-message",
      message: "start mission",
    })

    expect(next.header.activeMissionId).toBe("mission-created")
    expect(next.systemActions.some((action) => action.title === "mission submitted")).toBe(true)
    expect(next.runtimeCommandError).toBe("refresh failed after accepted mission")
  })

  test("status and missions commands do not run duplicate follow-up refreshes", async () => {
    const runtime = new CountingRuntime()
    const state = initialState("/tmp/demo")

    await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "status" })
    await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "missions" })

    expect(runtime.calls).toEqual(["runtime.status", "runtime.list_recent_missions"])
  })

  test("proposal commands create list select review and cancel redacted proposals", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "proposal target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-progress",
      args: ["fake-mission-1", claim.claim_id, "Title", "token=proposal-title", "--", "message", "token=proposal-secret"],
    })
    expect(state.proposals?.summary?.proposed_count).toBe(1)
    expect(state.proposals?.selectedProposal).toMatchObject({ status: "proposed", action_kind: "record_progress" })
    expect(JSON.stringify(state)).not.toContain("proposal-secret")

    const proposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "proposal-review",
      args: [proposalId, "Review", "title", "--", "Review", "summary"],
    })
    expect(state.proposals?.selectedProposal).toMatchObject({ proposal_id: proposalId, status: "review_requested" })
    expect(state.reviews?.pending[0]?.review_id).toBe(state.proposals?.selectedProposal?.review_id)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "proposal", args: [proposalId] })
    expect(state.proposals?.selectedProposal?.proposal_id).toBe(proposalId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-proposal", args: [proposalId, "reason", "token=cancel-secret"] })
    expect(state.proposals?.selectedProposal?.status).toBe("cancelled")
    expect(JSON.stringify(state)).not.toContain("cancel-secret")
  })

  test("fake runtime rejects cancelling terminal rejected proposals", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const proposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "Other",
      summary: "Other",
      proposedBy: "operator",
    }) as { proposal_id: string }
    const reviewed = await runtime.command("runtime.request_proposal_review", {
      proposalId: proposal.proposal_id,
      requestedBy: "operator",
    }) as { review_id: string }

    await runtime.command("runtime.reject_review_request", {
      reviewId: reviewed.review_id,
      decidedBy: "operator",
      reason: "no",
    })

    await expect(runtime.command("runtime.cancel_commander_proposal", { proposalId: proposal.proposal_id, reason: "late" })).rejects.toThrow("terminal proposal cannot cancel")
  })

  test("fake runtime rejects review requests on terminal proposals and keeps matching cancel retry idempotent", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const cancelled = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "Other",
      summary: "Other",
      proposedBy: "operator",
    }) as { proposal_id: string }

    await runtime.command("runtime.cancel_commander_proposal", { proposalId: cancelled.proposal_id, reason: "same" })
    await expect(runtime.command("runtime.cancel_commander_proposal", { proposalId: cancelled.proposal_id, reason: "same" })).resolves.toMatchObject({ status: "cancelled" })
    await expect(runtime.command("runtime.cancel_commander_proposal", { proposalId: cancelled.proposal_id, reason: "different" })).rejects.toThrow("terminal proposal cancellation conflicts")
    await expect(runtime.command("runtime.request_proposal_review", { proposalId: cancelled.proposal_id, requestedBy: "operator" })).rejects.toThrow("terminal proposal cannot request review")

    const rejected = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "Other",
      summary: "Other",
      proposedBy: "operator",
    }) as { proposal_id: string }
    const reviewed = await runtime.command("runtime.request_proposal_review", {
      proposalId: rejected.proposal_id,
      requestedBy: "operator",
    }) as { review_id: string }
    await runtime.command("runtime.reject_review_request", { reviewId: reviewed.review_id, decidedBy: "operator", reason: "no" })

    await expect(runtime.command("runtime.request_proposal_review", { proposalId: rejected.proposal_id, requestedBy: "operator" })).rejects.toThrow("terminal proposal cannot request review")
  })

  test("fake runtime rejects proposal payload ids that conflict with reviewed targets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    await runtime.command("runtime.submit_user_message", { message: "first" })
    const firstClaim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    await runtime.command("runtime.submit_user_message", { message: "second" })
    const secondClaim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-2", executorId: "executor" }) as { claim_id: string }
    const proposal = await runtime.command("runtime.create_commander_proposal", {
      missionId: "fake-mission-1",
      claimId: firstClaim.claim_id,
      actionKind: "record_progress",
      title: "Progress",
      summary: "Working",
      proposedBy: "operator",
      actionPayload: { mission_id: "fake-mission-2", claim_id: secondClaim.claim_id, message: "wrong target" },
    }) as { proposal_id: string }
    const reviewed = await runtime.command("runtime.request_proposal_review", {
      proposalId: proposal.proposal_id,
      requestedBy: "operator",
    }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: reviewed.review_id, decidedBy: "operator" })

    await expect(runtime.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })).rejects.toThrow("mission_id conflicts with reviewed proposal target")
  })

  test("apply proposal fails closed until linked review is approved then mutates mission through runtime", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "proposal target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-result",
      args: ["fake-mission-1", claim.claim_id, "Result", "proposal", "--", "summary"],
    })
    const proposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "proposal-review",
      args: [proposalId, "Review", "--", "Summary"],
    })
    const reviewId = state.proposals?.selectedProposal?.review_id ?? ""

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-proposal", args: [proposalId] })
    expect(state.proposals?.commandError).toContain("approved linked review")
    expect(state.missionExecution?.results).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "approve", args: [reviewId, "ok"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-proposal", args: [proposalId] })
    expect(state.proposals?.selectedProposal).toMatchObject({ proposal_id: proposalId, status: "applied" })
    expect(state.missionExecution?.results[0]).toMatchObject({ mission_id: "fake-mission-1", claim_id: claim.claim_id, summary: "summary" })
  })

  test("apply release proposal refreshes mission state from selected claim when proposal has no mission id", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "proposal target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "mission", args: ["fake-mission-1"] })
    expect(state.missionExecution?.claims[0]).toMatchObject({ claim_id: claim.claim_id, status: "active" })

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-release",
      args: [claim.claim_id, "Release", "--", "done"],
    })
    const proposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    expect(state.proposals?.selectedProposal?.mission_id).toBeUndefined()
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "proposal-review",
      args: [proposalId, "Review", "--", "Summary"],
    })
    const reviewId = state.proposals?.selectedProposal?.review_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "approve", args: [reviewId, "ok"] })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-proposal", args: [proposalId] })

    expect(state.proposals?.selectedProposal).toMatchObject({ proposal_id: proposalId, status: "applied" })
    expect(state.missionExecution?.selectedMissionId).toBe("fake-mission-1")
    expect(state.missionExecution?.claims[0]).toMatchObject({ claim_id: claim.claim_id, status: "released" })
  })

  test("missing proposal command args produce redacted proposal errors", async () => {
    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), new FakeRuntimeClient("/tmp/demo", "demo"), {
      type: "send-command",
      command: "propose-complete",
      args: ["mission-1", "Title", "token=proposal-secret"],
    })

    expect(state.proposals?.commandError).toContain("-- separator")
    expect(JSON.stringify(state)).not.toContain("proposal-secret")
  })

  test("proposal bundle commands create list select readiness review cancel and redact state", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "bundle target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-progress",
      args: ["fake-mission-1", claim.claim_id, "Progress", "--", "message"],
    })
    const proposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "create-bundle",
      args: ["Bundle", "token=bundle-title-secret", "--", "Summary", "secret=bundle-summary-secret"],
    })
    const bundleId = state.proposalBundles?.selectedBundle?.bundle_id ?? ""
    expect(state.proposalBundles?.summary?.open_count).toBe(1)
    expect(JSON.stringify(state)).not.toContain("bundle-title-secret")
    expect(JSON.stringify(state)).not.toContain("bundle-summary-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "bundle-add", args: [bundleId, proposalId] })
    expect(state.proposalBundles?.selectedBundle).toMatchObject({ bundle_id: bundleId, proposal_ids: [proposalId] })
    expect(state.proposalBundles?.readiness).toMatchObject({ proposed_count: 1, ready_to_apply: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "bundle-review", args: [bundleId] })
    expect(state.proposalBundles?.selectedBundle?.status).toBe("review_requested")
    expect(state.reviews?.pending).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "bundle", args: [bundleId] })
    expect(state.proposalBundles?.selectedBundle?.bundle_id).toBe(bundleId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-bundle", args: [bundleId, "reason", "token=bundle-cancel-secret"] })
    expect(state.proposalBundles?.selectedBundle?.status).toBe("cancelled")
    expect(state.proposals?.recent.find((proposal) => proposal.proposal_id === proposalId)?.status).toBe("review_requested")
    expect(JSON.stringify(state)).not.toContain("bundle-cancel-secret")
  })

  test("apply bundle fails closed until included proposal is approved then applies mission state", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "bundle apply target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-result",
      args: ["fake-mission-1", claim.claim_id, "Result", "--", "summary"],
    })
    const proposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "create-bundle", args: ["Apply", "bundle", "--", "Summary"] })
    const bundleId = state.proposalBundles?.selectedBundle?.bundle_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "bundle-add", args: [bundleId, proposalId] })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-bundle", args: [bundleId] })
    expect(state.proposalBundles?.commandError).toContain("not ready to apply")
    expect(state.missionExecution?.results).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "bundle-review", args: [bundleId] })
    const reviewId = state.proposals?.recent.find((proposal) => proposal.proposal_id === proposalId)?.review_id ?? state.reviews?.pending[0]?.review_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "approve", args: [reviewId, "ok"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-bundle", args: [bundleId] })

    expect(state.proposalBundles?.selectedBundle).toMatchObject({ bundle_id: bundleId, status: "applied" })
    expect(state.missionExecution?.results[0]).toMatchObject({ mission_id: "fake-mission-1", claim_id: claim.claim_id, summary: "summary" })
  })

  test("missing bundle command args produce redacted bundle errors", async () => {
    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), new FakeRuntimeClient("/tmp/demo", "demo"), {
      type: "send-command",
      command: "create-bundle",
      args: ["Title", "token=bundle-secret"],
    })

    expect(state.proposalBundles?.commandError).toContain("-- separator")
    expect(JSON.stringify(state)).not.toContain("bundle-secret")
  })

  test("research command loads projection, topics, and events", async () => {
    const runtime = new ResearchRuntime()
    const state = initialState("/tmp/demo")

    const next = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research" })

    expect(next.research?.projection?.mode).toBe("auto_rebuild")
    expect(next.research?.projection?.reason).toBe("[REDACTED]")
    expect(next.research?.topics[0]).toMatchObject({ id: "topic-secret", title: "[REDACTED]", status: "active" })
    expect(next.research?.events[0]).toMatchObject({ event_type: "note_added", entity_type: "note", entity_id: "note-1" })
    expect(JSON.stringify(next)).not.toContain("payload-secret")
  })

  test("research aggregate refresh preserves partial failures from earlier steps", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      research: {
        topics: [],
        selectedTopic: null,
        notes: [],
        events: [],
        commandError: "stale failure",
      },
    }

    const next = await applyRuntimeUiEffect(state, new ProjectionFailingResearchRuntime(), {
      type: "send-command",
      command: "research",
    })

    expect(next.research?.topics[0]?.id).toBe("topic-secret")
    expect(next.research?.events[0]?.event_id).toBe("event-1")
    expect(next.research?.commandError).toBe("projection failed [REDACTED]")
    expect(JSON.stringify(next)).not.toContain("projection-secret")
  })

  test("topic notes events projection and rebuild commands map to research runtime commands", async () => {
    const runtime = new ResearchRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "topic", args: ["topic-1"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "notes", args: ["topic-1", "runtime", "query"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-events" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "projection" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "rebuild-projection" })

    expect(state.research?.selectedTopic?.stats).toMatchObject({ source_count: 2, note_count: 3, artifact_count: 4 })
    expect(state.research?.notes[0]?.content).toContain("[REDACTED]")
    expect(state.research?.lastQuery).toBe("runtime query")
    expect(runtime.calls.some((call) => call.startsWith("research.rebuild_projection"))).toBe(true)
    expect(runtime.calls.filter((call) => call.startsWith("research.projection_status"))).toHaveLength(2)
  })

  test("notes command clears stale selected topic when target topic changes", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      research: {
        topics: [],
        notes: [],
        events: [],
        selectedTopicId: "topic-a",
        selectedTopic: {
          topic: { id: "topic-a", title: "Topic A", status: "active" },
          stats: {
            source_count: 1,
            note_count: 1,
            artifact_count: 0,
            report_count: 0,
            reviewed_source_count: 1,
            rejected_source_count: 0,
          },
        },
      },
    }

    const next = await applyRuntimeUiEffect(state, new ResearchRuntime(), {
      type: "send-command",
      command: "notes",
      args: ["topic-b", "runtime"],
    })

    expect(next.research?.selectedTopicId).toBe("topic-b")
    expect(next.research?.selectedTopic).toBeNull()
    expect(next.research?.notes[0]?.topic_id).toBe("topic-b")
  })

  test("notes command preserves selected topic when target topic matches", async () => {
    const selectedTopic = {
      topic: { id: "topic-1", title: "Topic 1", status: "active" },
      stats: {
        source_count: 1,
        note_count: 1,
        artifact_count: 0,
        report_count: 0,
        reviewed_source_count: 1,
        rejected_source_count: 0,
      },
    }
    const state = {
      ...initialState("/tmp/demo"),
      research: {
        topics: [],
        notes: [],
        events: [],
        selectedTopicId: "topic-1",
        selectedTopic,
      },
    }

    const next = await applyRuntimeUiEffect(state, new ResearchRuntime(), {
      type: "send-command",
      command: "notes",
      args: ["topic-1", "runtime"],
    })

    expect(next.research?.selectedTopic).toEqual(selectedTopic)
  })

  test("missing research command args produce redacted research errors", async () => {
    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), new ResearchRuntime(), {
      type: "send-command",
      command: "notes",
      args: ["topic-1"],
    })

    expect(next.research?.commandError).toBe("query is required")
    expect(next.systemActions.at(-1)).toMatchObject({ title: "research command error", status: "failed" })
  })

  test("failing research commands preserve runtime and mission state", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      runtimeStatus: { runtimeStatus: "started", mode: "active", projectName: "demo", specApproved: true, lockHeld: true },
      missions: { pending_count: 1, failed_count: 0, recent: [{ mission_id: "mission-1", status: "sent" }] },
    }

    const next = await applyRuntimeUiEffect(state, new FailingResearchRuntime(), { type: "send-command", command: "projection" })

    expect(next.runtimeStatus).toEqual(state.runtimeStatus)
    expect(next.missions).toEqual(state.missions)
    expect(next.research?.commandError).toBe("research failed [REDACTED]")
  })

  test("mission command loads selected mission details and execution records", async () => {
    const runtime = new MissionExecutionRuntime()
    const claim = await runtime.command("runtime.claim_mission", { missionId: "mission-1", executorId: "executor-1" }) as { claim_id: string }
    await runtime.command("runtime.record_mission_progress", { missionId: "mission-1", claimId: claim.claim_id, message: "started" })
    await runtime.command("runtime.submit_mission_result", { missionId: "mission-1", claimId: claim.claim_id, summary: "result summary" })

    const state: UiState = {
      ...initialState("/tmp/demo"),
      missionExecution: {
        selectedMissionId: "mission-old",
        selectedMission: { mission_id: "mission-old", status: "sent" },
        selectedClaimId: "claim-old",
        selectedResultId: "result-old",
        claims: [{ claim_id: "claim-old", mission_id: "mission-old", executor_id: "executor-old", status: "active" }],
        progress: [{ progress_id: "progress-old", mission_id: "mission-old", claim_id: "claim-old", message: "old progress" }],
        results: [{ result_id: "result-old", mission_id: "mission-old", claim_id: "claim-old", status: "submitted", summary: "old result" }],
      },
    }

    const next = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "mission",
      args: ["mission-1"],
    })

    expect(next.missionExecution?.selectedMission?.mission_id).toBe("mission-1")
    expect(next.missionExecution?.selectedClaimId).toBeUndefined()
    expect(next.missionExecution?.selectedResultId).toBeUndefined()
    expect(next.missionExecution?.claims[0]?.claim_id).toBe(claim.claim_id)
    expect(next.missionExecution?.progress[0]?.message).toBe("started")
    expect(next.missionExecution?.results[0]?.summary).toBe("result summary")
    expect(JSON.stringify(next.missionExecution)).not.toContain("mission-old")
  })

  test("mission lifecycle commands call runtime and refresh mission records", async () => {
    const runtime = new MissionExecutionRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "claim", args: ["mission-1", "token=executor-secret"] })
    const claimId = state.missionExecution?.selectedClaimId
    expect(claimId).toBe("claim-1")
    expect(state.missionExecution?.claims[0]?.executor_id).toBe("[REDACTED]")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "progress-add", args: ["mission-1", claimId!, "working", "api_key=progress-secret"] })
    expect(state.missionExecution?.progress[0]?.message).toBe("working [REDACTED]")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "result", args: ["mission-1", claimId!, "summary", "token=result-secret"] })
    const resultId = state.missionExecution?.selectedResultId
    expect(resultId).toBe("result-3")
    expect(state.missionExecution?.results[0]?.summary).toBe("summary [REDACTED]")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "complete", args: ["mission-1", "--result", resultId!, "done", "token=completion-secret"] })
    expect(state.missionExecution?.selectedMission?.status).toBe("completed")
    expect(state.missions?.completed_count).toBe(1)
    expect(JSON.stringify(state)).not.toContain("executor-secret")
    expect(JSON.stringify(state)).not.toContain("progress-secret")
    expect(JSON.stringify(state)).not.toContain("result-secret")
    expect(JSON.stringify(state)).not.toContain("completion-secret")
  })

  test("mission writes preserve selected mission when newer recent missions exist", async () => {
    const runtime = new MissionExecutionRuntime()
    const missionOne = runtime.missions.get("mission-1")!
    runtime.missions.delete("mission-1")
    runtime.missions.set("mission-new", {
      mission_id: "mission-new",
      intent_id: "intent-new",
      objective: "newer mission objective",
      status: "sent",
      created_at: "2026-05-16T00:01:00Z",
      updated_at: "2026-05-16T00:01:00Z",
    })
    runtime.missions.set("mission-1", missionOne)

    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, {
      type: "send-command",
      command: "claim",
      args: ["mission-1", "executor-1"],
    })

    expect(state.missions?.recent[0]?.mission_id).toBe("mission-new")
    expect(state.missionExecution?.selectedMissionId).toBe("mission-1")
    expect(state.header.activeMissionId).toBe("mission-1")
  })

  test("mission fail cancel and release commands update execution state without colliding with local cancel", async () => {
    const runtime = new MissionExecutionRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "claim", args: ["mission-1", "executor-1"] })
    const claimId = state.missionExecution?.selectedClaimId!

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "release-claim", args: [claimId, "token=release-secret"] })
    expect(state.missionExecution?.claims[0]).toMatchObject({ claim_id: claimId, status: "released", release_reason: "[REDACTED]" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "fail", args: ["mission-1", "token=fail-secret"] })
    expect(state.missionExecution?.selectedMission?.status).toBe("failed")
    expect(state.missions?.failed_count).toBe(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-mission", args: ["mission-1", "token=cancel-secret"] })
    expect(state.missionExecution?.selectedMission?.status).toBe("cancelled")

    const localCancel = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel" })
    expect(localCancel.missionExecution?.selectedMission?.status).toBe("cancelled")
    expect(localCancel.runtimeCommandError).toBeUndefined()
    expect(JSON.stringify(localCancel)).not.toContain("release-secret")
    expect(JSON.stringify(localCancel)).not.toContain("fail-secret")
    expect(JSON.stringify(localCancel)).not.toContain("cancel-secret")
  })

  test("review commands load create select and decide review requests", async () => {
    const runtime = new MissionExecutionRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "request-review", args: ["mission-1", "Approve", "mission", "--", "summary", "token=review-summary-secret"] })
    const reviewId = state.reviews?.selectedReview?.review_id ?? ""
    expect(reviewId).toBe("review-1")
    expect(state.reviews?.pending).toHaveLength(1)
    expect(JSON.stringify(state)).not.toContain("review-summary-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "review", args: [reviewId] })
    expect(state.reviews?.selectedReview?.title).toBe("Approve mission")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "approve", args: [reviewId, "ok", "secret=approve-secret"] })
    expect(state.reviews?.selectedReview?.status).toBe("approved")
    expect(state.reviews?.summary).toMatchObject({ pending_count: 0, approved_count: 1 })
    expect(JSON.stringify(state)).not.toContain("approve-secret")
  })

  test("review reject cancel and missing argument errors stay in review state", async () => {
    const runtime = new MissionExecutionRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "request-review", args: ["mission-1", "Reject", "me", "--", "summary"] })
    const rejectId = state.reviews?.selectedReview?.review_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "reject", args: [rejectId, "no"] })
    expect(state.reviews?.selectedReview?.status).toBe("rejected")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "request-review", args: ["mission-1", "Cancel", "me", "--", "summary"] })
    const cancelId = state.reviews?.selectedReview?.review_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-review", args: [cancelId, "operator", "cancelled"] })
    expect(state.reviews?.selectedReview?.status).toBe("cancelled")

    const beforeMission = state.missionExecution
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "request-review", args: ["mission-1", "missing", "separator"] })
    expect(state.reviews?.commandError).toContain("-- separator is required")
    expect(state.missionExecution).toEqual(beforeMission)
  })

  test("fake runtime client exercises review surface without leaking secrets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "request-review", args: ["mission-fake", "Title", "token=fake-title-secret", "--", "Summary", "secret=fake-summary-secret"] })
    const reviewId = state.reviews?.selectedReview?.review_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-review", args: [reviewId, "secret=fake-reason-secret"] })

    expect(state.reviews?.selectedReview).toMatchObject({ review_id: reviewId, status: "cancelled" })
    expect(JSON.stringify(state)).not.toContain("fake-title-secret")
    expect(JSON.stringify(state)).not.toContain("fake-summary-secret")
    expect(JSON.stringify(state)).not.toContain("fake-reason-secret")
  })

  test("release claim refreshes with raw mission id while storing redacted mission state", async () => {
    const runtime = new MissionExecutionRuntime()
    const missionId = "token=mission-secret"
    runtime.missions.set(missionId, {
      mission_id: missionId,
      intent_id: "intent-secret",
      objective: "secret mission objective",
      status: "sent",
      created_at: "2026-05-16T00:00:00Z",
      updated_at: "2026-05-16T00:00:00Z",
    })

    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, {
      type: "send-command",
      command: "claim",
      args: [missionId, "executor-1"],
    })
    const claimId = state.missionExecution?.selectedClaimId!
    const beforeReleaseCallCount = runtime.calls.length

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "release-claim",
      args: [claimId, "handoff"],
    })
    const releaseRefreshCalls = runtime.calls.slice(beforeReleaseCallCount)

    expect(state.missionExecution?.commandError).toBeUndefined()
    expect(state.missionExecution?.selectedMissionId).toBe("[REDACTED]")
    expect(state.missionExecution?.selectedMission?.mission_id).toBe("[REDACTED]")
    expect(releaseRefreshCalls).toContain(`runtime.get_mission:{"missionId":"${missionId}"}`)
    expect(JSON.stringify(state)).not.toContain("mission-secret")
  })

  test("complete command treats normal result-like words as summary text", async () => {
    const runtime = new MissionExecutionRuntime()

    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, {
      type: "send-command",
      command: "complete",
      args: ["mission-1", "resulting", "summary", "text"],
    })

    const call = runtime.calls.find((item) => item.startsWith("runtime.complete_mission:"))
    expect(call).toBe('runtime.complete_mission:{"missionId":"mission-1","summary":"resulting summary text"}')
    expect(next.missionExecution?.selectedMission?.completion_summary).toBe("resulting summary text")
  })

  test("complete command accepts explicit result id flags", async () => {
    const runtime = new MissionExecutionRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "complete", args: ["mission-1", "--result", "result-1", "final", "summary"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "complete", args: ["mission-1", "--result=result-2", "other", "summary"] })

    expect(runtime.calls).toContain('runtime.complete_mission:{"missionId":"mission-1","resultId":"result-1","summary":"final summary"}')
    expect(runtime.calls).toContain('runtime.complete_mission:{"missionId":"mission-1","resultId":"result-2","summary":"other summary"}')
    expect(JSON.stringify(state)).not.toContain("result-secret")
  })

  test("complete command reports missing explicit result id clearly", async () => {
    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), new MissionExecutionRuntime(), {
      type: "send-command",
      command: "complete",
      args: ["mission-1", "--result"],
    })

    expect(next.missionExecution?.commandError).toBe("resultId is required")
    expect(next.systemActions.at(-1)).toMatchObject({ title: "mission execution command error", status: "failed" })
  })

  test("complete command reports missing mission id clearly", async () => {
    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), new MissionExecutionRuntime(), {
      type: "send-command",
      command: "complete",
      args: [],
    })

    expect(next.missionExecution?.commandError).toBe("missionId is required")
    expect(next.systemActions.at(-1)).toMatchObject({ title: "mission execution command error", status: "failed" })
  })

  test("complete command rejects result flag as missing mission id", async () => {
    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), new MissionExecutionRuntime(), {
      type: "send-command",
      command: "complete",
      args: ["--result", "result-1"],
    })

    expect(next.missionExecution?.commandError).toBe("missionId is required")
    expect(next.systemActions.at(-1)).toMatchObject({ title: "mission execution command error", status: "failed" })
  })

  test("fake runtime release resets running mission after progress or result and preserves terminal statuses", async () => {
    const progressRuntime = new FakeRuntimeClient("/tmp/demo", "demo")
    await progressRuntime.command("runtime.claim_mission", { missionId: "mission-progress", executorId: "executor-1" })
    await progressRuntime.command("runtime.record_mission_progress", { missionId: "mission-progress", claimId: "fake-claim-1", message: "working" })
    await progressRuntime.command("runtime.release_mission_claim", { claimId: "fake-claim-1", reason: "done" })
    await expect(progressRuntime.command("runtime.get_mission", { missionId: "mission-progress" })).resolves.toMatchObject({ status: "sent" })
    await expect(progressRuntime.command("runtime.status")).resolves.toMatchObject({ missions: { pending_count: 1, active_claim_count: 0 } })

    const resultRuntime = new FakeRuntimeClient("/tmp/demo", "demo")
    await resultRuntime.command("runtime.claim_mission", { missionId: "mission-result", executorId: "executor-1" })
    await resultRuntime.command("runtime.submit_mission_result", { missionId: "mission-result", claimId: "fake-claim-1", summary: "ready" })
    await resultRuntime.command("runtime.release_mission_claim", { claimId: "fake-claim-1", reason: "done" })
    await expect(resultRuntime.command("runtime.get_mission", { missionId: "mission-result" })).resolves.toMatchObject({ status: "sent" })
    await expect(resultRuntime.command("runtime.claim_mission", { missionId: "mission-result", executorId: "executor-2" })).resolves.toMatchObject({ status: "active" })

    const completedRuntime = new FakeRuntimeClient("/tmp/demo", "demo")
    await completedRuntime.command("runtime.claim_mission", { missionId: "mission-completed", executorId: "executor-1" })
    await completedRuntime.command("runtime.submit_mission_result", { missionId: "mission-completed", claimId: "fake-claim-1", summary: "ready" })
    await completedRuntime.command("runtime.complete_mission", { missionId: "mission-completed" })
    await completedRuntime.command("runtime.release_mission_claim", { claimId: "fake-claim-1", reason: "late" })
    await expect(completedRuntime.command("runtime.get_mission", { missionId: "mission-completed" })).resolves.toMatchObject({ status: "completed" })

    const failedRuntime = new FakeRuntimeClient("/tmp/demo", "demo")
    await failedRuntime.command("runtime.claim_mission", { missionId: "mission-failed", executorId: "executor-1" })
    await failedRuntime.command("runtime.fail_mission", { missionId: "mission-failed", reason: "failed" })
    await failedRuntime.command("runtime.release_mission_claim", { claimId: "fake-claim-1", reason: "late" })
    await expect(failedRuntime.command("runtime.get_mission", { missionId: "mission-failed" })).resolves.toMatchObject({ status: "failed" })

    const cancelledRuntime = new FakeRuntimeClient("/tmp/demo", "demo")
    await cancelledRuntime.command("runtime.claim_mission", { missionId: "mission-cancelled", executorId: "executor-1" })
    await cancelledRuntime.command("runtime.cancel_mission", { missionId: "mission-cancelled", reason: "cancelled" })
    await cancelledRuntime.command("runtime.release_mission_claim", { claimId: "fake-claim-1", reason: "late" })
    await expect(cancelledRuntime.command("runtime.get_mission", { missionId: "mission-cancelled" })).resolves.toMatchObject({ status: "cancelled" })
  })

  test("fake runtime rejects completing active claim with stale result from released claim", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const firstClaim = await runtime.command("runtime.claim_mission", { missionId: "mission-stale-result", executorId: "executor-1" }) as { claim_id: string }
    const staleResult = await runtime.command("runtime.submit_mission_result", {
      missionId: "mission-stale-result",
      claimId: firstClaim.claim_id,
      summary: "ready",
    }) as { result_id: string }
    await runtime.command("runtime.release_mission_claim", { claimId: firstClaim.claim_id, reason: "handoff" })
    await runtime.command("runtime.claim_mission", { missionId: "mission-stale-result", executorId: "executor-2" })

    await expect(runtime.command("runtime.complete_mission", {
      missionId: "mission-stale-result",
      resultId: staleResult.result_id,
    })).rejects.toThrow("result must belong to active claim")
    await expect(runtime.command("runtime.get_mission", { missionId: "mission-stale-result" })).resolves.toMatchObject({ status: "claimed" })
  })

  test("mission list commands load bounded execution rows", async () => {
    const runtime = new MissionExecutionRuntime()
    const claim = await runtime.command("runtime.claim_mission", { missionId: "mission-1", executorId: "executor-1" }) as { claim_id: string }
    await runtime.command("runtime.record_mission_progress", { missionId: "mission-1", claimId: claim.claim_id, message: "progress row" })
    await runtime.command("runtime.submit_mission_result", { missionId: "mission-1", claimId: claim.claim_id, summary: "result row" })
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "claims", args: ["mission-1"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "progress", args: ["mission-1"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "results", args: ["mission-1"] })

    expect(state.missionExecution?.claims).toHaveLength(1)
    expect(state.missionExecution?.progress).toHaveLength(1)
    expect(state.missionExecution?.results).toHaveLength(1)
  })

  test("mission list commands clear stale selected mission when target changes", async () => {
    const runtime = new MissionExecutionRuntime()
    let state: UiState = {
      ...initialState("/tmp/demo"),
      missionExecution: {
        selectedMissionId: "mission-a",
        selectedMission: {
          mission_id: "mission-a",
          status: "sent",
          objective: "old mission",
        },
        selectedClaimId: "claim-a",
        selectedResultId: "result-a",
        claims: [{ claim_id: "claim-a", mission_id: "mission-a", executor_id: "executor-a", status: "active" }],
        progress: [{ progress_id: "progress-a", mission_id: "mission-a", claim_id: "claim-a", message: "old progress" }],
        results: [{ result_id: "result-a", mission_id: "mission-a", claim_id: "claim-a", status: "submitted", summary: "old result" }],
      },
    }

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "claims", args: ["mission-1"] })
    expect(state.missionExecution?.selectedMissionId).toBe("mission-1")
    expect(state.missionExecution?.selectedMission).toBeNull()
    expect(state.missionExecution?.selectedClaimId).toBeUndefined()
    expect(state.missionExecution?.selectedResultId).toBeUndefined()
    expect(state.header.activeMissionId).toBe("mission-1")
    expect(state.missionExecution?.progress).toEqual([])
    expect(state.missionExecution?.results).toEqual([])

    state = {
      ...state,
      missionExecution: {
        ...state.missionExecution!,
        selectedMissionId: "mission-a",
        selectedMission: {
          mission_id: "mission-a",
          status: "sent",
          objective: "old mission",
        },
        selectedClaimId: "claim-a",
        selectedResultId: "result-a",
        claims: [{ claim_id: "claim-a", mission_id: "mission-a", executor_id: "executor-a", status: "active" }],
        progress: [{ progress_id: "progress-a", mission_id: "mission-a", claim_id: "claim-a", message: "old progress" }],
        results: [{ result_id: "result-a", mission_id: "mission-a", claim_id: "claim-a", status: "submitted", summary: "old result" }],
      },
    }

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "progress", args: ["mission-1"] })
    expect(state.missionExecution?.selectedMissionId).toBe("mission-1")
    expect(state.missionExecution?.selectedMission).toBeNull()
    expect(state.missionExecution?.selectedClaimId).toBeUndefined()
    expect(state.missionExecution?.selectedResultId).toBeUndefined()
    expect(state.header.activeMissionId).toBe("mission-1")
    expect(state.missionExecution?.claims).toEqual([])
    expect(state.missionExecution?.results).toEqual([])

    state = {
      ...state,
      missionExecution: {
        ...state.missionExecution!,
        selectedMissionId: "mission-a",
        selectedMission: {
          mission_id: "mission-a",
          status: "sent",
          objective: "old mission",
        },
        selectedClaimId: "claim-a",
        selectedResultId: "result-a",
        claims: [{ claim_id: "claim-a", mission_id: "mission-a", executor_id: "executor-a", status: "active" }],
        progress: [{ progress_id: "progress-a", mission_id: "mission-a", claim_id: "claim-a", message: "old progress" }],
        results: [{ result_id: "result-a", mission_id: "mission-a", claim_id: "claim-a", status: "submitted", summary: "old result" }],
      },
    }

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "results", args: ["mission-1"] })
    expect(state.missionExecution?.selectedMissionId).toBe("mission-1")
    expect(state.missionExecution?.selectedMission).toBeNull()
    expect(state.missionExecution?.selectedClaimId).toBeUndefined()
    expect(state.missionExecution?.selectedResultId).toBeUndefined()
    expect(state.header.activeMissionId).toBe("mission-1")
    expect(state.missionExecution?.claims).toEqual([])
    expect(state.missionExecution?.progress).toEqual([])
  })

  test("missing mission command args produce redacted mission execution errors", async () => {
    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), new MissionExecutionRuntime(), {
      type: "send-command",
      command: "progress-add",
      args: ["mission-1", "claim-1"],
    })

    expect(next.missionExecution?.commandError).toBe("message is required")
    expect(next.systemActions.at(-1)).toMatchObject({ title: "mission execution command error", status: "failed" })
  })

  test("failing mission commands preserve runtime mission and research state", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      runtimeStatus: { runtimeStatus: "started", mode: "active", projectName: "demo", specApproved: true, lockHeld: true },
      missions: { pending_count: 1, failed_count: 0, recent: [{ mission_id: "mission-old", status: "sent" }] },
      research: {
        topics: [{ id: "topic-1", title: "Topic 1", status: "active" }],
        selectedTopic: null,
        notes: [],
        events: [],
      },
    }

    const next = await applyRuntimeUiEffect(state, new FailingMissionExecutionRuntime(), { type: "send-command", command: "claim", args: ["mission-1", "executor-1"] })

    expect(next.runtimeStatus).toEqual(state.runtimeStatus)
    expect(next.missions).toEqual(state.missions)
    expect(next.research).toEqual(state.research)
    expect(next.missionExecution?.commandError).toBe("claim failed [REDACTED]")
  })
})
