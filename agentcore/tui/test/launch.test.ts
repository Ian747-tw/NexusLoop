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
    if (name === "runtime.preview_executor_review_proposal_narrow_apply") return {
      preview_id: "narrow_apply_preview_test",
      status: "blocked",
      can_apply: false,
      proposal_id: payload?.proposal_id ?? "unknown",
      readiness_id: "readiness_test",
      candidate_kind: "generic",
      candidate_risk: "medium",
      proposal_title_preview: "Narrow apply preview",
      proposal_summary_preview: "Narrow apply preview",
      source_evidence_ids: [],
      source_finding_ids: [],
      blockers: ["apply readiness is blocked"],
      warnings: [],
      recommended_commands: [],
      generated_at: "2026-06-20T00:00:00.000Z",
      redacted_summary_preview: "Narrow apply preview blocked.",
    }
    if (name === "runtime.apply_executor_review_proposal_narrow") return {
      apply_id: "narrow_apply_test",
      status: "blocked",
      proposal_id: payload?.proposal_id ?? "unknown",
      readiness_id: "readiness_test",
      candidate_kind: "generic",
      candidate_risk: "medium",
      applied_at: "2026-06-20T00:00:00.000Z",
      applied_by: "operator",
      error: "apply readiness is blocked",
      apply_hash: "hash",
      recommended_commands: [],
    }
    if (name === "runtime.list_executor_review_proposal_narrow_applies") return []
    if (name === "runtime.get_executor_review_proposal_narrow_apply") return null
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
    if (name === "runtime.preview_opencode_session_plan") return opencodeSessionPreview(payload)
    if (name === "runtime.create_opencode_session_plan") return opencodeSessionPlan(payload, payload?.dry_run === true || payload?.dryRun === true ? "dry_run" : "planned")
    if (name === "runtime.list_opencode_sessions") return []
    if (name === "runtime.get_opencode_session") return null
    if (name === "runtime.opencode_session_summary") return { total_sessions: 0, planned_count: 0, running_count: 0, paused_count: 0, blocked_count: 0, completed_count: 0, failed_count: 0, cancelled_count: 0, generated_at: "2026-06-20T00:00:00.000Z" }
    if (name === "runtime.list_model_capabilities") return [{ capability_id: "capability-test", provider_kind: "local", model_id: "local-small", display_name: "Local small", role_support: ["commander"], max_context_tokens: 4096, max_context_bytes: 16384, supports_tools: "unknown", supports_json_schema: "unknown", supports_mcp: false, supports_long_context: false, supports_streaming: "unknown", supports_local_execution: true, safety_margin_ratio: 0.25, source: "default_registry", warnings: [] }]
    if (name === "runtime.get_model_capability") return { capability_id: "capability-test", provider_kind: "local", model_id: "local-small", display_name: "Local small", role_support: ["commander"], max_context_tokens: 4096, max_context_bytes: 16384, supports_tools: "unknown", supports_json_schema: "unknown", supports_mcp: false, supports_long_context: false, supports_streaming: "unknown", supports_local_execution: true, safety_margin_ratio: 0.25, source: "default_registry", warnings: [] }
    if (name === "runtime.context_budget_summary") return { total_capabilities: 1, known_context_count: 1, unknown_context_count: 0, local_model_count: 1, cloud_model_count: 0, long_context_count: 0, generated_at: "2026-06-20T00:00:00.000Z" }
    if (name === "runtime.preview_context_budget") return {
      preview_id: "budget-preview-test",
      purpose: payload?.purpose ?? "unknown",
      role: payload?.purpose === "opencode_executor_session" ? "executor" : "commander",
      capability: { capability_id: "capability-test", provider_kind: "local", model_id: "local-small", display_name: "Local small", role_support: ["commander"], max_context_tokens: 4096, max_context_bytes: 16384, supports_tools: "unknown", supports_json_schema: "unknown", supports_mcp: false, supports_long_context: false, supports_streaming: "unknown", supports_local_execution: true, safety_margin_ratio: 0.25, source: "default_registry", warnings: [] },
      budget: { budget_id: "budget-test", purpose: payload?.purpose ?? "unknown", provider_kind: "local", model_id: "local-small", max_context_tokens: 4096, max_context_bytes: payload?.maxContextBytes ?? 16384, max_output_tokens: 1024, safety_margin_tokens: 1024, safety_margin_bytes: 4096, allocations: [{ section: "raw_logs", priority: "excluded", inclusion_policy: "excluded_by_default" }, { section: "reserved_output", priority: "required", inclusion_policy: "always" }, { section: "safety_margin", priority: "required", inclusion_policy: "always" }], warnings: [], generated_at: "2026-06-20T00:00:00.000Z" },
      blockers: [],
      warnings: [],
      recommended_commands: [],
      generated_at: "2026-06-20T00:00:00.000Z",
      redacted_summary_preview: "budget preview",
    }
    if (name === "runtime.preview_context_packet") return {
      packet_id: "packet-preview-test",
      role: payload?.purpose === "opencode_executor_session" ? "executor" : "commander",
      purpose: payload?.purpose ?? "unknown",
      budget_id: "budget-test",
      provider_kind: "local",
      model_id: "local-small",
      packet_status: "partial",
      can_compile_final_prompt: false,
      sections: [
        { section: "role_kernel", status: "included", priority: "required", inclusion_policy: "always", estimated_tokens: 10, estimated_bytes: 40, summary_preview: "role kernel", source_refs: [], warnings: [] },
        { section: "raw_logs", status: "excluded", priority: "excluded", inclusion_policy: "excluded_by_default", estimated_tokens: 0, estimated_bytes: 0, summary_preview: "raw logs excluded", source_refs: [], warnings: [] },
      ],
      included_source_refs: [],
      omitted_source_refs: [],
      budget_summary: { max_context_tokens: 4096, max_context_bytes: payload?.maxContextBytes ?? 16384, max_output_tokens: 1024, safety_margin_tokens: 1024, safety_margin_bytes: 4096, estimated_input_tokens: 10, estimated_input_bytes: 40, over_budget: false },
      blockers: [],
      warnings: ["packet preview does not compile executable prompts, call providers, launch OpenCode, query research.db, call MCPs, or decide research direction"],
      recommended_commands: [],
      generated_at: "2026-06-20T00:00:00.000Z",
      redacted_summary_preview: "packet preview",
      packet_hash: "hash",
    }
    if (name === "runtime.context_packet_summary") return { supported_purposes: ["commander_research_decision", "opencode_executor_session"], supported_roles: ["commander", "executor"], generated_at: "2026-06-20T00:00:00.000Z" }
    if (name === "runtime.preview_opencode_session_instruction_pack") return opencodeSessionInstructionPackPreview(payload, "ready")
    if (name === "runtime.write_opencode_session_instruction_pack") return opencodeSessionInstructionPackResult(payload, payload?.dry_run === true || payload?.dryRun === true ? "dry_run" : "blocked")
    if (name === "runtime.list_opencode_session_instruction_packs") return []
    if (name === "runtime.get_opencode_session_instruction_pack") return null
    if (name === "runtime.preview_opencode_session_launch") return opencodeSessionLaunchPreview(payload)
    if (name === "runtime.launch_opencode_session") return opencodeSessionLaunchResult(payload, payload?.dry_run === true || payload?.dryRun === true ? "dry_run" : "blocked")
    if (name === "runtime.list_opencode_session_launches") return []
    if (name === "runtime.get_opencode_session_launch") return null
    if (name === "runtime.preview_commander_guidance") return commanderGuidancePreview(payload, "ready")
    if (name === "runtime.create_commander_guidance") return commanderGuidanceResult(payload, payload?.dry_run === true || payload?.dryRun === true ? "dry_run" : "created")
    if (name === "runtime.list_commander_guidance") return []
    if (name === "runtime.get_commander_guidance") return null
    if (name === "runtime.latest_commander_guidance") return null
    if (name === "runtime.commander_guidance_summary") return { total_guidance: 0, created_count: 0, not_delivered_count: 0, pending_delivery_count: 0, delivered_count: 0, cancelled_count: 0, by_scope_counts: {}, latest_guidance: [], generated_at: "2026-06-20T00:00:00.000Z" }
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

function opencodeSessionPreview(payload?: Record<string, unknown>) {
  const objective = String(payload?.objective ?? "inspect session")
  return {
    preview_id: "session_preview_test",
    can_create: true,
    source_kind: "manual",
    title_preview: "Session preview",
    objective_preview: objective,
    commander_context_summary_preview: `Commander context for ${objective}`,
    opencode_context_seed_preview: `OpenCode seed for ${objective}`,
    max_context_bytes: 12_000,
    success_criteria: ["report findings"],
    constraints: ["do not launch OpenCode"],
    timeout_policy: { max_wall_time_ms: 1_800_000, max_no_progress_ms: 600_000, heartbeat_interval_ms: 60_000, forced_pause_enabled: true, report_required_on_timeout: true, timeout_policy_hash: "hash-timeout" },
    question_policy: { allow_opencode_questions: true, commander_answer_required_for_blockers: true, human_escalation_allowed: true, max_pending_questions: 3, question_policy_hash: "hash-question" },
    human_control_policy: { allow_human_pause: true, allow_human_override: true, allow_human_stop: true, allow_human_guidance_note: true, require_reason_for_stop: true, human_policy_hash: "hash-human" },
    blockers: [],
    warnings: ["planning only"],
    recommended_commands: [],
    generated_at: "2026-06-20T00:00:00.000Z",
    redacted_summary_preview: "session preview",
  }
}

function opencodeSessionPlan(payload: Record<string, unknown> | undefined, status: "dry_run" | "planned") {
  const preview = opencodeSessionPreview(payload)
  return {
    session_id: status === "dry_run" ? "session_dry_run_test" : "session_plan_test",
    status: "planned",
    source_kind: preview.source_kind,
    objective: preview.objective_preview,
    title: preview.title_preview,
    commander_context_summary: preview.commander_context_summary_preview,
    opencode_context_seed: preview.opencode_context_seed_preview,
    shared_context_summary: "shared session metadata",
    max_context_bytes: preview.max_context_bytes,
    success_criteria: preview.success_criteria,
    constraints: preview.constraints,
    artifact_expectations: ["bounded report"],
    timeout_policy: preview.timeout_policy,
    question_policy: preview.question_policy,
    human_control_policy: preview.human_control_policy,
    created_at: "2026-06-20T00:00:00.000Z",
    created_by: "operator",
    session_hash: `hash-${status}`,
  }
}

function opencodeSessionInstructionPackPreview(payload: Record<string, unknown> | undefined, status: "ready" | "blocked") {
  const sessionId = String(payload?.session_id ?? payload?.sessionId ?? "session_plan_test")
  const canWrite = status === "ready"
  return {
    preview_id: "instruction_pack_preview_test",
    status,
    can_write: canWrite,
    session_id: sessionId,
    packet_id: "packet-preview-test",
    packet_hash: "hash",
    budget_id: "budget-test",
    target_dir: `.nxl/opencode/sessions/${sessionId}`,
    files: canWrite ? [
      { file_kind: "task", relative_path: "TASK.md", would_write: true, size_bytes: 120, sha256: "hash-task", summary_preview: "TASK.md preview", sections_used: ["mission_state"], source_refs: [sessionId], warnings: [] },
      { file_kind: "context", relative_path: "CONTEXT.md", would_write: true, size_bytes: 140, sha256: "hash-context", summary_preview: "CONTEXT.md preview", sections_used: ["role_kernel"], source_refs: [sessionId], warnings: [] },
      { file_kind: "manifest", relative_path: "MANIFEST.json", would_write: true, size_bytes: 160, sha256: "hash-manifest", summary_preview: "MANIFEST.json preview", sections_used: ["manifest"], source_refs: [sessionId], warnings: [] },
    ] : [],
    total_size_bytes: canWrite ? 420 : 0,
    blockers: canWrite ? [] : ["planned OpenCode session was not found"],
    warnings: ["instruction-pack writing does not launch OpenCode"],
    recommended_commands: [],
    generated_at: "2026-06-20T00:00:00.000Z",
    redacted_summary_preview: canWrite ? "instruction pack preview" : "instruction pack blocked",
  }
}

function opencodeSessionInstructionPackResult(payload: Record<string, unknown> | undefined, status: "dry_run" | "blocked") {
  const preview = opencodeSessionInstructionPackPreview(payload, status === "dry_run" ? "ready" : "blocked")
  return {
    pack_id: "instruction_pack_test",
    status,
    session_id: preview.session_id,
    packet_id: preview.packet_id,
    packet_hash: preview.packet_hash,
    budget_id: preview.budget_id,
    target_dir: preview.target_dir,
    files: preview.files.map((file) => ({ ...file, would_write: false })),
    total_size_bytes: preview.total_size_bytes,
    written_at: "2026-06-20T00:00:00.000Z",
    written_by: "operator",
    error: status === "blocked" ? "planned OpenCode session was not found" : undefined,
    pack_hash: "hash-pack",
    recommended_commands: [],
  }
}

function opencodeSessionLaunchPreview(payload: Record<string, unknown> | undefined) {
  const sessionId = String(payload?.session_id ?? payload?.sessionId ?? "missing-session")
  return {
    preview_id: "launch_preview_test",
    status: "blocked",
    can_launch: false,
    launch_performed: false,
    adapter_kind: "fake",
    launch_mode: "fresh",
    session_id: sessionId,
    pack_id: typeof payload?.pack_id === "string" ? payload.pack_id : typeof payload?.packId === "string" ? payload.packId : undefined,
    readiness_hash: "readiness-hash",
    readiness_status: "blocked",
    packet_id: "packet-preview-test",
    packet_hash: "hash",
    budget_id: "budget-test",
    target_dir: `.nxl/opencode/sessions/${sessionId}`,
    command_preview: "fake opencode launch",
    instruction_files: ["TASK.md", "CONTEXT.md", "POLICY.md", "MANIFEST.json"],
    blockers: ["OpenCode launch readiness must be ready; current status is blocked"],
    warnings: [],
    recommended_commands: [],
    generated_at: "2026-06-20T00:00:00.000Z",
    redacted_summary_preview: "launch preview blocked",
    launch_hash: "hash-launch-preview",
  }
}

function opencodeSessionLaunchResult(payload: Record<string, unknown> | undefined, status: "dry_run" | "blocked") {
  const preview = opencodeSessionLaunchPreview(payload)
  return {
    launch_id: "launch_test",
    status,
    adapter_kind: preview.adapter_kind,
    launch_mode: "fresh",
    session_id: preview.session_id,
    pack_id: preview.pack_id,
    readiness_hash: preview.readiness_hash,
    packet_id: preview.packet_id,
    packet_hash: preview.packet_hash,
    budget_id: preview.budget_id,
    target_dir: preview.target_dir,
    command_preview: preview.command_preview,
    started_at: status === "dry_run" ? undefined : "2026-06-20T00:00:00.000Z",
    completed_at: "2026-06-20T00:00:00.000Z",
    error: status === "blocked" ? "OpenCode launch readiness must be ready; current status is blocked" : undefined,
    launch_performed: false,
    output_summary_preview: "dry-run launch metadata only",
    event_count: 0,
    launch_hash: "hash-launch",
    recommended_commands: [],
  }
}

function commanderGuidancePreview(payload: Record<string, unknown> | undefined, status: "ready" | "blocked") {
  const questionId = String(payload?.question_id ?? payload?.questionId ?? "question_test")
  return {
    preview_id: "guidance_preview_test",
    status,
    can_create: status === "ready",
    question_id: questionId,
    question_status: "pending_commander",
    session_id: "session_test",
    launch_id: "launch_test",
    guidance_scope: "answer_question",
    author_kind: "human",
    answer_preview: String(payload?.answer ?? "choose option A"),
    rationale_preview: "manual answer record",
    constraints_preview: [],
    spec_refs_preview: [],
    research_refs_preview: [],
    artifact_refs_preview: [],
    delivery_status: "not_delivered",
    delivery_note_preview: "Guidance recorded only; delivery is future work.",
    blockers: status === "ready" ? [] : ["question was not found"],
    warnings: ["guidance has not been delivered to OpenCode"],
    recommended_commands: [],
    generated_at: "2026-06-20T00:00:00.000Z",
    redacted_summary_preview: "Commander guidance preview",
    guidance_hash: "hash-guidance-preview",
  }
}

function commanderGuidanceResult(payload: Record<string, unknown> | undefined, status: "dry_run" | "created") {
  const preview = commanderGuidancePreview(payload, "ready")
  return {
    guidance_id: "guidance_test",
    status,
    guidance_status: "created",
    delivery_status: "not_delivered",
    question_id: preview.question_id,
    question_status_after: status === "created" ? "answered" : undefined,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    guidance_scope: preview.guidance_scope,
    author_kind: preview.author_kind,
    answer_preview: preview.answer_preview,
    rationale_preview: preview.rationale_preview,
    constraints_preview: preview.constraints_preview,
    spec_refs_preview: preview.spec_refs_preview,
    research_refs_preview: preview.research_refs_preview,
    artifact_refs_preview: preview.artifact_refs_preview,
    delivery_note_preview: preview.delivery_note_preview,
    created_at: "2026-06-20T00:00:00.000Z",
    created_by: "operator",
    guidance_hash: "hash-guidance",
    recommended_commands: [],
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

  test("headless OpenCode session inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/opencode-session-preview objective=inspect session token=abc123" },
      { type: "submit" },
      { type: "insert", text: "/opencode-session-plan-dry-run objective=inspect session token=abc123" },
      { type: "submit" },
      { type: "insert", text: "/opencode-session-plan objective=inspect session token=abc123" },
      { type: "submit" },
      { type: "insert", text: "/opencode-sessions" },
      { type: "submit" },
      { type: "insert", text: "/opencode-session-summary" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-opencode-session-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode sessions")
    expect(snapshot).not.toContain("abc123")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_session_plan")
    expect(runtime.commandNames).toContain("runtime.create_opencode_session_plan")
    expect(runtime.commandNames).toContain("runtime.list_opencode_sessions")
    expect(runtime.commandNames).toContain("runtime.opencode_session_summary")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless context budget inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/model-capabilities" },
      { type: "submit" },
      { type: "insert", text: "/context-budget-summary" },
      { type: "submit" },
      { type: "insert", text: "/context-budget-preview purpose=commander_research_decision" },
      { type: "submit" },
      { type: "insert", text: "/budget-preview purpose=opencode_executor_session max_context_bytes=4096" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-context-budget-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Context budget registry")
    expect(runtime.commandNames).toContain("runtime.list_model_capabilities")
    expect(runtime.commandNames).toContain("runtime.context_budget_summary")
    expect(runtime.commandNames).toContain("runtime.preview_context_budget")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless context packet inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/context-packet-preview purpose=commander_research_decision" },
      { type: "submit" },
      { type: "insert", text: "/packet-preview purpose=opencode_executor_session max_context_bytes=4096" },
      { type: "submit" },
      { type: "insert", text: "/context-packet-summary" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-context-packet-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Context packet compiler")
    expect(runtime.commandNames).toContain("runtime.preview_context_packet")
    expect(runtime.commandNames).toContain("runtime.context_packet_summary")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless OpenCode session instruction pack inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/opencode-session-instruction-pack-preview session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/session-instruction-pack-dry-run session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-session-instruction-pack-write session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-context-pack-write session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-session-instruction-packs" },
      { type: "submit" },
      { type: "insert", text: "/opencode-session-instruction-pack-show missing-pack" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-opencode-session-instruction-pack-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode session instruction packs")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_session_instruction_pack")
    expect(runtime.commandNames).toContain("runtime.write_opencode_session_instruction_pack")
    expect(runtime.commandNames).toContain("runtime.list_opencode_session_instruction_packs")
    expect(runtime.commandNames).toContain("runtime.get_opencode_session_instruction_pack")
    expect(runtime.commandNames).not.toContain("runtime.resume")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless OpenCode launch gate scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/opencode-launch-preview session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/launch-opencode-dry-run session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-launch session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-launches" },
      { type: "submit" },
      { type: "insert", text: "/opencode-launch-show missing-launch" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-opencode-launch-gate-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode launches")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_session_launch")
    expect(runtime.commandNames).toContain("runtime.launch_opencode_session")
    expect(runtime.commandNames).toContain("runtime.list_opencode_session_launches")
    expect(runtime.commandNames).toContain("runtime.get_opencode_session_launch")
    expect(runtime.commandNames).not.toContain("runtime.resume")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless OpenCode watchdog inspection scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/opencode-watchdog-preview session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-watchdog-dry-run session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-watchdog-record session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/watchdog-record session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-force-report-dry-run session=missing-session reason=dry run" },
      { type: "submit" },
      { type: "insert", text: "/opencode-force-report session=missing-session reason=metadata only" },
      { type: "submit" },
      { type: "insert", text: "/force-report session=missing-session reason=metadata only" },
      { type: "submit" },
      { type: "insert", text: "/session-force-report session=missing-session reason=metadata only" },
      { type: "submit" },
      { type: "insert", text: "/opencode-watchdogs session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-force-report-requests session=missing-session" },
      { type: "submit" },
      { type: "insert", text: "/opencode-watchdog-summary" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-opencode-watchdog-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("OpenCode watchdog")
    expect(runtime.commandNames).toContain("runtime.preview_opencode_watchdog")
    expect(runtime.commandNames).toContain("runtime.record_opencode_watchdog")
    expect(runtime.commandNames).toContain("runtime.request_opencode_forced_report")
    expect(runtime.commandNames).toContain("runtime.list_opencode_watchdogs")
    expect(runtime.commandNames).toContain("runtime.list_opencode_forced_report_requests")
    expect(runtime.commandNames).toContain("runtime.opencode_watchdog_summary")
    expect(runtime.commandNames).not.toContain("runtime.resume")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
  })

  test("headless Commander guidance scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/commander-guidance-preview question=question_test answer=choose option A" },
      { type: "submit" },
      { type: "insert", text: "/guidance-preview question=question_test answer=choose option A" },
      { type: "submit" },
      { type: "insert", text: "/commander-guidance-dry-run question=question_test answer=choose option A" },
      { type: "submit" },
      { type: "insert", text: "/guidance-dry-run question=question_test answer=choose option A" },
      { type: "submit" },
      { type: "insert", text: "/commander-guidance question=question_test answer=choose option A" },
      { type: "submit" },
      { type: "insert", text: "/answer-commander-question question=question_test answer=choose option A" },
      { type: "submit" },
      { type: "insert", text: "/commander-guidance-list question=question_test" },
      { type: "submit" },
      { type: "insert", text: "/guidance-list question=question_test" },
      { type: "submit" },
      { type: "insert", text: "/commander-guidance-latest question=question_test" },
      { type: "submit" },
      { type: "insert", text: "/guidance-latest question=question_test" },
      { type: "submit" },
      { type: "insert", text: "/commander-guidance-show guidance_test" },
      { type: "submit" },
      { type: "insert", text: "/commander-guidance-summary" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-commander-guidance-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Commander guidance")
    expect(runtime.commandNames).toContain("runtime.preview_commander_guidance")
    expect(runtime.commandNames).toContain("runtime.create_commander_guidance")
    expect(runtime.commandNames).toContain("runtime.list_commander_guidance")
    expect(runtime.commandNames).toContain("runtime.latest_commander_guidance")
    expect(runtime.commandNames).toContain("runtime.get_commander_guidance")
    expect(runtime.commandNames).toContain("runtime.commander_guidance_summary")
    expect(runtime.commandNames).not.toContain("runtime.resume")
    expect(runtime.commandNames).not.toContain("runtime.status")
    expect(runtime.commandNames).not.toContain("runtime.list_recent_missions")
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

  test("headless executor review proposal narrow-apply scripts skip broad startup refresh", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-narrow-apply-preview proposal=proposal-test" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-narrow-apply-dry-run proposal=proposal-test" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-narrow-applies" },
      { type: "submit" },
      { type: "insert", text: "/executor-review-proposal-narrow-apply-show narrow-apply-test" },
      { type: "submit" },
      { type: "insert", text: "/authority-show /executor-review-proposal-narrow-apply" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-executor-review-narrow-apply-no-start",
      env: { NXL_TUI_HEADLESS: "1", NXL_TUI_KEYS: JSON.stringify(keys) },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Executor review proposal narrow apply")
    expect(runtime.commandNames).toContain("runtime.preview_executor_review_proposal_narrow_apply")
    expect(runtime.commandNames).toContain("runtime.apply_executor_review_proposal_narrow")
    expect(runtime.commandNames).toContain("runtime.list_executor_review_proposal_narrow_applies")
    expect(runtime.commandNames).toContain("runtime.get_executor_review_proposal_narrow_apply")
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
