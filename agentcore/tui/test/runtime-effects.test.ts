import { describe, expect, test } from "bun:test"
import type { RuntimeEvent } from "../src/events"
import { applyRuntimeUiEffect } from "../src/runtime-effects"
import { FakeRuntimeClient, orderQueueItems, type RuntimeClient } from "../src/runtime"
import { layoutSnapshot } from "../src/snapshot"
import { snapshotUiState } from "../src/state-snapshot"
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

class CommanderQueueLimitRuntime implements RuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (name === "runtime.commander_queue") {
      const limit = typeof payload?.limit === "number" ? payload.limit : 25
      return {
        queue: "needs_review",
        total_considered: limit,
        limit,
        items: Array.from({ length: limit }, (_, index) => ({
          queue: "needs_review",
          target_type: "review",
          target_id: `review_${index + 1}`,
          title: `review ${index + 1}`,
          summary: `summary ${index + 1}`,
          status: "pending",
          related_ids: { review_id: [`review_${index + 1}`] },
          created_at: "2026-05-22T00:00:00.000Z",
          updated_at: "2026-05-22T00:00:00.000Z",
        })),
      }
    }
    return { ok: true }
  }
}

class LongSuggestedCommandRuntime implements RuntimeClient {
  requestedProposalId: string | undefined
  readonly proposalId = `proposal_${"x".repeat(220)}`

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (name === "runtime.commander_target_context") {
      return {
        target_type: "proposal",
        target_id: this.proposalId,
        found: true,
        title: "Long proposal",
        summary: "Long command suggestion",
        status: "proposed",
        related_ids: {},
        queue_membership: [],
        audit_event_count: 0,
        recent_audit_events: [],
        suggested_commands: [
          {
            label: "Open long proposal",
            command: `/proposal ${this.proposalId}`,
            command_type: "read",
          },
        ],
        missing_links: [],
      }
    }
    if (name === "runtime.get_commander_proposal") {
      this.requestedProposalId = typeof payload?.proposalId === "string" ? payload.proposalId : undefined
      return {
        proposal_id: this.proposalId,
        status: "proposed",
        action_kind: "record_progress",
        title: "Long proposal",
        summary: "Long command suggestion",
        proposed_by: "operator",
        created_at: "2026-05-23T00:00:00.000Z",
        updated_at: "2026-05-23T00:00:00.000Z",
      }
    }
    return { ok: true }
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

class ExternalApiRuntime implements RuntimeClient {
  readonly calls: Array<{ name: string; payload?: Record<string, unknown> }> = []
  private readonly audit: unknown[] = []
  private readonly ingestions: unknown[] = []

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, payload })
    switch (name) {
      case "runtime.list_external_api_connectors":
        return [
          {
            connector_id: "mock-research-api",
            title: "Mock research API",
            base_url: "https://api.example.test",
            allowed_hosts: ["api.example.test"],
            allowed_methods: ["GET", "POST"],
            default_headers: { Authorization: "Bearer default-header-secret" },
            timeout_ms: 5000,
            max_response_bytes: 4096,
            credential_refs: [],
          },
        ]
      case "runtime.get_external_api_connector":
        return {
          connector_id: payload?.connectorId,
          title: "Mock research API token=connector-secret",
          base_url: "https://api.example.test",
          allowed_hosts: ["api.example.test"],
          allowed_methods: ["GET", "POST"],
          default_headers: { Authorization: "Bearer selected-default-header-secret" },
          timeout_ms: 5000,
          max_response_bytes: 4096,
          credential_refs: [{ name: "test-key", source: "env", inject_as: "header", target_name: "Authorization", env_name: "NXL_TEST_TOKEN" }],
        }
      case "runtime.preview_external_api_request":
        return {
          connector_id: payload?.connectorId,
          method: payload?.method,
          url: `https://api.example.test${payload?.path}?token=query-secret`,
          allowed: true,
          blockers: [],
          redacted_headers: { Authorization: "[REDACTED]" },
          has_body: false,
          body_bytes: 0,
          credential_refs_used: ["test-key"],
        }
      case "runtime.execute_external_api_request": {
        const result = {
          request_id: "fake-api-request-1",
          connector_id: payload?.connectorId,
          method: payload?.method,
          url: `https://api.example.test${payload?.path}`,
          status_code: payload?.dryRun ? undefined : 200,
          ok: true,
          response_bytes: payload?.dryRun ? undefined : 36,
          response_preview: payload?.dryRun ? "dry run: transport not called" : "token=response-secret value=ok",
          dry_run: payload?.dryRun === true,
          created_at: "1970-01-01T00:00:00.000Z",
        }
        if (!result.dry_run) this.audit.unshift({ ...result, requested_by: "operator" })
        return result
      }
      case "runtime.list_external_api_audit":
        return this.audit
      case "runtime.preview_external_api_research_ingestion":
        return {
          connector_id: payload?.connectorId,
          topic_id: payload?.topicId,
          method: payload?.method,
          url: `https://api.example.test${payload?.path}?token=query-secret`,
          allowed: true,
          blockers: [],
          would_create_source: true,
          would_create_note: true,
          max_ingested_bytes: 4096,
          credential_refs_used: ["test-key"],
          redacted_headers: { Authorization: "[REDACTED]" },
        }
      case "runtime.execute_external_api_research_ingestion": {
        const result = {
          ingestion_id: "fake-api-ingestion-1",
          request_id: payload?.dryRun ? undefined : "fake-api-request-1",
          connector_id: payload?.connectorId,
          topic_id: payload?.topicId,
          source_id: payload?.dryRun ? undefined : "source-1",
          note_id: payload?.dryRun ? undefined : "note-1",
          artifact_id: payload?.dryRun ? undefined : "artifact-1",
          audit_request_id: payload?.dryRun ? undefined : "fake-api-request-1",
          ok: true,
          dry_run: payload?.dryRun === true,
          ingested_bytes: payload?.dryRun ? 0 : 32,
          response_preview: payload?.dryRun ? "dry run: transport not called and ResearchDb not written" : "token=response-secret value=ok",
          created_at: "1970-01-01T00:00:00.000Z",
        }
        if (!result.dry_run) this.ingestions.unshift({ ...result, requested_by: "operator" })
        return result
      }
      case "runtime.list_external_api_research_ingestions":
        return this.ingestions
      default:
        return { ok: true }
    }
  }
}

class ResearchSynthesisRuntime implements RuntimeClient {
  readonly calls: Array<{ name: string; payload?: Record<string, unknown> }> = []
  private readonly syntheses: unknown[] = []
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, payload })
    switch (name) {
      case "runtime.preview_research_synthesis":
        return {
          topic_id: payload?.topicId,
          topic_title: "Topic token=topic-secret",
          evidence_counts: { sources: 1, notes: 1, artifacts: 1, ingestions: 1 },
          context_bytes: 128,
          max_context_bytes: 32768,
          included_evidence_ids: ["source-1", "note-1", "artifact-1", "ingest-1"],
          excluded_evidence_count: 0,
          blockers: [],
          redacted_context_preview: "context token=context-secret",
        }
      case "runtime.execute_research_synthesis": {
        const result = {
          synthesis_id: "synthesis-1",
          topic_id: payload?.topicId,
          provider_id: "fake-research-synthesis",
          source_note_id: "note-synth-1",
          artifact_id: "artifact-synth-1",
          proposal_ids: payload?.createProposals ? ["proposal-synth-1"] : [],
          title: "Synthesis token=title-secret",
          summary: "summary token=summary-secret",
          findings: ["finding token=finding-secret"],
          risks: ["bounded risk"],
          open_questions: ["open question"],
          recommended_actions: [{ title: "Checkpoint", summary: "operator checkpoint", action_kind: "operator_checkpoint", evidence_ids: ["note-1"] }],
          context_hash: "context-hash",
          output_hash: "output-hash",
          created_at: "1970-01-01T00:00:00.000Z",
          requested_by: "operator token=requester-secret",
        }
        this.syntheses.unshift({
          synthesis_id: result.synthesis_id,
          topic_id: result.topic_id,
          provider_id: result.provider_id,
          source_note_id: result.source_note_id,
          artifact_id: result.artifact_id,
          proposal_ids: result.proposal_ids,
          title: result.title,
          summary_preview: result.summary,
          created_at: result.created_at,
          requested_by: result.requested_by,
        })
        return result
      }
      case "runtime.get_research_synthesis":
        return this.syntheses.length > 0
          ? {
            synthesis_id: payload?.synthesisId,
            topic_id: "topic-1",
            provider_id: "fake-research-synthesis",
            source_note_id: "note-synth-1",
            artifact_id: "artifact-synth-1",
            proposal_ids: ["proposal-synth-1"],
            title: "Loaded synthesis",
            summary: "loaded summary",
            findings: ["loaded finding"],
            risks: [],
            open_questions: [],
            recommended_actions: [],
            context_hash: "context-hash",
            output_hash: "output-hash",
            created_at: "1970-01-01T00:00:00.000Z",
            requested_by: "operator",
          }
          : null
      case "runtime.list_research_syntheses":
        return this.syntheses
      case "runtime.proposal_status":
        return { proposed_count: 1, review_requested_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0, applied_count: 0, last_proposal_id: "proposal-synth-1" }
      case "runtime.list_commander_proposals":
        return payload?.limit ? [{ proposal_id: "proposal-synth-1", action_kind: "operator_checkpoint", title: "Checkpoint", summary: "proposal", proposed_by: "operator", status: "proposed", created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z" }] : []
      default:
        return { ok: true }
    }
  }
}

class CommanderCycleRuntime implements RuntimeClient {
  readonly calls: Array<{ name: string; payload?: Record<string, unknown> }> = []
  private readonly cycles: unknown[] = []
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, payload })
    switch (name) {
      case "runtime.preview_commander_cycle":
        return {
          objective: payload?.objective,
          topic_id: payload?.topicId,
          mission_id: payload?.missionId,
          context_counts: { sources: 1, notes: 1, artifacts: 0, syntheses: 1, proposals: 0, reviews: 0, queues: 0 },
          context_bytes: 192,
          max_context_bytes: 49152,
          included_evidence_ids: ["note-1"],
          included_synthesis_ids: ["synthesis-1"],
          blockers: [],
          redacted_context_preview: "context token=context-secret",
        }
      case "runtime.execute_commander_cycle": {
        const result = {
          cycle_id: "cycle-1",
          provider_id: "fake-commander-cycle",
          objective: payload?.objective,
          topic_id: payload?.topicId,
          mission_id: payload?.missionId,
          title: "Cycle token=title-secret",
          summary: "summary token=summary-secret",
          findings: ["finding token=finding-secret"],
          risks: ["bounded risk"],
          recommended_actions: [{
            title: "Checkpoint",
            summary: "operator checkpoint",
            action_kind: "operator_checkpoint",
            rationale: "keep review/apply authority",
            evidence_ids: ["note-1"],
            synthesis_ids: ["synthesis-1"],
          }],
          proposal_ids: payload?.createProposals ? ["proposal-cycle-1"] : [],
          bundle_id: payload?.createBundle ? "bundle-cycle-1" : undefined,
          context_hash: "context-hash",
          output_hash: "output-hash",
          created_at: "1970-01-01T00:00:00.000Z",
          requested_by: "operator token=requester-secret",
        }
        this.cycles.unshift({
          cycle_id: result.cycle_id,
          provider_id: result.provider_id,
          objective_preview: result.objective,
          topic_id: result.topic_id,
          mission_id: result.mission_id,
          title: result.title,
          summary_preview: result.summary,
          proposal_ids: result.proposal_ids,
          bundle_id: result.bundle_id,
          created_at: result.created_at,
          requested_by: result.requested_by,
        })
        return result
      }
      case "runtime.get_commander_cycle":
        return this.cycles.length > 0
          ? {
            cycle_id: payload?.cycleId,
            provider_id: "fake-commander-cycle",
            objective: "loaded objective",
            topic_id: "topic-1",
            title: "Loaded cycle",
            summary: "loaded summary",
            findings: ["loaded finding"],
            risks: [],
            recommended_actions: [],
            proposal_ids: ["proposal-cycle-1"],
            bundle_id: "bundle-cycle-1",
            context_hash: "context-hash",
            output_hash: "output-hash",
            created_at: "1970-01-01T00:00:00.000Z",
            requested_by: "operator",
          }
          : null
      case "runtime.list_commander_cycles":
        return this.cycles
      case "runtime.proposal_status":
        return { proposed_count: 1, review_requested_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0, applied_count: 0, last_proposal_id: "proposal-cycle-1" }
      case "runtime.list_commander_proposals":
        return payload?.limit ? [{ proposal_id: "proposal-cycle-1", action_kind: "operator_checkpoint", title: "Checkpoint", summary: "proposal", proposed_by: "operator", status: "proposed", created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z" }] : []
      case "runtime.bundle_status":
        return { open_count: 1, ready_count: 0, review_requested_count: 0, approved_count: 0, rejected_count: 0, applied_count: 0, partially_applied_count: 0, cancelled_count: 0, last_bundle_id: "bundle-cycle-1" }
      case "runtime.list_proposal_bundles":
        return payload?.limit ? [{ bundle_id: "bundle-cycle-1", title: "Cycle bundle", summary: "bundle", status: "open", proposal_ids: ["proposal-cycle-1"], review_ids: [], created_by: "operator", created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z" }] : []
      default:
        return { ok: true }
    }
  }
}

class OpenCodeHandoffRuntime implements RuntimeClient {
  readonly calls: Array<{ name: string; payload?: Record<string, unknown> }> = []
  private readonly handoffs: unknown[] = []
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, payload })
    switch (name) {
      case "runtime.preview_opencode_handoff":
        return {
          proposal_id: payload?.proposalId,
          eligible: payload?.proposalId === "proposal-approved",
          blockers: payload?.proposalId === "proposal-approved" ? [] : ["linked review must be approved token=blocker-secret"],
          action_kind: "opencode_handoff",
          proposal_status: payload?.proposalId === "proposal-approved" ? "approved" : "review_requested",
          review_id: "review-1",
          review_status: payload?.proposalId === "proposal-approved" ? "approved" : "pending",
          objective_preview: "implement handoff token=objective-secret",
          evidence_ids: ["evidence-1"],
          source_cycle_id: "cycle-1",
          would_create_mission: payload?.proposalId === "proposal-approved",
          would_send_to_adapter: payload?.proposalId === "proposal-approved",
        }
      case "runtime.execute_opencode_handoff": {
        if (payload?.proposalId !== "proposal-approved") throw new Error("linked review must be approved token=execute-secret")
        const result = {
          handoff_id: payload?.dryRun ? "dry-run" : "handoff-1",
          proposal_id: payload?.proposalId,
          review_id: "review-1",
          mission_id: payload?.dryRun ? undefined : "mission-handoff-1",
          intent_id: payload?.dryRun ? undefined : "intent-handoff-1",
          objective_preview: "implement handoff token=objective-secret",
          sent: payload?.dryRun !== true,
          dry_run: payload?.dryRun === true,
          created_at: "1970-01-01T00:00:00.000Z",
          requested_by: "operator token=requester-secret",
          source_cycle_id: "cycle-1",
          evidence_ids: ["evidence-1"],
        }
        if (!result.dry_run) this.handoffs.unshift({
          handoff_id: result.handoff_id,
          proposal_id: result.proposal_id,
          mission_id: result.mission_id,
          intent_id: result.intent_id,
          sent: result.sent,
          created_at: result.created_at,
          requested_by: result.requested_by,
          source_cycle_id: result.source_cycle_id,
        })
        return result
      }
      case "runtime.get_opencode_handoff":
        return {
          handoff_id: payload?.handoffId,
          proposal_id: "proposal-approved",
          review_id: "review-1",
          mission_id: "mission-handoff-1",
          intent_id: "intent-handoff-1",
          objective_preview: "loaded objective",
          sent: true,
          dry_run: false,
          created_at: "1970-01-01T00:00:00.000Z",
          requested_by: "operator",
          evidence_ids: [],
        }
      case "runtime.list_opencode_handoffs":
        return this.handoffs
      case "runtime.get_opencode_handoff_followup":
        return {
          handoff_id: payload?.handoffId,
          proposal_id: "proposal-approved",
          review_id: "review-1",
          mission_id: "mission-handoff-1",
          intent_id: "intent-handoff-1",
          followup_status: "result_submitted",
          handoff_sent: true,
          proposal_status: "applied",
          review_status: "approved",
          mission_status: "running",
          active_claim_id: "claim-handoff-1",
          latest_progress_id: "progress-handoff-1",
          latest_result_id: "result-handoff-1",
          result_count: 1,
          progress_count: 1,
          blockers: ["blocked token=followup-blocker-secret"],
          suggested_commands: [{ label: "Show mission", command: "/mission mission-handoff-1 token=followup-command-secret", command_type: "read" }],
          source_cycle_id: "cycle-1",
          evidence_ids: ["evidence-token=followup-evidence-secret"],
          updated_at: "1970-01-01T00:00:00.000Z",
        }
      case "runtime.list_opencode_handoff_followups":
        return [{
          handoff_id: "handoff-1",
          proposal_id: "proposal-approved",
          review_id: "review-1",
          mission_id: "mission-handoff-1",
          followup_status: "sent",
          handoff_sent: true,
          result_count: 0,
          progress_count: 0,
          blockers: [],
          suggested_commands: [{ label: "Show mission", command: "/mission mission-handoff-1", command_type: "read" }],
          evidence_ids: [],
          updated_at: "1970-01-01T00:00:00.000Z",
        }]
      case "runtime.opencode_handoff_followup_summary":
        return { sent_count: 1, running_count: 0, result_submitted_count: 1, completed_count: 0, failed_count: 0, blocked_count: 0, stale_count: 1, last_handoff_id: "handoff-1" }
      case "runtime.preview_opencode_handoff_readiness":
        return {
          readiness_id: "readiness-1",
          status: payload?.proposalId === "proposal-pending" ? "needs_review" : "ready",
          can_execute_now: false,
          proposal_id: payload?.proposalId,
          mission_id: payload?.missionId,
          handoff_id: payload?.handoffId,
          authority: { command: "/handoff", slash_command: "/handoff", risk: "high_impact_write", gate: "handoff_runtime", owner: "opencode_handoff", blocked_by_default: true },
          latest_smoke: { smoke_id: "smoke-1", status: "succeeded", adapter_kind: "fake", completed_at: "1970-01-01T00:00:00.000Z", duration_ms: 1, exit_code: 0, summary_preview: "smoke token=smoke-secret", smoke_hash: "hash" },
          handoff_preview_summary: "handoff readiness token=preview-secret",
          required_evidence: [
            { evidence_id: "process_smoke:smoke-1", kind: "process_smoke", related_id: "smoke-1", status: "succeeded", fresh: true, completed_at: "1970-01-01T00:00:00.000Z", age_ms: 0, summary_preview: "smoke token=evidence-secret", blockers: [], warnings: [] },
            { evidence_id: "authority:/handoff", kind: "authority_record", related_id: "/handoff", status: "high_impact_write", fresh: true, summary_preview: "handoff is high impact", blockers: [], warnings: ["handoff token=authority-secret"] },
          ],
          optional_evidence: payload?.handoffId ? [{ evidence_id: `handoff:${payload.handoffId}`, kind: "handoff_followup", related_id: payload.handoffId, status: "missing", fresh: false, summary_preview: `handoff ${payload.handoffId} not found token=optional-secret`, blockers: [], warnings: ["handoff target was not found token=optional-warning-secret"] }] : [],
          blockers: payload?.proposalId === "proposal-pending" ? ["linked review must be approved token=readiness-secret"] : [],
          warnings: ["readiness does not execute handoff token=warning-secret"],
          recommended_commands: [{ label: "Show authority", command: "/authority-show /handoff token=command-secret", command_type: "read" }],
          generated_at: "1970-01-01T00:00:00.000Z",
          redacted_summary_preview: "ready token=summary-secret",
        }
      case "runtime.opencode_handoff_readiness_summary":
        return { total_considered: 1, ready_count: 1, blocked_count: 0, needs_smoke_count: 0, needs_review_count: 0, latest_smoke_status: "succeeded", latest_handoff_status: "sent", generated_at: "1970-01-01T00:00:00.000Z" }
      case "runtime.preview_opencode_result_review_packet":
        return {
          packet_id: "packet-1",
          status: payload?.handoffId === "handoff-needs-result" ? "needs_result" : "ready_for_commander_review",
          handoff_id: payload?.handoffId,
          mission_id: payload?.missionId ?? "mission-handoff-1",
          result_id: payload?.resultId ?? "result-handoff-1",
          proposal_id: payload?.proposalId ?? "proposal-approved",
          review_id: "review-1",
          title: "OpenCode executor result is ready for Commander review",
          objective_preview: "executor objective token=packet-objective-secret",
          executor_summary_preview: "follow-up result_submitted token=packet-executor-secret",
          result_summary_preview: "result summary token=packet-result-secret",
          artifact_previews: ["artifact token=packet-artifact-secret"],
          evidence: [
            { evidence_id: "handoff:handoff-1", kind: "handoff", related_id: "handoff-1", status: "sent", fresh: true, completed_at: "1970-01-01T00:00:00.000Z", age_ms: 0, summary_preview: "handoff token=packet-evidence-secret", blockers: [], warnings: [] },
            { evidence_id: "authority:/handoff", kind: "authority", related_id: "/handoff", status: "high_impact_write", fresh: true, summary_preview: "/handoff authority", blockers: [], warnings: [] },
          ],
          blockers: [],
          warnings: ["packet preview does not call provider token=packet-warning-secret"],
          recommended_commands: [{ label: "Show handoff authority", command: "/authority-show /handoff token=packet-command-secret", command_type: "read" }],
          generated_at: "1970-01-01T00:00:00.000Z",
          redacted_summary_preview: "packet ready token=packet-summary-secret",
        }
      case "runtime.opencode_result_review_summary":
        return { total_considered: 1, ready_count: 1, needs_result_count: 0, failed_count: 0, blocked_count: 0, stale_count: 0, latest_handoff_id: "handoff-1", latest_result_id: "result-handoff-1", generated_at: "1970-01-01T00:00:00.000Z" }
      case "runtime.command_authority_validation_profile":
        return {
          unit_runtime: true,
          unit_tui: true,
          typecheck_runtime: true,
          typecheck_tui: true,
          integration_cli: true,
          targeted_e2e: payload?.command === "/result-review-packet" ? ["tests/e2e_user/scenarios/test_opencode_result_review_packet_tui.py"] : [],
          optional_regression_e2e: [],
          full_e2e_required_when: [],
          live_provider_required: false,
          real_opencode_required: false,
        }
      case "runtime.opencode_handoff_followup_queue":
        if (payload?.queue === "bad") throw new Error("handoff follow-up queue is invalid token=queue-secret")
        return {
          queue: payload?.queue ?? "active",
          items: [{
            handoff_id: "handoff-1",
            proposal_id: "proposal-approved",
            mission_id: "mission-handoff-1",
            followup_status: payload?.queue === "needs_result_review" ? "result_submitted" : "sent",
            handoff_sent: true,
            result_count: payload?.queue === "needs_result_review" ? 1 : 0,
            progress_count: 0,
            blockers: [],
            suggested_commands: [{ label: "List results", command: "/results mission-handoff-1", command_type: "read" }],
            evidence_ids: [],
          }],
          total_considered: 1,
          limit: 20,
        }
      case "runtime.proposal_status":
        return { proposed_count: 0, review_requested_count: 0, approved_count: 0, rejected_count: 0, cancelled_count: 0, applied_count: 1, last_proposal_id: "proposal-approved" }
      case "runtime.list_commander_proposals":
        return [{ proposal_id: "proposal-approved", action_kind: "opencode_handoff", title: "Handoff", summary: "proposal", proposed_by: "operator", status: "applied", review_id: "review-1", application_result: "opencode_handoff:handoff-1:mission:mission-handoff-1", created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z" }]
      case "runtime.status":
        return {
          runtimeStatus: "started",
          mode: "active",
          projectName: "demo",
          specApproved: true,
          lockHeld: true,
          missions: { pending_count: 1, failed_count: 0, active_claim_count: 0, completed_count: 0, cancelled_count: 0, last_mission_id: "mission-handoff-1" },
        }
      case "runtime.list_recent_missions":
        return [{ mission_id: "mission-handoff-1", intent_id: "intent-handoff-1", objective: "handoff mission", status: "sent" }]
      case "runtime.get_mission":
        return { mission_id: payload?.missionId, intent_id: "intent-handoff-1", objective: "handoff mission", status: "sent" }
      case "runtime.list_mission_claims":
      case "runtime.list_mission_progress":
      case "runtime.list_mission_results":
      case "runtime.review_status":
      case "runtime.list_review_requests":
        return Array.isArray(payload) ? [] : name === "runtime.review_status" ? { pending_count: 0, approved_count: 1, rejected_count: 0, cancelled_count: 0, last_review_id: "review-1" } : []
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

  test("playbook commands list select draft and render catalog and draft results", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "playbook target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    const result = await runtime.command("runtime.submit_mission_result", { missionId: "fake-mission-1", claimId: claim.claim_id, summary: "done" }) as { result_id: string }

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "playbooks" })
    expect(state.commanderPlaybooks?.catalog.map((playbook) => playbook.playbook_id)).toContain("complete-from-result")
    expect(layoutSnapshot(state)).toContain("Commander playbooks")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "playbook", args: ["complete-from-result"] })
    expect(state.commanderPlaybooks?.selectedPlaybook).toMatchObject({ playbook_id: "complete-from-result", generated_action_kinds: ["complete_mission"] })
    expect(layoutSnapshot(state)).toContain("selected_playbook=complete-from-result")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "playbook", args: ["record-progress"] })
    expect(state.commanderPlaybooks?.selectedPlaybook?.required_fields).toContainEqual({
      name: "message",
      label: "Message",
      required: true,
      field_type: "text",
    })

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "draft-complete",
      args: ["fake-mission-1", result.result_id, "Complete", "title", "--", "summary"],
    })

    expect(state.commanderPlaybooks?.lastDraft).toMatchObject({ draft_id: expect.stringMatching(/^fake-draft-/), playbook_id: "complete-from-result", proposal_ids: [expect.stringMatching(/^fake-proposal-/)] })
    expect(state.proposals?.recent[0]).toMatchObject({ action_kind: "complete_mission", status: "proposed" })
    expect(layoutSnapshot(state)).toContain("playbook=complete-from-result")
  })

  test("playbook draft-result-complete creates ordered proposals plus bundle", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "playbook bundle target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "draft-result-complete",
      args: ["fake-mission-1", claim.claim_id, "Bundle", "title", "--", "result", "summary", "||", "completion", "summary"],
    })

    const draft = state.commanderPlaybooks?.lastDraft
    expect(draft?.proposal_ids).toHaveLength(2)
    expect(draft?.bundle_id).toBeTruthy()
    expect(state.proposals?.recent.slice(0, 2)).toMatchObject([
      { proposal_id: draft?.proposal_ids[1], action_kind: "complete_mission", status: "proposed" },
      { proposal_id: draft?.proposal_ids[0], action_kind: "submit_result", status: "proposed" },
    ])
    expect(state.proposalBundles?.recent[0]).toMatchObject({ bundle_id: draft?.bundle_id, proposal_ids: draft?.proposal_ids })
  })

  test("commander workbench lists selects readies reviews and cancels playbook drafts", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "workbench target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    const result = await runtime.command("runtime.submit_mission_result", { missionId: "fake-mission-1", claimId: claim.claim_id, summary: "done" }) as { result_id: string }

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "draft-complete",
      args: ["fake-mission-1", result.result_id, "Complete", "--", "summary"],
    })
    const draftId = state.commanderPlaybooks?.lastDraft?.draft_id ?? ""
    expect(state.commanderWorkbench?.drafts[0]).toMatchObject({ draft_id: draftId, status: "drafted", proposal_ids: state.commanderPlaybooks?.lastDraft?.proposal_ids })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "drafts" })
    expect(state.commanderWorkbench?.summary).toMatchObject({ drafted_count: 1 })
    expect(layoutSnapshot(state)).toContain("Commander workbench")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "draft", args: [draftId] })
    expect(state.commanderWorkbench?.selectedDraft).toMatchObject({ draft_id: draftId })
    expect(state.commanderWorkbench?.readiness).toMatchObject({ draft_id: draftId, missing_review_count: 1, ready_to_apply: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "draft-review", args: [draftId] })
    expect(state.commanderWorkbench?.selectedDraft?.review_ids).toHaveLength(1)
    expect(state.commanderWorkbench?.selectedDraft?.status).toBe("review_requested")
    expect(state.reviews?.recent[0]).toMatchObject({ status: "pending" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-draft", args: [draftId, "reason", "token=workbench-cancel-secret"] })
    expect(state.commanderWorkbench?.selectedDraft).toMatchObject({ draft_id: draftId, status: "cancelled" })
    expect(state.proposals?.recent[0]).not.toMatchObject({ status: "cancelled" })
    expect(JSON.stringify(state)).not.toContain("workbench-cancel-secret")
    expect(layoutSnapshot(state)).not.toContain("workbench-cancel-secret")
  })

  test("playbook draft fail cancel release create expected proposal action kinds", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "playbook target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }

    for (const [command, args, actionKind] of [
      ["draft-fail", ["fake-mission-1", "Fail", "title", "--", "reason"], "fail_mission"],
      ["draft-cancel", ["fake-mission-1", "Cancel", "title", "--", "reason"], "cancel_mission"],
      ["draft-release", [claim.claim_id, "Release", "title", "--", "reason"], "release_claim"],
    ] as const) {
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command, args: [...args] })
      expect(state.proposals?.recent[0]).toMatchObject({ action_kind: actionKind, status: "proposed" })
    }
  })

  test("missing playbook args produce redacted command errors", async () => {
    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), new FakeRuntimeClient("/tmp/demo", "demo"), {
      type: "send-command",
      command: "draft-fail",
      args: ["mission-1", "Title", "token=playbook-secret"],
    })

    expect(state.commanderPlaybooks?.commandError).toContain("-- separator")
    expect(JSON.stringify(state)).not.toContain("playbook-secret")
  })

  test("secret-looking playbook titles summaries and reasons do not leak into TUI state or snapshot", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    await runtime.command("runtime.submit_user_message", { message: "playbook target" })
    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, {
      type: "send-command",
      command: "draft-fail",
      args: ["fake-mission-1", "Title", "token=playbook-title-secret", "--", "reason", "token=playbook-reason-secret"],
    })

    const rendered = layoutSnapshot(state)
    expect(JSON.stringify(state)).not.toContain("playbook-title-secret")
    expect(JSON.stringify(state)).not.toContain("playbook-reason-secret")
    expect(rendered).not.toContain("playbook-title-secret")
    expect(rendered).not.toContain("playbook-reason-secret")
    expect(rendered).toContain("[REDACTED]")
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
    expect(state.proposalBundles?.readiness?.blockers).toContain(`bundle ${bundleId} is cancelled`)
    expect(state.proposals?.recent.find((proposal) => proposal.proposal_id === proposalId)?.status).toBe("review_requested")
    expect(JSON.stringify(state)).not.toContain("bundle-cancel-secret")
  })

  test("create bundle refreshes readiness for the newly selected bundle", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "bundle readiness target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-progress",
      args: ["fake-mission-1", claim.claim_id, "Progress", "--", "message"],
    })
    const proposalId = state.proposals?.selectedProposal?.proposal_id ?? ""

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "create-bundle", args: ["First", "--", "Summary"] })
    const firstBundleId = state.proposalBundles?.selectedBundle?.bundle_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "bundle-add", args: [firstBundleId, proposalId] })
    expect(state.proposalBundles?.readiness).toMatchObject({ bundle_id: firstBundleId, proposal_count: 1 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "create-bundle", args: ["Second", "--", "Summary"] })
    const secondBundleId = state.proposalBundles?.selectedBundle?.bundle_id ?? ""
    expect(secondBundleId).not.toBe(firstBundleId)
    expect(state.proposalBundles?.readiness).toMatchObject({ bundle_id: secondBundleId, proposal_count: 0, ready_to_apply: false })
  })

  test("fake runtime rejects empty and no-op partial bundle applies", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const empty = await runtime.command("runtime.create_proposal_bundle", { title: "Empty", summary: "Summary", createdBy: "operator" }) as { bundle_id: string }
    await expect(runtime.command("runtime.apply_proposal_bundle", { bundleId: empty.bundle_id, allowPartial: true })).rejects.toThrow("has no proposals to apply")

    await runtime.command("runtime.submit_user_message", { message: "bundle no-op target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    const proposal = await runtime.command("runtime.create_commander_proposal", {
      missionId: "fake-mission-1",
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Blocked",
      summary: "Summary",
      proposedBy: "commander",
      actionPayload: { mission_id: "fake-mission-1", claim_id: claim.claim_id, message: "blocked" },
    }) as { proposal_id: string }
    const blocked = await runtime.command("runtime.create_proposal_bundle", { title: "Blocked", summary: "Summary", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: blocked.bundle_id, proposalId: proposal.proposal_id })
    await expect(runtime.command("runtime.apply_proposal_bundle", { bundleId: blocked.bundle_id, allowPartial: true })).rejects.toThrow("did not apply any proposals")
  })

  test("fake runtime rejects cancelling bundles projected as applied", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    await runtime.command("runtime.submit_user_message", { message: "bundle projected apply target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    const proposal = await runtime.command("runtime.create_commander_proposal", {
      missionId: "fake-mission-1",
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Progress",
      summary: "Summary",
      proposedBy: "commander",
      actionPayload: { mission_id: "fake-mission-1", claim_id: claim.claim_id, message: "external" },
    }) as { proposal_id: string }
    const bundle = await runtime.command("runtime.create_proposal_bundle", { title: "Bundle", summary: "Summary", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: proposal.proposal_id })
    const reviewed = await runtime.command("runtime.request_proposal_review", { proposalId: proposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: reviewed.review_id, decidedBy: "operator" })
    await runtime.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })

    await expect(runtime.command("runtime.cancel_proposal_bundle", { bundleId: bundle.bundle_id, reason: "late" })).rejects.toThrow("applied proposal bundle cannot cancel")
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

  test("commander apply workbench previews applies and reports partial targets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "apply workbench target" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-progress",
      args: ["fake-mission-1", claim.claim_id, "Blocked", "--", "message token=apply-secret"],
    })
    const blockedProposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-preview", args: ["proposal", blockedProposalId] })
    expect(state.commanderApply?.preview).toMatchObject({ target_type: "proposal", ready_to_apply: false, would_apply: [] })
    expect(layoutSnapshot(state)).toContain("Commander apply")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "propose-progress",
      args: ["fake-mission-1", claim.claim_id, "Approved", "--", "approved"],
    })
    const approvedProposalId = state.proposals?.selectedProposal?.proposal_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "proposal-review", args: [approvedProposalId, "Review", "--", "Summary"] })
    const reviewId = state.proposals?.selectedProposal?.review_id ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "approve", args: [reviewId, "ok"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-target", args: ["proposal", approvedProposalId] })
    expect(state.commanderApply?.lastResult).toMatchObject({ applied: true, applied_proposal_ids: [approvedProposalId] })
    expect(state.missionExecution?.progress[0]).toMatchObject({ message: "approved" })

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "draft-progress",
      args: ["fake-mission-1", claim.claim_id, "Draft", "--", "draft message"],
    })
    const draftId = state.commanderPlaybooks?.lastDraft?.draft_id ?? ""
    const draftProposalId = state.commanderPlaybooks?.lastDraft?.proposal_ids[0] ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "draft-review", args: [draftId] })
    const draftReviewId = state.commanderWorkbench?.selectedDraft?.review_ids?.[0] ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "approve", args: [draftReviewId, "ok"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-preview", args: ["draft", draftId] })
    expect(state.commanderApply?.preview).toMatchObject({ target_type: "draft", ready_to_apply: true, would_apply: [draftProposalId] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-target", args: ["draft", draftId] })
    expect(state.commanderApply?.lastResult).toMatchObject({ applied: true, applied_proposal_ids: [draftProposalId] })

    const dryRunProposal = await runtime.command("runtime.create_commander_proposal", {
      missionId: "fake-mission-1",
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Dry run",
      summary: "Dry run",
      proposedBy: "operator",
      actionPayload: { mission_id: "fake-mission-1", claim_id: claim.claim_id, message: "dry run" },
    }) as { proposal_id: string }
    const dryRunReview = await runtime.command("runtime.request_proposal_review", { proposalId: dryRunProposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: dryRunReview.review_id, decidedBy: "operator", reason: "ok" })
    await expect(runtime.command("runtime.apply_commander_target", { targetType: "proposal", targetId: dryRunProposal.proposal_id, dryRun: true })).resolves.toMatchObject({
      applied: false,
      applied_proposal_ids: [],
      skipped_proposal_ids: [dryRunProposal.proposal_id],
      result_summary: "dry run; no proposals applied",
    })
    await expect(runtime.command("runtime.get_commander_proposal", { proposalId: dryRunProposal.proposal_id })).resolves.toMatchObject({ status: "approved" })

    const bundledDraft = await runtime.command("runtime.draft_commander_playbook", {
      playbookId: "submit-result-and-complete",
      proposedBy: "operator",
      requestedBy: "operator",
      requestReviews: true,
      fields: {
        mission_id: "fake-mission-1",
        claim_id: claim.claim_id,
        title: "Cancelled bundled draft",
        result_summary: "result",
        completion_summary: "complete",
      },
    }) as { draft_id: string; proposal_ids: string[]; review_ids?: string[] }
    for (const bundledReviewId of bundledDraft.review_ids ?? []) {
      await runtime.command("runtime.approve_review_request", { reviewId: bundledReviewId, decidedBy: "operator", reason: "ok" })
    }
    await runtime.command("runtime.cancel_commander_playbook_draft", { draftId: bundledDraft.draft_id, reason: "operator cancelled" })
    await expect(runtime.command("runtime.commander_apply_preview", { targetType: "draft", targetId: bundledDraft.draft_id })).resolves.toMatchObject({
      ready_to_apply: false,
      apply_mode: "draft_bundle",
      would_apply: [],
      blockers: [`draft ${bundledDraft.draft_id} is cancelled`],
    })
    await expect(runtime.command("runtime.apply_commander_target", { targetType: "draft", targetId: bundledDraft.draft_id, allowPartial: true })).rejects.toThrow("partial commander apply")

    const bundle = await runtime.command("runtime.create_proposal_bundle", { title: "Partial", summary: "Partial", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: blockedProposalId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-partial", args: ["bundle", bundle.bundle_id] })
    expect(state.commanderApply?.commandError).toContain("partial commander apply")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-partial", args: ["proposal", approvedProposalId] })
    expect(state.commanderApply?.commandError).toContain("bundle or draft")
    expect(JSON.stringify(state)).not.toContain("apply-secret")
    expect(layoutSnapshot(state)).not.toContain("apply-secret")
  })

  test("commander apply refreshes the selected affected mission for mixed bundles", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    await runtime.command("runtime.submit_user_message", { message: "first apply mission" })
    await runtime.command("runtime.submit_user_message", { message: "second apply mission" })
    const firstClaim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    const secondClaim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-2", executorId: "executor" }) as { claim_id: string }
    const firstProposal = await runtime.command("runtime.create_commander_proposal", {
      missionId: "fake-mission-1",
      claimId: firstClaim.claim_id,
      actionKind: "record_progress",
      title: "First",
      summary: "First",
      proposedBy: "operator",
      actionPayload: { mission_id: "fake-mission-1", claim_id: firstClaim.claim_id, message: "first progress" },
    }) as { proposal_id: string }
    const secondProposal = await runtime.command("runtime.create_commander_proposal", {
      missionId: "fake-mission-2",
      claimId: secondClaim.claim_id,
      actionKind: "record_progress",
      title: "Second",
      summary: "Second",
      proposedBy: "operator",
      actionPayload: { mission_id: "fake-mission-2", claim_id: secondClaim.claim_id, message: "second progress" },
    }) as { proposal_id: string }
    for (const proposal of [firstProposal, secondProposal]) {
      const review = await runtime.command("runtime.request_proposal_review", { proposalId: proposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
      await runtime.command("runtime.approve_review_request", { reviewId: review.review_id, decidedBy: "operator", reason: "ok" })
    }
    const bundle = await runtime.command("runtime.create_proposal_bundle", { title: "Mixed", summary: "Mixed", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: firstProposal.proposal_id })
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: secondProposal.proposal_id })
    for (let index = 0; index < 25; index += 1) {
      await runtime.command("runtime.create_commander_proposal", {
        missionId: "fake-mission-1",
        claimId: firstClaim.claim_id,
        actionKind: "record_progress",
        title: `Filler ${index}`,
        summary: "Filler",
        proposedBy: "operator",
        actionPayload: { mission_id: "fake-mission-1", claim_id: firstClaim.claim_id, message: `filler ${index}` },
      })
    }

    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "mission", args: ["fake-mission-2"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apply-target", args: ["bundle", bundle.bundle_id] })

    expect(state.commanderApply?.lastResult).toMatchObject({ applied: true, applied_proposal_ids: [firstProposal.proposal_id, secondProposal.proposal_id] })
    expect(state.missionExecution?.selectedMissionId).toBe("fake-mission-2")
    expect(state.missionExecution?.progress[0]).toMatchObject({ mission_id: "fake-mission-2", message: "second progress" })
  })

  test("commander audit commands load timelines chains filters and redact state", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    await runtime.command("runtime.submit_user_message", { message: "audit target token=audit-secret" })
    const claim = await runtime.command("runtime.claim_mission", { missionId: "fake-mission-1", executorId: "executor" }) as { claim_id: string }
    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "draft-progress",
      args: ["fake-mission-1", claim.claim_id, "Audit", "--", "message token=audit-secret"],
    })
    const draftId = state.commanderPlaybooks?.lastDraft?.draft_id ?? ""
    const proposalId = state.commanderPlaybooks?.lastDraft?.proposal_ids[0] ?? ""
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "draft-review", args: [draftId] })
    const reviewId = state.commanderWorkbench?.selectedDraft?.review_ids?.[0] ?? ""
    const bundle = await runtime.command("runtime.create_proposal_bundle", { title: "Audit bundle", summary: "Audit", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: [] })
    expect(state.commanderAudit?.timeline.length).toBeGreaterThan(0)
    expect(layoutSnapshot(state)).toContain("Commander audit")
    const firstPage = await runtime.command("runtime.commander_audit_timeline", { limit: 2 }) as { events: Array<{ event_id?: string; event_index: number }>; next_before_event_id?: string }
    const secondPage = await runtime.command("runtime.commander_audit_timeline", { limit: 2, beforeEventId: firstPage.next_before_event_id }) as { events: Array<{ event_id?: string; event_index: number }> }
    expect(secondPage.events.every((event) => event.event_index < firstPage.events.at(-1)!.event_index)).toBe(true)
    expect(secondPage.events.map((event) => event.event_id).some((eventId) => firstPage.events.map((event) => event.event_id).includes(eventId))).toBe(false)
    const proposalAuditBefore = await runtime.command("runtime.commander_audit_timeline", { targetType: "proposal", targetId: proposalId, limit: 1 }) as { events: Array<{ event_id?: string }> }
    const newActivity = await runtime.command("runtime.submit_user_message", { message: "new audit activity" }) as { missionId: string }
    const proposalAuditAfter = await runtime.command("runtime.commander_audit_timeline", { targetType: "proposal", targetId: proposalId, limit: 1 }) as { events: Array<{ event_id?: string }> }
    expect(proposalAuditAfter.events[0]?.event_id).toBe(proposalAuditBefore.events[0]?.event_id)
    const newestAfterActivity = await runtime.command("runtime.commander_audit_timeline", { limit: 1 }) as { events: Array<{ kind: string; target_id?: string }> }
    expect(newestAfterActivity.events[0]).toMatchObject({ kind: "mission_created", target_id: newActivity.missionId })
    await expect(runtime.command("runtime.commander_audit_timeline", { category: "invalid" })).rejects.toThrow("category is invalid")
    await expect(runtime.command("runtime.commander_audit_timeline", { limit: 0 })).rejects.toThrow("audit limit must be a positive integer")
    await expect(runtime.command("runtime.commander_audit_timeline", { beforeEventId: "missing-event" })).rejects.toThrow("audit event cursor not found")
    await expect(runtime.command("runtime.commander_audit_timeline", { targetType: "proposal" })).rejects.toThrow("targetId is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit-kind", args: ["proposal"] })
    expect(state.commanderAudit?.timeline.every((event) => event.category === "proposal")).toBe(true)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["proposal", proposalId] })
    expect(state.commanderAudit?.selectedChain).toMatchObject({ target_type: "proposal", target_id: proposalId })
    expect(state.commanderAudit?.selectedChain?.events.map((event) => event.kind)).toContain("commander_proposal_created")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["bundle", bundle.bundle_id] })
    expect(state.commanderAudit?.selectedChain).toMatchObject({ target_type: "bundle", target_id: bundle.bundle_id })
    expect(state.commanderAudit?.selectedChain?.events.map((event) => event.kind)).toContain("commander_proposal_bundle_created")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["draft", draftId] })
    expect(state.commanderAudit?.selectedChain).toMatchObject({ target_type: "draft", target_id: draftId })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["review", reviewId] })
    expect(state.commanderAudit?.selectedChain).toMatchObject({ target_type: "review", target_id: reviewId })
    expect(state.commanderAudit?.selectedChain?.events.map((event) => event.kind)).toContain("review_request_created")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["mission", "fake-mission-1"] })
    expect(state.commanderAudit?.selectedChain?.events.map((event) => event.kind)).toContain("mission_created")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["runtime", "fake-intent-1"] })
    expect(state.commanderAudit?.selectedChain).toMatchObject({ target_type: "runtime", target_id: "fake-intent-1" })
    expect(state.commanderAudit?.selectedChain?.related_ids.runtime_id).toContain("fake-intent-1")
    expect(state.commanderAudit?.selectedChain?.related_ids.intent_id).toBeUndefined()
    expect(state.commanderAudit?.selectedChain?.events.map((event) => event.kind)).toContain("mission_created")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "audit", args: ["bundle"] })
    expect(state.commanderAudit?.commandError).toContain("targetId is required")
    expect(JSON.stringify(state)).not.toContain("audit-secret")
    expect(layoutSnapshot(state)).not.toContain("audit-secret")
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

  test("queue slash commands load summary rows blockers applied stale and redact state", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const claim = await runtime.command("runtime.claim_mission", { missionId: "mission-1", executorId: "executor" }) as { claim_id: string }
    const result = await runtime.command("runtime.submit_mission_result", { missionId: "mission-1", claimId: claim.claim_id, summary: "result summary" }) as { result_id: string }
    await runtime.command("runtime.create_review_request", {
      title: "review token=queue-review-secret",
      summary: "summary api_key=queue-summary-secret",
      requestedBy: "operator",
    })
    const blocked = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "record_progress",
      title: "blocked token=queue-blocked-secret",
      summary: "blocked",
      proposedBy: "operator",
      actionPayload: { mission_id: "mission-1", claim_id: claim.claim_id, message: "blocked" },
    }) as { proposal_id: string }
    const ready = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "record_progress",
      title: "ready",
      summary: "ready",
      proposedBy: "operator",
      actionPayload: { mission_id: "mission-1", claim_id: claim.claim_id, message: "ready" },
    }) as { proposal_id: string }
    const review = await runtime.command("runtime.request_proposal_review", { proposalId: ready.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: review.review_id, decidedBy: "operator" })
    const failed = await runtime.command("runtime.create_commander_proposal", { actionKind: "other", title: "failed", summary: "failed", proposedBy: "operator" }) as { proposal_id: string }
    const failedReview = await runtime.command("runtime.request_proposal_review", { proposalId: failed.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: failedReview.review_id, decidedBy: "operator" })
    await expect(runtime.command("runtime.apply_commander_target", { targetType: "proposal", targetId: failed.proposal_id })).rejects.toThrow()
    const cancelled = await runtime.command("runtime.create_commander_proposal", { actionKind: "other", title: "cancelled", summary: "cancelled", proposedBy: "operator" }) as { proposal_id: string }
    await runtime.command("runtime.cancel_commander_proposal", { proposalId: cancelled.proposal_id, reason: "operator cancelled" })
    const rejected = await runtime.command("runtime.create_commander_proposal", { actionKind: "other", title: "rejected", summary: "rejected", proposedBy: "operator" }) as { proposal_id: string }
    const rejectedReview = await runtime.command("runtime.request_proposal_review", { proposalId: rejected.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.reject_review_request", { reviewId: rejectedReview.review_id, decidedBy: "operator", reason: "operator rejected" })
    const failedBundle = await runtime.command("runtime.create_proposal_bundle", { title: "failed bundle", summary: "failed bundle", createdBy: "operator" }) as { bundle_id: string }
    await expect(runtime.command("runtime.apply_proposal_bundle", { bundleId: failedBundle.bundle_id, allowPartial: true })).rejects.toThrow("has no proposals to apply")
    const resolvedBundle = await runtime.command("runtime.create_proposal_bundle", { title: "resolved bundle", summary: "resolved bundle", createdBy: "operator" }) as { bundle_id: string }
    const resolvedProposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "record_progress",
      title: "resolved",
      summary: "resolved",
      proposedBy: "operator",
      actionPayload: { mission_id: "mission-1", claim_id: claim.claim_id, message: "resolved" },
    }) as { proposal_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: resolvedBundle.bundle_id, proposalId: resolvedProposal.proposal_id })
    await expect(runtime.command("runtime.apply_proposal_bundle", { bundleId: resolvedBundle.bundle_id, allowPartial: true })).rejects.toThrow("did not apply any proposals")
    const resolvedReview = await runtime.command("runtime.request_proposal_review", { proposalId: resolvedProposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: resolvedReview.review_id, decidedBy: "operator" })
    await runtime.command("runtime.apply_proposal_bundle", { bundleId: resolvedBundle.bundle_id, allowPartial: true })
    const bundle = await runtime.command("runtime.create_proposal_bundle", { title: "bundle", summary: "bundle", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: blocked.proposal_id })
    const cancelledBundle = await runtime.command("runtime.create_proposal_bundle", { title: "cancelled bundle", summary: "cancelled bundle", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: cancelledBundle.bundle_id, proposalId: blocked.proposal_id })
    await runtime.command("runtime.cancel_proposal_bundle", { bundleId: cancelledBundle.bundle_id, reason: "operator cancelled" })
    await runtime.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      fields: { mission_id: "mission-1", claim_id: claim.claim_id, title: "draft", message: "draft" },
      proposedBy: "operator",
    })
    const cancelledDraft = await runtime.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      fields: { mission_id: "mission-1", claim_id: claim.claim_id, title: "cancelled draft", message: "cancelled draft" },
      proposedBy: "operator",
    }) as { draft_id: string }
    await runtime.command("runtime.cancel_commander_playbook_draft", { draftId: cancelledDraft.draft_id, reason: "operator cancelled" })

    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "queues" })
    expect(state.commanderQueues?.summary?.needs_review_count).toBeGreaterThan(0)
    expect(state.commanderQueues?.selectedQueue).toBe("needs_review")
    expect(layoutSnapshot(state)).toContain("Commander queues")

    state = {
      ...state,
      commanderQueues: {
        ...state.commanderQueues,
        items: [],
        summary: {
          needs_review_count: 0,
          ready_to_apply_count: 0,
          blocked_count: 0,
          failed_apply_count: 0,
          recently_applied_count: 0,
          drafts_needing_review_count: 0,
          bundles_needing_review_count: 0,
          stale_open_count: 0,
          last_updated_at: "1970-01-01T00:00:00.000Z",
        },
      },
    }
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "queue", args: ["needs_review"] })
    expect(state.commanderQueues?.summary?.needs_review_count).toBeGreaterThan(0)
    expect(state.commanderQueues?.selectedQueue).toBe("needs_review")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "queue-apply" })
    expect(state.commanderQueues?.selectedQueue).toBe("ready_to_apply")
    expect(state.commanderQueues?.items).toEqual(expect.arrayContaining([expect.objectContaining({ target_id: ready.proposal_id })]))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "queue-failed" })
    expect(state.commanderQueues?.selectedQueue).toBe("failed_apply")
    expect(state.commanderQueues?.items).toEqual(expect.arrayContaining([expect.objectContaining({ target_id: failedBundle.bundle_id })]))
    expect(state.commanderQueues?.items.map((item) => item.target_id)).not.toContain(cancelled.proposal_id)
    expect(state.commanderQueues?.items.map((item) => item.target_id)).not.toContain(rejected.proposal_id)
    expect(state.commanderQueues?.items.map((item) => item.target_id)).not.toContain(resolvedBundle.bundle_id)

    for (const command of ["queue-blocked", "queue-applied", "queue-drafts", "queue-bundles"] as const) {
      if (command === "queue-applied") await runtime.command("runtime.apply_commander_target", { targetType: "proposal", targetId: ready.proposal_id })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command })
      expect(state.commanderQueues?.selectedQueue).toBeDefined()
      if (command === "queue-blocked") {
        const blockedIds = state.commanderQueues?.items.map((item) => item.target_id) ?? []
        expect(blockedIds).toContain(blocked.proposal_id)
        expect(blockedIds).not.toContain(cancelled.proposal_id)
        expect(blockedIds).not.toContain(rejected.proposal_id)
        expect(blockedIds).not.toContain(cancelledBundle.bundle_id)
        expect(blockedIds).not.toContain(cancelledDraft.draft_id)
      }
    }
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "queue-stale" })
    expect(state.commanderQueues?.selectedQueue).toBe("stale_open")
    expect(state.commanderQueues?.items).toHaveLength(0)
    state = await applyRuntimeUiEffect(state, runtime, { type: "load-commander-queue", queue: "stale_open", limit: 20, staleAfterMs: 1 })
    expect(state.commanderQueues?.items.length).toBeGreaterThan(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "queue", args: ["invalid"] })
    expect(state.commanderQueues?.commandError).toBe("commander queue kind is invalid")
    expect(JSON.stringify(state)).not.toContain("queue-review-secret")
    expect(JSON.stringify(state)).not.toContain("queue-summary-secret")
    expect(JSON.stringify(state)).not.toContain("queue-blocked-secret")
    await expect(runtime.command("runtime.commander_queue", { queue: "needs_review", limit: 0 })).rejects.toThrow("commander queue limit must be a positive integer")
    await expect(runtime.command("runtime.commander_queue", { queue: "needs_review", limit: null })).rejects.toThrow("commander queue limit must be a positive integer")
    await expect(runtime.command("runtime.commander_queue", { queue: "needs_review", staleAfterMs: null })).rejects.toThrow("staleAfterMs")
    await expect(runtime.command("runtime.commander_queue_summary", { staleAfterMs: null })).rejects.toThrow("staleAfterMs")
  })

  test("commander queue runtime result preserves requested rows above default render limit", async () => {
    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), new CommanderQueueLimitRuntime(), {
      type: "load-commander-queue",
      queue: "needs_review",
      limit: 25,
    })

    expect(state.commanderQueues?.selectedQueue).toBe("needs_review")
    expect(state.commanderQueues?.limit).toBe(25)
    expect(state.commanderQueues?.totalConsidered).toBe(25)
    expect(state.commanderQueues?.items).toHaveLength(25)
    expect(state.commanderQueues?.items.at(-1)?.target_id).toBe("review_25")
  })

  test("target navigation slash commands load fake context and render bounded redacted snapshot", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const claim = await runtime.command("runtime.claim_mission", { missionId: "mission-1", executorId: "executor" }) as { claim_id: string }
    const result = await runtime.command("runtime.submit_mission_result", { missionId: "mission-1", claimId: claim.claim_id, summary: "result summary" }) as { result_id: string }
    const proposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "record_progress",
      title: "proposal token=nav-title-secret",
      summary: "summary api_key=nav-summary-secret",
      proposedBy: "operator",
      actionPayload: { mission_id: "mission-1", claim_id: claim.claim_id, message: "progress" },
    }) as { proposal_id: string }
    const review = await runtime.command("runtime.request_proposal_review", { proposalId: proposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: review.review_id, decidedBy: "operator", reason: "ok" })
    const bundle = await runtime.command("runtime.create_proposal_bundle", { title: "bundle", summary: "bundle", createdBy: "operator" }) as { bundle_id: string }
    await runtime.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: proposal.proposal_id })
    const draft = await runtime.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      fields: { mission_id: "mission-1", claim_id: claim.claim_id, title: "draft", message: "draft" },
      proposedBy: "operator",
      createBundle: true,
      requestReviews: true,
    }) as { draft_id: string }

    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "open", args: ["proposal", proposal.proposal_id] })
    expect(state.commanderNavigation?.selected?.target_type).toBe("proposal")
    expect(state.commanderNavigation?.selected?.target_id).toBe(proposal.proposal_id)
    expect(state.commanderNavigation?.selected?.found).toBe(true)
    expect(state.commanderNavigation?.selected?.related_ids.review_id).toContain(review.review_id)
    expect(state.commanderNavigation?.selected?.related_ids.bundle_id).toContain(bundle.bundle_id)
    expect(state.commanderNavigation?.selected?.suggested_commands).toContainEqual(expect.objectContaining({ command: `/apply-preview proposal ${proposal.proposal_id}` }))
    expect(layoutSnapshot(state)).toContain("Commander target context")
    expect(layoutSnapshot(state)).toContain(`selected=proposal:${proposal.proposal_id}`)
    expect(JSON.stringify(state)).not.toContain("nav-title-secret")
    expect(JSON.stringify(state)).not.toContain("nav-summary-secret")

    const handoffProposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "opencode_handoff",
      title: "handoff proposal",
      summary: "handoff summary",
      proposedBy: "operator",
      actionPayload: { objective: "handoff objective" },
    }) as { proposal_id: string }
    const handoffReview = await runtime.command("runtime.request_proposal_review", { proposalId: handoffProposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await runtime.command("runtime.approve_review_request", { reviewId: handoffReview.review_id, decidedBy: "operator", reason: "ok" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "open", args: ["proposal", handoffProposal.proposal_id] })
    expect(state.commanderNavigation?.selected?.suggested_commands).toContainEqual(expect.objectContaining({ command: `/handoff-preview ${handoffProposal.proposal_id}` }))
    expect(state.commanderNavigation?.selected?.suggested_commands).toContainEqual(expect.objectContaining({ command: `/handoff ${handoffProposal.proposal_id}` }))
    expect(state.commanderNavigation?.selected?.suggested_commands).not.toContainEqual(expect.objectContaining({ command: `/apply-target proposal ${handoffProposal.proposal_id}` }))

    for (const [command, args, targetType] of [
      ["open-bundle", [bundle.bundle_id], "bundle"],
      ["open-draft", [draft.draft_id], "draft"],
      ["open-review", [review.review_id], "review"],
      ["open-mission", ["mission-1"], "mission"],
      ["jump", ["proposal", proposal.proposal_id], "proposal"],
      ["target", ["proposal", proposal.proposal_id], "proposal"],
      ["open", ["claim", claim.claim_id], "claim"],
      ["open", ["result", result.result_id], "result"],
    ] as const) {
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command, args: [...args] })
      expect(state.commanderNavigation?.selected?.target_type).toBe(targetType)
    }
    expect((await runtime.command("runtime.commander_target_context", { targetType: "claim", targetId: claim.claim_id }) as { suggested_commands: Array<{ command: string }> }).suggested_commands).toContainEqual(expect.objectContaining({ command: "/claims mission-1" }))
    const resultContext = await runtime.command("runtime.commander_target_context", { targetType: "result", targetId: result.result_id }) as { suggested_commands: Array<{ command: string }> }
    expect(resultContext.suggested_commands).toContainEqual(expect.objectContaining({ command: "/results mission-1" }))
    expect(resultContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/draft-complete mission-1 ${result.result_id} <title> -- <summary>` }))
    const bundleContext = await runtime.command("runtime.commander_target_context", { targetType: "bundle", targetId: bundle.bundle_id }) as { suggested_commands: Array<{ command: string }> }
    expect(bundleContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/apply-target bundle ${bundle.bundle_id}` }))
    const draftContext = await runtime.command("runtime.commander_target_context", { targetType: "draft", targetId: draft.draft_id }) as { suggested_commands: Array<{ command: string }> }
    expect(draftContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/apply-target draft ${draft.draft_id}` }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "open", args: ["proposal"] })
    expect(state.commanderNavigation?.commandError).toBe("targetId is required")

    const missing = await runtime.command("runtime.commander_target_context", { targetType: "proposal", targetId: "proposal_missing" }) as { found: boolean; missing_links: string[] }
    expect(missing.found).toBe(false)
    expect(missing.missing_links[0]).toContain("proposal record not found")
  })

  test("operator action staging previews clears runs and redacts suggested commands", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const claim = await runtime.command("runtime.claim_mission", { missionId: "mission-1", executorId: "executor" }) as { claim_id: string }
    const proposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "record_progress",
      title: "proposal token=stage-title-secret",
      summary: "summary",
      proposedBy: "operator",
      actionPayload: { mission_id: "mission-1", claim_id: claim.claim_id, message: "progress" },
    }) as { proposal_id: string }

    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "open", args: ["proposal", proposal.proposal_id] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage", args: ["1"] })
    expect(state.operatorActions?.staged).toMatchObject({
      source_target_type: "proposal",
      source_target_id: proposal.proposal_id,
      command: `/proposal ${proposal.proposal_id}`,
      command_type: "read",
    })
    expect(state.proposals?.selectedProposal).toBeUndefined()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-preview" })
    expect(layoutSnapshot(state)).toContain("Operator actions")
    expect(layoutSnapshot(state)).toContain(`command=/proposal ${proposal.proposal_id}`)
    expect(state.proposals?.selectedProposal).toBeUndefined()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.staged).toBeNull()
    expect(state.operatorActions?.lastResult).toMatchObject({ command: `/proposal ${proposal.proposal_id}`, ok: true, affected_target_type: "proposal", affected_target_id: proposal.proposal_id })
    expect(Date.parse(state.operatorActions?.lastResult?.executed_at ?? "")).toBeGreaterThan(0)
    expect(state.operatorActions?.lastResult?.executed_at).not.toBe("1970-01-01T00:00:00.000Z")
    expect(state.proposals?.selectedProposal?.proposal_id).toBe(proposal.proposal_id)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/queues"] })
    expect(state.operatorActions?.staged).toMatchObject({ command: "/queues", command_type: "read" })
    expect(state.commanderQueues?.items ?? []).toHaveLength(0)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/queues", ok: true })
    expect(state.operatorActions?.staged).toBeNull()
    expect(state.commanderQueues?.selectedQueue).toBe("needs_review")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/records"] })
    expect(state.operatorActions?.staged).toMatchObject({ command: "/records", command_type: "read" })
    state = await applyRuntimeUiEffect({ ...state, runtimeStatus: undefined, missions: undefined }, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/records", ok: true })
    expect(state.runtimeStatus?.runtimeStatus).toBeTruthy()
    expect(state.missions?.recent).toEqual(expect.any(Array))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/notes", "topic-1", "token=stage-secret"] })
    expect(state.operatorActions?.staged?.command).toBe("/notes topic-1 [REDACTED]")
    expect(JSON.stringify(state)).not.toContain("stage-secret")
    expect(layoutSnapshot(state)).not.toContain("stage-secret")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "clear-stage" })
    expect(state.operatorActions?.staged).toBeNull()
  })

  test("operator action staging preserves full suggested command while rendering bounded previews", async () => {
    const runtime = new LongSuggestedCommandRuntime()
    const fullCommand = `/proposal ${runtime.proposalId}`

    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "open", args: ["proposal", runtime.proposalId] })
    expect(state.commanderNavigation?.selected?.suggested_commands[0]?.command).toBe(fullCommand)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage", args: ["1"] })
    expect(state.operatorActions?.staged?.command).toBe(fullCommand)
    expect(layoutSnapshot(state)).toContain("command=/proposal proposal_")
    expect(layoutSnapshot(state)).toContain("...")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(runtime.requestedProposalId).toBe(runtime.proposalId)
    expect(state.operatorActions?.lastResult).toMatchObject({ command: fullCommand, ok: true, affected_target_id: runtime.proposalId })
  })

  test("operator action execution preserves raw staged command text without leaking it into state", async () => {
    const runtime = new ResearchRuntime()
    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "stage-command", args: ["/notes", "topic-1", "token=raw-stage-secret"] })

    expect(state.operatorActions?.staged?.command).toBe("/notes topic-1 [REDACTED]")
    expect(JSON.stringify(state)).not.toContain("raw-stage-secret")

    const cloned = snapshotUiState(state)
    expect(JSON.stringify(cloned)).not.toContain("raw-stage-secret")

    state = await applyRuntimeUiEffect(cloned, runtime, { type: "send-command", command: "run-staged" })
    expect(runtime.calls.some((call) => call.includes("token=raw-stage-secret"))).toBe(true)
    expect(runtime.calls.some((call) => call.includes("[REDACTED]"))).toBe(false)
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/notes topic-1 [REDACTED]", ok: true })
    expect(JSON.stringify(state)).not.toContain("raw-stage-secret")
    expect(layoutSnapshot(state)).not.toContain("raw-stage-secret")
  })

  test("runtime status renders bounded reasoning provider metadata without secrets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "load-runtime-status" })

    expect(state.reasoningProvider).toMatchObject({
      kind: "fake",
      provider_id: "fake-reasoning",
      enabled_for: ["research_synthesis", "commander_cycle"],
    })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("reasoning=fake:fake-reasoning")
    expect(snapshot).toContain("reasoning_enabled=research_synthesis,commander_cycle")

    const minimaxStatusRuntime: RuntimeClient = {
      stream: () => runtime.stream(),
      sendUserMessage: (message: string) => runtime.sendUserMessage(message),
      sendCommand: (command: string) => runtime.sendCommand(command),
      command: async (name: string) => {
        if (name === "runtime.reasoning_provider_status") {
          return {
            kind: "minimax",
            provider_id: "minimax-m2-7",
            connector_id: "minimax-anthropic",
            model: "MiniMax-M2.7",
            max_input_bytes: 32768,
            max_output_bytes: 16384,
            enabled_for: ["research_synthesis"],
            token: "token=reasoning-secret",
          }
        }
        return runtime.command(name)
      },
    }
    state = await applyRuntimeUiEffect(state, minimaxStatusRuntime, { type: "load-reasoning-provider-status" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("reasoning=minimax:minimax-m2-7")
    expect(snapshot).toContain("reasoning_connector=minimax-anthropic")
    expect(snapshot).toContain("reasoning_model=MiniMax-M2.7")
    expect(JSON.stringify(state)).not.toContain("reasoning-secret")
    expect(snapshot).not.toContain("reasoning-secret")
  })

  test("reasoning provider commands render health smoke preview and smoke result", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "reasoning" })
    expect(state.reasoningProvider?.health).toMatchObject({ status: "ok" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Reasoning provider")
    expect(snapshot).toContain("health=ok")
    expect(snapshot).toContain("check=config ok info")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "reasoning-smoke-preview", args: ["research"] })
    expect(state.reasoningProvider?.smokePreview).toMatchObject({ surface: "research_synthesis", would_call_network: false })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("smoke_preview=research_synthesis network=no")
    expect(snapshot).toContain("smoke_blockers=none")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "reasoning-smoke-dry-run", args: ["cycle"] })
    expect(state.reasoningProvider?.lastSmoke).toMatchObject({ surface: "commander_cycle", ok: true, dry_run: true, parsed: false })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("smoke_result=commander_cycle ok dry_run=true parsed=false")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "reasoning-smoke-preview", args: ["commander_executor_review"] })
    expect(state.reasoningProvider?.smokePreview).toMatchObject({ surface: "commander_executor_review", would_call_network: false })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("smoke_preview=commander_executor_review network=no")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "reasoning-smoke", args: ["research"] })
    expect(state.reasoningProvider?.lastSmoke).toMatchObject({ surface: "research_synthesis", ok: true, dry_run: false, parsed: true })
    expect(JSON.stringify(state)).not.toContain("raw-secret")
    expect(layoutSnapshot(state)).not.toContain("raw-secret")
  })

  test("reasoning provider invalid surface produces redacted command error", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    const state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "reasoning-smoke-preview", args: ["token=raw-secret"] })
    expect(state.reasoningProvider?.commandError).toContain("reasoning smoke surface")
    expect(JSON.stringify(state)).not.toContain("raw-secret")
    expect(layoutSnapshot(state)).not.toContain("raw-secret")
  })

  test("MiniMax live validation slash commands render gated fake/default surface", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-preview" })
    expect(state.minimaxLiveValidation?.preview).toMatchObject({ status: "not_configured", can_execute: false, opt_in_present: false })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("MiniMax live validation")
    expect(snapshot).toContain("preview=not_configured can_execute=false opt_in=no")
    expect(snapshot).toContain("note=live validation does not create proposals, run Commander cycle, launch OpenCode, or mutate missions")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-preview", args: ["surface=commander_executor_review"] })
    expect(state.minimaxLiveValidation?.preview?.requested_surfaces).toEqual(["commander_executor_review"])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-dry-run" })
    expect(state.minimaxLiveValidation?.latestResult).toMatchObject({ status: "skipped" })
    expect(state.minimaxLiveValidation?.records).toHaveLength(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-validate" })
    expect(state.minimaxLiveValidation?.latestResult).toMatchObject({ status: "blocked" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-validations" })
    expect(state.minimaxLiveValidation?.records.length).toBeGreaterThanOrEqual(1)
    const validationId = state.minimaxLiveValidation?.records[0]?.validation_id
    expect(validationId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-show", args: [validationId!] })
    expect(state.minimaxLiveValidation?.selected).toMatchObject({ validation_id: validationId, status: "blocked" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/minimax-live-validate"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_minimax_live_validation_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "minimax-live-preview", args: ["token=raw-secret"] })
    expect(state.minimaxLiveValidation?.commandError).toContain("MiniMax live validation args must be")
    snapshot = layoutSnapshot(state)
    expect(JSON.stringify(state)).not.toContain("raw-secret")
    expect(snapshot).not.toContain("raw-secret")
  })

  test("operator action staging fails closed for missing context bad indexes unsupported commands and write authority errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = await applyRuntimeUiEffect(initialState("/tmp/demo"), runtime, { type: "send-command", command: "stage", args: ["1"] })
    expect(state.operatorActions?.commandError).toBe("selected target context is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "open-mission", args: ["mission-1"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage", args: ["999"] })
    expect(state.operatorActions?.commandError).toContain("suggested command index is out of range")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/tmp/repro"] })
    expect(state.operatorActions?.staged?.command).toBe("/tmp/repro")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/tmp/repro", ok: false })
    expect(Date.parse(state.operatorActions?.lastResult?.executed_at ?? "")).toBeGreaterThan(0)
    expect(state.operatorActions?.lastResult?.executed_at).not.toBe("1970-01-01T00:00:00.000Z")
    expect(state.operatorActions?.commandError).toContain("unsupported staged command")
    expect(state.operatorActions?.staged?.command).toBe("/tmp/repro")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/apply-target", "proposal", "missing-proposal"] })
    expect(state.operatorActions?.staged).toMatchObject({ command: "/apply-target proposal missing-proposal", command_type: "write" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/apply-target proposal missing-proposal", ok: false })
    expect(state.operatorActions?.commandError).toContain("not found")
    expect(state.operatorActions?.staged?.command).toBe("/apply-target proposal missing-proposal")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/apply-target proposal missing-proposal", ok: false })
    expect(state.operatorActions?.commandError).toContain("not found")
    expect(state.operatorActions?.staged?.command).toBe("/apply-target proposal missing-proposal")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/handoff", "missing-proposal"] })
    expect(state.operatorActions?.staged?.command).toBe("/handoff missing-proposal")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/handoff missing-proposal", ok: false })
    expect(state.operatorActions?.commandError).toContain("not found")
    expect(state.operatorActions?.staged?.command).toBe("/handoff missing-proposal")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/executor-review-proposal-create-preview", "review=missing-review", "token=raw-secret"] })
    expect(state.operatorActions?.staged?.command).toBe("/executor-review-proposal-create-preview review=missing-review [REDACTED]")
    expect(state.operatorActions?.staged?.command_type).toBe("read")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/executor-review-proposal-create-preview review=missing-review [REDACTED]", ok: false })
    expect(state.operatorActions?.commandError).toContain("executor review proposal create arg is unsupported")
    expect(state.operatorActions?.staged?.command).toBe("/executor-review-proposal-create-preview review=missing-review [REDACTED]")
    expect(JSON.stringify(state)).not.toContain("raw-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/context-budget-preview"] })
    expect(state.operatorActions?.staged?.command).toBe("/context-budget-preview")
    expect(state.operatorActions?.staged?.command_type).toBe("read")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/context-budget-preview", ok: false })
    expect(state.operatorActions?.commandError).toContain("context budget preview requires purpose")
    expect(state.operatorActions?.staged?.command).toBe("/context-budget-preview")

    for (const createCommand of ["/executor-review-proposal-create", "/executor-draft-create", "/commander-executor-proposal-create"]) {
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: [createCommand, "review=missing-review", "draft=missing-draft"] })
      expect(state.operatorActions?.staged).toMatchObject({
        command: `${createCommand} review=missing-review draft=missing-draft`,
        command_type: "write",
      })
    }

    const smokeRuntime: RuntimeClient = {
      stream: () => runtime.stream(),
      sendUserMessage: (message: string) => runtime.sendUserMessage(message),
      sendCommand: (command: string) => runtime.sendCommand(command),
      command: async (name: string, payload?: Record<string, unknown>) => {
        if (name === "runtime.execute_opencode_process_smoke") throw new Error("token=smoke-secret denied")
        return runtime.command(name, payload)
      },
    }
    state = await applyRuntimeUiEffect(state, smokeRuntime, { type: "send-command", command: "stage-command", args: ["/opencode-smoke"] })
    expect(state.operatorActions?.staged?.command).toBe("/opencode-smoke")
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, smokeRuntime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/opencode-smoke", ok: false })
    expect(state.operatorActions?.commandError).toContain("[REDACTED]")
    expect(state.operatorActions?.staged?.command).toBe("/opencode-smoke")

    const blockedSmokeResult = {
      smoke_id: "smoke-blocked",
      status: "blocked",
      project_dir: "/tmp/demo",
      started_at: "2026-06-20T00:00:00.000Z",
      completed_at: "2026-06-20T00:00:00.000Z",
      diagnostics: ["opt-in missing"],
      error: "real OpenCode process smoke requires NXL_REAL_OPENCODE_SMOKE=1",
      requested_by: "operator",
      smoke_hash: "a".repeat(64),
    }
    const blockedSmokeRuntime: RuntimeClient = {
      stream: () => runtime.stream(),
      sendUserMessage: (message: string) => runtime.sendUserMessage(message),
      sendCommand: (command: string) => runtime.sendCommand(command),
      command: async (name: string, payload?: Record<string, unknown>) => {
        if (name === "runtime.execute_opencode_process_smoke") return blockedSmokeResult
        if (name === "runtime.list_opencode_process_smokes") return [{ smoke_id: "smoke-blocked", status: "blocked", completed_at: "2026-06-20T00:00:00.000Z", summary_preview: "blocked", smoke_hash: "a".repeat(64) }]
        return runtime.command(name, payload)
      },
    }
    state = await applyRuntimeUiEffect(state, blockedSmokeRuntime, { type: "send-command", command: "stage-command", args: ["/opencode-smoke"] })
    state = await applyRuntimeUiEffect(state, blockedSmokeRuntime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/opencode-smoke", ok: false })
    expect(state.operatorActions?.commandError).toContain("NXL_REAL_OPENCODE_SMOKE")
    expect(state.operatorActions?.staged?.command).toBe("/opencode-smoke")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/schedule-wake", "resume=missing-resume", "every=60s"] })
    expect(state.operatorActions?.staged?.command).toBe("/schedule-wake resume=missing-resume every=60s")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged" })
    expect(state.operatorActions?.lastResult).toMatchObject({ command: "/schedule-wake resume=missing-resume every=60s", ok: false })
    expect(state.operatorActions?.commandError).toContain("runtime resume anchor not found")
    expect(state.operatorActions?.staged?.command).toBe("/schedule-wake resume=missing-resume every=60s")
  })

  test("fake commander queue ordering applies priority tie-break before target id", () => {
    const ordered = orderQueueItems("needs_review", [
      {
        queue: "needs_review",
        target_type: "review",
        target_id: "a-normal",
        title: "normal",
        summary: "normal",
        status: "pending",
        priority: "normal",
        related_ids: {},
        updated_at: "1970-01-01T00:00:00.000Z",
      },
      {
        queue: "needs_review",
        target_type: "review",
        target_id: "z-high",
        title: "high",
        summary: "high",
        status: "pending",
        priority: "high",
        related_ids: {},
        updated_at: "1970-01-01T00:00:00.000Z",
      },
    ])

    expect(ordered.map((item) => item.target_id)).toEqual(["z-high", "a-normal"])
  })

  test("external API slash commands load connectors preview results and audit", async () => {
    const runtime = new ExternalApiRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "apis" })
    expect(state.externalApi?.connectors.map((connector) => connector.connector_id)).toEqual(["mock-research-api"])
    expect(runtime.calls.map((call) => call.name)).toContain("runtime.list_external_api_audit")
    expect(JSON.stringify(state)).not.toContain("default-header-secret")
    expect(layoutSnapshot(state)).not.toContain("default-header-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api", args: ["mock-research-api"] })
    expect(state.externalApi?.selectedConnector?.title).toContain("[REDACTED]")
    expect(JSON.stringify(state)).not.toContain("selected-default-header-secret")
    expect(layoutSnapshot(state)).not.toContain("selected-default-header-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api-preview", args: ["mock-research-api", "GET", "/search", "q=token=query-secret"] })
    expect(state.externalApi?.preview).toMatchObject({ connector_id: "mock-research-api", allowed: true })
    expect(JSON.stringify(state)).not.toContain("query-secret")
    expect(layoutSnapshot(state)).not.toContain("query-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api-call", args: ["mock-research-api", "GET", "/search"] })
    expect(state.externalApi?.lastResult).toMatchObject({ request_id: "fake-api-request-1", ok: true, dry_run: false })
    expect(JSON.stringify(state)).not.toContain("response-secret")
    expect(state.externalApi?.audit).toHaveLength(1)
    expect(layoutSnapshot(state)).toContain("External API")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api-audit" })
    expect(state.externalApi?.audit.at(0)).toMatchObject({ request_id: "fake-api-request-1" })
  })

  test("external API dry-run does not append audit and missing args are redacted errors", async () => {
    const runtime = new ExternalApiRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api-dry-run", args: ["mock-research-api", "GET", "/dry"] })
    expect(state.externalApi?.lastResult).toMatchObject({ ok: true, dry_run: true })
    expect(state.externalApi?.audit).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api-preview", args: ["mock-research-api"] })
    expect(state.externalApi?.commandError).toContain("method is required")
  })

  test("external API research ingestion slash commands render bounded redacted state", async () => {
    const runtime = new ExternalApiRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "api-ingest-preview",
      args: ["mock-research-api", "GET", "/search", "topic=topic-1", "source=API Source", "q=token=query-secret", "tag=api"],
    })
    expect(state.externalApi?.research?.preview).toMatchObject({ connector_id: "mock-research-api", topic_id: "topic-1", allowed: true })
    expect(JSON.stringify(state)).not.toContain("query-secret")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "api-ingest",
      args: ["mock-research-api", "GET", "/search", "topic=topic-1", "source=API Source"],
    })
    expect(state.externalApi?.research?.lastResult).toMatchObject({ ingestion_id: "fake-api-ingestion-1", source_id: "source-1", note_id: "note-1", artifact_id: "artifact-1" })
    expect(state.externalApi?.research?.ingestions).toHaveLength(1)
    expect(JSON.stringify(state)).not.toContain("response-secret")
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("External API research ingestion")
    expect(snapshot).toContain("source=source-1 note=note-1")
    expect(snapshot).not.toContain("response-secret")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "api-ingest-dry-run",
      args: ["mock-research-api", "GET", "/dry", "topic=topic-1", "source=Dry Source"],
    })
    expect(state.externalApi?.research?.lastResult).toMatchObject({ ok: true, dry_run: true, ingested_bytes: 0 })
    expect(state.externalApi?.research?.ingestions).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "api-ingestions" })
    expect(state.externalApi?.research?.ingestions.at(0)).toMatchObject({ ingestion_id: "fake-api-ingestion-1" })
  })

  test("external API research ingestion missing args produce redacted errors", async () => {
    const runtime = new ExternalApiRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "api-ingest-preview",
      args: ["mock-research-api", "GET", "/search", "source=token=source-secret"],
    })

    expect(state.externalApi?.commandError).toContain("topic is required")
    expect(JSON.stringify(state)).not.toContain("source-secret")
  })

  test("research synthesis slash commands render preview result proposals and recent rows", async () => {
    const runtime = new ResearchSynthesisRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "synthesize-preview",
      args: ["topic-1", "objective", "token=objective-secret"],
    })
    expect(state.researchSynthesis?.preview).toMatchObject({ topic_id: "topic-1", context_bytes: 128 })
    expect(JSON.stringify(state)).not.toContain("context-secret")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "synthesize",
      args: ["topic-1", "summarize"],
    })
    expect(state.researchSynthesis?.selected).toMatchObject({ synthesis_id: "synthesis-1", source_note_id: "note-synth-1", artifact_id: "artifact-synth-1" })
    expect(state.researchSynthesis?.recent.at(0)).toMatchObject({ synthesis_id: "synthesis-1" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Research synthesis")
    expect(snapshot).toContain("selected_synthesis=synthesis-1")
    expect(snapshot).not.toContain("summary-secret")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "synthesize-proposals",
      args: ["topic-1"],
    })
    expect(state.researchSynthesis?.selected?.proposal_ids).toEqual(["proposal-synth-1"])
    expect(state.proposals?.recent.at(0)).toMatchObject({ proposal_id: "proposal-synth-1", status: "proposed" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "syntheses" })
    expect(state.researchSynthesis?.recent.at(0)).toMatchObject({ synthesis_id: "synthesis-1" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "synthesis", args: ["synthesis-1"] })
    expect(state.researchSynthesis?.selected).toMatchObject({ synthesis_id: "synthesis-1" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("proposals=proposal-synth-1")
  })

  test("research synthesis missing args and secret-looking output are redacted", async () => {
    const runtime = new ResearchSynthesisRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "synthesize-preview" })
    expect(state.researchSynthesis?.commandError).toContain("topicId is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "synthesize", args: ["topic-1"] })
    expect(JSON.stringify(state)).not.toContain("title-secret")
    expect(JSON.stringify(state)).not.toContain("summary-secret")
    expect(JSON.stringify(state)).not.toContain("finding-secret")
    expect(JSON.stringify(state)).not.toContain("requester-secret")
  })

  test("commander cycle slash commands render preview result proposals bundle and recent rows", async () => {
    const runtime = new CommanderCycleRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "cycle-preview",
      args: ["topic=topic-1", "objective", "token=objective-secret"],
    })
    expect(state.commanderCycle?.preview).toMatchObject({ topic_id: "topic-1", context_bytes: 192 })
    expect(JSON.stringify(state)).not.toContain("context-secret")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "cycle",
      args: ["topic=topic-1", "inspect"],
    })
    expect(state.commanderCycle?.selected).toMatchObject({ cycle_id: "cycle-1", proposal_ids: [] })
    expect(state.commanderCycle?.recent.at(0)).toMatchObject({ cycle_id: "cycle-1" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Commander cycle")
    expect(snapshot).toContain("selected_cycle=cycle-1")
    expect(snapshot).not.toContain("summary-secret")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "cycle-proposals",
      args: ["topic=topic-1"],
    })
    expect(state.commanderCycle?.selected?.proposal_ids).toEqual(["proposal-cycle-1"])
    expect(state.proposals?.recent.at(0)).toMatchObject({ proposal_id: "proposal-cycle-1", status: "proposed" })

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "cycle-bundle",
      args: ["topic=topic-1"],
    })
    expect(state.commanderCycle?.selected?.bundle_id).toBe("bundle-cycle-1")
    expect(state.proposalBundles?.recent.at(0)).toMatchObject({ bundle_id: "bundle-cycle-1", status: "open" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cycles" })
    expect(state.commanderCycle?.recent.at(0)).toMatchObject({ cycle_id: "cycle-1" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cycle-show", args: ["cycle-1"] })
    expect(state.commanderCycle?.selected).toMatchObject({ cycle_id: "cycle-1" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("proposals=proposal-cycle-1")
    expect(snapshot).toContain("bundle=bundle-cycle-1")
  })

  test("commander cycle missing args and secret-looking output are redacted", async () => {
    const runtime = new CommanderCycleRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cycle-preview" })
    expect(state.commanderCycle?.commandError).toContain("topic, mission, or objective is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cycle", args: ["topic=topic-1"] })
    expect(JSON.stringify(state)).not.toContain("title-secret")
    expect(JSON.stringify(state)).not.toContain("summary-secret")
    expect(JSON.stringify(state)).not.toContain("finding-secret")
    expect(JSON.stringify(state)).not.toContain("requester-secret")
  })

  test("commander cycle objective-only slash commands reach runtime", async () => {
    const runtime = new CommanderCycleRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "cycle-preview",
      args: ["inspect", "next", "step"],
    })
    expect(state.commanderCycle?.preview).toMatchObject({ objective: "inspect next step" })
    expect(runtime.calls.at(-1)).toMatchObject({
      name: "runtime.preview_commander_cycle",
      payload: { objective: "inspect next step" },
    })

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "cycle",
      args: ["inspect", "next", "step"],
    })
    expect(state.commanderCycle?.selected).toMatchObject({ objective: "inspect next step" })
    expect(runtime.calls.find((call) => call.name === "runtime.execute_commander_cycle")).toMatchObject({
      payload: { objective: "inspect next step" },
    })
  })

  test("opencode handoff slash commands render preview dry-run execute and recent rows", async () => {
    const runtime = new OpenCodeHandoffRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "handoff-preview",
      args: ["proposal-approved"],
    })
    expect(state.opencodeHandoff?.preview).toMatchObject({ proposal_id: "proposal-approved", eligible: true, review_status: "approved" })
    expect(JSON.stringify(state)).not.toContain("objective-secret")
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode handoff")
    expect(snapshot).toContain("preview_proposal=proposal-approved eligible=true")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "handoff-dry-run",
      args: ["proposal-approved"],
    })
    expect(state.opencodeHandoff?.lastResult).toMatchObject({ handoff_id: "dry-run", sent: false, dry_run: true })
    expect(state.opencodeHandoff?.recent).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "handoff",
      args: ["proposal-approved"],
    })
    expect(state.opencodeHandoff?.lastResult).toMatchObject({ handoff_id: "handoff-1", mission_id: "mission-handoff-1", sent: true })
    expect(state.opencodeHandoff?.recent.at(0)).toMatchObject({ handoff_id: "handoff-1", mission_id: "mission-handoff-1" })
    expect(state.proposals?.recent.at(0)).toMatchObject({ proposal_id: "proposal-approved", status: "applied" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoffs" })
    expect(state.opencodeHandoff?.recent.at(0)).toMatchObject({ handoff_id: "handoff-1" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-show", args: ["handoff-1"] })
    expect(state.opencodeHandoff?.lastResult).toMatchObject({ handoff_id: "handoff-1" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("last_handoff=handoff-1")
    expect(snapshot).not.toContain("requester-secret")
  })

  test("opencode handoff missing args blockers and secret-looking output are redacted", async () => {
    const runtime = new OpenCodeHandoffRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-preview" })
    expect(state.opencodeHandoff?.commandError).toContain("proposalId is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-preview", args: ["proposal-pending"] })
    expect(state.opencodeHandoff?.preview).toMatchObject({ eligible: false })
    expect(JSON.stringify(state)).not.toContain("blocker-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff", args: ["proposal-pending"] })
    expect(state.opencodeHandoff?.commandError).toContain("linked review must be approved")
    expect(JSON.stringify(state)).not.toContain("execute-secret")
  })

  test("opencode process smoke commands render preview dry-run execute records and authority profile", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-smoke-preview" })
    expect(state.opencodeProcessSmoke?.preview).toMatchObject({ status: "ready", can_execute: true, adapter_kind: "fake" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode process smoke")
    expect(snapshot).toContain("preview_status=ready")
    expect(snapshot).toContain("note=real smoke is opt-in and not part of default CI")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-smoke-dry-run" })
    expect(state.opencodeProcessSmoke?.latestResult).toMatchObject({ smoke_id: "fake-smoke-dry-run", status: "skipped" })
    expect(state.opencodeProcessSmoke?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-smoke" })
    expect(state.opencodeProcessSmoke?.latestResult).toMatchObject({ smoke_id: "fake-smoke-1", status: "succeeded" })
    expect(state.opencodeProcessSmoke?.records.at(0)).toMatchObject({ smoke_id: "fake-smoke-1", status: "succeeded" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-smokes" })
    expect(state.opencodeProcessSmoke?.records.at(0)).toMatchObject({ smoke_id: "fake-smoke-1" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-smoke-show", args: ["fake-smoke-1"] })
    expect(state.opencodeProcessSmoke?.selected).toMatchObject({ smoke_id: "fake-smoke-1" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/opencode-smoke"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_opencode_process_smoke_tui.py")

    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("latest=fake-smoke-1 status=succeeded")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("opencode handoff readiness slash commands render preview summary and redact secrets", async () => {
    const runtime = new OpenCodeHandoffRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-readiness" })
    expect(state.opencodeHandoffReadiness?.preview).toMatchObject({
      status: "ready",
      can_execute_now: false,
      authority: expect.objectContaining({ risk: "high_impact_write", gate: "handoff_runtime" }),
    })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode handoff readiness")
    expect(snapshot).toContain("can_execute_now=false")
    expect(snapshot).toContain("note=readiness preview does not execute handoff or launch OpenCode")
    expect(snapshot).not.toContain("summary-secret")
    expect(JSON.stringify(state)).not.toContain("evidence-secret")
    expect(JSON.stringify(state)).not.toContain("command-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-readiness", args: ["proposal=proposal-pending"] })
    expect(state.opencodeHandoffReadiness?.preview).toMatchObject({ status: "needs_review", proposal_id: "proposal-pending" })
    expect(state.opencodeHandoffReadiness?.preview?.blockers.at(0)).toContain("linked review must be approved")
    expect(JSON.stringify(state)).not.toContain("readiness-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-readiness", args: ["mission=mission_1"] })
    expect(state.opencodeHandoffReadiness?.preview).toMatchObject({ mission_id: "mission_1" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-readiness", args: ["handoff=missing-handoff"] })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("optional_evidence")
    expect(snapshot).toContain("handoff_followup:missing")
    expect(snapshot).toContain("missing-handoff not found")
    expect(snapshot).not.toContain("optional-secret")
    expect(snapshot).not.toContain("optional-warning-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-readiness-summary" })
    expect(state.opencodeHandoffReadiness?.summary).toMatchObject({ ready_count: 1, latest_smoke_status: "succeeded" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("summary ready=1")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-ready" })
    expect(state.opencodeHandoffReadiness?.preview).toMatchObject({ status: "ready" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-readiness", args: ["token=abc123"] })
    expect(state.opencodeHandoffReadiness?.commandError).toContain("handoff readiness arg is unsupported")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("opencode handoff readiness fake path and authority profile are available", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-handoff-readiness" })
    expect(state.opencodeHandoffReadiness?.preview).toMatchObject({ status: "ready", can_execute_now: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/handoff-readiness"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_opencode_handoff_readiness_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/handoff-readiness-summary"] })
    expect(state.commandAuthority?.selected).toMatchObject({ slash_command: "/handoff-readiness-summary", risk: "safe_read" })
  })

  test("opencode result review packet slash commands render summary targets and redact secrets", async () => {
    const runtime = new OpenCodeHandoffRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "result-review-packet" })
    expect(state.opencodeResultReview?.packet).toMatchObject({ status: "ready_for_commander_review", result_id: "result-handoff-1" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode result review packet")
    expect(snapshot).toContain("note=packet preview does not call Commander/provider or create proposals")
    expect(snapshot).toContain("evidence")
    expect(snapshot).toContain("recommended_commands")
    expect(snapshot).not.toContain("packet-result-secret")
    expect(JSON.stringify(state)).not.toContain("packet-objective-secret")
    expect(JSON.stringify(state)).not.toContain("packet-executor-secret")
    expect(JSON.stringify(state)).not.toContain("packet-result-secret")
    expect(JSON.stringify(state)).not.toContain("packet-command-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "result-review-packet", args: ["handoff=handoff-needs-result"] })
    expect(state.opencodeResultReview?.packet).toMatchObject({ handoff_id: "handoff-needs-result", status: "needs_result" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-result-review", args: ["mission=mission-handoff-1"] })
    expect(state.opencodeResultReview?.packet).toMatchObject({ mission_id: "mission-handoff-1" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-result-review", args: ["proposal=proposal-approved"] })
    expect(state.opencodeResultReview?.packet).toMatchObject({ proposal_id: "proposal-approved" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "result-review-summary" })
    expect(state.opencodeResultReview?.summary).toMatchObject({ ready_count: 1, latest_result_id: "result-handoff-1" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("summary total=1 ready=1")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/result-review-packet"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_opencode_result_review_packet_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "result-review-packet", args: ["token=abc123"] })
    expect(state.opencodeResultReview?.commandError).toContain("result review packet arg is unsupported")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("opencode result review fake path and authority record are available", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-result-review" })
    expect(state.opencodeResultReview?.packet).toMatchObject({ status: expect.any(String) })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "result-review-summary" })
    expect(state.opencodeResultReview?.summary).toMatchObject({ total_considered: expect.any(Number) })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/result-review-packet"] })
    expect(state.commandAuthority?.selected).toMatchObject({ slash_command: "/result-review-packet", risk: "safe_read" })
  })

  test("commander executor review slash commands render fake review results and redact secrets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-preview", args: ["result=result-handoff-1"] })
    expect(state.commanderExecutorReview?.preview).toMatchObject({ can_execute: true, packet_status: "ready_for_commander_review" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Commander executor review")
    expect(snapshot).toContain("note=executor review does not create proposals or apply changes")
    expect(snapshot).toContain("recommended_commands")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-dry-run", args: ["result=result-handoff-1"] })
    expect(state.commanderExecutorReview?.latestResult).toMatchObject({ review_id: "dry-run", status: "blocked", decision: "accept_result" })
    expect(state.commanderExecutorReview?.records).toHaveLength(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review", args: ["result=result-handoff-1"] })
    expect(state.commanderExecutorReview?.latestResult).toMatchObject({ status: "succeeded", decision: "accept_result" })
    const reviewId = state.commanderExecutorReview?.latestResult?.review_id
    expect(reviewId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-reviews" })
    expect(state.commanderExecutorReview?.records.length).toBeGreaterThanOrEqual(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-show", args: [reviewId!] })
    expect(state.commanderExecutorReview?.selected).toMatchObject({ review_id: reviewId, status: "succeeded" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-draft-preview", args: [`review=${reviewId}`] })
    const draftId = state.executorReviewProposalDrafts?.preview?.candidates[0]?.draft_id
    expect(state.executorReviewProposalDrafts?.preview?.status).toBe("ready")
    expect(state.executorReviewProposalDrafts?.preview?.can_create_proposals_now).toBe(false)
    expect(state.executorReviewProposalDrafts?.preview?.candidates[0]?.draft_kind).toBe("mission_result")
    expect(state.executorReviewProposalDrafts?.preview?.candidates[0]?.would_create_proposal).toBe(false)
    expect(draftId).toBeTruthy()
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Executor review proposal drafts")
    expect(snapshot).toContain("note=draft preview does not create proposals, request reviews, or apply changes")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create-preview", args: [`review=${reviewId}`, `draft=${draftId}`] })
    expect(state.executorReviewProposalCreate?.preview).toMatchObject({ status: "ready", can_create: true, review_id: reviewId, draft_id: draftId })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Executor review proposal creation")
    expect(snapshot).toContain("note=proposal creation does not request review, apply changes, mutate mission, call provider, or launch OpenCode")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create-dry-run", args: [`review=${reviewId}`, `draft=${draftId}`] })
    expect(state.executorReviewProposalCreate?.latestResult).toMatchObject({ status: "dry_run", proposal_id: undefined })
    expect(state.executorReviewProposalCreate?.records).toHaveLength(0)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create-dry-run", args: [`review=${reviewId}`, "draft=missing-draft"] })
    expect(state.executorReviewProposalCreate?.latestResult).toMatchObject({ status: "blocked", proposal_id: undefined })
    expect(state.executorReviewProposalCreate?.commandError).toContain("requested draft_id was not found")
    expect(state.executorReviewProposalCreate?.records).toHaveLength(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create", args: [`review=${reviewId}`, `draft=${draftId}`] })
    expect(state.executorReviewProposalCreate?.latestResult).toMatchObject({ status: "created", proposal_id: "fake-proposal-1" })
    expect(state.executorReviewProposalCreate?.records).toHaveLength(1)
    const fakeProposal = await runtime.command("runtime.get_commander_proposal", { proposalId: "fake-proposal-1" }) as Record<string, unknown>
    expect(fakeProposal).toMatchObject({
      proposal_id: "fake-proposal-1",
      mission_id: "mission-handoff-1",
      result_id: "result-handoff-1",
      action_payload: expect.objectContaining({
        source: "executor_review_proposal_create",
        review_id: reviewId,
        draft_id: draftId,
        target_mission_id: "mission-handoff-1",
        target_result_id: "result-handoff-1",
      }),
    })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create", args: [`review=${reviewId}`, `draft=${draftId}`] })
    expect(state.executorReviewProposalCreate?.latestResult).toMatchObject({ status: "created", proposal_id: "fake-proposal-1" })
    expect(state.executorReviewProposalCreate?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-preview", args: ["proposal=fake-proposal-1"] })
    expect(state.executorReviewProposalReviewRequest?.preview).toMatchObject({ status: "ready", can_request: true, proposal_id: "fake-proposal-1", review_id: reviewId, draft_id: draftId })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Executor review proposal review request")
    expect(snapshot).toContain("note=review request does not approve, reject, apply, mutate mission, call provider, or launch OpenCode")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-dry-run", args: ["proposal=fake-proposal-1"] })
    expect(state.executorReviewProposalReviewRequest?.latestResult).toMatchObject({ status: "dry_run", review_request_id: undefined })
    expect(state.executorReviewProposalReviewRequest?.records).toHaveLength(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-request", args: ["proposal=fake-proposal-1"] })
    expect(state.executorReviewProposalReviewRequest?.latestResult).toMatchObject({ status: "requested", review_request_id: "fake-review-request-1" })
    expect(state.executorReviewProposalReviewRequest?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-request", args: ["proposal=fake-proposal-1"] })
    expect(state.executorReviewProposalReviewRequest?.latestResult).toMatchObject({ status: "requested", review_request_id: "fake-review-request-1" })
    expect(state.executorReviewProposalReviewRequest?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-request", args: ["proposal=fake-proposal-1", "create=wrong-create"] })
    expect(state.executorReviewProposalReviewRequest?.latestResult).toMatchObject({ status: "blocked", error: "create_id does not match the proposal source create record" })
    expect(state.executorReviewProposalReviewRequest?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-requests" })
    expect(state.executorReviewProposalReviewRequest?.records).toEqual([expect.objectContaining({ status: "requested", review_request_id: "fake-review-request-1", proposal_id: "fake-proposal-1" })])
    const requestGateId = state.executorReviewProposalReviewRequest?.records[0]?.request_gate_id
    expect(requestGateId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-show", args: [requestGateId!] })
    expect(state.executorReviewProposalReviewRequest?.selected).toMatchObject({ request_gate_id: requestGateId, status: "requested", review_request_id: "fake-review-request-1" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-decision-preview", args: ["review=fake-review-request-1", "decision=approve"] })
    expect(state.executorReviewProposalReviewDecision?.preview).toMatchObject({ status: "ready", can_decide: true, decision: "approve", review_request_id: "fake-review-request-1", proposal_id: "fake-proposal-1" })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Executor review proposal review decision")
    expect(snapshot).toContain("note=review decision does not apply proposals, mutate missions, call provider, or launch OpenCode")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-decision-dry-run", args: ["review=fake-review-request-1", "decision=approve"] })
    expect(state.executorReviewProposalReviewDecision?.latestResult).toMatchObject({ status: "dry_run", decision: "approve", review_request_id: "fake-review-request-1" })
    expect(state.executorReviewProposalReviewDecision?.records).toHaveLength(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/executor-review-proposal-review-approve review=missing-review"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged", args: [] })
    expect(state.operatorActions?.lastResult).toMatchObject({ ok: false })
    expect(state.executorReviewProposalReviewDecision?.commandError).toContain("review_request_id was not found")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review-proposal-review-request"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_executor_review_proposal_review_request_tui.py")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review-proposal-review-approve"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-preview", args: ["proposal=fake-proposal-1", "create=wrong-create"] })
    expect(state.executorReviewProposalReviewRequest?.preview).toMatchObject({ status: "blocked", can_request: false })
    expect(state.executorReviewProposalReviewRequest?.preview?.blockers).toContain("create_id does not match the proposal source create record")

    const ordinaryProposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "Ordinary proposal",
      summary: "Manual proposal not created by executor review proposal gate.",
      proposedBy: "operator",
    }) as { proposal_id: string }
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-preview", args: [`proposal=${ordinaryProposal.proposal_id}`] })
    expect(state.executorReviewProposalReviewRequest?.preview).toMatchObject({ status: "blocked", can_request: false })
    expect(state.executorReviewProposalReviewRequest?.preview?.proposal_id).toBe(ordinaryProposal.proposal_id)
    expect(state.executorReviewProposalReviewRequest?.preview?.blockers).toContain("proposal was not created by executor-review proposal creation gate")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/executor-review-proposal-review-request proposal=missing-proposal"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged", args: [] })
    expect(state.operatorActions?.lastResult).toMatchObject({ ok: false })
    expect(state.executorReviewProposalReviewRequest?.commandError).toContain("proposal_id was not found")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "cancel-proposal", args: ["fake-proposal-1", "operator", "cancelled"] })
    expect(state.proposals?.selectedProposal?.status).toBe("cancelled")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create", args: [`review=${reviewId}`, `draft=${draftId}`] })
    expect(state.executorReviewProposalCreate?.latestResult).toMatchObject({ status: "blocked", proposal_id: "fake-proposal-1" })
    expect(state.executorReviewProposalCreate?.commandError).toContain("proposal already exists for this executor review draft and was cancelled")
    expect(state.executorReviewProposalCreate?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create", args: [`review=${reviewId}`, "draft=missing-draft"] })
    expect(state.executorReviewProposalCreate?.latestResult).toMatchObject({ status: "blocked", proposal_id: undefined })
    expect(state.executorReviewProposalCreate?.commandError).toContain("requested draft_id was not found")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-creates" })
    expect(state.executorReviewProposalCreate?.records).toEqual([expect.objectContaining({ status: "created", proposal_id: "fake-proposal-1" })])
    const createId = state.executorReviewProposalCreate?.records[0]?.create_id
    expect(createId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create-show", args: [createId!] })
    expect(state.executorReviewProposalCreate?.selected).toMatchObject({ create_id: createId, status: "created", proposal_id: "fake-proposal-1" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review-proposal-create"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_executor_review_proposal_create_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-draft-preview", args: ["review=missing-review"] })
    expect(state.executorReviewProposalDrafts?.preview).toMatchObject({
      status: "unknown",
      candidates: [],
      blockers: [expect.stringContaining("no Commander executor review matched")],
    })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-draft-preview", args: ["result=missing-result"] })
    expect(state.executorReviewProposalDrafts?.preview).toMatchObject({
      status: "unknown",
      candidates: [],
      blockers: [expect.stringContaining("no Commander executor review matched")],
    })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-draft-summary" })
    expect(state.executorReviewProposalDrafts?.summary).toMatchObject({ draftable_review_count: 1, candidate_count: 1 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_commander_executor_review_tui.py")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review-draft-preview"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_executor_review_proposal_draft_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-preview", args: ["token=abc123"] })
    expect(state.commanderExecutorReview?.commandError).toContain("executor review arg is unsupported")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-draft-preview", args: ["token=abc123"] })
    expect(state.executorReviewProposalDrafts?.commandError).toContain("executor review draft arg is unsupported")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-create-preview", args: ["review=missing-review", "token=abc123"] })
    expect(state.executorReviewProposalCreate?.commandError).toContain("executor review proposal create arg is unsupported")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-preview", args: ["proposal=missing-proposal", "token=abc123"] })
    expect(state.executorReviewProposalReviewRequest?.commandError).toContain("executor review proposal review request arg is unsupported")
    snapshot = layoutSnapshot(state)
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(snapshot).not.toContain("abc123")
  })

  test("executor review proposal review decision fake path approves rejects and dedupes", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    const createRequest = async (current: UiState): Promise<{ state: UiState; reviewRequestId: string; proposalId: string; createId: string }> => {
      let next = await applyRuntimeUiEffect(current, runtime, { type: "send-command", command: "executor-review", args: ["result=result-handoff-1"] })
      const reviewId = next.commanderExecutorReview?.latestResult?.review_id
      expect(reviewId).toBeTruthy()
      next = await applyRuntimeUiEffect(next, runtime, { type: "send-command", command: "executor-review-draft-preview", args: [`review=${reviewId}`] })
      const draftId = next.executorReviewProposalDrafts?.preview?.candidates[0]?.draft_id
      expect(draftId).toBeTruthy()
      next = await applyRuntimeUiEffect(next, runtime, { type: "send-command", command: "executor-review-proposal-create", args: [`review=${reviewId}`, `draft=${draftId}`] })
      const proposalId = next.executorReviewProposalCreate?.latestResult?.proposal_id
      const createId = next.executorReviewProposalCreate?.latestResult?.create_id
      expect(proposalId).toBeTruthy()
      expect(createId).toBeTruthy()
      next = await applyRuntimeUiEffect(next, runtime, { type: "send-command", command: "executor-review-proposal-review-request", args: [`proposal=${proposalId}`] })
      const reviewRequestId = next.executorReviewProposalReviewRequest?.latestResult?.review_request_id
      expect(reviewRequestId).toBeTruthy()
      return { state: next, reviewRequestId: reviewRequestId!, proposalId: proposalId!, createId: createId! }
    }

    const first = await createRequest(state)
    state = first.state
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-approve", args: [`review=${first.reviewRequestId}`] })
    expect(state.executorReviewProposalReviewDecision?.latestResult).toMatchObject({ status: "approved", decision: "approve", review_request_id: first.reviewRequestId })
    expect(state.executorReviewProposalReviewDecision?.records).toHaveLength(1)
    const approvedGateId = state.executorReviewProposalReviewDecision?.records[0]?.decision_gate_id
    expect(approvedGateId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`proposal=${first.proposalId}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({
      status: "ready",
      can_apply_in_future: true,
      proposal_id: first.proposalId,
      review_request_id: first.reviewRequestId,
      decision_gate_id: approvedGateId,
      candidate_kind: "mission_result",
      candidate_risk: "high",
    })
    let applyReadinessSnapshot = layoutSnapshot(state)
    expect(applyReadinessSnapshot).toContain("Executor review proposal apply readiness")
    expect(applyReadinessSnapshot).toContain("note=apply readiness does not apply proposals, mutate missions, call provider, or launch OpenCode")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`review=${first.reviewRequestId}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({ status: "ready", proposal_id: first.proposalId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`decision=${approvedGateId}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({ status: "ready", proposal_id: first.proposalId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`create=${first.createId}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({ status: "ready", proposal_id: first.proposalId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness-summary" })
    expect(state.executorReviewProposalApplyReadiness?.summary).toMatchObject({ ready_count: 1, high_risk_count: 1 })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness-list", args: ["status=ready"] })
    expect(state.executorReviewProposalApplyReadiness?.records).toEqual([expect.objectContaining({ status: "ready", proposal_id: first.proposalId })])
    const readinessId = state.executorReviewProposalApplyReadiness?.records[0]?.readiness_id
    expect(readinessId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness-show", args: [readinessId!] })
    expect(state.executorReviewProposalApplyReadiness?.selected).toMatchObject({
      status: "ready",
      proposal_id: first.proposalId,
      can_apply_in_future: true,
      blockers: [],
      recommended_commands: expect.arrayContaining([expect.objectContaining({ command: `/proposal ${first.proposalId}` })]),
    })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-narrow-apply-preview", args: [`proposal=${first.proposalId}`] })
    expect(state.executorReviewProposalNarrowApply?.preview).toMatchObject({
      status: "blocked",
      can_apply: false,
      proposal_id: first.proposalId,
      candidate_kind: "mission_result",
    })
    expect(state.executorReviewProposalNarrowApply?.preview?.blockers).toContain("mission_result proposals are out of scope for narrow apply")
    let narrowApplySnapshot = layoutSnapshot(state)
    expect(narrowApplySnapshot).toContain("Executor review proposal narrow apply")
    expect(narrowApplySnapshot).toContain("note=narrow apply marks the proposal applied only")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-narrow-apply-dry-run", args: [`proposal=${first.proposalId}`] })
    expect(state.executorReviewProposalNarrowApply?.latestResult).toMatchObject({ status: "blocked", proposal_id: first.proposalId })
    expect(state.executorReviewProposalNarrowApply?.commandError).toContain("mission_result proposals are out of scope for narrow apply")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-narrow-applies" })
    expect(state.executorReviewProposalNarrowApply?.records).toEqual([])
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: [`/executor-review-proposal-narrow-apply proposal=${first.proposalId}`] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-narrow-apply-preview", args: ["token=abc123"] })
    expect(state.executorReviewProposalNarrowApply?.commandError).toContain("executor review proposal narrow apply arg is unsupported")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review-proposal-narrow-apply"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_executor_review_proposal_narrow_apply_tui.py")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/executor-review-proposal-apply-readiness"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_executor_review_proposal_apply_readiness_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-approve", args: [`review=${first.reviewRequestId}`] })
    expect(state.executorReviewProposalReviewDecision?.latestResult).toMatchObject({ status: "approved", decision_gate_id: approvedGateId })
    expect(state.executorReviewProposalReviewDecision?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-reject", args: [`review=${first.reviewRequestId}`, "reason=conflicting decision"] })
    expect(state.executorReviewProposalReviewDecision?.latestResult).toMatchObject({ status: "blocked", decision: "reject", error: "review request already approved" })
    expect(state.executorReviewProposalReviewDecision?.commandError).toContain("review request already approved")

    const second = await createRequest(state)
    state = second.state
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-decision-preview", args: [`review=${second.reviewRequestId}`, "decision=reject"] })
    expect(state.executorReviewProposalReviewDecision?.preview).toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["reject decision requires reason"]),
    })
    expect(state.executorReviewProposalReviewDecision?.commandError).toBeUndefined()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-reject", args: [`review=${second.reviewRequestId}`, "reason=needs human review"] })
    expect(state.executorReviewProposalReviewDecision?.latestResult).toMatchObject({ status: "rejected", decision: "reject", review_request_id: second.reviewRequestId })
    expect(state.executorReviewProposalReviewDecision?.records).toHaveLength(2)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`proposal=${second.proposalId}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({ status: "rejected", can_apply_in_future: false, proposal_id: second.proposalId })

    const pending = await createRequest(state)
    state = pending.state
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`proposal=${pending.proposalId}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({ status: "needs_review", can_apply_in_future: false, proposal_id: pending.proposalId })
    const ordinaryProposal = await runtime.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "Novel generic proposal",
      summary: "Novel manual content is not rejected by topic.",
      proposedBy: "operator",
    }) as { proposal_id: string }
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-apply-readiness", args: [`proposal=${ordinaryProposal.proposal_id}`] })
    expect(state.executorReviewProposalApplyReadiness?.preview).toMatchObject({ status: "blocked", candidate_kind: "generic" })
    expect(state.executorReviewProposalApplyReadiness?.preview?.blockers).toContain("proposal was not created by executor-review proposal creation gate")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-decisions" })
    expect(state.executorReviewProposalReviewDecision?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "approved", review_request_id: first.reviewRequestId }),
      expect.objectContaining({ status: "rejected", review_request_id: second.reviewRequestId }),
    ]))
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-decision-show", args: [approvedGateId!] })
    expect(state.executorReviewProposalReviewDecision?.selected).toMatchObject({ decision_gate_id: approvedGateId, status: "approved" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-reject", args: [`review=${second.reviewRequestId}`] })
    expect(state.executorReviewProposalReviewDecision?.commandError).toContain("executor review proposal review reject requires reason=<reason>")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-approve", args: [`review=${second.reviewRequestId}`, "decision=reject", "reason=should not override"] })
    expect(state.executorReviewProposalReviewDecision?.commandError).toContain("executor review proposal review approve command cannot use decision=reject")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "executor-review-proposal-review-decision-preview", args: [`review=${second.reviewRequestId}`, "decision=invalid"] })
    expect(state.executorReviewProposalReviewDecision?.commandError).toContain("executor review proposal review decision must be approve or reject")

    const snapshot = layoutSnapshot(state)
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(snapshot).not.toContain("abc123")
  })

  test("opencode handoff follow-up slash commands render summary queues selected and redact secrets", async () => {
    const runtime = new OpenCodeHandoffRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-followups" })
    expect(state.opencodeFollowup?.summary).toMatchObject({ sent_count: 1, result_submitted_count: 1 })
    expect(state.opencodeFollowup?.queueItems.at(0)).toMatchObject({ handoff_id: "handoff-1", followup_status: "sent" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-followup-summary" })
    expect(state.opencodeFollowup?.summary).toMatchObject({ stale_count: 1 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-queue", args: ["needs_result_review"] })
    expect(state.opencodeFollowup?.selectedQueue).toBe("needs_result_review")
    expect(state.opencodeFollowup?.queueItems.at(0)).toMatchObject({ followup_status: "result_submitted" })

    for (const command of ["handoff-active", "handoff-results", "handoff-failed", "handoff-blocked", "handoff-stale"]) {
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command })
      expect(state.opencodeFollowup?.queueItems.length).toBeGreaterThan(0)
    }

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-followup", args: ["handoff-1"] })
    expect(state.opencodeFollowup?.selected).toMatchObject({ handoff_id: "handoff-1", latest_result_id: "result-handoff-1" })
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode follow-up")
    expect(snapshot).toContain("selected=handoff-1 status=result_submitted")
    expect(snapshot).not.toContain("followup-blocker-secret")
    expect(snapshot).not.toContain("followup-command-secret")
    expect(JSON.stringify(state)).not.toContain("followup-evidence-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-followup" })
    expect(state.opencodeFollowup?.commandError).toContain("handoffId is required")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "handoff-queue", args: ["bad"] })
    expect(state.opencodeFollowup?.commandError).toContain("handoff follow-up queue is invalid")
    expect(JSON.stringify(state)).not.toContain("queue-secret")
  })

  test("runtime checkpoint slash commands render preview create list and selected checkpoint", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint-preview" })
    expect(state.runtimeCheckpoints?.preview).toMatchObject({ scope: "full", blockers: [] })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Runtime checkpoints")
    expect(snapshot).toContain("preview_scope=full")

    state = await applyRuntimeUiEffect(state, runtime, {
      type: "send-command",
      command: "checkpoint",
      args: ["full", "e2e", "checkpoint", "token=checkpoint-secret"],
    })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id
    expect(checkpointId).toMatch(/^fake-checkpoint-/)
    expect(state.runtimeCheckpoints?.selected).toMatchObject({ scope: "full", restore_supported: false })
    expect(state.runtimeCheckpoints?.recent.at(0)).toMatchObject({ checkpoint_id: checkpointId, scope: "full" })
    expect(JSON.stringify(state)).not.toContain("checkpoint-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoints" })
    expect(state.runtimeCheckpoints?.recent.at(0)).toMatchObject({ checkpoint_id: checkpointId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint-show", args: [checkpointId ?? "missing"] })
    expect(state.runtimeCheckpoints?.selected).toMatchObject({ checkpoint_id: checkpointId })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain(`selected_checkpoint=${checkpointId}`)
    expect(snapshot).toContain("restore_supported=false")
  })

  test("runtime checkpoint invalid scope and secret-looking state are redacted", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint-preview", args: ["invalid"] })
    expect(state.runtimeCheckpoints?.commandError).toContain("runtime checkpoint scope is invalid")
    expect(JSON.stringify(state)).not.toContain("invalid-secret")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["research", "token=checkpoint-secret"] })
    expect(JSON.stringify(state)).not.toContain("checkpoint-secret")
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Runtime checkpoints")
    expect(snapshot).not.toContain("checkpoint-secret")
  })

  test("runtime restore slash commands preview mark list and selected anchor", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=restore-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "restore-preview", args: [checkpointId] })
    expect(state.runtimeRestore?.preview).toMatchObject({ checkpoint_id: checkpointId, can_mark_resume: true })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Checkpoint resume")
    expect(snapshot).toContain(`preview_checkpoint=${checkpointId}`)
    expect(snapshot).toContain("drift=advanced")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-preview", args: [checkpointId] })
    expect(state.runtimeRestore?.preview?.checkpoint_id).toBe(checkpointId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-mark", args: [checkpointId] })
    const resumeId = state.runtimeRestore?.selectedAnchor?.resume_id
    expect(resumeId).toMatch(/^fake-resume-/)
    expect(state.runtimeRestore?.recentAnchors.at(0)).toMatchObject({ resume_id: resumeId, checkpoint_id: checkpointId })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-anchors" })
    expect(state.runtimeRestore?.recentAnchors.at(0)).toMatchObject({ resume_id: resumeId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-anchor", args: [resumeId ?? "missing"] })
    expect(state.runtimeRestore?.selectedAnchor).toMatchObject({ resume_id: resumeId, checkpoint_id: checkpointId })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain(`selected_anchor=${resumeId}`)
    expect(JSON.stringify(state)).not.toContain("restore-secret")
    expect(snapshot).not.toContain("restore-secret")
  })

  test("runtime restore missing args and missing checkpoint are redacted errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "restore-preview" })
    expect(state.runtimeRestore?.commandError).toContain("checkpointId is required")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "restore-preview", args: ["missing-token=restore-secret"] })
    expect(state.runtimeRestore?.preview?.can_mark_resume).toBe(false)
    expect(JSON.stringify(state)).not.toContain("restore-secret")
  })

  test("wake assessment slash commands preview create list and select", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=wake-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-mark", args: [checkpointId] })
    const resumeId = state.runtimeRestore?.selectedAnchor?.resume_id ?? "missing"

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-preview", args: [`resume=${resumeId}`] })
    expect(state.wakeAssessment?.preview).toMatchObject({ allowed: true, resume_id: resumeId, checkpoint_id: checkpointId })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Wake assessment")
    expect(snapshot).toContain(`resume=${resumeId}`)
    expect(snapshot).toContain(`checkpoint=${checkpointId}`)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake", args: [`resume=${resumeId}`] })
    const wakeId = state.wakeAssessment?.selected?.wake_id
    expect(wakeId).toMatch(/^fake-wake-/)
    expect(state.wakeAssessment?.selected).toMatchObject({ resume_id: resumeId, checkpoint_id: checkpointId, allowed: true })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wakes" })
    expect(state.wakeAssessment?.recent.at(0)).toMatchObject({ wake_id: wakeId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-show", args: [wakeId ?? "missing"] })
    expect(state.wakeAssessment?.selected).toMatchObject({ wake_id: wakeId })
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain(`selected_wake=${wakeId}`)
    expect(snapshot).not.toContain("wake-secret")
    expect(JSON.stringify(state)).not.toContain("wake-secret")
  })

  test("wake assessment checkpoint preview warning missing args and redaction", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=wake-preview-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-preview", args: [`checkpoint=${checkpointId}`] })
    expect(state.wakeAssessment?.preview).toMatchObject({ allowed: true, checkpoint_id: checkpointId })
    expect(state.wakeAssessment?.preview?.warnings).toContain("wake preview is using an unanchored checkpoint; create requires resume_id")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake", args: [`checkpoint=${checkpointId}`] })
    expect(state.wakeAssessment?.commandError).toContain("wake requires resume=<resumeId>")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-preview" })
    expect(state.wakeAssessment?.commandError).toContain("wake preview requires resume=<resumeId> or checkpoint=<checkpointId>")
    expect(JSON.stringify(state)).not.toContain("wake-preview-secret")
  })

  test("continuation slash commands preview create execute pause cancel and redact secrets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=continuation-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-mark", args: [checkpointId] })
    const resumeId = state.runtimeRestore?.selectedAnchor?.resume_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake", args: [`resume=${resumeId}`] })
    const wakeId = state.wakeAssessment?.selected?.wake_id ?? "missing"

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-preview", args: [`wake=${wakeId}`] })
    expect(state.continuation?.preview).toMatchObject({ wake_id: wakeId, can_create: true })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Continuation")
    expect(snapshot).toContain(`preview_wake=${wakeId}`)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-plan", args: [`wake=${wakeId}`] })
    const planId = state.continuation?.selected?.plan_id
    expect(planId).toMatch(/^fake-continuation-/)
    expect(state.continuation?.selected?.steps.at(0)).toMatchObject({ status: "pending", command_type: "read" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-dry-run", args: [planId ?? "missing"] })
    expect(state.continuation?.lastStepResult).toMatchObject({ plan_id: planId, dry_run: true, status: "succeeded" })
    expect(state.continuation?.selected?.steps.at(0)?.status).toBe("pending")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-step", args: [planId ?? "missing"] })
    expect(state.continuation?.lastStepResult).toMatchObject({ plan_id: planId, dry_run: false, status: "succeeded" })
    expect(state.continuation?.selected?.completed_step_count).toBe(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continuations" })
    expect(state.continuation?.recent.at(0)).toMatchObject({ plan_id: planId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-show", args: [planId ?? "missing"] })
    expect(state.continuation?.selected).toMatchObject({ plan_id: planId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-pause", args: [planId ?? "missing"] })
    expect(state.continuation?.selected?.status).toBe("paused")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-cancel", args: [planId ?? "missing"] })
    expect(state.continuation?.selected?.status).toBe("cancelled")
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain(`selected_plan=${planId}`)
    expect(snapshot).not.toContain("continuation-secret")
    expect(JSON.stringify(state)).not.toContain("continuation-secret")
  })

  test("continuation missing args and blocked write steps produce redacted command errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-preview" })
    expect(state.continuation?.commandError).toContain("continuation command requires wake=<wakeId>")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=blocked-continuation-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-mark", args: [checkpointId] })
    const resumeId = state.runtimeRestore?.selectedAnchor?.resume_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake", args: [`resume=${resumeId}`] })
    const wakeId = state.wakeAssessment?.selected?.wake_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-plan", args: [`wake=${wakeId}`] })
    const planId = state.continuation?.selected?.plan_id ?? "missing"
    const writeIndex = state.continuation?.selected?.steps.find((step) => step.command_type === "write")?.index ?? 99
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "continue-step", args: [planId, String(writeIndex)] })
    expect(state.continuation?.commandError).toContain("continuation write commands are blocked by default")
    expect(JSON.stringify(state)).not.toContain("blocked-continuation-secret")
  })

  test("wake schedule slash commands preview create tick and redact secrets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=schedule-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-mark", args: [checkpointId] })
    const resumeId = state.runtimeRestore?.selectedAnchor?.resume_id ?? "missing"

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "schedule-wake-preview", args: [`resume=${resumeId}`, "every=60s", "token=schedule-secret"] })
    expect(state.wakeSchedules?.preview).toMatchObject({ resume_id: resumeId, can_create: true, interval_ms: 60_000 })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Wake schedules")
    expect(snapshot).toContain(`preview_resume=${resumeId}`)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "schedule-wake", args: [`resume=${resumeId}`, "every=60s", "token=schedule-secret"] })
    const scheduleId = state.wakeSchedules?.selected?.schedule_id
    expect(scheduleId).toMatch(/^fake-wake-schedule-/)
    expect(state.wakeSchedules?.selected?.next_due_at).toBe("1970-01-01T00:01:00.000Z")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-schedules" })
    expect(state.wakeSchedules?.recent.at(0)).toMatchObject({ schedule_id: scheduleId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-schedule", args: [scheduleId ?? "missing"] })
    expect(state.wakeSchedules?.selected).toMatchObject({ schedule_id: scheduleId })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-tick-preview" })
    expect(state.wakeSchedules?.tickPreview).toMatchObject({ due_count: 0, eligible_count: 0 })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-tick-dry-run" })
    expect(state.wakeSchedules?.lastTick).toMatchObject({ dry_run: true, processed_count: 0, wake_ids: [] })
    expect(state.wakeAssessment?.selected).toBeUndefined()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-tick" })
    expect(state.wakeSchedules?.lastTick).toMatchObject({ dry_run: false, processed_count: 0, wake_ids: [] })
    expect(state.continuation?.lastStepResult).toBeUndefined()
    await runtime.command("runtime.create_wake_schedule", {
      resumeId,
      intervalMs: 60_000,
      nextDueAt: "1970-01-01T00:00:00.000Z",
      title: "explicitly due fake schedule",
      requestedBy: "operator",
    })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-tick-preview" })
    expect(state.wakeSchedules?.tickPreview).toMatchObject({ due_count: 1, eligible_count: 1 })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-tick" })
    expect(state.wakeSchedules?.lastTick).toMatchObject({ dry_run: false, processed_count: 1 })
    expect(state.wakeSchedules?.lastTick?.wake_ids.at(0)).toMatch(/^fake-wake-/)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-ticks" })
    const tickId = state.wakeSchedules?.recentTicks.at(0)?.tick_id
    expect(tickId).toMatch(/^fake-wake-tick-/)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-tick-show", args: [tickId ?? "missing"] })
    expect(state.wakeSchedules?.lastTick).toMatchObject({ tick_id: tickId })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-schedule-pause", args: [scheduleId ?? "missing"] })
    expect(state.wakeSchedules?.selected?.status).toBe("paused")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-schedule-resume", args: [scheduleId ?? "missing"] })
    expect(state.wakeSchedules?.selected?.status).toBe("active")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "wake-schedule-cancel", args: [scheduleId ?? "missing"] })
    expect(state.wakeSchedules?.selected?.status).toBe("cancelled")
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain(`selected_schedule=${scheduleId}`)
    expect(snapshot).not.toContain("schedule-secret")
    expect(JSON.stringify(state)).not.toContain("schedule-secret")
  })

  test("fake wake schedule tick prioritizes due active schedules before capped inactive records", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    await runtime.command("runtime.create_runtime_checkpoint", { scope: "full", requestedBy: "operator" })
    await runtime.command("runtime.mark_checkpoint_resume_anchor", { checkpointId: "fake-checkpoint-1", requestedBy: "operator" })
    await runtime.command("runtime.create_wake_schedule", { resumeId: "fake-resume-1", intervalMs: 60_000, nextDueAt: "1970-01-01T00:00:00.000Z", requestedBy: "operator" })
    await runtime.command("runtime.pause_wake_schedule", { scheduleId: "fake-wake-schedule-1", requestedBy: "operator" })
    await runtime.command("runtime.create_wake_schedule", { resumeId: "fake-resume-1", intervalMs: 60_000, nextDueAt: "1970-01-01T00:00:00.000Z", requestedBy: "operator" })
    await runtime.command("runtime.cancel_wake_schedule", { scheduleId: "fake-wake-schedule-2", requestedBy: "operator" })
    await runtime.command("runtime.create_wake_schedule", { resumeId: "fake-resume-1", intervalMs: 60_000, nextDueAt: "1970-01-01T00:00:00.000Z", requestedBy: "operator" })

    const preview = await runtime.command("runtime.preview_wake_schedule_tick", { maxDueItems: 1 }) as { due_count: number; eligible_count: number; items: Array<{ schedule_id: string; status: string }> }
    expect(preview).toMatchObject({ due_count: 1, eligible_count: 1 })
    expect(preview.items).toEqual([expect.objectContaining({ schedule_id: "fake-wake-schedule-3", status: "active" })])

    const result = await runtime.command("runtime.execute_wake_schedule_tick", { maxDueItems: 1, requestedBy: "operator" }) as { processed_count: number; wake_ids: string[] }
    expect(result).toMatchObject({ processed_count: 1, wake_ids: ["fake-wake-1"] })
    const schedule = await runtime.command("runtime.get_wake_schedule", { scheduleId: "fake-wake-schedule-3" }) as { last_wake_id?: string }
    expect(schedule.last_wake_id).toBe("fake-wake-1")
  })

  test("wake schedule missing and invalid args produce redacted command errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "schedule-wake-preview", args: ["every=5m"] })
    expect(state.wakeSchedules?.commandError).toContain("schedule wake requires resume=<resumeId>")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "schedule-wake-preview", args: ["resume=resume-1", "every=soon-token=schedule-secret"] })
    expect(state.wakeSchedules?.commandError).toContain("schedule duration")
    expect(JSON.stringify(state)).not.toContain("schedule-secret")
  })

  test("wake scheduler slash commands preview start status stop events and redact secrets", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "checkpoint", args: ["full", "token=scheduler-secret"] })
    const checkpointId = state.runtimeCheckpoints?.selected?.checkpoint_id ?? "missing"
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "resume-mark", args: [checkpointId] })
    const resumeId = state.runtimeRestore?.selectedAnchor?.resume_id ?? "missing"
    await runtime.command("runtime.create_wake_schedule", {
      resumeId,
      intervalMs: 60_000,
      nextDueAt: "1970-01-01T00:00:00.000Z",
      title: "due fake scheduler schedule",
      requestedBy: "operator",
    })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-preview", args: ["dry-run", "every=60s", "max=5"] })
    expect(state.wakeScheduler?.preview).toMatchObject({ can_start: true, status: "stopped", config: { dry_run: true, interval_ms: 60_000, max_due_items: 5 } })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Wake scheduler")
    expect(snapshot).toContain("preview can_start=true")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-start", args: ["dry-run", "every=60s", "max=5"] })
    expect(state.wakeScheduler?.status).toMatchObject({ status: "running", tick_count: 0, config: { dry_run: true } })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-status" })
    expect(state.wakeScheduler?.status?.status).toBe("running")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-events" })
    expect(state.wakeScheduler?.events.at(0)).toMatchObject({ kind: "runtime_wake_scheduler_started", scheduler_status: "running" })
    expect(state.wakeSchedules?.lastTick).toBeUndefined()
    expect(state.continuation?.lastStepResult).toBeUndefined()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-stop", args: ["e2e", "stop", "token=scheduler-secret"] })
    expect(state.wakeScheduler?.status?.status).toBe("stopped")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-events" })
    expect(state.wakeScheduler?.events.at(0)?.kind).toBe("runtime_wake_scheduler_stopped")
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("status=stopped")
    expect(snapshot).not.toContain("scheduler-secret")
    expect(JSON.stringify(state)).not.toContain("scheduler-secret")
  })

  test("wake scheduler invalid args propagate redacted command errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-preview", args: ["every=soon-token=scheduler-secret"] })
    expect(state.wakeScheduler?.commandError).toContain("schedule duration")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-preview", args: ["max=0"] })
    expect(state.wakeScheduler?.commandError).toContain("scheduler max must be 1..20")
    expect(JSON.stringify(state)).not.toContain("scheduler-secret")
  })

  test("wake scheduler bootstrap status and preview slash commands are read-only", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-bootstrap" })
    expect(state.wakeScheduler?.bootstrapStatus).toMatchObject({
      autostart_enabled: false,
      configured: false,
      can_bootstrap: false,
      scheduler_status: "stopped",
    })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("bootstrap autostart=disabled")
    expect(snapshot).toContain("wake scheduler autostart disabled")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-bootstrap-preview" })
    expect(state.wakeScheduler?.bootstrapPreview).toMatchObject({
      autostart_enabled: false,
      can_bootstrap: false,
      due_preview: { due_count: 0 },
    })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-status" })
    expect(state.wakeScheduler?.status?.status).toBe("stopped")
    expect(state.wakeScheduler?.events).toEqual([])
    expect(state.continuation?.lastStepResult).toBeUndefined()
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("bootstrap_due=0 eligible=0")
  })

  test("wake scheduler recovery slash commands render no-stale and stale acknowledgement states", async () => {
    const previous = process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
    process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = "1"
    try {
      const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
      let state = initialState("/tmp/demo")
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery" })
      expect(state.wakeScheduler?.recoveryPreview).toMatchObject({ stale_detected: true, status: "detected", recovery_id: "fake-recovery-1" })
      let snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("recovery")
      expect(snapshot).toContain("stale_detected=true")
      expect(snapshot).toContain("/scheduler-recovery-ack fake-recovery-1")

      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-ack", args: ["fake-recovery-1", "operator", "saw", "token=recovery-secret"] })
      expect(state.wakeScheduler?.selectedRecovery).toMatchObject({ recovery_id: "fake-recovery-1", status: "acknowledged" })
      expect(state.wakeScheduler?.recoveryPreview).toMatchObject({ recovery_id: "fake-recovery-1", status: "acknowledged" })
      expect(state.wakeScheduler?.recoveries.at(0)).toMatchObject({ recovery_id: "fake-recovery-1", status: "acknowledged" })
      snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("status=acknowledged")
      expect(snapshot).not.toContain("/scheduler-recovery-ack fake-recovery-1")
      expect(state.wakeScheduler?.status?.status).not.toBe("running")
      expect(state.wakeSchedules?.lastTick).toBeUndefined()
      expect(state.continuation?.lastStepResult).toBeUndefined()

      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-resolve", args: ["fake-recovery-1", "resolved", "token=recovery-secret"] })
      expect(state.wakeScheduler?.selectedRecovery).toMatchObject({ recovery_id: "fake-recovery-1", status: "resolved" })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-dismiss", args: ["fake-recovery-1", "dismissed", "token=recovery-secret"] })
      expect(state.wakeScheduler?.selectedRecovery).toMatchObject({ recovery_id: "fake-recovery-1", status: "dismissed" })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recoveries" })
      expect(state.wakeScheduler?.recoveries.length).toBeGreaterThan(0)
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-show", args: ["fake-recovery-1"] })
      expect(state.wakeScheduler?.selectedRecovery?.recovery_id).toBe("fake-recovery-1")
      snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("recent_recoveries")
      expect(snapshot).not.toContain("recovery-secret")
      expect(JSON.stringify(state)).not.toContain("recovery-secret")
    } finally {
      if (previous === undefined) delete process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
      else process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = previous
    }
  })

  test("wake scheduler recovery missing args and default fake no-stale path are bounded", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-preview" })
    expect(state.wakeScheduler?.recoveryPreview).toMatchObject({ stale_detected: false, status: "none" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("stale_detected=false")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-ack", args: [] })
    expect(state.wakeScheduler?.commandError).toContain("recoveryId")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-show", args: ["missing-token=recovery-secret"] })
    expect(state.wakeScheduler?.commandError).toContain("[REDACTED]")
    expect(JSON.stringify(state)).not.toContain("recovery-secret")
    snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("recovery-secret")
  })

  test("wake scheduler recovery workflow slash commands render checklist and manual records without executing remediation", async () => {
    const previous = process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
    process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = "1"
    try {
      const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
      let state = initialState("/tmp/demo")
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-workflow-preview", args: ["fake-recovery-1"] })
      expect(state.wakeScheduler?.recoveryWorkflowPreview).toMatchObject({ recovery_id: "fake-recovery-1", can_create: true })
      let snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("recovery_workflow")
      expect(snapshot).toContain("can_create=true")

      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-workflow", args: ["fake-recovery-1"] })
      const workflowId = state.wakeScheduler?.selectedRecoveryWorkflow?.workflow_id
      expect(workflowId).toBe("fake-workflow-fake-recovery-1")
      expect(state.wakeScheduler?.selectedRecoveryWorkflow?.steps.length).toBeGreaterThan(0)

      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-step-done", args: [workflowId!, "0", "token=workflow-secret"] })
      expect(state.wakeScheduler?.selectedRecoveryWorkflow?.completed_step_count).toBe(1)
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-workflow-verify", args: [workflowId!] })
      expect(state.wakeScheduler?.recoveryWorkflowVerification).toMatchObject({ workflow_id: workflowId, recovery_id: "fake-recovery-1" })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-workflows" })
      expect(state.wakeScheduler?.recoveryWorkflows.at(0)).toMatchObject({ workflow_id: workflowId, status: "active" })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-workflow-cancel", args: [workflowId!, "token=workflow-secret"] })
      expect(state.wakeScheduler?.selectedRecoveryWorkflow?.status).toBe("cancelled")
      expect(state.wakeScheduler?.status?.status).not.toBe("running")
      expect(state.wakeSchedules?.lastTick).toBeUndefined()
      expect(state.continuation?.lastStepResult).toBeUndefined()
      snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("selected_workflow=fake-workflow-fake-recovery-1")
      expect(snapshot).not.toContain("workflow-secret")
      expect(JSON.stringify(state)).not.toContain("workflow-secret")
    } finally {
      if (previous === undefined) delete process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
      else process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = previous
    }
  })

  test("wake scheduler recovery workflow errors are redacted and default fake path blocks creation", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-workflow-preview", args: ["missing-token=workflow-secret"] })
    expect(state.wakeScheduler?.recoveryWorkflowPreview).toMatchObject({ can_create: false })
    expect(JSON.stringify(state.wakeScheduler?.recoveryWorkflowPreview)).not.toContain("workflow-secret")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-recovery-step-done", args: ["workflow-1"] })
    expect(state.wakeScheduler?.commandError).toContain("workflow step index")
    const snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("workflow-secret")
    expect(JSON.stringify(state)).not.toContain("workflow-secret")
  })

  test("wake scheduler audit slash commands render summary timeline chain and incidents", async () => {
    const previous = process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
    process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = "1"
    try {
      const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
      let state = initialState("/tmp/demo")
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-audit" })
      expect(state.wakeScheduler?.auditSummary?.event_count).toBeGreaterThan(0)
      expect(state.wakeScheduler?.auditTimeline.length).toBeGreaterThan(0)
      let snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("scheduler_audit")
      expect(snapshot).toContain("timeline_rows")

      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-audit-summary" })
      expect(state.wakeScheduler?.auditSummary?.stale_recovery_count).toBe(1)
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-audit-timeline", args: ["limit=5", "related=fake-recovery-1"] })
      expect(state.wakeScheduler?.auditTimeline.every((entry) => Object.values(entry.related_ids).some((values) => values.includes("fake-recovery-1")))).toBe(true)
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-audit-chain", args: ["fake-recovery-1"] })
      expect(state.wakeScheduler?.selectedAuditChain).toMatchObject({ root_id: "fake-recovery-1" })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-audit-incidents" })
      expect(state.wakeScheduler?.auditIncidents.length).toBeGreaterThan(0)
      expect(state.wakeScheduler?.status?.status).not.toBe("running")
      expect(state.wakeSchedules?.lastTick).toBeUndefined()
      expect(state.continuation?.lastStepResult).toBeUndefined()
      snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("incident_rows")
    } finally {
      if (previous === undefined) delete process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
      else process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = previous
    }
  })

  test("wake scheduler audit errors are redacted", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-audit-timeline", args: ["bad=token=audit-secret"] })
    expect(state.wakeScheduler?.commandError).toContain("scheduler audit timeline arg is invalid")
    expect(JSON.stringify(state)).not.toContain("audit-secret")
  })

  test("wake scheduler navigation slash commands render command cards without execution", async () => {
    const previous = process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
    process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = "1"
    try {
      const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
      let state = initialState("/tmp/demo")
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav" })
      expect(state.wakeScheduler?.navigationBoard?.cards.some((card) => card.command === "/scheduler-audit")).toBe(true)
      let snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("scheduler_navigation")
      expect(snapshot).toContain("cards")

      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav", args: ["related=fake-recovery-1"] })
      expect(state.wakeScheduler?.navigationBoard?.source).toMatchObject({ kind: "related_id", related_id: "fake-recovery-1" })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav", args: ["incident=fake-incident-fake-audit-recovery"] })
      expect(state.wakeScheduler?.navigationBoard?.source.kind).toBe("incident")
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-command", args: ["/wake-tick-dry-run", "token=nav-secret"] })
      expect(state.wakeScheduler?.navigationCommandPreview).toMatchObject({ command_type: "write", risk: "write_requires_operator", target_kind: "wake_tick", supported: true })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-command", args: ["/scheduler-status"] })
      expect(state.wakeScheduler?.navigationCommandPreview).toMatchObject({ command_type: "read", risk: "safe_read", target_kind: "scheduler_status", supported: true })
      state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-target", args: ["recovery", "fake-recovery-1"] })
      expect(state.wakeScheduler?.navigationTarget).toMatchObject({ target_kind: "scheduler_recovery", target_id: "fake-recovery-1" })
      expect(state.wakeScheduler?.status?.status).not.toBe("running")
      expect(state.wakeSchedules?.lastTick).toBeUndefined()
      expect(state.continuation?.lastStepResult).toBeUndefined()
      snapshot = layoutSnapshot(state)
      expect(snapshot).toContain("target=scheduler_recovery:fake-recovery-1")
      expect(snapshot).not.toContain("nav-secret")
      expect(JSON.stringify(state)).not.toContain("nav-secret")
    } finally {
      if (previous === undefined) delete process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE
      else process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE = previous
    }
  })

  test("wake scheduler navigation invalid args and unsupported commands are redacted", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav", args: ["bad=token=nav-secret"] })
    expect(state.wakeScheduler?.commandError).toContain("scheduler navigation arg is invalid")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-command", args: ["/tmp/repro", "token=nav-secret"] })
    expect(state.wakeScheduler?.navigationCommandPreview).toMatchObject({ risk: "unsupported", supported: false })
    const snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("nav-secret")
    expect(JSON.stringify(state)).not.toContain("nav-secret")
  })

  test("wake scheduler navigation staging slash commands stage only safe-read text", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage-preview", args: ["/scheduler-status"] })
    expect(state.wakeScheduler?.navigationStagePreview?.eligibility).toMatchObject({ can_stage: true, risk: "safe_read", target_kind: "scheduler_status" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_navigation_staging")
    expect(snapshot).toContain("can_stage=true")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-status"] })
    const stagedId = state.wakeScheduler?.selectedStagedNavigationCommand?.staged_id
    expect(stagedId).toBeTruthy()
    expect(state.wakeScheduler?.stagedNavigationCommands).toHaveLength(1)
    expect(state.wakeScheduler?.stagedNavigationCommands[0]).toMatchObject({ command: "/scheduler-status", risk: "safe_read", target_kind: "scheduler_status" })
    expect(state.operatorActions?.staged).toBeUndefined()
    expect(runtime.sentCommands).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-status"] })
    expect(state.wakeScheduler?.stagedNavigationCommands).toHaveLength(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-staged" })
    expect(state.wakeScheduler?.stagedNavigationCommands).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-unstage", args: [stagedId!] })
    expect(state.wakeScheduler?.stagedNavigationCommands).toEqual([])
    expect(state.wakeScheduler?.selectedStagedNavigationCommand).toBeNull()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-audit-summary"] })
    expect(state.wakeScheduler?.stagedNavigationCommands).toHaveLength(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage-clear", args: ["reason"] })
    expect(state.wakeScheduler?.stagedNavigationCommands).toEqual([])
    expect(state.wakeScheduler?.selectedStagedNavigationCommand).toBeNull()

    expect(state.wakeScheduler?.status?.status).not.toBe("running")
    expect(state.wakeSchedules?.lastTick).toBeUndefined()
    expect(state.continuation?.lastStepResult).toBeUndefined()
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("staged navigation commands are not executed automatically")
  })

  test("wake scheduler navigation staging blocks write high-impact and secret-looking command text", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/wake-tick", "token=nav-stage-secret"] })
    expect(state.wakeScheduler?.commandError).toContain("cannot be staged")
    expect(state.wakeScheduler?.stagedNavigationCommands).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/handoff", "token=nav-stage-secret"] })
    expect(state.wakeScheduler?.commandError).toContain("cannot be staged")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage-preview", args: ["/tmp/repro", "token=nav-stage-secret"] })
    expect(state.wakeScheduler?.navigationStagePreview?.eligibility).toMatchObject({ can_stage: false, risk: "unsupported" })
    const snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("nav-stage-secret")
    expect(JSON.stringify(state)).not.toContain("nav-stage-secret")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation staged read slash commands run one safe-read command", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-status"] })
    const stagedId = state.wakeScheduler?.selectedStagedNavigationCommand?.staged_id
    expect(stagedId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run-preview", args: [stagedId!] })
    expect(state.wakeScheduler?.stagedReadPreview).toMatchObject({ staged_id: stagedId, can_execute: true, command: "/scheduler-status", risk: "safe_read", target_kind: "scheduler_status" })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_navigation_staged_reads")
    expect(snapshot).toContain("can_execute=true")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run-dry-run", args: [stagedId!] })
    expect(state.wakeScheduler?.latestStagedReadResult).toBeNull()
    expect(state.wakeScheduler?.stagedReadRuns).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run", args: [stagedId!] })
    expect(state.wakeScheduler?.latestStagedReadResult).toMatchObject({ staged_id: stagedId, command: "/scheduler-status", status: "succeeded", result_kind: "fake_read_result" })
    expect(state.wakeScheduler?.stagedReadRuns).toHaveLength(1)
    expect(state.wakeScheduler?.stagedNavigationCommands).toHaveLength(1)
    expect(state.operatorActions?.staged).toBeUndefined()
    expect(runtime.sentCommands).toEqual([])

    const runId = state.wakeScheduler?.latestStagedReadResult?.run_id
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-runs", args: [] })
    expect(state.wakeScheduler?.stagedReadRuns.map((run) => run.run_id)).toContain(runId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run-show", args: [runId!] })
    expect(state.wakeScheduler?.latestStagedReadResult?.run_id).toBe(runId)

    expect(state.wakeScheduler?.status?.status).not.toBe("running")
    expect(state.wakeSchedules?.lastTick).toBeUndefined()
    expect(state.continuation?.lastStepResult).toBeUndefined()
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("only one safe-read staged navigation command runs per explicit request")
  })

  test("wake scheduler navigation staged read blocks missing ids and redacts errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run-preview", args: ["missing-token=secret"] })
    expect(state.wakeScheduler?.stagedReadPreview).toMatchObject({ can_execute: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run", args: ["missing-token=secret"] })
    expect(state.wakeScheduler?.latestStagedReadResult).toMatchObject({ status: "blocked" })
    const snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("secret")
    expect(JSON.stringify(state)).not.toContain("secret")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation staged read comparison commands render history compare stale and group without rerun", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-status"] })
    const stagedId = state.wakeScheduler?.selectedStagedNavigationCommand?.staged_id
    expect(stagedId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run", args: [stagedId!] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-run", args: [stagedId!] })
    const runCount = state.wakeScheduler?.stagedReadRuns.length
    expect(runCount).toBe(2)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-history", args: [] })
    expect(state.wakeScheduler?.stagedReadHistory).toMatchObject({ total_groups: 1, total_runs: 2 })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-history", args: [`staged=${stagedId}`] })
    expect(state.wakeScheduler?.stagedReadHistory?.groups[0]?.staged_id).toBe(stagedId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-compare", args: [stagedId!] })
    expect(state.wakeScheduler?.stagedReadComparison?.comparison_status).toBe("unchanged")
    const [left, right] = state.wakeScheduler?.stagedReadRuns ?? []
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-compare-runs", args: [right!.run_id, left!.run_id] })
    expect(state.wakeScheduler?.stagedReadComparison?.comparison_status).toBe("unchanged")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-stale", args: ["after=1h"] })
    expect(state.wakeScheduler?.stagedReadStaleItems[0]).toMatchObject({ staged_id: stagedId, stale: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-group", args: [stagedId!] })
    expect(state.wakeScheduler?.selectedStagedReadGroup).toMatchObject({ staged_id: stagedId, run_count: 2, comparison_status: "unchanged" })

    expect(state.wakeScheduler?.stagedReadRuns).toHaveLength(runCount!)
    expect(runtime.sentCommands).toEqual([])
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_navigation_read_comparison")
    expect(snapshot).toContain("comparison=unchanged")
    expect(snapshot).toContain("comparison uses bounded summaries and does not execute staged reads")
  })

  test("wake scheduler navigation staged read comparison invalid args and secrets are redacted", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-stale", args: ["after=forever-token=abc123"] })
    expect(state.wakeScheduler?.commandError).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-read-group", args: ["token=abc123"] })
    expect(state.wakeScheduler?.selectedStagedReadGroup).toBeNull()
    const snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation write preview renders authority gates without staging or execution", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/wake-tick-dry-run"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "low_risk_write", authority_gate: "wake_schedule_tick", can_stage_now: false, can_execute_now: false })
    expect(state.wakeScheduler?.writePreview?.future_stage_policy?.would_require_approval_record).toBe(false)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/checkpoint", "full"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "medium_risk_write", authority_gate: "checkpoint_runtime", can_stage_now: false, can_execute_now: false })
    expect(state.wakeScheduler?.writePreview?.future_stage_policy?.would_require_approval_record).toBe(true)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/scheduler-start", "dry-run", "every=60s"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "medium_risk_write", authority_gate: "wake_scheduler_runtime", can_stage_now: false, can_execute_now: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/handoff", "token=abc123"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "high_impact_write", status: "high_impact_blocked", can_stage_now: false, can_execute_now: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/proposal-review", "proposal-1"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "high_impact_write", status: "high_impact_blocked", authority_gate: "proposal_review_runtime" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/scheduler-recovery-workflow", "recovery-1"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "medium_risk_write", authority_gate: "recovery_workflow_runtime", target_kind: "scheduler_recovery" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-preview", args: ["/tmp/repro"] })
    expect(state.wakeScheduler?.writePreview).toMatchObject({ risk: "unsupported", status: "unsupported", can_stage_now: false, can_execute_now: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-board", args: [] })
    expect(state.wakeScheduler?.writeBoard?.previews.length).toBeGreaterThan(0)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-board", args: ["staged=staged-7t"] })
    expect(state.wakeScheduler?.writeBoard?.previews[0]).toMatchObject({ command: "/scheduler-nav-run staged-7t", risk: "low_risk_write", authority_gate: "wake_scheduler_runtime" })

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_write_eligibility")
    expect(snapshot).toContain("can_stage_now=false")
    expect(snapshot).toContain("can_execute_now=false")
    expect(snapshot).toContain("preview only; no write staging or execution")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation write board args reject malformed input and redact command errors", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-board", args: ["bad-token=abc123"] })
    expect(state.wakeScheduler?.commandError).toContain("scheduler navigation write board arg is invalid")
    const snapshot = layoutSnapshot(state)
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation write staging stages allowed writes without execution", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-preview", args: ["/wake-tick-dry-run"] })
    expect(state.wakeScheduler?.writeStagePreview?.eligibility).toMatchObject({ can_stage: true, risk: "low_risk_write", authority_gate: "wake_schedule_tick" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick-dry-run"] })
    const lowId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(lowId).toBeTruthy()
    expect(state.wakeScheduler?.stagedWriteCommands.some((item) => item.command === "/wake-tick-dry-run")).toBe(true)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/checkpoint", "full", "token=abc123"] })
    expect(state.wakeScheduler?.commandError).toContain("medium-risk")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-medium", args: ["/checkpoint", "full", "token=abc123"] })
    expect(state.wakeScheduler?.selectedStagedWriteCommand).toMatchObject({ risk: "medium_risk_write", authority_gate: "checkpoint_runtime" })
    expect(state.wakeScheduler?.selectedStagedWriteCommand?.command).not.toContain("abc123")
    expect(state.wakeScheduler?.selectedStagedWriteCommand?.future_stage_policy?.would_require_approval_record).toBe(true)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick"] })
    expect(state.wakeScheduler?.commandError).toContain("high-impact")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/proposal-review", "proposal_1", "token=abc123"] })
    expect(state.wakeScheduler?.commandError).toContain("high-impact")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-staged", args: [] })
    expect(state.wakeScheduler?.stagedWriteCommands.length).toBe(2)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-unstage", args: [lowId!] })
    expect(state.wakeScheduler?.stagedWriteCommands.some((item) => item.staged_write_id === lowId)).toBe(false)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-clear", args: ["token=abc123"] })
    expect(state.wakeScheduler?.stagedWriteCommands).toEqual([])

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_write_staging")
    expect(snapshot).toContain("staged write commands are operator intent only")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation write run executes only low-risk staged writes", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick-dry-run"] })
    const dryRunWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(dryRunWriteId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-preview", args: [dryRunWriteId!] })
    expect(state.wakeScheduler?.writeRunPreview).toMatchObject({ can_execute: true, execution_kind: "wake_tick_dry_run", risk: "low_risk_write" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-dry-run", args: [dryRunWriteId!] })
    expect(state.wakeScheduler?.latestWriteRunResult).toMatchObject({ status: "succeeded", execution_kind: "wake_tick_dry_run" })
    expect(state.wakeScheduler?.writeRunRecords).toHaveLength(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [dryRunWriteId!] })
    expect(state.wakeScheduler?.latestWriteRunResult).toMatchObject({ status: "succeeded", execution_kind: "wake_tick_dry_run", result_kind: "wake_tick_dry_run" })
    expect(state.wakeScheduler?.stagedWriteCommands.some((item) => item.staged_write_id === dryRunWriteId)).toBe(true)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-status"] })
    const stagedReadId = state.wakeScheduler?.selectedStagedNavigationCommand?.staged_id
    expect(stagedReadId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/scheduler-nav-run", stagedReadId!] })
    const stagedReadWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(stagedReadWriteId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [stagedReadWriteId!] })
    expect(state.wakeScheduler?.latestWriteRunResult).toMatchObject({ status: "succeeded", execution_kind: "staged_safe_read" })
    expect(state.wakeScheduler?.latestWriteRunResult?.downstream_run_id).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-stage", args: ["/scheduler-audit-summary"] })
    const removedReadId = state.wakeScheduler?.selectedStagedNavigationCommand?.staged_id
    expect(removedReadId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/scheduler-nav-run", removedReadId!] })
    const removedReadWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(removedReadWriteId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-unstage", args: [removedReadId!] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-preview", args: [removedReadWriteId!] })
    expect(state.wakeScheduler?.writeRunPreview).toMatchObject({ can_execute: false, execution_kind: "blocked" })
    expect(state.wakeScheduler?.writeRunPreview?.blockers.join(" ")).toContain("staged navigation command is not active")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-medium", args: ["/checkpoint", "full", "token=abc123"] })
    const checkpointWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(checkpointWriteId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-preview", args: [checkpointWriteId!] })
    expect(state.wakeScheduler?.writeRunPreview).toMatchObject({ can_execute: false, execution_kind: "blocked" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [checkpointWriteId!] })
    expect(state.wakeScheduler?.latestWriteRunResult).toMatchObject({ status: "blocked", execution_kind: "blocked" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick-dry-run", "extra"] })
    const malformedDryRunId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(malformedDryRunId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-preview", args: [malformedDryRunId!] })
    expect(state.wakeScheduler?.writeRunPreview).toMatchObject({ can_execute: false, execution_kind: "blocked" })
    expect(state.wakeScheduler?.writeRunPreview?.blockers.join(" ")).toContain("does not accept")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-runs", args: [] })
    expect(state.wakeScheduler?.writeRunRecords.length).toBeGreaterThanOrEqual(3)
    const runId = state.wakeScheduler?.writeRunRecords[0]?.run_id
    expect(runId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-show", args: [runId!] })
    expect(state.wakeScheduler?.latestWriteRunResult?.run_id).toBe(runId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [] })
    expect(state.wakeScheduler?.commandError).toContain("stagedWriteId is required")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_write_runs")
    expect(snapshot).toContain("only low-risk staged writes execute in 7V")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation write-run comparison is read-only and bounded", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick-dry-run"] })
    const stagedWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(stagedWriteId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [stagedWriteId!] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [stagedWriteId!] })
    const runCountAfterExplicitRuns = state.wakeScheduler?.writeRunRecords.length ?? 0
    expect(runCountAfterExplicitRuns).toBe(2)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-history", args: [] })
    expect(state.wakeScheduler?.writeRunHistory).toMatchObject({ total_groups: 1, total_runs: 2 })
    expect(state.wakeScheduler?.writeRunHistory?.groups[0]).toMatchObject({ staged_write_id: stagedWriteId, comparison_status: "unchanged" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-history", args: [`staged=${stagedWriteId}`, "limit=5"] })
    expect(state.wakeScheduler?.writeRunHistory?.groups).toHaveLength(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-compare", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.writeRunComparison).toMatchObject({ comparison_status: "unchanged", staged_write_id: stagedWriteId })
    const latestRunId = state.wakeScheduler?.writeRunComparison?.right_run_id
    const previousRunId = state.wakeScheduler?.writeRunComparison?.left_run_id
    expect(latestRunId).toBeTruthy()
    expect(previousRunId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-compare-runs", args: [previousRunId!, latestRunId!] })
    expect(state.wakeScheduler?.writeRunComparison?.comparison_status).toBe("unchanged")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-stale", args: ["after=1h"] })
    expect(state.wakeScheduler?.writeRunStaleItems.some((item) => item.staged_write_id === stagedWriteId && item.stale === false)).toBe(true)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-group", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.selectedWriteRunGroup).toMatchObject({ staged_write_id: stagedWriteId, run_count: 2, comparison_status: "unchanged" })
    expect(state.wakeScheduler?.writeRunRecords.length).toBe(runCountAfterExplicitRuns)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-medium", args: ["/checkpoint", "full", "token=abc123"] })
    const checkpointWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(checkpointWriteId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run", args: [checkpointWriteId!] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-history", args: [] })
    expect(state.wakeScheduler?.writeRunHistory?.failed_groups).toBeGreaterThanOrEqual(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-run-history", args: ["after=soon"] })
    expect(state.wakeScheduler?.commandError).toContain("duration")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_write_run_comparison")
    expect(snapshot).toContain("comparison uses bounded summaries")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation write approval records future intent without execution", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-medium", args: ["/checkpoint", "full", "token=abc123"] })
    const stagedWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(stagedWriteId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-readiness", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.writeReadinessPreview).toMatchObject({ staged_write_id: stagedWriteId, readiness_status: "ready_for_approval", can_approve: true, can_execute_now: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approve", args: [stagedWriteId!, "token=abc123"] })
    const approvalId = state.wakeScheduler?.selectedWriteApproval?.approval_id
    expect(approvalId).toBeTruthy()
    expect(state.wakeScheduler?.selectedWriteApproval).toMatchObject({ staged_write_id: stagedWriteId, status: "approved" })
    expect(state.wakeScheduler?.selectedWriteApproval?.reason).not.toContain("abc123")
    expect(state.wakeScheduler?.writeApprovalRecords.some((record) => record.approval_id === approvalId)).toBe(true)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approval-show", args: [approvalId!] })
    expect(state.wakeScheduler?.selectedWriteApproval?.approval_id).toBe(approvalId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approval-revoke", args: [approvalId!, "token=abc123"] })
    expect(state.wakeScheduler?.selectedWriteApproval).toMatchObject({ approval_id: approvalId, status: "revoked" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approvals", args: [] })
    expect(state.wakeScheduler?.writeApprovalRecords.some((record) => record.status === "revoked")).toBe(true)
    expect(state.wakeScheduler?.writeApprovalRecords.filter((record) => record.approval_id === approvalId)).toHaveLength(1)
    expect(state.wakeScheduler?.writeApprovalRecords.some((record) => record.approval_id === approvalId && record.status === "approved")).toBe(false)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-readiness", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.writeReadinessPreview?.existing_approval).toBeUndefined()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-reject", args: [stagedWriteId!, "token=abc123"] })
    expect(state.wakeScheduler?.selectedWriteApproval).toMatchObject({ staged_write_id: stagedWriteId, status: "rejected" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick-dry-run"] })
    const lowRiskId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(lowRiskId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-readiness", args: [lowRiskId!] })
    expect(state.wakeScheduler?.writeReadinessPreview).toMatchObject({ can_approve: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "approve-wake-scheduler-navigation-staged-write", stagedWriteId: lowRiskId! })
    expect(state.wakeScheduler?.commandError).toContain("not ready")
    expect(state.runtimeCommandError).toBeUndefined()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approve", args: [] })
    expect(state.wakeScheduler?.commandError).toContain("stagedWriteId is required")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_write_approval")
    expect(snapshot).toContain("approval records future operator intent")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("wake scheduler navigation checkpoint write runs execute approved staged checkpoints only", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-medium", args: ["/checkpoint", "full", "token=abc123"] })
    const stagedWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(stagedWriteId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run-preview", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.checkpointWriteRunPreview).toMatchObject({ staged_write_id: stagedWriteId, can_execute: false, execution_kind: "blocked" })
    expect(state.wakeScheduler?.checkpointWriteRunPreview?.blockers.join(" ")).toContain("approval")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approve", args: [stagedWriteId!, "token=abc123"] })
    const approvalId = state.wakeScheduler?.selectedWriteApproval?.approval_id
    expect(approvalId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run-preview", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.checkpointWriteRunPreview).toMatchObject({ staged_write_id: stagedWriteId, approval_id: approvalId, can_execute: true, execution_kind: "checkpoint_create", checkpoint_scope: "full" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run-dry-run", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.latestCheckpointWriteRunResult).toMatchObject({ status: "succeeded", result_kind: "fake_checkpoint_write_run_dry_run" })
    expect(state.wakeScheduler?.checkpointWriteRunRecords).toEqual([])
    expect(state.runtimeCheckpoints?.recent ?? []).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.latestCheckpointWriteRunResult).toMatchObject({ staged_write_id: stagedWriteId, approval_id: approvalId, status: "succeeded", result_kind: "runtime_checkpoint" })
    expect(state.wakeScheduler?.latestCheckpointWriteRunResult?.checkpoint_id).toBeTruthy()
    expect(state.wakeScheduler?.checkpointWriteRunRecords).toHaveLength(1)
    expect(state.wakeScheduler?.stagedWriteCommands.some((item) => item.staged_write_id === stagedWriteId)).toBe(true)
    const runId = state.wakeScheduler?.latestCheckpointWriteRunResult?.run_id

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-runs", args: [] })
    expect(state.wakeScheduler?.checkpointWriteRunRecords.map((record) => record.run_id)).toContain(runId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run-show", args: [runId!] })
    expect(state.wakeScheduler?.latestCheckpointWriteRunResult?.run_id).toBe(runId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage", args: ["/wake-tick-dry-run"] })
    const lowRiskId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(lowRiskId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run-preview", args: [lowRiskId!] })
    expect(state.wakeScheduler?.checkpointWriteRunPreview).toMatchObject({ can_execute: false, execution_kind: "blocked" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run", args: [] })
    expect(state.wakeScheduler?.commandError ?? state.runtimeCommandError).toContain("stagedWriteId is required")

    expect(state.wakeScheduler?.status?.status).not.toBe("running")
    expect(state.wakeSchedules?.lastTick).toBeUndefined()
    expect(state.continuation?.lastStepResult).toBeUndefined()
    expect(runtime.sentCommands).toEqual([])
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_checkpoint_write_runs")
    expect(snapshot).toContain("only approved staged checkpoint writes execute in 7Y")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("wake scheduler navigation checkpoint write comparison is read-only and bounded", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-stage-medium", args: ["/checkpoint", "full", "token=abc123"] })
    const stagedWriteId = state.wakeScheduler?.selectedStagedWriteCommand?.staged_write_id
    expect(stagedWriteId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-write-approve", args: [stagedWriteId!, "token=abc123"] })
    const approvalId = state.wakeScheduler?.selectedWriteApproval?.approval_id
    expect(approvalId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run", args: [stagedWriteId!] })
    const firstRunId = state.wakeScheduler?.latestCheckpointWriteRunResult?.run_id
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-run", args: [stagedWriteId!] })
    const secondRunId = state.wakeScheduler?.latestCheckpointWriteRunResult?.run_id
    expect(firstRunId).toBeTruthy()
    expect(secondRunId).toBeTruthy()
    expect(secondRunId).not.toBe(firstRunId)
    const runCount = state.wakeScheduler?.checkpointWriteRunRecords.length

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-history", args: [] })
    expect(state.wakeScheduler?.checkpointWriteHistory).toMatchObject({ total_groups: 1, total_runs: 2 })
    expect(state.wakeScheduler?.checkpointWriteHistory?.groups[0]).toMatchObject({ staged_write_id: stagedWriteId, run_count: 2, comparison_status: "unchanged", checkpoint_artifact_changed: true })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-history", args: [`staged=${stagedWriteId}`] })
    expect(state.wakeScheduler?.checkpointWriteHistory?.staged_write_id).toBe(stagedWriteId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-history", args: [`approval=${approvalId}`] })
    expect(state.wakeScheduler?.checkpointWriteHistory?.groups[0].approval_ids).toContain(approvalId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-compare", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.checkpointWriteComparison?.staged_write_id).toBe(stagedWriteId)
    expect(state.wakeScheduler?.checkpointWriteComparison?.comparison_status).toBe("unchanged")
    expect(state.wakeScheduler?.checkpointWriteComparison?.checkpoint_artifact_delta).toContain("checkpoint artifact")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-compare-runs", args: [firstRunId!, secondRunId!] })
    expect(state.wakeScheduler?.checkpointWriteComparison?.left_run_id).toBe(firstRunId)
    expect(state.wakeScheduler?.checkpointWriteComparison?.right_run_id).toBe(secondRunId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-stale", args: ["after=1d"] })
    expect(state.wakeScheduler?.checkpointWriteStaleItems.some((item) => item.staged_write_id === stagedWriteId)).toBe(true)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-group", args: [stagedWriteId!] })
    expect(state.wakeScheduler?.selectedCheckpointWriteGroup).toMatchObject({ staged_write_id: stagedWriteId, run_count: 2, comparison_status: "unchanged", checkpoint_artifact_changed: true })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-approval-usage", args: [] })
    expect(state.wakeScheduler?.checkpointApprovalUsage).toMatchObject({ total_approvals: 1, used_count: 1 })
    expect(state.wakeScheduler?.checkpointApprovalUsage?.approvals[0]).toMatchObject({ approval_id: approvalId, used: true })
    expect(state.wakeScheduler?.checkpointWriteRunRecords.length).toBe(runCount)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "scheduler-nav-checkpoint-history", args: ["bad"] })
    expect(state.wakeScheduler?.commandError).toContain("key=value")

    expect(state.wakeScheduler?.status?.status).not.toBe("running")
    expect(state.wakeSchedules?.lastTick).toBeUndefined()
    expect(state.continuation?.lastStepResult).toBeUndefined()
    expect(runtime.sentCommands).toEqual([])
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("scheduler_checkpoint_write_comparison")
    expect(snapshot).toContain("comparison uses bounded summaries")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("command authority commands render filtered inventory and validation profiles without executing inspected commands", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority", args: [] })
    expect(state.commandAuthority?.summary?.total_records).toBeGreaterThan(0)
    expect(state.commandAuthority?.records.length).toBeGreaterThan(0)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-list", args: ["risk=high_impact_write"] })
    expect(state.commandAuthority?.records.every((record) => record.risk === "high_impact_write")).toBe(true)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/scheduler-nav-checkpoint-run"] })
    expect(state.commandAuthority?.selected).toMatchObject({ slash_command: "/scheduler-nav-checkpoint-run", gate: "checkpoint_runtime" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-profile", args: ["/scheduler-nav-checkpoint-run"] })
    expect(state.commandAuthority?.validationProfile?.targeted_e2e).toContain("tests/e2e_user/scenarios/test_wake_scheduler_navigation_checkpoint_write_tui.py")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/handoff", "token=abc123"] })
    expect(state.commandAuthority?.selected).toMatchObject({ slash_command: "/handoff", risk: "high_impact_write" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-smoke"] })
    expect(state.commandAuthority?.selected).toMatchObject({ slash_command: "/opencode-smoke", risk: "low_risk_write", blocked_by_default: true })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/tmp/repro"] })
    expect(state.commandAuthority?.selected).toMatchObject({ risk: "unsupported", blocked_by_default: true })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-list", args: ["bad"] })
    expect(state.commandAuthority?.commandError).toContain("key=value")

    expect(runtime.sentCommands).toEqual([])
    expect(state.wakeScheduler?.status?.status).not.toBe("running")
    expect(state.wakeSchedules?.lastTick).toBeUndefined()
    expect(state.runtimeCheckpoints?.selected).toBeUndefined()
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Command authority")
    expect(snapshot).toContain("risk=unsupported")
    expect(snapshot).toContain("targeted_e2e=")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("opencode session plan commands render planned session metadata without launching execution", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-preview", args: ["objective=inspect", "training", "progress", "token=abc123"] })
    expect(state.opencodeSessions?.preview).toMatchObject({
      can_create: true,
      source_kind: "manual",
      timeout_policy: expect.objectContaining({ forced_pause_enabled: true, report_required_on_timeout: true }),
      question_policy: expect.objectContaining({ allow_opencode_questions: true, max_pending_questions: 3 }),
      human_control_policy: expect.objectContaining({ allow_human_pause: true, require_reason_for_stop: true }),
    })
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode sessions")
    expect(snapshot).toContain("commander_context=")
    expect(snapshot).toContain("opencode_context_seed=")
    expect(snapshot).toContain("max_context_bytes=12000")
    expect(snapshot).toContain("timeout wall_ms=")
    expect(snapshot).toContain("question_policy questions=true")
    expect(snapshot).toContain("human_control pause=true")
    expect(snapshot).toContain("note=session planning does not launch OpenCode or mutate missions")
    expect(snapshot).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-preview", args: ["objective=triage", "proposal=fake-missing-proposal"] })
    expect(state.opencodeSessions?.preview).toMatchObject({
      can_create: false,
      source_kind: "proposal",
      objective_preview: "triage",
      blockers: expect.arrayContaining(["proposal not found: fake-missing-proposal"]),
    })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan-dry-run", args: ["objective=inspect", "training", "progress", "token=abc123"] })
    expect(state.opencodeSessions?.latestPlan).toMatchObject({ status: "planned", source_kind: "manual" })
    expect(state.opencodeSessions?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=inspect", "training", "progress", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    expect(state.opencodeSessions?.records).toHaveLength(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=inspect", "training", "progress", "token=abc123"] })
    expect(state.opencodeSessions?.records).toHaveLength(1)
    await expect(runtime.command("runtime.create_opencode_session_plan", {
      objective: "inspect training progress token=abc123",
      maxContextBytes: 4096,
    })).rejects.toThrow("different boundary or policy metadata")
    expect(state.opencodeSessions?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-sessions", args: [] })
    expect(state.opencodeSessions?.records.map((record) => record.session_id)).toContain(sessionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-show", args: [sessionId!] })
    expect(state.opencodeSessions?.selected?.session_id).toBe(sessionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-summary", args: [] })
    expect(state.opencodeSessions?.summary).toMatchObject({ total_sessions: 1, planned_count: 1, running_count: 0 })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-session-plan"] })
    expect(state.commandAuthority?.selected).toMatchObject({ slash_command: "/opencode-session-plan", risk: "high_impact_write", creates_external_process: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/opencode-session-plan objective=stage command token=abc123"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan-dry-run", args: ["apply=fake-missing-apply"] })
    expect(state.opencodeSessions?.commandError).toContain("apply record not found")
    expect(state.opencodeSessions?.commandError).not.toContain("requires objective")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: [] })
    expect(state.opencodeSessions?.commandError).toContain("requires objective")

    expect(runtime.sentCommands).toEqual([])
    expect(state.opencodeHandoff?.lastResult).toBeNull()
    expect(state.opencodeProcessSmoke?.latestResult).toBeNull()
    expect(state.missionExecution?.selectedResultId).toBeUndefined()
    expect(state.missionExecution?.results).toEqual([])
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("latest=fake-opencode-session")
    expect(snapshot).toContain("latest_context max_bytes=12000")
    expect(snapshot).toContain("summary total=1 planned=1")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("fake opencode session identity uses raw long objectives instead of rendered previews", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    const sharedPrefix = "inspect training configuration ".repeat(12)
    const firstObjective = `${sharedPrefix}variant alpha`
    const secondObjective = `${sharedPrefix}variant beta`

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: [`objective=${firstObjective}`] })
    const firstSessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(firstSessionId).toBeTruthy()
    expect(state.opencodeSessions?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: [`objective=${secondObjective}`] })
    expect(state.opencodeSessions?.latestPlan?.session_id).not.toBe(firstSessionId)
    expect(state.opencodeSessions?.records).toHaveLength(2)
    expect(new Set(state.opencodeSessions?.records.map((record) => record.session_id)).size).toBe(2)
  })

  test("context budget registry slash commands render read-only budget metadata", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "model-capabilities", args: [] })
    expect(state.contextBudgets?.capabilities.map((item) => item.capability_id)).toContain("fake-minimax-validation")
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Context budget registry")
    expect(snapshot).toContain("fake-minimax-validation minimax/minimax-validation-default")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "model-capability", args: ["fake-local-small"] })
    expect(state.contextBudgets?.selectedCapability).toMatchObject({ capability_id: "fake-local-small", provider_kind: "local" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-budget-summary", args: [] })
    expect(state.contextBudgets?.summary).toMatchObject({ total_capabilities: 4, local_model_count: 1 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-budget-preview", args: ["purpose=commander_research_decision", "provider=vendor-secret=abc123", "model=model-secret=abc123"] })
    expect(state.contextBudgets?.preview).toMatchObject({ purpose: "commander_research_decision", role: "commander" })
    expect(state.contextBudgets?.preview?.budget.allocations).toContainEqual(expect.objectContaining({ section: "raw_logs", inclusion_policy: "excluded_by_default", priority: "excluded" }))
    expect(state.contextBudgets?.preview?.budget.allocations).toContainEqual(expect.objectContaining({ section: "research_memory" }))
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("preview=fake-context-budget-preview")
    expect(snapshot).toContain("raw_logs priority=excluded policy=excluded_by_default")
    expect(snapshot).toContain("safety_margin_tokens=")
    expect(snapshot).toContain("note=budget preview does not compile context, call providers, launch OpenCode, query research.db, or mutate missions")
    expect(snapshot).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-budget-preview", args: ["purpose=opencode_executor_session"] })
    expect(state.contextBudgets?.preview?.budget.allocations).toContainEqual(expect.objectContaining({ section: "commander_guidance", priority: "high" }))
    expect(state.contextBudgets?.preview?.budget.allocations).toContainEqual(expect.objectContaining({ section: "executor_progress", priority: "high" }))
    expect(state.contextBudgets?.preview?.budget.allocations).toContainEqual(expect.objectContaining({ section: "research_memory", inclusion_policy: "pointer_only" }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=budget", "session", "cap", "max_context_bytes=4096"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-budget-preview", args: ["purpose=opencode_executor_session", `session=${sessionId}`] })
    expect(state.contextBudgets?.preview).toMatchObject({
      session_id: sessionId,
      session_max_context_bytes: 4096,
    })
    expect(state.contextBudgets?.preview?.budget.max_context_bytes).toBe(4096)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-budget-preview", args: ["purpose=opencode_executor_session", "max_context_bytes=4096"] })
    expect(state.contextBudgets?.preview?.budget.max_context_bytes).toBe(4096)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-budget-preview", args: [] })
    expect(state.contextBudgets?.commandError).toContain("requires purpose")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/context-budget-preview"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/context-budget-preview",
      risk: "safe_read",
      creates_external_process: false,
      calls_provider: false,
      mutates_events: false,
    })

    expect(runtime.sentCommands).toEqual([])
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("context packet compiler slash commands render bounded packet previews", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: ["purpose=commander_research_decision", "provider=vendor-secret=abc123", "model=model-secret=abc123"] })
    expect(state.contextPackets?.preview).toMatchObject({ purpose: "commander_research_decision", role: "commander", can_compile_final_prompt: false })
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({ section: "raw_logs", status: "excluded" }))
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({ section: "research_memory", status: "pointer_only" }))
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Context packet compiler")
    expect(snapshot).toContain("purpose=commander_research_decision")
    expect(snapshot).toContain("raw_logs status=excluded")
    expect(snapshot).toContain("research_memory status=pointer_only")
    expect(snapshot).toContain("tool_or_mcp_schema status=excluded")
    expect(snapshot).toContain("can_compile_final_prompt=false")
    expect(snapshot).toContain("does not compile executable prompts")
    expect(snapshot).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: ["purpose=wake_supervisor"] })
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({ section: "active_sessions" }))
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({ section: "executor_progress", status: "missing" }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: ["purpose=research_retrieval"] })
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({ section: "external_research", status: "omitted" }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: ["purpose=opencode_executor_session"] })
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({ section: "mission_state", status: "missing" }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: ["purpose=open_question_answer"] })
    expect(state.contextPackets?.preview?.sections).toContainEqual(expect.objectContaining({
      section: "open_question_answer",
      status: "missing",
      source_refs: expect.arrayContaining([expect.objectContaining({ source_id: "opencode_question_protocol_future", pointer_only: true })]),
    }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=context", "packet", "session", "max_context_bytes=4096"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "packet-preview", args: ["purpose=opencode_executor_session", `session=${sessionId}`] })
    expect(state.contextPackets?.preview).toMatchObject({ purpose: "opencode_executor_session", session_id: sessionId })
    expect(state.contextPackets?.preview?.budget_summary.max_context_bytes).toBe(4096)
    expect(state.contextPackets?.preview?.omitted_source_refs).toContainEqual(expect.objectContaining({ label: "timeout/report policy pointer" }))
    expect(state.contextPackets?.preview?.omitted_source_refs).toContainEqual(expect.objectContaining({ label: "question policy pointer" }))
    expect(state.contextPackets?.preview?.omitted_source_refs).toContainEqual(expect.objectContaining({ label: "human control policy pointer" }))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "packet-preview", args: ["purpose=opencode_executor_session", `session=${sessionId}`, "mission=mission_conflict"] })
    expect(state.contextPackets?.preview?.packet_status).toBe("blocked")
    expect(state.contextPackets?.preview?.blockers).toContain("session_id has no linked mission_id to match explicit mission_id")
    expect(state.contextPackets?.preview?.mission_id).toBeUndefined()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-summary", args: [] })
    expect(state.contextPackets?.summary?.supported_purposes).toContain("opencode_executor_session")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: [] })
    expect(state.contextPackets?.commandError).toContain("requires purpose")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/context-packet-preview"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/context-packet-preview",
      risk: "safe_read",
      creates_external_process: false,
      calls_provider: false,
      mutates_events: false,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("does not compile executable prompts")

    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("selected=/context-packet-preview risk=safe_read")
    expect(runtime.sentCommands).toEqual([])
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("opencode session instruction pack commands render bounded pack previews and writes", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-preview", args: [] })
    expect(state.opencodeSessionInstructionPacks?.commandError).toContain("requires session")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-dry-run", args: ["session=missing-session-does-not-exist-999999"] })
    expect(state.opencodeSessionInstructionPacks?.latestResult?.status).toBe("blocked")
    expect(state.opencodeSessionInstructionPacks?.commandError).toContain("planned OpenCode session was not found")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=instruction", "pack", "test", "token=abc123", "max_context_bytes=4096"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-preview", args: [`session=${sessionId}`] })
    expect(state.opencodeSessionInstructionPacks?.preview).toMatchObject({
      status: "ready",
      can_write: true,
      session_id: sessionId,
      target_dir: `.nxl/opencode/sessions/${sessionId}`,
    })
    expect(state.opencodeSessionInstructionPacks?.preview?.files.map((file) => file.relative_path)).toEqual(expect.arrayContaining([
      "TASK.md",
      "CONTEXT.md",
      "GUIDANCE.md",
      "SESSION_MEMORY.md",
      "POLICY.md",
      "MANIFEST.json",
      "opencode-session-config.json",
    ]))
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode session instruction packs")
    expect(snapshot).toContain("TASK.md")
    expect(snapshot).toContain("CONTEXT.md")
    expect(snapshot).toContain("GUIDANCE.md")
    expect(snapshot).toContain("SESSION_MEMORY.md")
    expect(snapshot).toContain("POLICY.md")
    expect(snapshot).toContain("MANIFEST.json")
    expect(snapshot).toContain("note=instruction-pack writing does not launch OpenCode")
    expect(snapshot).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-dry-run", args: [`session=${sessionId}`] })
    expect(state.opencodeSessionInstructionPacks?.latestResult).toMatchObject({ status: "dry_run", session_id: sessionId })
    expect(state.opencodeSessionInstructionPacks?.latestResult?.files.every((file) => file.would_write === false)).toBe(true)
    expect(state.opencodeSessionInstructionPacks?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    const packId = state.opencodeSessionInstructionPacks?.latestResult?.pack_id
    expect(packId).toBeTruthy()
    expect(state.opencodeSessionInstructionPacks?.latestResult).toMatchObject({ status: "written", session_id: sessionId })
    expect(state.opencodeSessionInstructionPacks?.records).toHaveLength(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    expect(state.opencodeSessionInstructionPacks?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-packs", args: [] })
    expect(state.opencodeSessionInstructionPacks?.records.map((record) => record.pack_id)).toContain(packId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-show", args: [packId!] })
    expect(state.opencodeSessionInstructionPacks?.selected?.pack_id).toBe(packId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-preview", args: ["session=../escape"] })
    expect(state.opencodeSessionInstructionPacks?.preview?.status).toBe("blocked")
    expect(state.opencodeSessionInstructionPacks?.preview?.blockers).toContain("session_id contains unsafe path characters")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/opencode-session-instruction-pack-write session=missing-session-does-not-exist-999999"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged", args: [] })
    expect(state.operatorActions?.lastResult?.ok).toBe(false)
    expect(state.operatorActions?.commandError).toContain("planned OpenCode session was not found")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-session-instruction-pack-write"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-session-instruction-pack-write",
      risk: "high_impact_write",
      creates_external_process: false,
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("does not launch OpenCode")
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("selected=/opencode-session-instruction-pack-write risk=high_impact_write")
    expect(snapshot).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("OpenCode launch readiness slash commands render read-only fake checks", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=launch", "readiness", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch-readiness", args: [`session=${sessionId}`] })
    expect(state.opencodeLaunchReadiness?.preview).toMatchObject({
      status: "blocked",
      session_id: sessionId,
      launch_performed: false,
    })
    expect(state.opencodeLaunchReadiness?.commandError).toContain("instruction pack is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    const packId = state.opencodeSessionInstructionPacks?.latestResult?.pack_id
    expect(packId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "launch-readiness", args: [`session=${sessionId}`, `pack=${packId}`] })
    expect(state.opencodeLaunchReadiness?.preview).toMatchObject({
      session_id: sessionId,
      pack_id: packId,
      launch_performed: false,
      instruction_files_verified: true,
      manifest_verified: true,
      config_verified: true,
    })
    expect(state.opencodeLaunchReadiness?.preview?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ check_id: "instruction_pack", status: "pass" }),
      expect.objectContaining({ check_id: "native_config", status: "warn" }),
    ]))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch-readiness-summary", args: [] })
    expect(state.opencodeLaunchReadiness?.summary?.total_planned_sessions).toBeGreaterThanOrEqual(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-launch-readiness"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-launch-readiness",
      risk: "safe_read",
      creates_external_process: false,
      calls_provider: false,
    })
    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode launch readiness")
    expect(snapshot).toContain("launch_performed=false")
    expect(snapshot).toContain("selected=/opencode-launch-readiness risk=safe_read")
    expect(snapshot).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
    expect(JSON.stringify(state)).not.toContain("abc123")
  })

  test("OpenCode launch gate slash commands preview dry-run fake launch and block duplicates", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch-preview", args: [] })
    expect(state.runtimeCommandError).toContain("requires session")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=launch", "gate", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch-preview", args: [`session=${sessionId}`] })
    expect(state.opencodeLaunches?.preview).toMatchObject({ status: "blocked", session_id: sessionId, launch_performed: false })
    expect(state.opencodeLaunches?.commandError).toContain("instruction pack is required")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    const packId = state.opencodeSessionInstructionPacks?.latestResult?.pack_id
    expect(packId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "launch-opencode-preview", args: [`session=${sessionId}`, `pack=${packId}`] })
    expect(state.opencodeLaunches?.preview).toMatchObject({
      status: "ready",
      can_launch: true,
      session_id: sessionId,
      pack_id: packId,
      adapter_kind: "fake",
      launch_performed: false,
    })
    expect(state.opencodeLaunches?.preview?.instruction_files).toEqual(expect.arrayContaining(["TASK.md", "CONTEXT.md", "POLICY.md", "MANIFEST.json"]))

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch-dry-run", args: [`session=${sessionId}`, `pack=${packId}`] })
    expect(state.opencodeLaunches?.latestResult).toMatchObject({ status: "dry_run", session_id: sessionId, launch_performed: false })
    expect(state.opencodeLaunches?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`, `pack=${packId}`] })
    const launchId = state.opencodeLaunches?.latestResult?.launch_id
    expect(launchId).toBeTruthy()
    expect(state.opencodeLaunches?.latestResult).toMatchObject({ status: "launched", session_id: sessionId, adapter_kind: "fake", launch_performed: false })
    expect(state.opencodeLaunches?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`, `pack=${packId}`] })
    expect(state.opencodeLaunches?.latestResult?.status).toBe("blocked")
    expect(state.opencodeLaunches?.commandError).toContain("already has an active launch record")
    expect(state.opencodeLaunches?.records).toHaveLength(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launches", args: [] })
    expect(state.opencodeLaunches?.records.map((record) => record.launch_id)).toContain(launchId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch-show", args: [launchId!] })
    expect(state.opencodeLaunches?.selected?.launch_id).toBe(launchId)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/opencode-launch session=missing-session-does-not-exist-999999"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "run-staged", args: [] })
    expect(state.operatorActions?.lastResult?.ok).toBe(false)
    expect(state.operatorActions?.commandError).toContain("planned OpenCode session was not found")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-launch"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-launch",
      risk: "high_impact_write",
      creates_external_process: true,
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("First real OpenCode launch gate")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode launches")
    expect(snapshot).toContain("preview/dry-run do not launch")
    expect(snapshot).toContain("9D does not supervise progress")
    expect(snapshot).toContain("selected=/opencode-launch risk=high_impact_write")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("OpenCode progress slash commands preview record list latest summary and classify writes", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=progress", "heartbeat", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })
    const launchId = state.opencodeLaunches?.latestResult?.launch_id
    expect(launchId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-preview", args: [`session=${sessionId}`, "summary=working", "through", "first", "step", "token=abc123"] })
    expect(state.opencodeProgress?.preview).toMatchObject({ status: "ready", can_record: true, session_id: sessionId, kind: "heartbeat" })
    expect(JSON.stringify(state.opencodeProgress?.preview)).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-dry-run", args: [`session=${sessionId}`, "summary=dry", "run", "progress", "token=abc123"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "dry_run", session_id: sessionId })
    expect(state.opencodeProgress?.records).toEqual([])
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-dry-run", args: ["session=missing", "summary=invalid", "dry", "run"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "blocked", session_id: "missing" })
    expect(state.opencodeProgress?.commandError).toContain("session_id does not resolve")
    expect(state.opencodeProgress?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-heartbeat", args: [`session=${sessionId}`, "summary=alive", "and", "working", "token=abc123"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "heartbeat", session_id: sessionId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress", args: [`session=${sessionId}`, "summary=implemented", "first", "change", "files=fileA.ts", "tests=bun-test"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "progress", session_id: sessionId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-blocker", args: [`session=${sessionId}`, "summary=blocked", "on", "ambiguity", "blocker=needs", "commander", "clarification"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "blocker", execution_state: "blocked" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-blocker", args: [`session=${sessionId}`, "summary=blocked", "again", "blockers=needs", "commander", "clarification"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "blocker", blockers_preview: ["needs commander clarification"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-question", args: [`session=${sessionId}`, "question=should", "I", "prefer", "option", "A", "or", "B"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "question", execution_state: "needs_commander" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-list", args: [`session=${sessionId}`] })
    expect(state.opencodeProgress?.records.map((record) => record.kind)).toEqual(["question", "blocker", "blocker", "progress", "heartbeat"])
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-latest", args: [`session=${sessionId}`] })
    expect(state.opencodeProgress?.latest?.kind).toBe("question")
    const progressId = state.opencodeProgress?.latest?.progress_id
    expect(progressId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-show", args: [progressId!] })
    expect(state.opencodeProgress?.selected?.progress_id).toBe(progressId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-summary", args: [] })
    expect(state.opencodeProgress?.summary).toMatchObject({ total_records: 5, heartbeat_count: 1, blocked_count: 2, question_count: 1 })
    const blockerId = state.opencodeProgress?.records.find((record) => record.kind === "blocker")?.progress_id
    expect(blockerId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-show", args: [blockerId!] })
    expect(state.opencodeProgress?.selected).toMatchObject({ kind: "blocker", blockers_preview: ["needs commander clarification"] })
    const progressDetailSnapshot = layoutSnapshot(state)
    expect(progressDetailSnapshot).toContain("latest_question=should I prefer option A or B")
    expect(progressDetailSnapshot).toContain("selected_blockers=needs commander clarification")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-preview", args: [`launch=${launchId}`, "summary=stdout", "stderr"] })
    expect(state.opencodeProgress?.commandError).toContain("raw logs are out of scope")
    expect(state.opencodeProgress?.preview?.report_summary_preview).toBe("raw progress log omitted; attach artifact pointer in a later branch")
    expect(JSON.stringify(state.opencodeProgress?.preview)).not.toContain("stdout")
    expect(JSON.stringify(state.opencodeProgress?.preview)).not.toContain("stderr")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress-dry-run", args: [`session=${sessionId}`, "summary=plain", "blocker=traceback", "frame"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "blocked", blockers_preview: [] })
    expect(JSON.stringify(state.opencodeProgress?.latestResult)).not.toContain("traceback")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-progress", args: [`session=${sessionId}`, "kind=question", "question=override", "question"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "question", question_preview: "override question" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-question", args: [`session=${sessionId}`, "kind=progress", "summary=override", "progress"] })
    expect(state.opencodeProgress?.latestResult).toMatchObject({ status: "recorded", kind: "progress", report_summary_preview: "override progress" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: [`/opencode-progress session=${sessionId} summary=staged progress`] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-progress"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-progress",
      risk: "medium_risk_write",
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("metadata")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode progress")
    expect(snapshot).toContain("selected_blockers=needs commander clarification")
    expect(snapshot).toContain("heartbeat does not mean task success")
    expect(snapshot).toContain("question reports do not ask Commander yet")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("OpenCode watchdog slash commands record assessments and forced report metadata only", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=timeout", "watchdog", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })
    const launchId = state.opencodeLaunches?.latestResult?.launch_id
    expect(launchId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-heartbeat", args: [`session=${sessionId}`, "summary=alive", "token=abc123"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-preview", args: [`session=${sessionId}`] })
    expect(state.opencodeWatchdog?.preview).toMatchObject({ status: "ready", can_record: true, session_id: sessionId, watchdog_status: "healthy" })
    expect(JSON.stringify(state.opencodeWatchdog?.preview)).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-preview", args: [`session=${sessionId}`, "max_wall_ms=60000", "max_no_progress_ms=2000", "heartbeat_ms=1000"] })
    expect(state.opencodeWatchdog?.preview).toMatchObject({ max_wall_time_ms: 60_000, max_no_progress_ms: 2_000, heartbeat_interval_ms: 1_000 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-force-report", args: [`session=${sessionId}`, "reason=healthy", "report", "request"] })
    expect(state.opencodeWatchdog?.commandError).toContain("forced report request is only allowed")
    expect(state.opencodeWatchdog?.forcedReportRequests).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-record", args: [`session=${sessionId}`, "request_report=true"] })
    expect(state.opencodeWatchdog?.latestResult).toMatchObject({ status: "blocked", forced_report_requested: false })
    expect(state.opencodeWatchdog?.commandError).toContain("forced report request is only allowed")
    expect(state.opencodeWatchdog?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-dry-run", args: [`session=${sessionId}`] })
    expect(state.opencodeWatchdog?.latestResult).toMatchObject({ status: "dry_run", session_id: sessionId })
    expect(state.opencodeWatchdog?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-record", args: [`session=${sessionId}`] })
    expect(state.opencodeWatchdog?.latestResult).toMatchObject({ status: "recorded", session_id: sessionId, watchdog_status: "healthy", report_required: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-blocker", args: [`session=${sessionId}`, "summary=blocked", "blocker=needs", "report", "token=abc123"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-preview", args: [`session=${sessionId}`] })
    expect(state.opencodeWatchdog?.preview).toMatchObject({ watchdog_status: "blocked", report_required: true, has_blockers: true })
    expect(state.opencodeWatchdog?.preview?.blockers_preview).toEqual(["needs report [REDACTED]"])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-force-report-dry-run", args: [`session=${sessionId}`, "reason=dry", "report"] })
    expect(state.opencodeWatchdog?.latestResult).toMatchObject({ status: "dry_run", session_id: sessionId, forced_report_requested: false })
    expect(state.opencodeWatchdog?.forcedReportResult).toBeNull()
    expect(state.opencodeWatchdog?.forcedReportRequests).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-record", args: [`session=${sessionId}`, "request_report=true"] })
    expect(state.opencodeWatchdog?.latestResult).toMatchObject({ status: "recorded", forced_report_requested: true })
    const requestId = state.opencodeWatchdog?.latestResult?.forced_report_request_id
    expect(requestId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-force-report", args: [`session=${sessionId}`, "reason=duplicate", "request"] })
    expect(state.opencodeWatchdog?.commandError).toContain("forced report request already exists")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdogs", args: [`session=${sessionId}`] })
    expect(state.opencodeWatchdog?.records.map((record) => record.watchdog_status)).toContain("healthy")
    const watchdogId = state.opencodeWatchdog?.records[0]?.watchdog_id
    expect(watchdogId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-show", args: [watchdogId!] })
    expect(state.opencodeWatchdog?.selected?.watchdog_id).toBe(watchdogId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-force-report-requests", args: [`session=${sessionId}`] })
    expect(state.opencodeWatchdog?.forcedReportRequests.map((request) => request.request_id)).toContain(requestId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-force-report-show", args: [requestId!] })
    expect(state.opencodeWatchdog?.selectedRequest?.request_id).toBe(requestId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-summary", args: [] })
    expect(state.opencodeWatchdog?.summary?.total_launched_sessions).toBeGreaterThanOrEqual(1)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: [`/opencode-force-report session=${sessionId} reason=staged report`] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-force-report"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-force-report",
      risk: "medium_risk_write",
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("process_paused=false")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode watchdog")
    expect(snapshot).toContain("forced_report_requests")
    expect(snapshot).toContain("process_paused=false")
    expect(snapshot).toContain("watchdog does not pause/kill OpenCode")
    expect(snapshot).toContain("Commander guidance/answer and wake scheduler execution are future work")
    expect(snapshot).toContain("selected=/opencode-force-report risk=medium_risk_write")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("OpenCode asks Commander slash commands create bounded pending question metadata only", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=ask", "commander", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-question", args: [`session=${sessionId}`, "question=should", "I", "use", "option", "A", "or", "B", "token=abc123"] })
    const progressId = state.opencodeProgress?.latestResult?.progress_id
    expect(progressId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander-preview", args: [`session=${sessionId}`, "question=should", "I", "use", "option", "A", "or", "B", "token=abc123", "options=A,B", "recommendation=prefer", "A"] })
    expect(state.opencodeCommanderQuestions?.preview).toMatchObject({ status: "ready", can_create: true, session_id: sessionId, question_type: "clarification", urgency: "normal" })
    expect(state.opencodeCommanderQuestions?.preview?.options_considered_preview).toEqual(["A", "B"])
    expect(JSON.stringify(state.opencodeCommanderQuestions?.preview)).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander-dry-run", args: [`session=${sessionId}`, "question=should", "I", "use", "option", "A", "or", "B"] })
    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ status: "dry_run", session_id: sessionId })
    expect(state.opencodeCommanderQuestions?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=other", "ask", "commander", "session"] })
    const otherSessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(otherSessionId).toBeTruthy()
    expect(otherSessionId).not.toBe(sessionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${otherSessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${otherSessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${otherSessionId}`, "question=unrelated", "session", "question"] })
    const otherQuestionId = state.opencodeCommanderQuestions?.latestResult?.question_id
    expect(otherQuestionId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`progress=${progressId}`] })
    const questionId = state.opencodeCommanderQuestions?.latestResult?.question_id
	    expect(questionId).toBeTruthy()
    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ status: "created", question_status: "pending_commander", source_kind: "progress_question", progress_id: progressId })
    expect(state.opencodeCommanderQuestions?.records).toHaveLength(1)
    expect(state.opencodeCommanderQuestions?.records.map((record) => record.question_id)).toEqual([questionId!])
    expect(state.opencodeCommanderQuestions?.records.map((record) => record.question_id)).not.toContain(otherQuestionId)
	    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander-preview", args: [`progress=${progressId}`] })
	    expect(state.opencodeCommanderQuestions?.preview).toMatchObject({ status: "blocked", can_create: false, duplicate_question_id: questionId })
	    expect(state.opencodeCommanderQuestions?.commandError).toContain("pending Commander question already exists")

	    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`progress=${progressId}`] })
	    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ status: "blocked" })
	    expect(state.opencodeCommanderQuestions?.commandError).toContain("pending Commander question already exists")
	    expect(state.opencodeCommanderQuestions?.records).toHaveLength(1)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander-preview", args: [`progress=${progressId}`, "question=edited", "wording", "same", "evidence"] })
    expect(state.opencodeCommanderQuestions?.preview).toMatchObject({ status: "blocked", can_create: false, duplicate_question_id: questionId })
    expect(state.opencodeCommanderQuestions?.commandError).toContain("pending Commander question already exists")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-commander-questions", args: [`session=${sessionId}`] })
    expect(state.opencodeCommanderQuestions?.records.map((record) => record.question_id)).toContain(questionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-commander-question-latest", args: [`session=${sessionId}`] })
    expect(state.opencodeCommanderQuestions?.latest?.question_id).toBe(questionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-commander-question-show", args: [questionId!] })
    expect(state.opencodeCommanderQuestions?.selected?.question_id).toBe(questionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-commander-question-summary", args: [] })
    expect(state.opencodeCommanderQuestions?.summary).toMatchObject({ total_questions: 2, pending_commander_count: 2 })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=urgent", "choice", "urgency=urgent"] })
    const urgentQuestionId = state.opencodeCommanderQuestions?.latestResult?.question_id
    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ status: "created", question_status: "pending_human" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander-preview", args: [`session=${sessionId}`, "question=urgent", "choice", "urgency=urgent"] })
    expect(state.opencodeCommanderQuestions?.preview).toMatchObject({ status: "blocked", can_create: false, duplicate_question_id: urgentQuestionId })
    expect(state.opencodeCommanderQuestions?.commandError).toContain("pending Commander question already exists")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=third", "pending", "question"] })
    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ status: "created", question_status: "pending_commander" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=fourth", "pending", "question"] })
    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ status: "blocked" })
    expect(state.opencodeCommanderQuestions?.commandError).toContain("max_pending_questions")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander-preview", args: [`session=${sessionId}`, "question=stdout", "stderr"] })
    expect(state.opencodeCommanderQuestions?.commandError).toContain("raw logs are out of scope")
    expect(JSON.stringify(state.opencodeCommanderQuestions?.preview)).not.toContain("stdout")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/opencode-ask-commander", `session=${sessionId}`, "question=staged", "question"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-ask-commander"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-ask-commander",
      risk: "medium_risk_write",
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("pending question")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode asks Commander")
    expect(snapshot).toContain("pending_commander=2")
    expect(snapshot).toContain("do not call Commander providers")
    expect(snapshot).toContain("selected=/opencode-ask-commander risk=medium_risk_write")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("Commander guidance slash commands answer pending questions without delivery", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=guidance", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=should", "I", "choose", "option", "A", "or", "B", "token=abc123"] })
    const questionId = state.opencodeCommanderQuestions?.latestResult?.question_id
    expect(questionId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=please", "provide", "timeout", "report", "type=timeout_report"] })
    const timeoutQuestionId = state.opencodeCommanderQuestions?.latestResult?.question_id
    expect(timeoutQuestionId).toBeTruthy()
    expect(state.opencodeCommanderQuestions?.latestResult).toMatchObject({ question_type: "timeout_report" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-preview", args: [`question=${timeoutQuestionId}`, "answer=send", "a", "bounded", "timeout", "report"] })
    expect(state.commanderGuidance?.preview).toMatchObject({ question_id: timeoutQuestionId, guidance_scope: "timeout_report_response" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-preview", args: [`question=${questionId}`, "answer=choose", "option", "A", "because", "it", "is", "safer", "token=abc123", "constraints=stay-bounded", "rationale=manual", "answer"] })
    expect(state.commanderGuidance?.preview).toMatchObject({ status: "ready", can_create: true, question_id: questionId, delivery_status: "not_delivered" })
    expect(JSON.stringify(state.commanderGuidance?.preview)).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-dry-run", args: [`question=${questionId}`, "answer=choose", "option", "A"] })
    expect(state.commanderGuidance?.latestResult).toMatchObject({ status: "dry_run", question_id: questionId, delivery_status: "not_delivered" })
    expect(state.commanderGuidance?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-preview", args: [`question=${questionId}`, "answer=stdout", "stderr"] })
    expect(state.commanderGuidance?.commandError).toContain("raw logs are out of scope")
    expect(JSON.stringify(state.commanderGuidance?.preview)).not.toContain("stdout")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance", args: [`question=${questionId}`, "answer=choose", "option", "A", "because", "it", "is", "safer", "token=abc123"] })
    const guidanceId = state.commanderGuidance?.latestResult?.guidance_id
    expect(guidanceId).toBeTruthy()
    expect(state.commanderGuidance?.latestResult).toMatchObject({ status: "created", delivery_status: "not_delivered", question_status_after: "answered" })
    expect(state.opencodeCommanderQuestions?.selected).toMatchObject({ question_id: questionId, question_status: "answered" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-list", args: [`question=${questionId}`] })
    expect(state.commanderGuidance?.records.map((record) => record.guidance_id)).toContain(guidanceId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-latest", args: [`question=${questionId}`] })
    expect(state.commanderGuidance?.latest?.guidance_id).toBe(guidanceId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-show", args: [guidanceId!] })
    expect(state.commanderGuidance?.selected?.guidance_id).toBe(guidanceId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-summary", args: [] })
    expect(state.commanderGuidance?.summary).toMatchObject({ total_guidance: 1, not_delivered_count: 1, delivered_count: 0 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-preview", args: [`question=${questionId}`, "answer=another", "answer"] })
    expect(state.commanderGuidance?.preview).toMatchObject({ status: "blocked", can_create: false, duplicate_guidance_id: guidanceId })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance", args: [`question=${questionId}`, "answer=another", "answer"] })
    expect(state.commanderGuidance?.latestResult).toMatchObject({ status: "blocked" })
    expect(state.commanderGuidance?.commandError).toContain("Commander guidance already exists")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/commander-guidance", `question=${questionId}`, "answer=staged", "answer"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/commander-guidance"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/commander-guidance",
      risk: "medium_risk_write",
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("not_delivered")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Commander guidance")
    expect(snapshot).toContain("delivery_status=not_delivered")
    expect(snapshot).toContain("not delivered to OpenCode")
    expect(snapshot).toContain("selected=/commander-guidance risk=medium_risk_write")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("Commander guidance delivery slash commands request operator handoff separately from answers", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=guidance", "delivery", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=should", "I", "choose", "option", "A", "or", "B", "token=abc123"] })
    const questionId = state.opencodeCommanderQuestions?.latestResult?.question_id
    expect(questionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance", args: [`question=${questionId}`, "answer=choose", "option", "A", "because", "it", "is", "safer", "token=abc123"] })
    const guidanceId = state.commanderGuidance?.latestResult?.guidance_id
    expect(guidanceId).toBeTruthy()

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-delivery-preview", args: [`guidance=${guidanceId}`] })
    expect(state.commanderGuidanceDelivery?.preview).toMatchObject({ status: "ready", can_deliver: true, delivery_mode: "operator_handoff", adapter_capability: "operator_handoff_only" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-delivery-dry-run", args: [`guidance=${guidanceId}`] })
    expect(state.commanderGuidanceDelivery?.latestResult).toMatchObject({ status: "dry_run", guidance_id: guidanceId, delivery_status_after: "not_delivered" })
    expect(state.commanderGuidanceDelivery?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-deliver", args: [`guidance=${guidanceId}`, "mode=adapter-send"] })
    expect(state.commanderGuidanceDelivery?.latestResult).toMatchObject({ status: "blocked" })
    expect(state.commanderGuidanceDelivery?.commandError).toContain("unsupported guidance delivery mode")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-deliver", args: [`guidance=${guidanceId}`, "mode=operator_handoff", "delivered_by=delivery-operator"] })
    const deliveryId = state.commanderGuidanceDelivery?.latestResult?.delivery_id
    expect(deliveryId).toBeTruthy()
    expect(state.commanderGuidanceDelivery?.latestResult).toMatchObject({ status: "delivery_requested", delivery_status_after: "pending_delivery", delivery_mode: "operator_handoff" })
    expect(state.commanderGuidanceDelivery?.latestResult?.delivered_by).toBe("delivery-operator")
    expect(state.commanderGuidanceDelivery?.latestResult?.operator_handoff_preview).toContain("no OpenCode prompt was sent")
    expect(state.commanderGuidance?.selected).toMatchObject({ guidance_id: guidanceId, delivery_status: "pending_delivery" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-deliveries", args: [`guidance=${guidanceId}`] })
    expect(state.commanderGuidanceDelivery?.records.map((record) => record.delivery_id)).toContain(deliveryId)
    expect(state.commanderGuidanceDelivery?.records.find((record) => record.delivery_id === deliveryId)?.delivered_by).toBe("delivery-operator")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-delivery-latest", args: [`guidance=${guidanceId}`] })
    expect(state.commanderGuidanceDelivery?.latest?.delivery_id).toBe(deliveryId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-delivery-show", args: [deliveryId!] })
    expect(state.commanderGuidanceDelivery?.selected?.delivery_id).toBe(deliveryId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-delivery-summary", args: [] })
    expect(state.commanderGuidanceDelivery?.summary).toMatchObject({ total_deliveries: 1, requested_count: 1, delivered_count: 0 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-deliver", args: [`guidance=${guidanceId}`, "mode=operator_handoff"] })
    expect(state.commanderGuidanceDelivery?.latestResult).toMatchObject({ status: "blocked" })
    expect(state.commanderGuidanceDelivery?.commandError).toContain("delivery_status must be not_delivered")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/commander-guidance-deliver", `guidance=${guidanceId}`] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/commander-guidance-deliver"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/commander-guidance-deliver",
      risk: "medium_risk_write",
      calls_provider: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("operator_handoff metadata only")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Commander guidance delivery")
    expect(snapshot).toContain("pending_delivery")
    expect(snapshot).toContain("operator_handoff does not send a prompt")
    expect(snapshot).toContain("selected=/commander-guidance-deliver risk=medium_risk_write")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("OpenCode human control slash commands record metadata without process control or prompts", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=human", "control", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-preview", args: [`session=${sessionId}`, "kind=note", "note=stdout:", "raw", "runtime", "log"] })
    expect(state.opencodeHumanControls?.preview).toMatchObject({ status: "blocked", human_note_preview: "raw human note omitted" })
    expect(JSON.stringify(state)).not.toContain("stdout:")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-preview", args: [`session=${sessionId}`, "kind=pause_request", "reason=operator", "wants", "review", "token=abc123"] })
    expect(state.opencodeHumanControls?.preview).toMatchObject({ status: "ready", can_record: true, control_kind: "pause_request", process_control_performed: false, open_code_prompt_sent: false, mission_mutated: false })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-dry-run", args: [`session=${sessionId}`, "kind=pause_request", "reason=operator", "wants", "review", "token=abc123"] })
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "dry_run", control_kind: "pause_request", process_control_performed: false })
    expect(state.opencodeHumanControls?.records).toEqual([])

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=other", "session"] })
    const otherSessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(otherSessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${otherSessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${otherSessionId}`] })
    const otherLaunchId = state.opencodeLaunches?.latestResult?.launch_id
    expect(otherLaunchId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-question", args: [`session=${otherSessionId}`, "question=other", "session", "question"] })
    const otherProgressId = state.opencodeProgress?.latestResult?.progress_id
    expect(otherProgressId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-preview", args: [`session=${sessionId}`, `progress=${otherProgressId}`, "kind=pause_request", "reason=mismatched", "evidence"] })
    expect(state.opencodeHumanControls?.preview).toMatchObject({ status: "blocked" })
    expect(state.opencodeHumanControls?.preview?.blockers.join(" ")).toContain("linked evidence belongs to a different session")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-preview", args: [`launch=${otherLaunchId}`, `progress=${otherProgressId}`, "kind=note", "note=matching", "evidence"] })
    expect(state.opencodeHumanControls?.preview).toMatchObject({ status: "ready" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-preview", args: ["launch=fake_launch_mismatch", `progress=${otherProgressId}`, "kind=note", "note=mismatched", "launch"] })
    expect(state.opencodeHumanControls?.preview).toMatchObject({ status: "blocked" })
    expect(state.opencodeHumanControls?.preview?.blockers.join(" ")).toContain("linked evidence belongs to a different launch")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-pause", args: [`session=${sessionId}`, "reason=operator", "wants", "review", "token=abc123"] })
    const pauseId = state.opencodeHumanControls?.latestResult?.control_id
    expect(pauseId).toBeTruthy()
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "recorded", projected_state_after: "pause_requested", process_control_performed: false, open_code_prompt_sent: false, mission_mutated: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-correction", args: [`session=${sessionId}`, "correction=prefer", "safer", "approach", "token=abc123"] })
    const correctionId = state.opencodeHumanControls?.latestResult?.control_id
    expect(correctionId).toBeTruthy()
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "recorded", control_kind: "correction", projected_state_after: "correction_pending", open_code_prompt_sent: false })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-force-report", args: [`session=${sessionId}`, "reason=please", "report", "current", "state", "token=abc123"] })
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "recorded", control_kind: "force_report", projected_state_after: "report_requested" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-note", args: [`session=${sessionId}`, "note=operator", "note", "token=abc123"] })
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "recorded", control_kind: "note", projected_state_after: "noted" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-pause", args: [`session=${sessionId}`, "reason=operator", "wants", "review", "token=abc123"] })
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "blocked" })
    expect(state.opencodeHumanControls?.commandError).toContain("duplicate human control already exists")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-dry-run", args: [`session=${sessionId}`, "kind=pause_request", "reason=operator", "wants", "review", "token=abc123"] })
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ status: "blocked", control_kind: "pause_request" })
    expect(state.opencodeHumanControls?.commandError).toContain("duplicate human control already exists")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-controls", args: [`session=${sessionId}`] })
    expect(state.opencodeHumanControls?.records.map((record) => record.control_id)).toContain(correctionId)
    expect(state.opencodeHumanControls?.records).toHaveLength(4)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-latest", args: [`session=${sessionId}`] })
    expect(state.opencodeHumanControls?.latest?.control_kind).toBe("note")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-show", args: [correctionId!] })
    expect(state.opencodeHumanControls?.selected?.control_id).toBe(correctionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-control-summary", args: [] })
    expect(state.opencodeHumanControls?.summary).toMatchObject({ total_controls: 4, pause_requested_count: 1, correction_pending_count: 1, report_requested_count: 1 })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "stage-command", args: ["/opencode-human-pause", `session=${sessionId}`, "reason=staged", "review"] })
    expect(state.operatorActions?.staged?.command_type).toBe("write")
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-human-pause"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-human-control",
      risk: "medium_risk_write",
      calls_provider: false,
      creates_external_process: false,
      mutates_events: true,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("process_control_performed=false")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode human controls")
    expect(snapshot).toContain("process_control_performed=false")
    expect(snapshot).toContain("open_code_prompt_sent=false")
    expect(snapshot).toContain("mission_mutated=false")
    expect(snapshot).toContain("no process pause/kill/stop/resume occurred")
    expect(snapshot).toContain("selected=/opencode-human-control risk=medium_risk_write")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toEqual([])
  })

  test("OpenCode wake supervisor slash commands render read-only aggregate evidence", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-plan", args: ["objective=wake", "supervisor", "preview", "test", "token=abc123"] })
    const sessionId = state.opencodeSessions?.latestPlan?.session_id
    expect(sessionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-session-instruction-pack-write", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-launch", args: [`session=${sessionId}`] })
    const launchId = state.opencodeLaunches?.latestResult?.launch_id
    expect(launchId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-heartbeat", args: [`session=${sessionId}`, "summary=alive", "token=abc123"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-watchdog-record", args: [`session=${sessionId}`] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-question", args: [`session=${sessionId}`, "question=should", "I", "choose", "option", "A", "or", "B", "token=abc123"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-ask-commander", args: [`session=${sessionId}`, "question=should", "I", "choose", "option", "A", "or", "B", "token=abc123"] })
    const questionId = state.opencodeCommanderQuestions?.latestResult?.question_id
    expect(questionId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance", args: [`question=${questionId}`, "answer=choose", "option", "A", "token=abc123"] })
    const guidanceId = state.commanderGuidance?.latestResult?.guidance_id
    expect(guidanceId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "commander-guidance-deliver", args: [`guidance=${guidanceId}`, "mode=operator_handoff"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-pause", args: [`session=${sessionId}`, "reason=operator", "wants", "review", "token=abc123"] })
    const pauseId = state.opencodeHumanControls?.latestResult?.control_id
    expect(pauseId).toBeTruthy()
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-human-note", args: [`session=${sessionId}`, "note=operator", "note", "after", "pause", "token=abc123"] })
    expect(state.opencodeHumanControls?.latestResult).toMatchObject({ control_kind: "note", projected_state_after: "noted" })

    const commandCountBeforePreview = runtime.sentCommands.length
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-wake-supervisor-preview", args: [`session=${sessionId}`] })
    expect(state.opencodeWakeSupervisor?.preview).toMatchObject({
      status: "ready",
      session_id: sessionId,
      launch_id: launchId,
      supervisor_status: "human_paused",
      recommended_action: "review_human_control",
      pending_delivery_count: 1,
      latest_human_control_id: pauseId,
      human_pause_requested: true,
      blocked_by_human: true,
    })
    expect(state.opencodeWakeSupervisor?.preview?.checks.map((check) => check.check_id)).toContain("human_control_state")
    expect(state.opencodeWakeSupervisor?.preview?.context_sections.map((section) => section.section)).toEqual(expect.arrayContaining(["guidance_delivery_state", "human_control_state", "omitted_raw_logs", "omitted_full_research_db", "omitted_full_event_log"]))
    expect(state.opencodeWakeSupervisor?.preview?.evidence_refs.map((ref) => ref.evidence_kind)).toEqual(expect.arrayContaining(["progress", "watchdog", "commander_guidance", "guidance_delivery", "human_control"]))
    expect(state.opencodeWakeSupervisor?.preview?.recommended_commands.some((command) => command.command_type === "write")).toBe(true)
    expect(runtime.sentCommands).toHaveLength(commandCountBeforePreview)

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-wake-supervisor-preview", args: [`session=${sessionId}`, "include_human_controls=false"] })
    expect(state.opencodeWakeSupervisor?.preview).toMatchObject({
      supervisor_status: "guidance_pending_delivery",
      recommended_action: "review_human_control",
      human_pause_requested: false,
      blocked_by_human: false,
    })
    expect(state.opencodeWakeSupervisor?.preview?.evidence_refs.map((ref) => ref.evidence_kind)).not.toContain("human_control")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-wake-supervisor-preview", args: [`session=${sessionId}`] })
    expect(state.opencodeWakeSupervisor?.preview).toMatchObject({ supervisor_status: "human_paused" })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-wake-supervisor-preview", args: [`launch=${launchId}`] })
    expect(state.opencodeWakeSupervisor?.preview).toMatchObject({ launch_id: launchId, supervisor_status: "human_paused" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "opencode-wake-supervisor-summary", args: [] })
    expect(state.opencodeWakeSupervisor?.summary).toMatchObject({ total_launched_sessions: 1, human_attention_count: 1 })
    expect(state.opencodeWakeSupervisor?.cards.map((card) => card.session_id)).toContain(sessionId)
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/opencode-wake-supervisor-preview"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/opencode-wake-supervisor-preview",
      risk: "safe_read",
      calls_provider: false,
      mutates_events: false,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("Read-only OpenCode wake supervisor preview")

    const snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("OpenCode wake supervisor")
    expect(snapshot).toContain("supervisor_status=human_paused")
    expect(snapshot).toContain("recommended_action=review_human_control")
    expect(snapshot).toContain("pending_delivery=1")
    expect(snapshot).toContain("pause=true")
    expect(snapshot).toContain("context_sections")
    expect(snapshot).toContain("evidence_refs")
    expect(snapshot).toContain("recommended=/opencode-progress-latest")
    expect(snapshot).toContain("wake supervisor preview is read-only")
    expect(snapshot).toContain("selected=/opencode-wake-supervisor-preview risk=safe_read")
    expect(snapshot).not.toContain("abc123")
    expect(JSON.stringify(state)).not.toContain("abc123")
    expect(runtime.sentCommands).toHaveLength(commandCountBeforePreview)
  })

  test("research memory and novelty slash commands render read-only previews", async () => {
    const runtime = new FakeRuntimeClient("/tmp/demo", "demo")
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-memory-summary", args: [] })
    expect(state.researchMemory?.summary).toMatchObject({
      total_candidates_available: 4,
      has_research_db_projection: true,
      retrieval_policy: "fake",
    })

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-memory-search", args: ["query=adapter", "timeout", "token=abc123"] })
    expect(state.researchMemory?.retrievalPreview).toMatchObject({
      status: "ready",
      retrieval_policy: "fake",
    })
    expect(state.researchMemory?.retrievalPreview?.candidates.map((candidate) => candidate.label)).toContain("failure")
    let snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("Research memory and novelty")
    expect(snapshot).toContain("retrieval=fake-research-memory")
    expect(snapshot).toContain("retrieval_candidates")
    expect(snapshot).toContain("refs=research_db:fake-finding-timeout")
    expect(snapshot).toContain("artifacts=fake-artifact-timeout")
    expect(snapshot).toContain("citations=fake-citation-timeout")
    expect(snapshot).toContain("note=previews do not include raw research records, full research.db")
    expect(snapshot).not.toContain("abc123")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-novelty-preview", args: ["question=adapter", "timeout", "method=watchdog", "config=short-interval"] })
    expect(state.researchMemory?.noveltyPreview?.duplicate_risk).toBe("high")
    expect(state.researchMemory?.noveltyPreview?.repetition_requires_justification).toBe(true)
    snapshot = layoutSnapshot(state)
    expect(snapshot).toContain("duplicate_risk=high")
    expect(snapshot).toContain("novelty_score=")
    expect(snapshot).toContain("external_research_recommended=")
    expect(snapshot).toContain("previews do not call providers, call MCPs, launch OpenCode, write research.db")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-novelty-preview", args: ["question=adapter", "timeout", "method=watchdog", "config=short-interval", "reason=replication"] })
    expect(state.researchMemory?.noveltyPreview?.repetition_requires_justification).toBe(false)
    expect(state.researchMemory?.noveltyPreview?.suggested_reason_not_duplicate).toBe("replication")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-novelty-preview", args: ["question=spectral", "normalization", "method=orthogonalization", "config=large-margin"] })
    expect(state.researchMemory?.noveltyPreview).toMatchObject({
      duplicate_risk: "low",
      novelty_score: 0.85,
      missing_memory_warning: false,
      external_research_recommended: false,
    })
    expect(state.researchMemory?.noveltyPreview?.nearest_prior_results).toEqual([])
    expect(state.researchMemory?.noveltyPreview?.warnings.join(" ")).not.toContain("empty or unavailable")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-memory-search", args: [] })
    expect(state.researchMemory?.commandError).toContain("requires query")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-novelty-preview", args: [] })
    expect(state.researchMemory?.commandError).toContain("requires question")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "authority-show", args: ["/research-novelty-preview"] })
    expect(state.commandAuthority?.selected).toMatchObject({
      slash_command: "/research-novelty-preview",
      risk: "safe_read",
      creates_external_process: false,
      calls_provider: false,
      mutates_events: false,
    })
    expect(state.commandAuthority?.selected?.notes.join(" ")).toContain("flagged, not forbidden")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "context-packet-preview", args: ["purpose=commander_research_decision"] })
    expect(state.contextPackets?.preview?.purpose).toBe("commander_research_decision")

    expect(runtime.sentCommands).toEqual([])
    expect(JSON.stringify(state)).not.toContain("abc123")
  })
})
