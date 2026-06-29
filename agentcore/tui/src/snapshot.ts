import type { UiState, StreamLine } from "./state"
import { redactText } from "./redaction"

function lines(items: StreamLine[]): string[] {
  if (items.length === 0) return ["  - empty"]
  return items.map((item) => `  - ${item.title}${item.status ? ` [${item.status}]` : ""}${item.detail ? `: ${item.detail}` : ""}`)
}

export function layoutSnapshot(state: UiState): string {
  const out = [
    `NexusLoop OpenTUI shell`,
    `screen=${state.screen}`,
    `focus=${state.focus}`,
    `project=${state.header.projectName}`,
    `runtime=${state.header.runtimeStatus}`,
    state.header.providerStatus,
    state.header.modelStatus,
    `mission=${state.header.activeMissionId}`,
    `active_training=${state.header.activeTrainingCount}`,
    `open_obligations=${state.header.openObligationsCount}`,
  ]

  if (state.screen === "init") {
    out.push(...runtimeLines(state))
    out.push("Project not initialized")
    out.push(...state.initChoices.map((choice, index) => `${index === state.initSelection ? ">" : " "} ${choice.label}`))
    return out.join("\n")
  }

  if (state.screen === "resume") {
    out.push(...runtimeLines(state))
    out.push("Resume")
    out.push(...state.resumeChoices.map((choice, index) => `${index === state.resumeSelection ? ">" : " "} ${choice.label}`))
    return out.join("\n")
  }

  out.push("Executor")
  out.push(...lines(state.executor))
  out.push("Commander")
  out.push(`  program_state=${state.commander.programState}`)
  out.push(`  work_intent=${state.commander.workIntent}`)
  out.push(`  budget=${state.commander.budget}`)
  out.push(`  obligations=${state.commander.obligations.join(", ") || "none"}`)
  out.push(`  candidates=${state.commander.candidates.join(", ") || "none"}`)
  out.push(...runtimeLines(state))
  out.push(...commandAuthorityLines(state))
  out.push(...reasoningProviderLines(state))
  out.push(...missionExecutionLines(state))
  out.push("Live system actions")
  out.push(...lines(state.systemActions))
  out.push("Onboarding")
  out.push(`  provider=${state.providerOnboarding.provider}`)
  out.push(`  model=${state.providerOnboarding.model}`)
  out.push(`  credential=${state.providerOnboarding.credentialSource}`)
  out.push(`  connection=${state.providerOnboarding.connectionStatus}`)
  out.push(`  gpu_quota=${state.projectOnboarding.gpuQuota}`)
  out.push(`  wake_hooks=${state.projectOnboarding.wakeHooks}`)
  out.push(`  max_parallel_runs=${state.projectOnboarding.maxParallelRuns}`)
  out.push(`  approvals=${state.projectOnboarding.approvalRequirements.join(", ") || "none"}`)
  out.push(`  risky_fields=${state.projectOnboarding.riskyFields.join(", ") || "none"}`)
  out.push("Search / records")
  out.push(`  filters=${state.search.recordFilters.join(", ")}`)
  out.push(`  labels=${state.search.labelFilters.join(", ")}`)
  out.push(...lines(state.search.records))
  out.push(...researchLines(state))
  out.push("Approval / clarification")
  out.push(...lines([...state.approval.specApprovals, ...state.approval.candidateApprovals, ...state.approval.clarifications]))
  out.push(...reviewLines(state))
  out.push(...proposalLines(state))
  out.push(...proposalBundleLines(state))
  out.push(...playbookLines(state))
  out.push(...workbenchLines(state))
  out.push(...applyLines(state))
  out.push(...auditLines(state))
  out.push(...queueLines(state))
  out.push(...navigationLines(state))
  out.push(...operatorActionLines(state))
  out.push(...externalApiLines(state))
  out.push(...minimaxLiveValidationLines(state))
  out.push(...researchSynthesisLines(state))
  out.push(...commanderCycleLines(state))
  out.push(...opencodeHandoffLines(state))
  out.push(...opencodeProcessSmokeLines(state))
  out.push(...opencodeHandoffReadinessLines(state))
  out.push(...opencodeResultReviewLines(state))
  out.push(...opencodeSessionLines(state))
  out.push(...contextBudgetLines(state))
  out.push(...contextPacketLines(state))
  out.push(...opencodeSessionInstructionPackLines(state))
  out.push(...researchMemoryLines(state))
  out.push(...commanderExecutorReviewLines(state))
  out.push(...executorReviewProposalDraftLines(state))
  out.push(...executorReviewProposalCreateLines(state))
  out.push(...executorReviewProposalReviewRequestLines(state))
  out.push(...executorReviewProposalReviewDecisionLines(state))
  out.push(...executorReviewProposalApplyReadinessLines(state))
  out.push(...executorReviewProposalNarrowApplyLines(state))
  out.push(...opencodeFollowupLines(state))
  out.push(...runtimeCheckpointLines(state))
  out.push(...runtimeRestoreLines(state))
  out.push(...wakeAssessmentLines(state))
  out.push(...continuationLines(state))
  out.push(...wakeScheduleLines(state))
  out.push(...wakeSchedulerLines(state))
  out.push(`Message box: ${state.messageDraft}`)
  return out.join("\n")
}

function runtimeLines(state: UiState): string[] {
  const out = ["Runtime"]
  if (state.runtimeStatus) {
    out.push(`  status=${state.runtimeStatus.runtimeStatus}`)
    out.push(`  mode=${state.runtimeStatus.mode}`)
    out.push(`  spec_approved=${state.runtimeStatus.specApproved}`)
    out.push(`  lock_held=${state.runtimeStatus.lockHeld}`)
  } else {
    out.push("  status=unknown")
  }
  if (state.adapterStatus) {
    out.push(`  adapter=${adapterSummary(state.adapterStatus)}`)
  }
  if (state.reasoningProvider) {
    const provider = state.reasoningProvider
    out.push(`  reasoning=${provider.kind}:${provider.provider_id}`)
    if (provider.connector_id) out.push(`  reasoning_connector=${provider.connector_id}`)
    if (provider.model) out.push(`  reasoning_model=${provider.model}`)
    out.push(`  reasoning_enabled=${provider.enabled_for.join(",") || "none"}`)
  }
  if (state.researchProjection) {
    out.push(`  projection=${state.researchProjection.ok ? "ok" : "not-ok"} stale=${state.researchProjection.stale} pending=${state.researchProjection.pending_count}`)
    if (state.researchProjection.reason) out.push(`  projection_reason=${state.researchProjection.reason}`)
  }
  if (state.missions) {
    out.push(`  missions_pending=${state.missions.pending_count}`)
    out.push(`  missions_failed=${state.missions.failed_count}`)
    out.push(`  missions_active_claims=${state.missions.active_claim_count ?? 0}`)
    out.push(`  missions_completed=${state.missions.completed_count ?? 0}`)
    out.push(`  missions_cancelled=${state.missions.cancelled_count ?? 0}`)
    out.push(`  last_mission=${state.missions.last_mission_id ?? "none"}`)
    out.push("  recent_missions")
    if (state.missions.recent.length === 0) out.push("    - empty")
    else out.push(...state.missions.recent.map((mission) => `    - ${mission.mission_id} [${mission.status}]`))
  }
  if (state.runtimeCommandError) out.push(`  command_error=${redactText(state.runtimeCommandError)}`)
  return out
}

function commandAuthorityLines(state: UiState): string[] {
  const authority = state.commandAuthority
  const out = ["Command authority"]
  if (!authority) {
    out.push("  records=0")
    return out
  }
  if (authority.summary) {
    const summary = authority.summary
    out.push(`  total=${summary.total_records} mutating=${summary.mutating_count} high_impact=${summary.high_impact_count} approval_required=${summary.approval_required_count}`)
    out.push(`  risks=${countMapSummary(summary.risks)}`)
    out.push(`  gates=${countMapSummary(summary.gates)}`)
  } else {
    out.push(`  records=${authority.records.length}`)
  }
  if (authority.selected) {
    const selected = authority.selected
    out.push(`  selected=${preview(redactText(selected.slash_command))} risk=${selected.risk} gate=${selected.gate} owner=${selected.owner} mutates_events=${selected.mutates_events}`)
    out.push(`  runtime=${selected.runtime_command ?? "none"} requires_active_runtime=${selected.requires_active_runtime} requires_run_lock=${selected.requires_run_lock} requires_approval=${selected.requires_approval}`)
    out.push(`  phase=${selected.current_phase_status} blocked_by_default=${selected.blocked_by_default}`)
    if (selected.approval_surface) out.push(`  approval_surface=${preview(redactText(selected.approval_surface))}`)
    if (selected.execution_surface) out.push(`  execution_surface=${preview(redactText(selected.execution_surface))}`)
    if (selected.expected_event_kinds.length > 0) out.push(`  expected_events=${selected.expected_event_kinds.slice(0, 8).join(",")}`)
    if (selected.recommended_reads.length > 0) out.push(`  recommended_reads=${selected.recommended_reads.slice(0, 8).join(",")}`)
    if (selected.notes.length > 0) out.push(`  notes=${selected.notes.slice(0, 3).map((note) => preview(redactText(note))).join(" | ")}`)
    if (selected.out_of_scope.length > 0) out.push(`  out_of_scope=${selected.out_of_scope.slice(0, 5).map((item) => preview(redactText(item))).join(",")}`)
  } else {
    out.push("  selected=none")
  }
  if (authority.validationProfile) {
    const profile = authority.validationProfile
    out.push(`  validation runtime_unit=${profile.unit_runtime} tui_unit=${profile.unit_tui} runtime_typecheck=${profile.typecheck_runtime} tui_typecheck=${profile.typecheck_tui} cli=${profile.integration_cli}`)
    out.push(`  targeted_e2e=${profile.targeted_e2e.slice(0, 8).join(",") || "none"}`)
    out.push(`  full_e2e_required_when=${profile.full_e2e_required_when.slice(0, 3).map((item) => preview(redactText(item))).join(" | ") || "none"}`)
  }
  out.push("  records")
  if (authority.records.length === 0) out.push("    - empty")
  else {
    out.push(...authority.records.slice(0, 20).map((record) => {
      return `    - ${preview(redactText(record.slash_command))} risk=${record.risk} gate=${record.gate} owner=${record.owner} mutates=${record.mutates_events} approval=${record.requires_approval}`
    }))
  }
  if (authority.commandError) out.push(`  command_error=${redactText(authority.commandError)}`)
  return out
}

function reasoningProviderLines(state: UiState): string[] {
  const provider = state.reasoningProvider
  const out = ["Reasoning provider"]
  if (!provider) {
    out.push("  status=unknown")
    return out
  }
  out.push(`  provider=${provider.kind}:${provider.provider_id}`)
  if (provider.model) out.push(`  model=${provider.model}`)
  if (provider.connector_id) out.push(`  connector=${provider.connector_id}`)
  out.push(`  enabled=${provider.enabled_for.join(",") || "none"}`)
  if (provider.health) {
    out.push(`  health=${provider.health.status}`)
    for (const check of provider.health.checks.slice(0, 10)) {
      out.push(`  check=${check.name} ${check.ok ? "ok" : "not-ok"} ${check.severity}: ${check.summary}`)
    }
  }
  if (provider.smokePreview) {
    const preview = provider.smokePreview
    out.push(`  smoke_preview=${preview.surface} network=${preview.would_call_network ? "yes" : "no"} prompt_bytes=${preview.prompt_bytes}`)
    out.push(`  smoke_blockers=${preview.blockers.join("; ") || "none"}`)
  }
  if (provider.lastSmoke) {
    const smoke = provider.lastSmoke
    out.push(`  smoke_result=${smoke.surface} ${smoke.ok ? "ok" : "failed"} dry_run=${smoke.dry_run} parsed=${smoke.parsed}`)
    out.push(`  smoke_summary=${smoke.summary}`)
    if (smoke.request_id) out.push(`  smoke_request=${smoke.request_id}`)
    if (smoke.error) out.push(`  smoke_error=${smoke.error}`)
  }
  if (provider.commandError) out.push(`  command_error=${redactText(provider.commandError)}`)
  return out
}

function minimaxLiveValidationLines(state: UiState): string[] {
  const validation = state.minimaxLiveValidation
  const out = ["MiniMax live validation"]
  if (!validation) {
    out.push("  status=not_configured")
    out.push("  note=live validation does not create proposals, run Commander cycle, launch OpenCode, or mutate missions")
    return out
  }
  if (validation.preview) {
    const previewRecord = validation.preview
    out.push(`  preview=${previewRecord.status} can_execute=${previewRecord.can_execute} opt_in=${previewRecord.opt_in_present ? "yes" : "no"} timeout_ms=${previewRecord.timeout_ms}`)
    out.push(`  provider=${previewRecord.provider_kind}:${previewRecord.provider_id}`)
    if (previewRecord.connector_id) out.push(`  connector=${previewRecord.connector_id}`)
    if (previewRecord.model) out.push(`  model=${previewRecord.model}`)
    out.push(`  requested=${previewRecord.requested_surfaces.join(",") || "none"} enabled=${previewRecord.enabled_surfaces.join(",") || "none"}`)
    if (previewRecord.blockers.length > 0) out.push(`  blockers=${previewRecord.blockers.map((item) => preview(redactText(item))).join("; ")}`)
    if (previewRecord.warnings.length > 0) out.push(`  warnings=${previewRecord.warnings.map((item) => preview(redactText(item))).join("; ")}`)
  }
  if (validation.latestResult) {
    const result = validation.latestResult
    out.push(`  latest=${result.validation_id} status=${result.status} surfaces=${result.surfaces.length} duration_ms=${result.duration_ms ?? "unknown"}`)
    for (const surface of result.surfaces.slice(0, 10)) {
      out.push(`  surface=${surface.surface} ${surface.status} parsed=${surface.parsed} ok=${surface.ok}`)
      if (surface.summary_preview) out.push(`    summary=${preview(redactText(surface.summary_preview))}`)
      if (surface.error) out.push(`    error=${preview(redactText(surface.error))}`)
    }
    if (result.error) out.push(`  error=${preview(redactText(result.error))}`)
  }
  if (validation.selected && validation.selected.validation_id !== validation.latestResult?.validation_id) out.push(`  selected=${validation.selected.validation_id} status=${validation.selected.status}`)
  out.push(`  records=${validation.records.length}`)
  out.push("  recent_validations")
  if (validation.records.length === 0) out.push("    - empty")
  else out.push(...validation.records.slice(0, 10).map((record) => `    - ${record.validation_id} status=${record.status} surfaces=${record.surface_count} ok=${record.succeeded_count} failed=${record.failed_count}: ${preview(redactText(record.summary_preview))}`))
  if (validation.commandError) out.push(`  command_error=${redactText(validation.commandError)}`)
  out.push("  note=live validation does not create proposals, run Commander cycle, launch OpenCode, or mutate missions")
  return out
}

function reviewLines(state: UiState): string[] {
  const reviews = state.reviews
  const out = ["Reviews / approvals"]
  if (!reviews) {
    out.push("  pending=0 approved=0 rejected=0 cancelled=0")
    return out
  }
  if (reviews.summary) {
    out.push(`  pending=${reviews.summary.pending_count} approved=${reviews.summary.approved_count} rejected=${reviews.summary.rejected_count} cancelled=${reviews.summary.cancelled_count}`)
    out.push(`  last_review=${reviews.summary.last_review_id ?? "none"}`)
  } else {
    out.push(`  pending=${reviews.pending.length}`)
  }
  out.push("  pending_reviews")
  if (reviews.pending.length === 0) out.push("    - empty")
  else {
    out.push(...reviews.pending.slice(0, 10).map((review) => {
      const mission = review.mission_id ?? "none"
      return `    - ${review.review_id} [${review.status}] ${review.request_type} mission=${mission}: ${preview(redactText(review.title))}`
    }))
  }
  if (reviews.selectedReview) {
    const review = reviews.selectedReview
    out.push(`  selected_review=${review.review_id} [${review.status}] ${review.request_type}`)
    out.push(`  selected_mission=${review.mission_id ?? "none"}`)
    out.push(`  title=${preview(redactText(review.title))}`)
    out.push(`  summary=${preview(redactText(review.summary))}`)
    if (review.decision_by) out.push(`  decision_by=${review.decision_by}`)
    if (review.decision_reason) out.push(`  decision_reason=${preview(redactText(review.decision_reason))}`)
  } else {
    out.push("  selected_review=none")
  }
  out.push("  recent_reviews")
  if (reviews.recent.length === 0) out.push("    - empty")
  else out.push(...reviews.recent.slice(0, 10).map((review) => `    - ${review.review_id} [${review.status}] ${preview(redactText(review.title))}`))
  if (reviews.commandError) out.push(`  command_error=${redactText(reviews.commandError)}`)
  return out
}

function proposalLines(state: UiState): string[] {
  const proposals = state.proposals
  const out = ["Commander proposals"]
  if (!proposals) {
    out.push("  proposed=0 review_requested=0 approved=0 rejected=0 cancelled=0 applied=0")
    return out
  }
  if (proposals.summary) {
    out.push(`  proposed=${proposals.summary.proposed_count} review_requested=${proposals.summary.review_requested_count} approved=${proposals.summary.approved_count} rejected=${proposals.summary.rejected_count} cancelled=${proposals.summary.cancelled_count} applied=${proposals.summary.applied_count}`)
    out.push(`  last_proposal=${proposals.summary.last_proposal_id ?? "none"}`)
  } else {
    out.push(`  recent=${proposals.recent.length}`)
  }
  out.push("  recent_proposals")
  if (proposals.recent.length === 0) out.push("    - empty")
  else {
    out.push(...proposals.recent.slice(0, 10).map((proposal) => {
      const mission = proposal.mission_id ?? "none"
      return `    - ${proposal.proposal_id} [${proposal.status}] ${proposal.action_kind} mission=${mission}: ${preview(redactText(proposal.title))}`
    }))
  }
  if (proposals.selectedProposal) {
    const proposal = proposals.selectedProposal
    out.push(`  selected_proposal=${proposal.proposal_id} [${proposal.status}] ${proposal.action_kind}`)
    out.push(`  selected_mission=${proposal.mission_id ?? "none"}`)
    out.push(`  linked_review=${proposal.review_id ?? "none"}`)
    out.push(`  title=${preview(redactText(proposal.title))}`)
    out.push(`  summary=${preview(redactText(proposal.summary))}`)
    if (proposal.application_result) out.push(`  application_result=${preview(redactText(proposal.application_result))}`)
    if (proposal.failure_reason) out.push(`  failure_reason=${preview(redactText(proposal.failure_reason))}`)
  } else {
    out.push("  selected_proposal=none")
  }
  if (proposals.commandError) out.push(`  command_error=${redactText(proposals.commandError)}`)
  return out
}

function proposalBundleLines(state: UiState): string[] {
  const bundles = state.proposalBundles
  const out = ["Proposal bundles"]
  if (!bundles) {
    out.push("  open=0 review_requested=0 partially_approved=0 approved=0 partially_applied=0 applied=0 cancelled=0")
    return out
  }
  if (bundles.summary) {
    out.push(`  open=${bundles.summary.open_count} review_requested=${bundles.summary.review_requested_count} partially_approved=${bundles.summary.partially_approved_count} approved=${bundles.summary.approved_count} partially_applied=${bundles.summary.partially_applied_count} applied=${bundles.summary.applied_count} cancelled=${bundles.summary.cancelled_count}`)
    out.push(`  last_bundle=${bundles.summary.last_bundle_id ?? "none"}`)
  } else {
    out.push(`  recent=${bundles.recent.length}`)
  }
  out.push("  recent_bundles")
  if (bundles.recent.length === 0) out.push("    - empty")
  else {
    out.push(...bundles.recent.slice(0, 10).map((bundle) => {
      return `    - ${bundle.bundle_id} [${bundle.status}] proposals=${bundle.proposal_ids.length}: ${preview(redactText(bundle.title))}`
    }))
  }
  if (bundles.selectedBundle) {
    const bundle = bundles.selectedBundle
    out.push(`  selected_bundle=${bundle.bundle_id} [${bundle.status}] proposals=${bundle.proposal_ids.length}`)
    out.push(`  title=${preview(redactText(bundle.title))}`)
    out.push(`  summary=${preview(redactText(bundle.summary))}`)
    if (bundle.cancellation_reason) out.push(`  cancellation_reason=${preview(redactText(bundle.cancellation_reason))}`)
    if (bundle.failure_reason) out.push(`  failure_reason=${preview(redactText(bundle.failure_reason))}`)
  } else {
    out.push("  selected_bundle=none")
  }
  if (bundles.readiness) {
    const readiness = bundles.readiness
    out.push(`  readiness=${readiness.ready_to_apply ? "ready" : "blocked"} proposals=${readiness.proposal_count} proposed=${readiness.proposed_count} review_requested=${readiness.review_requested_count} approved=${readiness.approved_count} applied=${readiness.applied_count} rejected=${readiness.rejected_count} cancelled=${readiness.cancelled_count} blocked=${readiness.blocked_count}`)
    if (readiness.blockers.length > 0) {
      out.push("  blockers")
      out.push(...readiness.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  }
  if (bundles.commandError) out.push(`  command_error=${redactText(bundles.commandError)}`)
  return out
}

function opencodeHandoffLines(state: UiState): string[] {
  const handoff = state.opencodeHandoff
  const out = ["OpenCode handoff"]
  if (!handoff) {
    out.push("  handoffs=0")
    return out
  }
  if (handoff.preview) {
    const previewRecord = handoff.preview
    out.push(`  preview_proposal=${previewRecord.proposal_id} eligible=${previewRecord.eligible}`)
    out.push(`  preview_action=${previewRecord.action_kind} proposal_status=${previewRecord.proposal_status}`)
    out.push(`  preview_review=${previewRecord.review_id ?? "none"} review_status=${previewRecord.review_status ?? "none"}`)
    out.push(`  would_create_mission=${previewRecord.would_create_mission} would_send_to_adapter=${previewRecord.would_send_to_adapter}`)
    if (previewRecord.source_cycle_id) out.push(`  source_cycle=${previewRecord.source_cycle_id}`)
    if (previewRecord.source_synthesis_id) out.push(`  source_synthesis=${previewRecord.source_synthesis_id}`)
    if (previewRecord.evidence_ids.length > 0) out.push(`  evidence=${previewRecord.evidence_ids.slice(0, 10).join(",")}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (handoff.lastResult) {
    const result = handoff.lastResult
    out.push(`  last_handoff=${result.handoff_id} proposal=${result.proposal_id} sent=${result.sent} dry_run=${result.dry_run}`)
    out.push(`  mission=${result.mission_id ?? "none"} intent=${result.intent_id ?? "none"}`)
    if (result.review_id) out.push(`  review=${result.review_id}`)
    if (result.source_cycle_id) out.push(`  source_cycle=${result.source_cycle_id}`)
    if (result.source_synthesis_id) out.push(`  source_synthesis=${result.source_synthesis_id}`)
  } else {
    out.push("  last_handoff=none")
  }
  out.push(`  handoffs=${handoff.recent.length}`)
  out.push("  recent_handoffs")
  if (handoff.recent.length === 0) out.push("    - empty")
  else out.push(...handoff.recent.slice(0, 10).map((record) => `    - ${record.handoff_id} proposal=${record.proposal_id} mission=${record.mission_id ?? "none"} sent=${record.sent}`))
  if (handoff.commandError) out.push(`  command_error=${redactText(handoff.commandError)}`)
  return out
}

function opencodeProcessSmokeLines(state: UiState): string[] {
  const smoke = state.opencodeProcessSmoke
  const out = ["OpenCode process smoke"]
  if (!smoke) {
    out.push("  records=0")
    out.push("  note=real smoke is opt-in and not part of default CI")
    return out
  }
  if (smoke.preview) {
    const previewRecord = smoke.preview
    out.push(`  preview_status=${previewRecord.status} can_execute=${previewRecord.can_execute} opt_in=${previewRecord.opt_in_present}/${previewRecord.opt_in_required}`)
    out.push(`  adapter=${previewRecord.adapter_kind ?? "unknown"} binary_detected=${previewRecord.binary_detected} timeout_ms=${previewRecord.timeout_ms}`)
    if (previewRecord.binary_path) out.push(`  binary=${preview(redactText(previewRecord.binary_path))}`)
    if (previewRecord.redacted_summary_preview) out.push(`  summary=${preview(redactText(previewRecord.redacted_summary_preview))}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (previewRecord.warnings.length > 0) {
      out.push("  warnings")
      out.push(...previewRecord.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (smoke.latestResult) {
    const result = smoke.latestResult
    out.push(`  latest=${result.smoke_id} status=${result.status} duration_ms=${result.duration_ms ?? "unknown"} exit=${result.exit_code ?? "none"}`)
    if (result.error) out.push(`  error=${preview(redactText(result.error))}`)
    if (result.stdout_preview) out.push(`  stdout=${preview(redactText(result.stdout_preview))}`)
    if (result.stderr_preview) out.push(`  stderr=${preview(redactText(result.stderr_preview))}`)
    if (result.diagnostics.length > 0) out.push(...result.diagnostics.slice(0, 5).map((diagnostic) => `  diagnostic=${preview(redactText(diagnostic))}`))
  } else {
    out.push("  latest=none")
  }
  if (smoke.selected && smoke.selected.smoke_id !== smoke.latestResult?.smoke_id) out.push(`  selected=${smoke.selected.smoke_id} status=${smoke.selected.status}`)
  out.push(`  records=${smoke.records.length}`)
  out.push("  recent_smokes")
  if (smoke.records.length === 0) out.push("    - empty")
  else out.push(...smoke.records.slice(0, 10).map((record) => `    - ${record.smoke_id} status=${record.status} duration_ms=${record.duration_ms ?? "unknown"}: ${preview(redactText(record.summary_preview))}`))
  if (smoke.commandError) out.push(`  command_error=${redactText(smoke.commandError)}`)
  out.push("  note=real smoke is opt-in and not part of default CI")
  return out
}

function opencodeHandoffReadinessLines(state: UiState): string[] {
  const readiness = state.opencodeHandoffReadiness
  const out = ["OpenCode handoff readiness"]
  if (!readiness) {
    out.push("  preview=none")
    out.push("  note=readiness preview does not execute handoff or launch OpenCode")
    return out
  }
  if (readiness.summary) {
    const summary = readiness.summary
    out.push(`  summary ready=${summary.ready_count} blocked=${summary.blocked_count} needs_smoke=${summary.needs_smoke_count} needs_review=${summary.needs_review_count}`)
    out.push(`  latest_smoke=${summary.latest_smoke_status ?? "none"} latest_handoff=${summary.latest_handoff_status ?? "none"}`)
  } else {
    out.push("  summary=none")
  }
  if (readiness.preview) {
    const previewRecord = readiness.preview
    out.push(`  preview=${previewRecord.readiness_id} status=${previewRecord.status} can_execute_now=${previewRecord.can_execute_now}`)
    out.push(`  targets proposal=${previewRecord.proposal_id ?? "none"} review=${previewRecord.review_id ?? "none"} mission=${previewRecord.mission_id ?? "none"} handoff=${previewRecord.handoff_id ?? "none"}`)
    out.push(`  authority=${previewRecord.authority.command} risk=${previewRecord.authority.risk} gate=${previewRecord.authority.gate} owner=${previewRecord.authority.owner} blocked_by_default=${previewRecord.authority.blocked_by_default}`)
    if (previewRecord.latest_smoke) out.push(`  latest_smoke=${previewRecord.latest_smoke.smoke_id} status=${previewRecord.latest_smoke.status} at=${previewRecord.latest_smoke.completed_at}`)
    if (previewRecord.handoff_preview_summary) out.push(`  handoff_preview=${preview(redactText(previewRecord.handoff_preview_summary))}`)
    if (previewRecord.redacted_summary_preview) out.push(`  summary_preview=${preview(redactText(previewRecord.redacted_summary_preview))}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (previewRecord.warnings.length > 0) {
      out.push("  warnings")
      out.push(...previewRecord.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  required_evidence")
    if (previewRecord.required_evidence.length === 0) out.push("    - empty")
    else out.push(...previewRecord.required_evidence.slice(0, 10).map((item) => `    - ${item.kind}:${item.status} fresh=${item.fresh} ${preview(redactText(item.summary_preview))}`))
    out.push("  optional_evidence")
    if (previewRecord.optional_evidence.length === 0) out.push("    - empty")
    else out.push(...previewRecord.optional_evidence.slice(0, 10).map((item) => `    - ${item.kind}:${item.status} fresh=${item.fresh} ${preview(redactText(item.summary_preview))}`))
    out.push("  recommended_commands")
    if (previewRecord.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...previewRecord.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (readiness.commandError) out.push(`  command_error=${redactText(readiness.commandError)}`)
  out.push("  note=readiness preview does not execute handoff or launch OpenCode")
  return out
}

function opencodeResultReviewLines(state: UiState): string[] {
  const review = state.opencodeResultReview
  const out = ["OpenCode result review packet"]
  if (!review) {
    out.push("  packet=none")
    out.push("  note=packet preview does not call Commander/provider or create proposals")
    return out
  }
  if (review.summary) {
    const summary = review.summary
    out.push(`  summary total=${summary.total_considered} ready=${summary.ready_count} needs_result=${summary.needs_result_count} failed=${summary.failed_count} blocked=${summary.blocked_count} stale=${summary.stale_count}`)
    out.push(`  latest_handoff=${summary.latest_handoff_id ?? "none"} latest_result=${summary.latest_result_id ?? "none"}`)
  } else {
    out.push("  summary=none")
  }
  if (review.packet) {
    const packet = review.packet
    out.push(`  packet=${packet.packet_id} status=${packet.status}`)
    out.push(`  targets handoff=${packet.handoff_id ?? "none"} followup=${packet.followup_id ?? "none"} mission=${packet.mission_id ?? "none"} result=${packet.result_id ?? "none"} proposal=${packet.proposal_id ?? "none"} review=${packet.review_id ?? "none"}`)
    out.push(`  title=${preview(redactText(packet.title))}`)
    if (packet.objective_preview) out.push(`  objective=${preview(redactText(packet.objective_preview))}`)
    if (packet.executor_summary_preview) out.push(`  executor=${preview(redactText(packet.executor_summary_preview))}`)
    if (packet.result_summary_preview) out.push(`  result=${preview(redactText(packet.result_summary_preview))}`)
    if (packet.redacted_summary_preview) out.push(`  summary_preview=${preview(redactText(packet.redacted_summary_preview))}`)
    if (packet.artifact_previews.length > 0) {
      out.push("  artifacts")
      out.push(...packet.artifact_previews.slice(0, 10).map((artifact) => `    - ${preview(redactText(artifact))}`))
    }
    if (packet.blockers.length > 0) {
      out.push("  blockers")
      out.push(...packet.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (packet.warnings.length > 0) {
      out.push("  warnings")
      out.push(...packet.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  evidence")
    if (packet.evidence.length === 0) out.push("    - empty")
    else out.push(...packet.evidence.slice(0, 10).map((item) => `    - ${item.kind}:${item.status} fresh=${item.fresh} ${preview(redactText(item.summary_preview))}`))
    out.push("  recommended_commands")
    if (packet.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...packet.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  packet=none")
  }
  out.push(`  records=${review.records.length}`)
  if (review.records.length > 0) {
    out.push("  recent_packets")
    out.push(...review.records.slice(0, 10).map((record) => `    - ${record.packet_id} status=${record.status} handoff=${record.handoff_id ?? "none"} mission=${record.mission_id ?? "none"}: ${preview(redactText(record.summary_preview))}`))
  }
  if (review.commandError) out.push(`  command_error=${redactText(review.commandError)}`)
  out.push("  note=packet preview does not call Commander/provider or create proposals")
  return out
}

function opencodeSessionLines(state: UiState): string[] {
  const sessions = state.opencodeSessions
  const out = ["OpenCode sessions"]
  if (!sessions) {
    out.push("  preview=none")
    out.push("  latest=none")
    out.push("  records=0")
    out.push("  note=session planning does not launch OpenCode or mutate missions")
    return out
  }
  if (sessions.preview) {
    const item = sessions.preview
    out.push(`  preview=${item.preview_id} can_create=${item.can_create} source=${item.source_kind}`)
    out.push(`  links mission=${item.mission_id ?? "none"} proposal=${item.proposal_id ?? "none"} review=${item.review_request_id ?? "none"} apply=${item.apply_id ?? "none"}`)
    out.push(`  title=${preview(redactText(item.title_preview))}`)
    out.push(`  objective=${preview(redactText(item.objective_preview))}`)
    out.push(`  commander_context=${preview(redactText(item.commander_context_summary_preview))}`)
    out.push(`  opencode_context_seed=${preview(redactText(item.opencode_context_seed_preview))}`)
    out.push(`  max_context_bytes=${item.max_context_bytes}`)
    out.push(`  timeout wall_ms=${item.timeout_policy.max_wall_time_ms ?? 1800000} no_progress_ms=${item.timeout_policy.max_no_progress_ms ?? 600000} heartbeat_ms=${item.timeout_policy.heartbeat_interval_ms ?? 60000}`)
    out.push(`  question_policy questions=${item.question_policy.allow_opencode_questions ?? true} max_pending=${item.question_policy.max_pending_questions ?? 3}`)
    out.push(`  human_control pause=${item.human_control_policy.allow_human_pause ?? true} stop=${item.human_control_policy.allow_human_stop ?? true} reason_required=${item.human_control_policy.require_reason_for_stop ?? true}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
    out.push("  recommended_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (sessions.latestPlan) {
    const plan = sessions.latestPlan
    out.push(`  latest=${plan.session_id} status=${plan.status} source=${plan.source_kind}`)
    out.push(`  latest_context commander=${preview(redactText(plan.commander_context_summary))}`)
    out.push(`  latest_context opencode=${preview(redactText(plan.opencode_context_seed))}`)
    out.push(`  latest_context max_bytes=${plan.max_context_bytes}`)
  } else {
    out.push("  latest=none")
  }
  if (sessions.summary) {
    const summary = sessions.summary
    out.push(`  summary total=${summary.total_sessions} planned=${summary.planned_count} running=${summary.running_count} paused=${summary.paused_count} blocked=${summary.blocked_count} completed=${summary.completed_count} failed=${summary.failed_count} cancelled=${summary.cancelled_count}`)
  } else {
    out.push("  summary=none")
  }
  out.push(`  records=${sessions.records.length}`)
  if (sessions.records.length > 0) {
    out.push("  planned_sessions")
    out.push(...sessions.records.slice(0, 10).map((record) => `    - ${record.session_id} status=${record.status} source=${record.source_kind} proposal=${record.proposal_id ?? "none"} mission=${record.mission_id ?? "none"}: ${preview(redactText(record.summary_preview))}`))
  }
  if (sessions.selected && sessions.selected.session_id !== sessions.latestPlan?.session_id) out.push(`  selected=${sessions.selected.session_id} status=${sessions.selected.status}`)
  if (sessions.commandError) out.push(`  command_error=${redactText(sessions.commandError)}`)
  out.push("  note=session planning does not launch OpenCode or mutate missions")
  out.push("  note=session planning does not launch OpenCode, call providers, create checkpoints, or mutate missions")
  return out
}

function contextBudgetLines(state: UiState): string[] {
  const budgets = state.contextBudgets
  const out = ["Context budget registry"]
  if (!budgets) {
    out.push("  capabilities=0")
    out.push("  preview=none")
    out.push("  note=budget preview does not compile context, call providers, launch OpenCode, or query research.db")
    return out
  }
  if (budgets.summary) {
    const summary = budgets.summary
    out.push(`  summary total=${summary.total_capabilities} known=${summary.known_context_count} unknown=${summary.unknown_context_count} local=${summary.local_model_count} cloud=${summary.cloud_model_count} long_context=${summary.long_context_count}`)
  } else {
    out.push("  summary=none")
  }
  out.push(`  capabilities=${budgets.capabilities.length}`)
  if (budgets.capabilities.length > 0) {
    out.push("  model_capabilities")
    out.push(...budgets.capabilities.slice(0, 10).map((capability) => `    - ${capability.capability_id} ${capability.provider_kind}/${capability.model_id} roles=${capability.role_support.join(",") || "none"} context_tokens=${capability.max_context_tokens ?? "unknown"} context_bytes=${capability.max_context_bytes ?? "unknown"}`))
  }
  if (budgets.selectedCapability) {
    const capability = budgets.selectedCapability
    out.push(`  selected=${capability.capability_id} provider=${capability.provider_kind} model=${capability.model_id} source=${capability.source}`)
    out.push(`  selected_support tools=${capability.supports_tools} json_schema=${capability.supports_json_schema} mcp=${capability.supports_mcp} local=${capability.supports_local_execution}`)
    if (capability.warnings.length > 0) out.push(`  selected_warnings=${capability.warnings.slice(0, 3).map((warning) => preview(redactText(warning))).join(" | ")}`)
  }
  if (budgets.preview) {
    const item = budgets.preview
    out.push(`  preview=${item.preview_id} purpose=${item.purpose} role=${item.role}`)
    out.push(`  provider=${item.budget.provider_kind} model=${item.budget.model_id} session=${item.session_id ?? "none"} session_max_context_bytes=${item.session_max_context_bytes ?? "none"}`)
    out.push(`  max_context_tokens=${item.budget.max_context_tokens ?? "unknown"} max_context_bytes=${item.budget.max_context_bytes ?? "unknown"} max_output_tokens=${item.budget.max_output_tokens ?? "unknown"}`)
    out.push(`  safety_margin_tokens=${item.budget.safety_margin_tokens ?? "unknown"} safety_margin_bytes=${item.budget.safety_margin_bytes ?? "unknown"}`)
    out.push("  allocations")
    out.push(...item.budget.allocations.slice(0, 14).map((allocation) => `    - ${allocation.section} priority=${allocation.priority} policy=${allocation.inclusion_policy} tokens=${allocation.max_tokens ?? "none"} bytes=${allocation.max_bytes ?? "none"}`))
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  recommended_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (budgets.commandError) out.push(`  command_error=${redactText(budgets.commandError)}`)
  out.push("  note=budget preview does not compile context, call providers, launch OpenCode, query research.db, or mutate missions")
  return out
}

function contextPacketLines(state: UiState): string[] {
  const packets = state.contextPackets
  const out = ["Context packet compiler"]
  if (!packets) {
    out.push("  preview=none")
    out.push("  note=packet preview does not compile executable prompts, call providers, launch OpenCode, query research.db, or decide research direction")
    return out
  }
  if (packets.summary) {
    out.push(`  supported_purposes=${packets.summary.supported_purposes.join(",") || "none"}`)
    out.push(`  supported_roles=${packets.summary.supported_roles.join(",") || "none"}`)
  } else {
    out.push("  summary=none")
  }
  if (packets.preview) {
    const item = packets.preview
    out.push(`  preview=${item.packet_id} purpose=${item.purpose} role=${item.role} status=${item.packet_status} can_compile_final_prompt=${item.can_compile_final_prompt}`)
    out.push(`  budget=${item.budget_id} provider=${item.provider_kind ?? "unknown"} model=${item.model_id ?? "unknown"}`)
    out.push(`  session=${item.session_id ?? "none"} mission=${item.mission_id ?? "none"} proposal=${item.proposal_id ?? "none"} review=${item.review_request_id ?? "none"} apply=${item.apply_id ?? "none"}`)
    out.push(`  estimated_input_tokens=${item.budget_summary.estimated_input_tokens ?? "unknown"} estimated_input_bytes=${item.budget_summary.estimated_input_bytes ?? "unknown"} over_budget=${item.budget_summary.over_budget}`)
    out.push(`  max_context_tokens=${item.budget_summary.max_context_tokens ?? "unknown"} max_context_bytes=${item.budget_summary.max_context_bytes ?? "unknown"} max_output_tokens=${item.budget_summary.max_output_tokens ?? "unknown"}`)
    out.push("  sections")
    out.push(...item.sections.slice(0, 18).map((section) => `    - ${section.section} status=${section.status} priority=${section.priority} policy=${section.inclusion_policy} estimated_tokens=${section.estimated_tokens ?? "none"} max_tokens=${section.max_tokens ?? "none"}`))
    out.push("  included_source_refs")
    if (item.included_source_refs.length === 0) out.push("    - empty")
    else out.push(...item.included_source_refs.slice(0, 10).map((ref) => `    - ${ref.source_kind}:${preview(redactText(ref.source_id))} pointer_only=${ref.pointer_only}${ref.label ? ` ${preview(redactText(ref.label))}` : ""}`))
    out.push("  omitted_source_refs")
    if (item.omitted_source_refs.length === 0) out.push("    - empty")
    else out.push(...item.omitted_source_refs.slice(0, 10).map((ref) => `    - ${ref.source_kind}:${preview(redactText(ref.source_id))} pointer_only=${ref.pointer_only}${ref.label ? ` ${preview(redactText(ref.label))}` : ""}`))
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 12).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  recommended_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (packets.commandError) out.push(`  command_error=${redactText(packets.commandError)}`)
  out.push("  note=packet preview does not compile executable prompts, call providers, launch OpenCode, query research.db, call MCPs, mutate missions, or decide research direction")
  return out
}

function opencodeSessionInstructionPackLines(state: UiState): string[] {
  const packs = state.opencodeSessionInstructionPacks
  const out = ["OpenCode session instruction packs"]
  if (!packs) {
    out.push("  preview=none")
    out.push("  latest=none")
    out.push("  records=0")
    out.push("  note=instruction-pack writing does not launch OpenCode, call providers, query research.db, or mutate missions")
    return out
  }
  if (packs.preview) {
    const item = packs.preview
    out.push(`  preview=${item.preview_id} status=${item.status} can_write=${item.can_write}`)
    out.push(`  session=${item.session_id || "none"} packet=${item.packet_id ?? "none"} packet_hash=${item.packet_hash ?? "none"} budget=${item.budget_id ?? "none"}`)
    out.push(`  target_dir=${preview(redactText(item.target_dir))}`)
    out.push(`  total_size_bytes=${item.total_size_bytes}`)
    out.push("  file_previews")
    if (item.files.length === 0) out.push("    - empty")
    else out.push(...item.files.slice(0, 10).map((file) => `    - ${file.relative_path} kind=${file.file_kind} would_write=${file.would_write} bytes=${file.size_bytes} sha=${preview(redactText(file.sha256))}: ${preview(redactText(file.summary_preview))}`))
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  recommended_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (packs.latestResult) {
    const result = packs.latestResult
    out.push(`  latest=${result.pack_id} status=${result.status} session=${result.session_id} files=${result.files.length} bytes=${result.total_size_bytes}`)
    out.push(`  latest_target=${preview(redactText(result.target_dir))}`)
    if (result.error) out.push(`  latest_error=${preview(redactText(result.error))}`)
  } else {
    out.push("  latest=none")
  }
  out.push(`  records=${packs.records.length}`)
  if (packs.records.length > 0) {
    out.push("  instruction_packs")
    out.push(...packs.records.slice(0, 10).map((record) => `    - ${record.pack_id} status=${record.status} session=${record.session_id} files=${record.file_count} bytes=${record.total_size_bytes}: ${preview(redactText(record.summary_preview))}`))
  }
  if (packs.selected) {
    const selected = packs.selected
    out.push(`  selected=${selected.pack_id} status=${selected.status} session=${selected.session_id}`)
  }
  if (packs.commandError) out.push(`  command_error=${redactText(packs.commandError)}`)
  out.push("  note=instruction-pack writing does not launch OpenCode, call providers, query research.db, call MCPs, mutate missions, or compile executable prompts")
  return out
}

function researchMemoryLines(state: UiState): string[] {
  const memory = state.researchMemory
  const out = ["Research memory and novelty"]
  if (!memory) {
    out.push("  summary=none")
    out.push("  retrieval=none")
    out.push("  novelty=none")
    out.push("  note=retrieval/novelty previews do not call providers, call MCPs, launch OpenCode, write research.db, or decide research direction")
    return out
  }
  if (memory.summary) {
    const summary = memory.summary
    out.push(`  summary candidates=${summary.total_candidates_available} projection=${summary.has_research_db_projection} policy=${summary.retrieval_policy}`)
    out.push(`  label_counts=${countMapSummary(summary.label_counts)}`)
    out.push(`  source_counts=${countMapSummary(summary.source_counts)}`)
  } else {
    out.push("  summary=none")
  }
  if (memory.retrievalPreview) {
    const item = memory.retrievalPreview
    out.push(`  retrieval=${item.preview_id} status=${item.status} policy=${item.retrieval_policy} limit=${item.limit} omitted=${item.omitted_count}`)
    out.push(`  query=${preview(redactText(item.query_preview))}`)
    out.push(`  labels=${item.labels.join(",") || "none"}`)
    out.push(`  candidates=${item.candidates.length}`)
    if (item.candidates.length > 0) {
      out.push("  retrieval_candidates")
      out.push(...item.candidates.slice(0, 10).map((candidate) => `    - ${candidate.result_id} label=${candidate.label} source=${candidate.source_kind} relevance=${candidate.relevance_score} duplicate=${candidate.duplicate_similarity_score} terms=${candidate.matched_terms.join(",") || "none"}: ${preview(redactText(candidate.question_preview))}`))
    }
    if (item.blockers.length > 0) {
      out.push("  retrieval_blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  retrieval_warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  retrieval_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 8).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  retrieval=none")
  }
  if (memory.noveltyPreview) {
    const item = memory.noveltyPreview
    out.push(`  novelty=${item.preview_id} status=${item.status} duplicate_risk=${item.duplicate_risk} novelty_score=${item.novelty_score}`)
    out.push(`  repetition_requires_justification=${item.repetition_requires_justification} missing_memory_warning=${item.missing_memory_warning} external_research_recommended=${item.external_research_recommended}`)
    out.push(`  question=${preview(redactText(item.proposed_question_preview))}`)
    if (item.proposed_method_preview) out.push(`  method=${preview(redactText(item.proposed_method_preview))}`)
    if (item.proposed_config_preview) out.push(`  config=${preview(redactText(item.proposed_config_preview))}`)
    out.push(`  difference=${preview(redactText(item.difference_summary_preview))}`)
    if (item.suggested_reason_not_duplicate) out.push(`  repetition_reason=${preview(redactText(item.suggested_reason_not_duplicate))}`)
    out.push(`  acceptable_repetition_reasons=${item.acceptable_repetition_reasons.join(",") || "none"}`)
    if (item.nearest_prior_results.length > 0) {
      out.push("  nearest_prior_results")
      out.push(...item.nearest_prior_results.slice(0, 10).map((candidate) => `    - ${candidate.result_id} label=${candidate.label} relevance=${candidate.relevance_score} duplicate=${candidate.duplicate_similarity_score}: ${preview(redactText(candidate.question_preview))}`))
    }
    if (item.blockers.length > 0) {
      out.push("  novelty_blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  novelty_warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  novelty_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 8).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  novelty=none")
  }
  if (memory.commandError) out.push(`  command_error=${redactText(memory.commandError)}`)
  out.push("  note=previews do not include raw research records, full research.db, raw artifacts, provider output, OpenCode output, raw event log, or online research")
  out.push("  note=retrieval/novelty previews do not call providers, call MCPs, launch OpenCode, write research.db, mutate missions/proposals/reviews/apply, or decide research direction")
  return out
}

function commanderExecutorReviewLines(state: UiState): string[] {
  const review = state.commanderExecutorReview
  const out = ["Commander executor review"]
  if (!review) {
    out.push("  preview=none")
    out.push("  note=executor review does not create proposals or apply changes")
    return out
  }
  if (review.preview) {
    const item = review.preview
    out.push(`  preview packet=${item.packet_id ?? "none"} status=${item.packet_status ?? "unknown"} can_execute=${item.can_execute}`)
    out.push(`  provider=${item.provider_kind} ready=${item.provider_ready}`)
    if (item.packet_summary_preview) out.push(`  packet_summary=${preview(redactText(item.packet_summary_preview))}`)
    if (item.prompt_preview) out.push(`  prompt_preview=${preview(redactText(item.prompt_preview))}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  recommended_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (review.latestResult) {
    const result = review.latestResult
    out.push(`  latest=${result.review_id} status=${result.status} decision=${result.decision} confidence=${result.confidence}`)
    out.push(`  packet=${result.packet_id} packet_status=${result.packet_status}`)
    out.push(`  summary=${preview(redactText(result.summary))}`)
    if (result.error) out.push(`  error=${preview(redactText(result.error))}`)
    if (result.findings.length > 0) {
      out.push("  findings")
      out.push(...result.findings.slice(0, 10).map((finding) => `    - ${finding.severity}:${preview(redactText(finding.title))}: ${preview(redactText(finding.summary))}`))
    }
  } else {
    out.push("  latest=none")
  }
  if (review.selected && review.selected.review_id !== review.latestResult?.review_id) {
    out.push(`  selected=${review.selected.review_id} status=${review.selected.status} decision=${review.selected.decision}`)
  }
  out.push(`  records=${review.records.length}`)
  if (review.records.length > 0) {
    out.push("  recent_reviews")
    out.push(...review.records.slice(0, 10).map((record) => `    - ${record.review_id} status=${record.status} decision=${record.decision}: ${preview(redactText(record.summary_preview))}`))
  }
  if (review.commandError) out.push(`  command_error=${redactText(review.commandError)}`)
  out.push("  note=executor review does not create proposals or apply changes")
  return out
}

function executorReviewProposalDraftLines(state: UiState): string[] {
  const drafts = state.executorReviewProposalDrafts
  const out = ["Executor review proposal drafts"]
  if (!drafts) {
    out.push("  preview=none")
    out.push("  note=draft preview does not create proposals, request reviews, or apply changes")
    return out
  }
  if (drafts.preview) {
    const item = drafts.preview
    out.push(`  preview=${item.preview_id} status=${item.status} candidates=${item.candidates.length} can_create_proposals_now=${item.can_create_proposals_now}`)
    out.push(`  source review=${item.review_id ?? "none"} packet=${item.packet_id ?? "none"} decision=${item.review_decision ?? "unknown"} confidence=${item.review_confidence ?? 0}`)
    out.push(`  summary=${preview(redactText(item.redacted_summary_preview))}`)
    if (item.candidates.length > 0) {
      out.push("  candidates")
      out.push(...item.candidates.slice(0, 10).map((candidate) => `    - ${candidate.draft_id ?? "draft"} kind=${candidate.draft_kind ?? "other"} risk=${candidate.risk ?? "unknown"} confidence=${candidate.confidence ?? 0}: ${preview(redactText(candidate.title ?? ""))}`))
    }
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
    out.push("  recommended_commands")
    if (item.recommended_commands.length === 0) out.push("    - empty")
    else out.push(...item.recommended_commands.slice(0, 10).map((command) => `    - ${preview(redactText(String(command.label ?? "")))}: ${preview(redactText(String(command.command ?? "")))} [${command.command_type}]`))
  } else {
    out.push("  preview=none")
  }
  if (drafts.summary) {
    out.push(`  summary total=${drafts.summary.total_reviews_considered} draftable=${drafts.summary.draftable_review_count} blocked=${drafts.summary.blocked_review_count} candidates=${drafts.summary.candidate_count}`)
    if (drafts.summary.latest_review_id) out.push(`  latest_review=${drafts.summary.latest_review_id}`)
  } else {
    out.push("  summary=none")
  }
  if (drafts.commandError) out.push(`  command_error=${redactText(drafts.commandError)}`)
  out.push("  note=draft preview does not create proposals, request reviews, or apply changes")
  return out
}

function executorReviewProposalCreateLines(state: UiState): string[] {
  const create = state.executorReviewProposalCreate
  const out = ["Executor review proposal creation"]
  if (!create) {
    out.push("  preview=none")
    out.push("  latest=none")
    out.push("  records=0")
    out.push("  note=proposal creation does not request review, apply changes, mutate mission, call provider, or launch OpenCode")
    return out
  }
  if (create.preview) {
    const item = create.preview
    out.push(`  preview=${item.preview_id} status=${item.status} can_create=${item.can_create}`)
    out.push(`  source review=${item.review_id} draft=${item.draft_id} packet=${item.source_packet_id ?? "none"} kind=${item.draft_kind} risk=${item.risk}`)
    out.push(`  proposal action=${item.proposed_action_kind} title=${preview(redactText(item.title_preview))}`)
    out.push(`  summary=${preview(redactText(item.redacted_summary_preview))}`)
    if (item.existing_proposal_id) out.push(`  existing_proposal=${item.existing_proposal_id}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (create.latestResult) {
    const result = create.latestResult
    out.push(`  latest=${result.create_id} status=${result.status} proposal=${result.proposal_id ?? "none"} review=${result.review_id} draft=${result.draft_id}`)
    out.push(`  latest_summary=${preview(redactText(result.summary_preview))}`)
    if (result.error) out.push(`  latest_error=${preview(redactText(result.error))}`)
  } else {
    out.push("  latest=none")
  }
  out.push(`  records=${create.records.length}`)
  if (create.records.length > 0) {
    out.push("  recent_creates")
    out.push(...create.records.slice(0, 10).map((record) => `    - ${record.create_id} status=${record.status} proposal=${record.proposal_id ?? "none"} draft=${record.draft_id}: ${preview(redactText(record.summary_preview))}`))
  }
  if (create.selected && create.selected.create_id !== create.latestResult?.create_id) {
    out.push(`  selected=${create.selected.create_id} status=${create.selected.status} proposal=${create.selected.proposal_id ?? "none"}`)
  }
  if (create.commandError) out.push(`  command_error=${redactText(create.commandError)}`)
  out.push("  note=proposal creation does not request review, apply changes, mutate mission, call provider, or launch OpenCode")
  return out
}

function executorReviewProposalReviewRequestLines(state: UiState): string[] {
  const request = state.executorReviewProposalReviewRequest
  const out = ["Executor review proposal review request"]
  if (!request) {
    out.push("  preview=none")
    out.push("  latest=none")
    out.push("  records=0")
    out.push("  note=review request does not approve, reject, apply, mutate mission, call provider, or launch OpenCode")
    return out
  }
  if (request.preview) {
    const item = request.preview
    out.push(`  preview=${item.preview_id} status=${item.status} can_request=${item.can_request}`)
    out.push(`  proposal=${item.proposal_id} create=${item.create_id ?? "none"} review=${item.review_id ?? "none"} draft=${item.draft_id ?? "none"}`)
    out.push(`  proposal_status=${item.proposal_status ?? "none"} action=${item.action_kind ?? "none"} title=${preview(redactText(item.proposal_title_preview))}`)
    out.push(`  summary=${preview(redactText(item.redacted_summary_preview))}`)
    if (item.existing_review_request_id) out.push(`  existing_review_request=${item.existing_review_request_id} status=${item.existing_review_request_status ?? "unknown"}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (request.latestResult) {
    const result = request.latestResult
    out.push(`  latest=${result.request_gate_id} status=${result.status} review_request=${result.review_request_id ?? "none"} proposal=${result.proposal_id}`)
    if (result.error) out.push(`  latest_error=${preview(redactText(result.error))}`)
  } else {
    out.push("  latest=none")
  }
  out.push(`  records=${request.records.length}`)
  if (request.records.length > 0) {
    out.push("  recent_review_requests")
    out.push(...request.records.slice(0, 10).map((record) => `    - ${record.request_gate_id} status=${record.status} review_request=${record.review_request_id ?? "none"} proposal=${record.proposal_id}: ${preview(redactText(record.summary_preview))}`))
  }
  if (request.selected && request.selected.request_gate_id !== request.latestResult?.request_gate_id) {
    out.push(`  selected=${request.selected.request_gate_id} status=${request.selected.status} review_request=${request.selected.review_request_id ?? "none"}`)
  }
  if (request.commandError) out.push(`  command_error=${redactText(request.commandError)}`)
  out.push("  note=review request does not approve, reject, apply, mutate mission, call provider, or launch OpenCode")
  return out
}

function executorReviewProposalReviewDecisionLines(state: UiState): string[] {
  const decision = state.executorReviewProposalReviewDecision
  const out = ["Executor review proposal review decision"]
  if (!decision) {
    out.push("  preview=none")
    out.push("  latest=none")
    out.push("  records=0")
    out.push("  note=review decision does not apply proposals, mutate missions, call provider, or launch OpenCode")
    return out
  }
  if (decision.preview) {
    const item = decision.preview
    out.push(`  preview=${item.preview_id} status=${item.status} can_decide=${item.can_decide} decision=${item.decision}`)
    out.push(`  review_request=${item.review_request_id} proposal=${item.proposal_id ?? "none"} request_gate=${item.request_gate_id ?? "none"}`)
    out.push(`  create=${item.create_id ?? "none"} source_review=${item.source_executor_review_id ?? "none"} draft=${item.source_draft_id ?? "none"}`)
    out.push(`  review_status=${item.review_request_status ?? "none"} proposal_status=${item.proposal_status ?? "none"} action=${item.action_kind ?? "none"} title=${preview(redactText(item.proposal_title_preview))}`)
    out.push(`  summary=${preview(redactText(item.redacted_summary_preview))}`)
    if (item.existing_decision) out.push(`  existing_decision=${item.existing_decision} at=${item.existing_decision_at ?? "unknown"}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (decision.latestResult) {
    const result = decision.latestResult
    out.push(`  latest=${result.decision_gate_id} status=${result.status} decision=${result.decision} review_request=${result.review_request_id}`)
    if (result.reason_preview) out.push(`  reason=${preview(redactText(result.reason_preview))}`)
    if (result.error) out.push(`  latest_error=${preview(redactText(result.error))}`)
  } else {
    out.push("  latest=none")
  }
  out.push(`  records=${decision.records.length}`)
  if (decision.records.length > 0) {
    out.push("  recent_decisions")
    out.push(...decision.records.slice(0, 10).map((record) => `    - ${record.decision_gate_id} status=${record.status} decision=${record.decision} review_request=${record.review_request_id}: ${preview(redactText(record.summary_preview))}`))
  }
  if (decision.selected && decision.selected.decision_gate_id !== decision.latestResult?.decision_gate_id) {
    out.push(`  selected=${decision.selected.decision_gate_id} status=${decision.selected.status} review_request=${decision.selected.review_request_id}`)
  }
  if (decision.commandError) out.push(`  command_error=${redactText(decision.commandError)}`)
  out.push("  note=review decision does not apply proposals, mutate missions, call provider, or launch OpenCode")
  return out
}

function executorReviewProposalApplyReadinessLines(state: UiState): string[] {
  const readiness = state.executorReviewProposalApplyReadiness
  const out = ["Executor review proposal apply readiness"]
  if (!readiness) {
    out.push("  preview=none")
    out.push("  records=0")
    out.push("  note=apply readiness does not apply proposals, mutate missions, call provider, or launch OpenCode")
    return out
  }
  if (readiness.preview) {
    const item = readiness.preview
    out.push(`  preview=${item.readiness_id} status=${item.status} can_apply_in_future=${item.can_apply_in_future}`)
    out.push(`  proposal=${item.proposal_id} review_request=${item.review_request_id ?? "none"} decision=${item.decision_gate_id ?? "none"} create=${item.create_id ?? "none"}`)
    out.push(`  source_review=${item.source_executor_review_id ?? "none"} draft=${item.source_draft_id ?? "none"} packet=${item.source_packet_id ?? "none"}`)
    out.push(`  proposal_status=${item.proposal_status ?? "none"} review_status=${item.review_request_status ?? "none"} review_decision=${item.review_decision ?? "none"}`)
    out.push(`  candidate=${item.candidate_kind} risk=${item.candidate_risk} action=${item.action_kind ?? "none"} title=${preview(redactText(item.proposal_title_preview))}`)
    out.push(`  summary=${preview(redactText(item.redacted_summary_preview))}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (readiness.summary) {
    const summary = readiness.summary
    out.push(`  summary total=${summary.total_considered} ready=${summary.ready_count} needs_review=${summary.needs_review_count} rejected=${summary.rejected_count} blocked=${summary.blocked_count} generic=${summary.generic_count} high_risk=${summary.high_risk_count}`)
  } else {
    out.push("  summary=none")
  }
  out.push(`  records=${readiness.records.length}`)
  if (readiness.records.length > 0) {
    out.push("  readiness_records")
    out.push(...readiness.records.slice(0, 10).map((record) => `    - ${record.readiness_id} status=${record.status} proposal=${record.proposal_id} kind=${record.candidate_kind} risk=${record.candidate_risk}: ${preview(redactText(record.summary_preview))}`))
  }
  if (readiness.selected && readiness.selected.readiness_id !== readiness.preview?.readiness_id) out.push(`  selected=${readiness.selected.readiness_id} status=${readiness.selected.status} proposal=${readiness.selected.proposal_id}`)
  if (readiness.commandError) out.push(`  command_error=${redactText(readiness.commandError)}`)
  out.push("  note=apply readiness does not apply proposals, mutate missions, call provider, or launch OpenCode")
  return out
}

function executorReviewProposalNarrowApplyLines(state: UiState): string[] {
  const apply = state.executorReviewProposalNarrowApply
  const out = ["Executor review proposal narrow apply"]
  if (!apply) {
    out.push("  preview=none")
    out.push("  latest=none")
    out.push("  records=0")
    out.push("  note=narrow apply marks the proposal applied only and does not mutate missions, submit results, call provider, or launch OpenCode")
    return out
  }
  if (apply.preview) {
    const item = apply.preview
    out.push(`  preview=${item.preview_id} status=${item.status} can_apply=${item.can_apply}`)
    out.push(`  proposal=${item.proposal_id} readiness=${item.readiness_id ?? "none"} review_request=${item.review_request_id ?? "none"} decision=${item.decision_gate_id ?? "none"} create=${item.create_id ?? "none"}`)
    out.push(`  source_review=${item.source_executor_review_id ?? "none"} draft=${item.source_draft_id ?? "none"} packet=${item.source_packet_id ?? "none"}`)
    out.push(`  proposal_status=${item.proposal_status ?? "none"} readiness_status=${item.readiness_status ?? "none"} candidate=${item.candidate_kind} risk=${item.candidate_risk} action=${item.action_kind ?? "none"}`)
    out.push(`  title=${preview(redactText(item.proposal_title_preview))}`)
    out.push(`  summary=${preview(redactText(item.redacted_summary_preview))}`)
    if (item.blockers.length > 0) {
      out.push("  blockers")
      out.push(...item.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(String(blocker ?? "")))}`))
    }
    if (item.warnings.length > 0) {
      out.push("  warnings")
      out.push(...item.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(String(warning ?? "")))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (apply.latestResult) {
    const result = apply.latestResult
    out.push(`  latest=${result.apply_id} status=${result.status} proposal=${result.proposal_id} candidate=${result.candidate_kind} risk=${result.candidate_risk}`)
    if (result.reason_preview) out.push(`  reason=${preview(redactText(result.reason_preview))}`)
    if (result.error) out.push(`  latest_error=${preview(redactText(result.error))}`)
  } else {
    out.push("  latest=none")
  }
  out.push(`  records=${apply.records.length}`)
  if (apply.records.length > 0) {
    out.push("  recent_applies")
    out.push(...apply.records.slice(0, 10).map((record) => `    - ${record.apply_id} status=${record.status} proposal=${record.proposal_id} kind=${record.candidate_kind} risk=${record.candidate_risk}: ${preview(redactText(record.summary_preview))}`))
  }
  if (apply.selected && apply.selected.apply_id !== apply.latestResult?.apply_id) out.push(`  selected=${apply.selected.apply_id} status=${apply.selected.status} proposal=${apply.selected.proposal_id}`)
  if (apply.commandError) out.push(`  command_error=${redactText(apply.commandError)}`)
  out.push("  note=narrow apply marks the proposal applied only and does not mutate missions, submit results, call provider, or launch OpenCode")
  return out
}

function opencodeFollowupLines(state: UiState): string[] {
  const followup = state.opencodeFollowup
  const out = ["OpenCode follow-up"]
  if (!followup) {
    out.push("  followups=0")
    return out
  }
  if (followup.summary) {
    const summary = followup.summary
    out.push(`  summary sent=${summary.sent_count} running=${summary.running_count} results=${summary.result_submitted_count} completed=${summary.completed_count} failed=${summary.failed_count} blocked=${summary.blocked_count} stale=${summary.stale_count}`)
    if (summary.last_handoff_id) out.push(`  last_handoff=${summary.last_handoff_id}`)
  } else {
    out.push("  summary=none")
  }
  if (followup.selected) {
    const selected = followup.selected
    out.push(`  selected=${selected.handoff_id} status=${selected.followup_status} sent=${selected.handoff_sent}`)
    out.push(`  proposal=${selected.proposal_id} proposal_status=${selected.proposal_status ?? "none"} review=${selected.review_id ?? "none"} review_status=${selected.review_status ?? "none"}`)
    out.push(`  mission=${selected.mission_id ?? "none"} mission_status=${selected.mission_status ?? "none"} claim=${selected.active_claim_id ?? "none"} progress=${selected.latest_progress_id ?? "none"} result=${selected.latest_result_id ?? "none"}`)
    out.push(`  counts progress=${selected.progress_count} results=${selected.result_count}`)
    if (selected.blockers.length > 0) {
      out.push("  blockers")
      out.push(...selected.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (selected.suggested_commands.length > 0) {
      out.push("  suggested_commands")
      out.push(...selected.suggested_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
    }
  } else {
    out.push("  selected=none")
  }
  out.push(`  queue=${followup.selectedQueue ?? "none"} rows=${followup.queueItems.length}`)
  out.push("  queue_rows")
  if (followup.queueItems.length === 0) out.push("    - empty")
  else out.push(...followup.queueItems.slice(0, 10).map((item) => `    - ${item.handoff_id} status=${item.followup_status} mission=${item.mission_id ?? "none"} result=${item.latest_result_id ?? "none"}`))
  if (followup.commandError) out.push(`  command_error=${redactText(followup.commandError)}`)
  return out
}

function runtimeCheckpointLines(state: UiState): string[] {
  const checkpoints = state.runtimeCheckpoints
  const out = ["Runtime checkpoints"]
  if (!checkpoints) {
    out.push("  checkpoints=0")
    return out
  }
  if (checkpoints.preview) {
    const previewRecord = checkpoints.preview
    out.push(`  preview_scope=${previewRecord.scope} events=${previewRecord.event_count} bytes=${previewRecord.estimated_bytes}/${previewRecord.max_bytes}`)
    if (previewRecord.last_event_id) out.push(`  preview_last_event=${previewRecord.last_event_id}`)
    out.push("  preview_sections")
    out.push(...previewRecord.sections.slice(0, 10).map((section) => `    - ${section.name} items=${section.item_count} bytes=${section.bytes} truncated=${section.truncated}`))
    if (previewRecord.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (checkpoints.selected) {
    const selected = checkpoints.selected
    out.push(`  selected_checkpoint=${selected.checkpoint_id} scope=${selected.scope} restore_supported=${selected.restore_supported}`)
    out.push(`  hash=${preview(redactText(selected.checkpoint_hash))}`)
    out.push(`  created_at=${selected.created_at} created_by=${selected.created_by}`)
    out.push(`  event_count=${selected.event_count} last_event=${selected.last_event_id ?? "none"}`)
    out.push("  selected_sections")
    out.push(...selected.section_summaries.slice(0, 10).map((section) => `    - ${section.name} items=${section.item_count} bytes=${section.bytes} truncated=${section.truncated}`))
    const suggested = Array.isArray(selected.sections.suggested_commands) ? selected.sections.suggested_commands as Array<{ label?: string; command?: string; command_type?: string }> : []
    if (suggested.length > 0) {
      out.push("  suggested_commands")
      out.push(...suggested.slice(0, 10).map((command) => `    - ${preview(redactText(String(command.label ?? "")))}: ${preview(redactText(String(command.command ?? "")))} [${command.command_type ?? "read"}]`))
    }
    if (selected.warnings.length > 0) {
      out.push("  warnings")
      out.push(...selected.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
  } else {
    out.push("  selected_checkpoint=none")
  }
  out.push(`  checkpoints=${checkpoints.recent.length}`)
  out.push("  recent_checkpoints")
  if (checkpoints.recent.length === 0) out.push("    - empty")
  else out.push(...checkpoints.recent.slice(0, 10).map((record) => `    - ${record.checkpoint_id} scope=${record.scope} events=${record.event_count}: ${preview(redactText(record.summary_preview))}`))
  if (checkpoints.commandError) out.push(`  command_error=${redactText(checkpoints.commandError)}`)
  return out
}

function runtimeRestoreLines(state: UiState): string[] {
  const restore = state.runtimeRestore
  const out = ["Checkpoint resume"]
  if (!restore) {
    out.push("  anchors=0")
    return out
  }
  if (restore.preview) {
    const previewRecord = restore.preview
    out.push(`  preview_checkpoint=${previewRecord.checkpoint_id} can_mark=${previewRecord.can_mark_resume}`)
    out.push(`  verification hash_ok=${previewRecord.verification.hash_ok} cursor_ok=${previewRecord.verification.cursor_ok} drift=${previewRecord.verification.drift_status}`)
    out.push(`  events=${previewRecord.verification.event_count_at_checkpoint}->${previewRecord.verification.current_event_count} new=${previewRecord.verification.new_event_count}`)
    out.push(`  commander cycles=${(previewRecord.commander_context.recent_cycle_ids ?? []).join(",") || "none"} proposals=${(previewRecord.commander_context.proposal_ids ?? []).join(",") || "none"}`)
    out.push(`  executor missions=${(previewRecord.executor_context.mission_ids ?? []).join(",") || "none"} active=${(previewRecord.executor_context.active_mission_ids ?? []).join(",") || "none"}`)
    out.push(`  handoffs=${(previewRecord.handoff_context.handoff_ids ?? []).join(",") || "none"} needs_results=${(previewRecord.handoff_context.needs_result_review_ids ?? []).join(",") || "none"}`)
    if (previewRecord.reasoning_context.provider_id) out.push(`  reasoning=${previewRecord.reasoning_context.provider_kind ?? "unknown"}:${previewRecord.reasoning_context.provider_id} health=${previewRecord.reasoning_context.health_status ?? "unknown"}`)
    if (previewRecord.verification.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.verification.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (previewRecord.verification.warnings.length > 0) {
      out.push("  warnings")
      out.push(...previewRecord.verification.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    if (previewRecord.suggested_commands.length > 0) {
      out.push("  suggested_commands")
      out.push(...previewRecord.suggested_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
    }
  } else {
    out.push("  preview=none")
  }
  if (restore.selectedAnchor) {
    const anchor = restore.selectedAnchor
    out.push(`  selected_anchor=${anchor.resume_id} checkpoint=${anchor.checkpoint_id} drift=${anchor.drift_status}`)
    out.push(`  marked_at=${anchor.marked_at} marked_by=${anchor.marked_by}`)
  } else {
    out.push("  selected_anchor=none")
  }
  out.push(`  anchors=${restore.recentAnchors.length}`)
  out.push("  recent_anchors")
  if (restore.recentAnchors.length === 0) out.push("    - empty")
  else out.push(...restore.recentAnchors.slice(0, 10).map((anchor) => `    - ${anchor.resume_id} checkpoint=${anchor.checkpoint_id} drift=${anchor.drift_status}: ${preview(redactText(anchor.summary_preview))}`))
  if (restore.commandError) out.push(`  command_error=${redactText(restore.commandError)}`)
  return out
}

function wakeAssessmentLines(state: UiState): string[] {
  const wake = state.wakeAssessment
  const out = ["Wake assessment"]
  if (!wake) {
    out.push("  wakes=0")
    return out
  }
  if (wake.preview) {
    const previewRecord = wake.preview
    out.push(`  preview_allowed=${previewRecord.allowed} resume=${previewRecord.resume_id ?? "none"} checkpoint=${previewRecord.checkpoint_id ?? "none"} drift=${previewRecord.drift_status ?? "unknown"}`)
    out.push(`  events=${previewRecord.checkpoint_event_count ?? 0}->${previewRecord.current_event_count} new=${previewRecord.new_event_count ?? 0}`)
    if (previewRecord.reasoning_health_status) out.push(`  reasoning_health=${previewRecord.reasoning_health_status}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (previewRecord.warnings.length > 0) {
      out.push("  warnings")
      out.push(...previewRecord.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    if (previewRecord.suggested_commands.length > 0) {
      out.push("  suggested_commands")
      out.push(...previewRecord.suggested_commands.slice(0, 10).map((command) => `    - ${preview(redactText(command.label))}: ${preview(redactText(command.command))} [${command.command_type}]`))
    }
  } else {
    out.push("  preview=none")
  }
  if (wake.selected) {
    const selected = wake.selected
    out.push(`  selected_wake=${selected.wake_id} allowed=${selected.allowed} resume=${selected.resume_id ?? "none"} checkpoint=${selected.checkpoint_id ?? "none"} drift=${selected.drift_status ?? "unknown"}`)
    out.push(`  hash=${preview(redactText(selected.assessment_hash))}`)
    out.push(`  events=${selected.checkpoint_event_count ?? 0}->${selected.current_event_count} new=${selected.new_event_count ?? 0}`)
    if (selected.sections.reasoning?.health_status) out.push(`  selected_reasoning_health=${selected.sections.reasoning.health_status}`)
    if (selected.blockers.length > 0) {
      out.push("  selected_blockers")
      out.push(...selected.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  } else {
    out.push("  selected_wake=none")
  }
  out.push(`  wakes=${wake.recent.length}`)
  out.push("  recent_wakes")
  if (wake.recent.length === 0) out.push("    - empty")
  else out.push(...wake.recent.slice(0, 10).map((record) => `    - ${record.wake_id} allowed=${record.allowed} checkpoint=${record.checkpoint_id ?? "none"}: ${preview(redactText(record.summary_preview))}`))
  if (wake.commandError) out.push(`  command_error=${redactText(wake.commandError)}`)
  return out
}

function continuationLines(state: UiState): string[] {
  const continuation = state.continuation
  const out = ["Continuation"]
  if (!continuation) {
    out.push("  plans=0")
    return out
  }
  if (continuation.preview) {
    const previewRecord = continuation.preview
    out.push(`  preview_wake=${previewRecord.wake_id} can_create=${previewRecord.can_create} steps=${previewRecord.step_count} read=${previewRecord.read_step_count} write=${previewRecord.write_step_count}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (previewRecord.warnings.length > 0) {
      out.push("  warnings")
      out.push(...previewRecord.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
    out.push("  preview_steps")
    if (previewRecord.steps.length === 0) out.push("    - empty")
    else out.push(...previewRecord.steps.slice(0, 10).map((step) => `    - ${step.index}:${step.step_kind}:${step.command_type}:${step.allowed_by_default ? "allowed" : "blocked"} ${preview(redactText(step.command))}`))
  } else {
    out.push("  preview=none")
  }
  if (continuation.selected) {
    const selected = continuation.selected
    out.push(`  selected_plan=${selected.plan_id} status=${selected.status} wake=${selected.wake_id} completed=${selected.completed_step_count} failed=${selected.failed_step_count}`)
    out.push(`  hash=${preview(redactText(selected.plan_hash))}`)
    out.push("  steps")
    if (selected.steps.length === 0) out.push("    - empty")
    else out.push(...selected.steps.slice(0, 10).map((step) => `    - ${step.index}:${step.status}:${step.command_type} ${preview(redactText(step.command))}`))
  } else {
    out.push("  selected_plan=none")
  }
  if (continuation.lastStepResult) {
    const result = continuation.lastStepResult
    out.push(`  last_step=${result.step_id} index=${result.index} status=${result.status} dry_run=${result.dry_run === true}`)
    if (result.result_summary) out.push(`  last_step_summary=${preview(redactText(result.result_summary))}`)
    if (result.error) out.push(`  last_step_error=${preview(redactText(result.error))}`)
  }
  out.push(`  plans=${continuation.recent.length}`)
  out.push("  recent_plans")
  if (continuation.recent.length === 0) out.push("    - empty")
  else out.push(...continuation.recent.slice(0, 10).map((record) => `    - ${record.plan_id} status=${record.status} wake=${record.wake_id}: ${preview(redactText(record.summary_preview))}`))
  if (continuation.commandError) out.push(`  command_error=${redactText(continuation.commandError)}`)
  return out
}

function wakeScheduleLines(state: UiState): string[] {
  const schedules = state.wakeSchedules
  const out = ["Wake schedules"]
  if (!schedules) {
    out.push("  schedules=0")
    return out
  }
  if (schedules.preview) {
    const previewRecord = schedules.preview
    out.push(`  preview_resume=${previewRecord.resume_id} can_create=${previewRecord.can_create} every_ms=${previewRecord.interval_ms} next_due=${previewRecord.next_due_at}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  preview_blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (schedules.selected) {
    const selected = schedules.selected
    out.push(`  selected_schedule=${selected.schedule_id} status=${selected.status} resume=${selected.resume_id} next_due=${selected.next_due_at}`)
    if (selected.last_wake_id) out.push(`  last_wake=${selected.last_wake_id}`)
    if (selected.last_plan_id) out.push(`  last_plan=${selected.last_plan_id}`)
  } else {
    out.push("  selected_schedule=none")
  }
  if (schedules.tickPreview) {
    const tickPreview = schedules.tickPreview
    out.push(`  tick_preview due=${tickPreview.due_count} eligible=${tickPreview.eligible_count} blocked=${tickPreview.blocked_count}`)
    out.push("  tick_preview_rows")
    if (tickPreview.items.length === 0) out.push("    - empty")
    else out.push(...tickPreview.items.slice(0, 10).map((item) => `    - ${item.schedule_id} due=${item.due} wake=${item.would_create_wake} plan=${item.would_create_continuation_plan}`))
  }
  if (schedules.lastTick) {
    const tick = schedules.lastTick
    out.push(`  last_tick=${tick.tick_id} dry_run=${tick.dry_run} processed=${tick.processed_count} wakes=${tick.wake_ids.length} plans=${tick.plan_ids.length}`)
  }
  out.push(`  schedules=${schedules.recent.length}`)
  out.push("  recent_schedules")
  if (schedules.recent.length === 0) out.push("    - empty")
  else out.push(...schedules.recent.slice(0, 10).map((record) => `    - ${record.schedule_id} status=${record.status} resume=${record.resume_id} next_due=${record.next_due_at}: ${preview(redactText(record.summary_preview))}`))
  out.push(`  ticks=${schedules.recentTicks.length}`)
  out.push("  recent_ticks")
  if (schedules.recentTicks.length === 0) out.push("    - empty")
  else out.push(...schedules.recentTicks.slice(0, 10).map((tick) => `    - ${tick.tick_id} dry_run=${tick.dry_run} processed=${tick.processed_count}`))
  if (schedules.commandError) out.push(`  command_error=${redactText(schedules.commandError)}`)
  return out
}

function wakeSchedulerLines(state: UiState): string[] {
  const scheduler = state.wakeScheduler
  const out = ["Wake scheduler"]
  if (!scheduler) {
    out.push("  status=stopped")
    return out
  }
  if (scheduler.preview) {
    const previewRecord = scheduler.preview
    out.push(`  preview can_start=${previewRecord.can_start} status=${previewRecord.status} every_ms=${previewRecord.config.interval_ms} dry_run=${previewRecord.config.dry_run} max=${previewRecord.config.max_due_items}`)
    if (previewRecord.due_preview) out.push(`  preview_due=${previewRecord.due_preview.due_count} eligible=${previewRecord.due_preview.eligible_count}`)
    if (previewRecord.blockers.length > 0) {
      out.push("  preview_blockers")
      out.push(...previewRecord.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (scheduler.status) {
    const status = scheduler.status
    out.push(`  status=${status.status} ticks=${status.tick_count} heartbeats=${status.heartbeat_count} dry_run=${status.config.dry_run} every_ms=${status.config.interval_ms}`)
    if (status.next_tick_at) out.push(`  next_tick=${status.next_tick_at}`)
    if (status.last_tick_id) out.push(`  last_tick=${status.last_tick_id}`)
    if (status.last_tick_at) out.push(`  last_tick_at=${status.last_tick_at}`)
    if (status.last_error) out.push(`  last_error=${preview(redactText(status.last_error))}`)
  } else {
    out.push("  status=none")
  }
  const bootstrap = scheduler.bootstrapPreview ?? scheduler.bootstrapStatus
  if (bootstrap) {
    out.push(`  bootstrap autostart=${bootstrap.autostart_enabled ? "enabled" : "disabled"} configured=${bootstrap.configured} can_bootstrap=${bootstrap.can_bootstrap} scheduler_status=${bootstrap.scheduler_status}`)
    out.push(`  bootstrap_config every_ms=${bootstrap.config.interval_ms} dry_run=${bootstrap.config.dry_run} max=${bootstrap.config.max_due_items} require_due=${bootstrap.config.require_due_schedule === true}`)
    if (bootstrap.stale_prior_run?.detected) out.push(`  stale_prior_run=${preview(redactText(bootstrap.stale_prior_run.reason ?? "detected"))}`)
    if (bootstrap.due_preview) out.push(`  bootstrap_due=${bootstrap.due_preview.due_count} eligible=${bootstrap.due_preview.eligible_count}`)
    if (bootstrap.last_bootstrap_event_id) out.push(`  last_bootstrap_event=${bootstrap.last_bootstrap_event_id}`)
    if (bootstrap.blockers.length > 0) {
      out.push("  bootstrap_blockers")
      out.push(...bootstrap.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
    if (bootstrap.warnings.length > 0) {
      out.push("  bootstrap_warnings")
      out.push(...bootstrap.warnings.slice(0, 10).map((warning) => `    - ${preview(redactText(warning))}`))
    }
  } else {
    out.push("  bootstrap=none")
  }
  const recovery = scheduler.recoveryPreview
  out.push("  recovery")
  if (recovery) {
    out.push(`    stale_detected=${recovery.stale_detected} status=${recovery.status} scheduler_status=${recovery.scheduler_status}`)
    if (recovery.recovery_id) out.push(`    recovery_id=${recovery.recovery_id}`)
    if (recovery.prior_started_at) out.push(`    prior_started_at=${recovery.prior_started_at}`)
    if (recovery.prior_event_id) out.push(`    prior_event=${recovery.prior_event_id}`)
    if (recovery.prior_tick_id) out.push(`    prior_tick=${recovery.prior_tick_id}`)
    out.push(`    due=${recovery.due_schedule_count} eligible=${recovery.eligible_due_schedule_count} blocked=${recovery.blocked_due_schedule_count}`)
    if (recovery.missed_window_estimate_count !== undefined) out.push(`    missed_window_estimate=${recovery.missed_window_estimate_count}`)
    if (recovery.recommended_commands.length > 0) {
      out.push("    recommended_commands")
      out.push(...recovery.recommended_commands.slice(0, 10).map((command) => `      - ${command.command_type}${command.requires_active_runtime ? "/active" : ""}: ${preview(redactText(command.command))}`))
    }
    if (recovery.blockers.length > 0) {
      out.push("    recovery_blockers")
      out.push(...recovery.blockers.slice(0, 10).map((blocker) => `      - ${preview(redactText(blocker))}`))
    }
    if (recovery.warnings.length > 0) {
      out.push("    recovery_warnings")
      out.push(...recovery.warnings.slice(0, 10).map((warning) => `      - ${preview(redactText(warning))}`))
    }
  } else {
    out.push("    preview=none")
  }
  if (scheduler.selectedRecovery) {
    const selected = scheduler.selectedRecovery
    out.push(`  selected_recovery=${selected.recovery_id} status=${selected.status}`)
    if (selected.acknowledged_at) out.push(`    acknowledged_at=${selected.acknowledged_at}`)
    if (selected.resolution_reason) out.push(`    reason=${preview(redactText(selected.resolution_reason))}`)
  }
  out.push(`  recoveries=${scheduler.recoveries.length}`)
  out.push("  recent_recoveries")
  if (scheduler.recoveries.length === 0) out.push("    - empty")
  else out.push(...scheduler.recoveries.slice(0, 10).map((record) => `    - ${record.recovery_id} status=${record.status}${record.prior_started_at ? ` prior=${record.prior_started_at}` : ""}: ${preview(redactText(record.summary_preview))}`))
  out.push("  recovery_workflow")
  if (scheduler.recoveryWorkflowPreview) {
    const workflow = scheduler.recoveryWorkflowPreview
    out.push(`    preview recovery_id=${workflow.recovery_id} can_create=${workflow.can_create} steps=${workflow.step_count} reads=${workflow.read_step_count} writes=${workflow.write_step_count}`)
    if (workflow.blockers.length > 0) out.push(...workflow.blockers.slice(0, 10).map((blocker) => `    blocker=${preview(redactText(blocker))}`))
    out.push("    preview_steps")
    if (workflow.steps.length === 0) out.push("      - empty")
    else out.push(...workflow.steps.slice(0, 10).map((step) => `      - ${step.index} ${step.step_kind}/${step.command_type}: ${preview(redactText(step.command))}`))
  } else {
    out.push("    preview=none")
  }
  if (scheduler.selectedRecoveryWorkflow) {
    const workflow = scheduler.selectedRecoveryWorkflow
    out.push(`    selected_workflow=${workflow.workflow_id} status=${workflow.status} recovery_id=${workflow.recovery_id}`)
    out.push(`    progress done=${workflow.completed_step_count} skipped=${workflow.skipped_step_count} blocked=${workflow.blocked_step_count} total=${workflow.steps.length}`)
    out.push("    steps")
    if (workflow.steps.length === 0) out.push("      - empty")
    else out.push(...workflow.steps.slice(0, 10).map((step) => `      - ${step.index} ${step.status ?? "pending"} ${step.step_kind}: ${preview(redactText(step.command))}${step.note ? ` note=${preview(redactText(step.note))}` : ""}`))
  } else {
    out.push("    selected_workflow=none")
  }
  if (scheduler.recoveryWorkflowVerification) {
    const verification = scheduler.recoveryWorkflowVerification
    out.push(`    verification workflow_id=${verification.workflow_id} updates=${verification.step_updates.length} events=${verification.observable_events.length}`)
    if (verification.warnings.length > 0) out.push(...verification.warnings.slice(0, 10).map((warning) => `    verification_warning=${preview(redactText(warning))}`))
  }
  out.push(`  recovery_workflows=${scheduler.recoveryWorkflows.length}`)
  out.push("  recent_recovery_workflows")
  if (scheduler.recoveryWorkflows.length === 0) out.push("    - empty")
  else out.push(...scheduler.recoveryWorkflows.slice(0, 10).map((record) => `    - ${record.workflow_id} status=${record.status} steps=${record.step_count} done=${record.completed_step_count}: ${preview(redactText(record.summary_preview))}`))
  out.push("  scheduler_audit")
  if (scheduler.auditSummary) {
    const summary = scheduler.auditSummary
    out.push(`    summary events=${summary.event_count} checkpoints=${summary.checkpoint_count} wakes=${summary.wake_assessment_count} plans=${summary.continuation_plan_count} schedules=${summary.schedule_count} ticks=${summary.tick_count} incidents=${summary.unresolved_incident_count}`)
    out.push(`    latest scheduler=${summary.latest_scheduler_status ?? "unknown"} bootstrap=${summary.latest_bootstrap_status ?? "unknown"} recovery=${summary.latest_recovery_status ?? "unknown"}`)
  } else {
    out.push("    summary=none")
  }
  out.push(`    timeline=${scheduler.auditTimeline.length}`)
  out.push("    timeline_rows")
  if (scheduler.auditTimeline.length === 0) out.push("      - empty")
  else out.push(...scheduler.auditTimeline.slice(0, 10).map((entry) => `      - ${entry.severity} ${entry.source_kind}/${entry.source_event_kind}${entry.event_id ? ` event=${entry.event_id}` : ""}: ${preview(redactText(entry.summary))}`))
  if (scheduler.selectedAuditChain) {
    const chain = scheduler.selectedAuditChain
    out.push(`    selected_chain=${chain.root_id} kind=${chain.root_kind} entries=${chain.entries.length} gaps=${chain.gaps.length}`)
    if (chain.gaps.length > 0) out.push(...chain.gaps.slice(0, 10).map((gap) => `    chain_gap=${gap.severity}: ${preview(redactText(gap.message))}`))
    if (chain.recommended_commands.length > 0) out.push(...chain.recommended_commands.slice(0, 10).map((command) => `    chain_command=${command.command_type}: ${preview(redactText(command.command))}`))
  } else {
    out.push("    selected_chain=none")
  }
  out.push(`    incidents=${scheduler.auditIncidents.length}`)
  out.push("    incident_rows")
  if (scheduler.auditIncidents.length === 0) out.push("      - empty")
  else out.push(...scheduler.auditIncidents.slice(0, 10).map((incident) => `      - ${incident.severity}/${incident.status} ${incident.incident_id}: ${preview(redactText(incident.title))}`))
  out.push("  scheduler_navigation")
  if (scheduler.navigationBoard) {
    const board = scheduler.navigationBoard
    out.push(`    board=${board.board_id} source=${board.source.kind} cards=${board.cards.length}`)
    out.push(`    title=${preview(redactText(board.title))}`)
    out.push(`    summary=${preview(redactText(board.summary))}`)
    if (board.blockers.length > 0) out.push(...board.blockers.slice(0, 10).map((blocker) => `    blocker=${preview(redactText(blocker))}`))
    if (board.warnings.length > 0) out.push(...board.warnings.slice(0, 10).map((warning) => `    warning=${preview(redactText(warning))}`))
    out.push("    cards")
    if (board.cards.length === 0) out.push("      - empty")
    else out.push(...board.cards.slice(0, 10).map((card) => `      - ${card.recommended_order} ${card.risk}/${card.command_type} ${card.target_kind}${card.target_id ? `:${card.target_id}` : ""} supported=${card.supported}: ${preview(redactText(card.command))}`))
  } else {
    out.push("    board=none")
  }
  if (scheduler.navigationCommandPreview) {
    const commandPreview = scheduler.navigationCommandPreview
    out.push(`    command_preview=${commandPreview.risk}/${commandPreview.command_type} target=${commandPreview.target_kind}${commandPreview.target_id ? `:${commandPreview.target_id}` : ""} supported=${commandPreview.supported}: ${preview(redactText(commandPreview.command))}`)
    if (commandPreview.equivalent_runtime_command) out.push(`    runtime_command=${preview(redactText(commandPreview.equivalent_runtime_command))}`)
    if (commandPreview.blockers.length > 0) out.push(...commandPreview.blockers.slice(0, 10).map((blocker) => `    command_blocker=${preview(redactText(blocker))}`))
  }
  if (scheduler.navigationTarget) {
    const target = scheduler.navigationTarget
    out.push(`    target=${target.target_kind}:${target.target_id} commands=${target.related_commands.length} audit_entries=${target.audit_entries.length}`)
    if (target.warnings.length > 0) out.push(...target.warnings.slice(0, 10).map((warning) => `    target_warning=${preview(redactText(warning))}`))
  }
  out.push("  scheduler_navigation_staging")
  if (scheduler.navigationStagePreview) {
    const stagePreview = scheduler.navigationStagePreview
    out.push(`    preview=${stagePreview.eligibility.risk}/${stagePreview.eligibility.command_type} target=${stagePreview.eligibility.target_kind}${stagePreview.eligibility.target_id ? `:${stagePreview.eligibility.target_id}` : ""} can_stage=${stagePreview.eligibility.can_stage}: ${preview(redactText(stagePreview.command))}`)
    if (stagePreview.existing_staged_id) out.push(`    existing_staged_id=${stagePreview.existing_staged_id}`)
    if (stagePreview.blockers.length > 0) out.push(...stagePreview.blockers.slice(0, 10).map((blocker) => `    stage_blocker=${preview(redactText(blocker))}`))
    if (stagePreview.warnings.length > 0) out.push(...stagePreview.warnings.slice(0, 10).map((warning) => `    stage_warning=${preview(redactText(warning))}`))
  } else {
    out.push("    preview=none")
  }
  if (scheduler.selectedStagedNavigationCommand) {
    const selected = scheduler.selectedStagedNavigationCommand
    out.push(`    selected_staged=${selected.staged_id} ${selected.risk}/${selected.command_type} ${selected.target_kind}: ${preview(redactText(selected.command))}`)
  } else {
    out.push("    selected_staged=none")
  }
  out.push("    note=staged navigation commands are not executed automatically")
  out.push(`    staged=${scheduler.stagedNavigationCommands.length}`)
  out.push("    staged_rows")
  if (scheduler.stagedNavigationCommands.length === 0) out.push("      - empty")
  else out.push(...scheduler.stagedNavigationCommands.slice(0, 10).map((record) => `      - ${record.staged_id} ${record.risk} ${record.target_kind}${record.target_id ? `:${record.target_id}` : ""}: ${preview(redactText(record.command))}`))
  out.push("  scheduler_navigation_staged_reads")
  if (scheduler.stagedReadPreview) {
    const readPreview = scheduler.stagedReadPreview
    out.push(`    preview=${readPreview.staged_id} ${readPreview.risk}/${readPreview.command_type} target=${readPreview.target_kind}${readPreview.target_id ? `:${readPreview.target_id}` : ""} can_execute=${readPreview.can_execute}: ${preview(redactText(readPreview.command))}`)
    if (readPreview.blockers.length > 0) out.push(...readPreview.blockers.slice(0, 10).map((blocker) => `    read_blocker=${preview(redactText(blocker))}`))
    if (readPreview.warnings.length > 0) out.push(...readPreview.warnings.slice(0, 10).map((warning) => `    read_warning=${preview(redactText(warning))}`))
  } else {
    out.push("    preview=none")
  }
  if (scheduler.latestStagedReadResult) {
    const result = scheduler.latestStagedReadResult
    out.push(`    latest=${result.run_id} ${result.status} ${result.target_kind}${result.target_id ? `:${result.target_id}` : ""}: ${preview(redactText(result.result_summary ?? result.error ?? result.command))}`)
  } else {
    out.push("    latest=none")
  }
  out.push("    note=only one safe-read staged navigation command runs per explicit request")
  out.push(`    runs=${scheduler.stagedReadRuns.length}`)
  out.push("    run_rows")
  if (scheduler.stagedReadRuns.length === 0) out.push("      - empty")
  else out.push(...scheduler.stagedReadRuns.slice(0, 10).map((record) => `      - ${record.run_id} ${record.status} ${record.target_kind}: ${preview(redactText(record.summary_preview))}`))
  out.push("  scheduler_navigation_read_comparison")
  if (scheduler.stagedReadHistory) {
    const history = scheduler.stagedReadHistory
    out.push(`    history=groups=${history.total_groups} runs=${history.total_runs} changed=${history.changed_groups} failed=${history.failed_groups} stale=${history.stale_groups}`)
    out.push("    history_rows")
    if (history.groups.length === 0) out.push("      - empty")
    else out.push(...history.groups.slice(0, 10).map((group) => `      - ${group.staged_id} ${group.comparison_status} runs=${group.run_count} latest=${group.latest_status ?? "unknown"}: ${preview(redactText(group.summary_preview))}`))
  } else {
    out.push("    history=none")
  }
  if (scheduler.stagedReadComparison) {
    const comparison = scheduler.stagedReadComparison
    out.push(`    comparison=${comparison.comparison_status} left=${comparison.left_run_id} right=${comparison.right_run_id}: ${preview(redactText(comparison.summary_delta))}`)
    if (comparison.warnings.length > 0) out.push(...comparison.warnings.slice(0, 10).map((warning) => `    comparison_warning=${preview(redactText(warning))}`))
  } else {
    out.push("    comparison=none")
  }
  if (scheduler.selectedStagedReadGroup) {
    const group = scheduler.selectedStagedReadGroup
    out.push(`    selected_group=${group.staged_id} ${group.comparison_status} runs=${group.run_count}: ${preview(redactText(group.summary_preview))}`)
  } else {
    out.push("    selected_group=none")
  }
  out.push(`    stale_items=${scheduler.stagedReadStaleItems.length}`)
  out.push("    stale_rows")
  if (scheduler.stagedReadStaleItems.length === 0) out.push("      - empty")
  else out.push(...scheduler.stagedReadStaleItems.slice(0, 10).map((item) => `      - ${item.staged_id} stale=${item.stale} age_ms=${item.age_ms ?? "unknown"} after_ms=${item.stale_after_ms}: ${preview(redactText(item.command))}`))
  out.push("    note=comparison uses bounded summaries and does not execute staged reads")
  out.push("  scheduler_write_eligibility")
  if (scheduler.writePreview) {
    const writePreview = scheduler.writePreview
    out.push(`    preview=${writePreview.risk} gate=${writePreview.authority_gate} status=${writePreview.status} can_stage_now=${writePreview.can_stage_now} can_execute_now=${writePreview.can_execute_now}: ${preview(redactText(writePreview.command))}`)
    out.push(`    target=${writePreview.target_kind}${writePreview.target_id ? `:${writePreview.target_id}` : ""}`)
    if (writePreview.equivalent_runtime_command) out.push(`    runtime_command=${preview(redactText(writePreview.equivalent_runtime_command))}`)
    if (writePreview.blockers.length > 0) out.push(...writePreview.blockers.slice(0, 10).map((blocker) => `    write_blocker=${preview(redactText(blocker))}`))
    if (writePreview.warnings.length > 0) out.push(...writePreview.warnings.slice(0, 10).map((warning) => `    write_warning=${preview(redactText(warning))}`))
    out.push("    prerequisites")
    if (writePreview.prerequisites.length === 0) out.push("      - empty")
    else out.push(...writePreview.prerequisites.slice(0, 10).map((item) => `      - ${item.name} satisfied=${item.satisfied} severity=${item.severity}: ${preview(redactText(item.summary))}`))
    out.push("    safer_reads")
    if (writePreview.safer_read_commands.length === 0) out.push("      - empty")
    else out.push(...writePreview.safer_read_commands.slice(0, 10).map((command) => `      - ${command.command_type}: ${preview(redactText(command.command))}`))
    if (writePreview.future_stage_policy) out.push(`    future_policy=active_runtime=${writePreview.future_stage_policy.would_require_active_runtime} run_lock=${writePreview.future_stage_policy.would_require_run_lock} approval=${writePreview.future_stage_policy.would_require_approval_record} dry_run_first=${writePreview.future_stage_policy.would_require_dry_run_first} allowed_in_7t=${writePreview.future_stage_policy.allowed_in_7t}`)
  } else {
    out.push("    preview=none")
  }
  if (scheduler.writeBoard) {
    const board = scheduler.writeBoard
    out.push(`    board=${board.board_id} source=${board.source.kind} previews=${board.previews.length} unsupported=${board.unsupported_count} high_impact=${board.high_impact_count}`)
    if (board.blockers.length > 0) out.push(...board.blockers.slice(0, 10).map((blocker) => `    board_blocker=${preview(redactText(blocker))}`))
    if (board.warnings.length > 0) out.push(...board.warnings.slice(0, 10).map((warning) => `    board_warning=${preview(redactText(warning))}`))
    out.push("    board_rows")
    if (board.previews.length === 0) out.push("      - empty")
    else out.push(...board.previews.slice(0, 10).map((item) => `      - ${item.risk} gate=${item.authority_gate} status=${item.status} can_stage_now=${item.can_stage_now} can_execute_now=${item.can_execute_now}: ${preview(redactText(item.command))}`))
  } else {
    out.push("    board=none")
  }
  out.push("    note=preview only; no write staging or execution")
  out.push("  scheduler_write_staging")
  if (scheduler.writeStagePreview) {
    const stagePreview = scheduler.writeStagePreview
    out.push(`    preview=${stagePreview.eligibility.risk} gate=${stagePreview.eligibility.authority_gate} can_stage=${stagePreview.eligibility.can_stage}: ${preview(redactText(stagePreview.command))}`)
    if (stagePreview.existing_staged_id) out.push(`    existing=${stagePreview.existing_staged_id}`)
    if (stagePreview.blockers.length > 0) out.push(...stagePreview.blockers.slice(0, 10).map((blocker) => `    stage_blocker=${preview(redactText(blocker))}`))
    if (stagePreview.warnings.length > 0) out.push(...stagePreview.warnings.slice(0, 10).map((warning) => `    stage_warning=${preview(redactText(warning))}`))
    out.push("    stage_safer_reads")
    if (stagePreview.eligibility.safer_read_commands.length === 0) out.push("      - empty")
    else out.push(...stagePreview.eligibility.safer_read_commands.slice(0, 10).map((command) => `      - ${command.command_type}: ${preview(redactText(command.command))}`))
  } else {
    out.push("    preview=none")
  }
  if (scheduler.selectedStagedWriteCommand) {
    const selected = scheduler.selectedStagedWriteCommand
    out.push(`    selected=${selected.staged_write_id} ${selected.risk} gate=${selected.authority_gate} target=${selected.target_kind}${selected.target_id ? `:${selected.target_id}` : ""}`)
  } else {
    out.push("    selected=none")
  }
  out.push(`    staged_writes=${scheduler.stagedWriteCommands.length}`)
  out.push("    staged_write_rows")
  if (scheduler.stagedWriteCommands.length === 0) out.push("      - empty")
  else out.push(...scheduler.stagedWriteCommands.slice(0, 10).map((item) => `      - ${item.staged_write_id} ${item.risk} gate=${item.authority_gate} target=${item.target_kind}${item.target_id ? `:${item.target_id}` : ""}: ${preview(redactText(item.command))}`))
  out.push("    note=staged write commands are operator intent only and are not executed by 7U")
  out.push("  scheduler_write_runs")
  if (scheduler.writeRunPreview) {
    const runPreview = scheduler.writeRunPreview
    out.push(`    preview=${runPreview.staged_write_id} ${runPreview.risk} kind=${runPreview.execution_kind} can_execute=${runPreview.can_execute}: ${preview(redactText(runPreview.command))}`)
    if (runPreview.blockers.length > 0) out.push(...runPreview.blockers.slice(0, 10).map((blocker) => `    run_blocker=${preview(redactText(blocker))}`))
    if (runPreview.warnings.length > 0) out.push(...runPreview.warnings.slice(0, 10).map((warning) => `    run_warning=${preview(redactText(warning))}`))
  } else {
    out.push("    preview=none")
  }
  if (scheduler.latestWriteRunResult) {
    const result = scheduler.latestWriteRunResult
    out.push(`    latest=${result.run_id} ${result.status} kind=${result.execution_kind}${result.downstream_run_id ? ` downstream=${result.downstream_run_id}` : ""}: ${preview(redactText(result.result_summary ?? result.error ?? result.command))}`)
  } else {
    out.push("    latest=none")
  }
  out.push(`    write_runs=${scheduler.writeRunRecords.length}`)
  out.push("    write_run_rows")
  if (scheduler.writeRunRecords.length === 0) out.push("      - empty")
  else out.push(...scheduler.writeRunRecords.slice(0, 10).map((item) => `      - ${item.run_id} ${item.status} kind=${item.execution_kind}: ${preview(redactText(item.summary_preview))}`))
  out.push("    note=only low-risk staged writes execute in 7V, one explicit command at a time")
  out.push("  scheduler_write_run_comparison")
  if (scheduler.writeRunHistory) {
    const history = scheduler.writeRunHistory
    out.push(`    history=groups=${history.total_groups} runs=${history.total_runs} changed=${history.changed_groups} failed=${history.failed_groups} stale=${history.stale_groups}`)
    out.push("    history_rows")
    if (history.groups.length === 0) out.push("      - empty")
    else out.push(...history.groups.slice(0, 10).map((group) => `      - ${group.staged_write_id} ${group.comparison_status} runs=${group.run_count} latest=${group.latest_status ?? "unknown"} downstream=${group.downstream_run_ids.length}: ${preview(redactText(group.summary_preview))}`))
  } else {
    out.push("    history=none")
  }
  if (scheduler.writeRunComparison) {
    const comparison = scheduler.writeRunComparison
    out.push(`    comparison=${comparison.comparison_status} left=${comparison.left_run_id} right=${comparison.right_run_id}: ${preview(redactText(comparison.summary_delta))}`)
    if (comparison.downstream_delta) out.push(`    downstream_delta=${preview(redactText(comparison.downstream_delta))}`)
    if (comparison.warnings.length > 0) out.push(...comparison.warnings.slice(0, 10).map((warning) => `    comparison_warning=${preview(redactText(warning))}`))
  } else {
    out.push("    comparison=none")
  }
  if (scheduler.selectedWriteRunGroup) {
    const group = scheduler.selectedWriteRunGroup
    out.push(`    selected_group=${group.staged_write_id} ${group.comparison_status} runs=${group.run_count} downstream=${group.downstream_run_ids.length}: ${preview(redactText(group.summary_preview))}`)
  } else {
    out.push("    selected_group=none")
  }
  out.push(`    stale_items=${scheduler.writeRunStaleItems.length}`)
  out.push("    stale_rows")
  if (scheduler.writeRunStaleItems.length === 0) out.push("      - empty")
  else out.push(...scheduler.writeRunStaleItems.slice(0, 10).map((item) => `      - ${item.staged_write_id} stale=${item.stale} age_ms=${item.age_ms ?? "unknown"} after_ms=${item.stale_after_ms}: ${preview(redactText(item.command))}`))
  out.push("    note=comparison uses bounded summaries and never executes staged writes")
  out.push("  scheduler_write_approval")
  if (scheduler.writeReadinessPreview) {
    const readiness = scheduler.writeReadinessPreview
    out.push(`    readiness=${readiness.staged_write_id} ${readiness.readiness_status} can_approve=${readiness.can_approve} execute_now=${readiness.can_execute_now}: ${preview(redactText(readiness.command))}`)
    if (readiness.existing_approval) out.push(`    existing=${readiness.existing_approval.approval_id} ${readiness.existing_approval.status}`)
    if (readiness.blockers.length > 0) out.push(...readiness.blockers.slice(0, 10).map((blocker) => `    approval_blocker=${preview(redactText(blocker))}`))
    if (readiness.warnings.length > 0) out.push(...readiness.warnings.slice(0, 10).map((warning) => `    approval_warning=${preview(redactText(warning))}`))
    out.push("    required_evidence")
    if (readiness.required_evidence.length === 0) out.push("      - empty")
    else out.push(...readiness.required_evidence.slice(0, 10).map((item) => `      - ${item.kind} fresh=${item.fresh} status=${item.status ?? "unknown"}: ${preview(redactText(item.summary_preview))}`))
    out.push("    recommended_commands")
    if (readiness.recommended_commands.length === 0) out.push("      - empty")
    else out.push(...readiness.recommended_commands.slice(0, 10).map((command) => `      - ${command.command_type}: ${preview(redactText(command.command))}`))
  } else {
    out.push("    readiness=none")
  }
  if (scheduler.selectedWriteApproval) {
    const approval = scheduler.selectedWriteApproval
    out.push(`    selected=${approval.approval_id} ${approval.status} staged=${approval.staged_write_id} expires=${approval.expires_at ?? "none"}: ${preview(redactText(approval.summary_preview))}`)
  } else {
    out.push("    selected=none")
  }
  out.push(`    approvals=${scheduler.writeApprovalRecords.length}`)
  out.push("    approval_rows")
  if (scheduler.writeApprovalRecords.length === 0) out.push("      - empty")
  else out.push(...scheduler.writeApprovalRecords.slice(0, 10).map((item) => `      - ${item.approval_id} ${item.status} staged=${item.staged_write_id}: ${preview(redactText(item.summary_preview))}`))
  out.push("    note=approval records future operator intent only and does not execute staged writes")
  out.push("  scheduler_checkpoint_write_runs")
  if (scheduler.checkpointWriteRunPreview) {
    const runPreview = scheduler.checkpointWriteRunPreview
    out.push(`    preview=${runPreview.staged_write_id} approval=${runPreview.approval_id ?? "none"} kind=${runPreview.execution_kind} can_execute=${runPreview.can_execute} scope=${runPreview.checkpoint_scope ?? "none"}: ${preview(redactText(runPreview.command))}`)
    if (runPreview.checkpoint_reason_preview) out.push(`    checkpoint_reason=${preview(redactText(runPreview.checkpoint_reason_preview))}`)
    if (runPreview.blockers.length > 0) out.push(...runPreview.blockers.slice(0, 10).map((blocker) => `    checkpoint_run_blocker=${preview(redactText(blocker))}`))
    if (runPreview.warnings.length > 0) out.push(...runPreview.warnings.slice(0, 10).map((warning) => `    checkpoint_run_warning=${preview(redactText(warning))}`))
  } else {
    out.push("    preview=none")
  }
  if (scheduler.latestCheckpointWriteRunResult) {
    const result = scheduler.latestCheckpointWriteRunResult
    out.push(`    latest=${result.run_id} ${result.status} checkpoint=${result.checkpoint_id ?? "none"} events=${result.event_count ?? "unknown"}: ${preview(redactText(result.result_summary ?? result.error ?? result.command))}`)
    if (result.checkpoint_hash) out.push(`    checkpoint_hash=${preview(redactText(result.checkpoint_hash))}`)
  } else {
    out.push("    latest=none")
  }
  out.push(`    checkpoint_write_runs=${scheduler.checkpointWriteRunRecords.length}`)
  out.push("    checkpoint_write_run_rows")
  if (scheduler.checkpointWriteRunRecords.length === 0) out.push("      - empty")
  else out.push(...scheduler.checkpointWriteRunRecords.slice(0, 10).map((item) => `      - ${item.run_id} ${item.status} checkpoint=${item.checkpoint_id ?? "none"}: ${preview(redactText(item.summary_preview))}`))
  out.push("    note=only approved staged checkpoint writes execute in 7Y")
  out.push("  scheduler_checkpoint_write_comparison")
  if (scheduler.checkpointWriteHistory) {
    const history = scheduler.checkpointWriteHistory
    out.push(`    history_groups=${history.total_groups} runs=${history.total_runs} changed=${history.changed_groups} failed=${history.failed_groups} artifact_changed=${history.artifact_changed_groups} unused_approvals=${history.unused_approval_count} stale_approvals=${history.stale_approval_count}`)
    out.push("    history_rows")
    if (history.groups.length === 0) out.push("      - empty")
    else out.push(...history.groups.slice(0, 10).map((group) => `      - ${group.staged_write_id} ${group.comparison_status} runs=${group.run_count} latest=${group.latest_run_id ?? "none"} approval=${group.latest_approval_id ?? "none"} checkpoint=${group.latest_checkpoint_id ?? "none"} artifact_changed=${group.checkpoint_artifact_changed ?? false}: ${preview(redactText(group.summary_preview))}`))
  } else {
    out.push("    history=none")
  }
  if (scheduler.checkpointWriteComparison) {
    const comparison = scheduler.checkpointWriteComparison
    out.push(`    comparison=${comparison.comparison_id} ${comparison.comparison_status} left=${comparison.left_run_id} right=${comparison.right_run_id}: ${preview(redactText(comparison.summary_delta))}`)
    if (comparison.checkpoint_artifact_delta) out.push(`    artifact_delta=${preview(redactText(comparison.checkpoint_artifact_delta))}`)
    if (comparison.approval_delta) out.push(`    approval_delta=${preview(redactText(comparison.approval_delta))}`)
    if (comparison.warnings.length > 0) out.push(...comparison.warnings.slice(0, 10).map((warning) => `    comparison_warning=${preview(redactText(warning))}`))
    if (comparison.recommended_commands.length > 0) out.push(...comparison.recommended_commands.slice(0, 5).map((command) => `    recommended=${command.command_type}: ${preview(redactText(command.command))}`))
  } else {
    out.push("    comparison=none")
  }
  out.push(`    stale_items=${scheduler.checkpointWriteStaleItems.length}`)
  out.push("    stale_rows")
  if (scheduler.checkpointWriteStaleItems.length === 0) out.push("      - empty")
  else out.push(...scheduler.checkpointWriteStaleItems.slice(0, 10).map((item) => `      - ${item.staged_write_id} stale=${item.stale} approval=${item.approval_id ?? "none"} latest=${item.latest_run_id ?? "none"} checkpoint=${item.checkpoint_id ?? "none"}: ${preview(redactText(item.reason))}`))
  if (scheduler.selectedCheckpointWriteGroup) {
    const group = scheduler.selectedCheckpointWriteGroup
    out.push(`    selected_group=${group.staged_write_id} ${group.comparison_status} runs=${group.run_count} checkpoint=${group.latest_checkpoint_id ?? "none"} artifact_changed=${group.checkpoint_artifact_changed ?? false}`)
  } else {
    out.push("    selected_group=none")
  }
  if (scheduler.checkpointApprovalUsage) {
    const usage = scheduler.checkpointApprovalUsage
    out.push(`    approval_usage total=${usage.total_approvals} used=${usage.used_count} unused=${usage.unused_count} stale=${usage.stale_count} expired_unused=${usage.expired_unused_count} revoked_unused=${usage.revoked_unused_count}`)
    out.push("    approval_usage_rows")
    if (usage.approvals.length === 0) out.push("      - empty")
    else out.push(...usage.approvals.slice(0, 10).map((item) => `      - ${item.approval_id} ${item.approval_status} used=${item.used} stale=${item.stale} latest=${item.latest_run_id ?? "none"} warnings=${item.warnings.length}`))
  } else {
    out.push("    approval_usage=none")
  }
  out.push("    note=comparison uses bounded summaries and separate checkpoint artifact hashes; it does not create checkpoints")
  out.push(`  events=${scheduler.events.length}`)
  out.push("  recent_events")
  if (scheduler.events.length === 0) out.push("    - empty")
  else out.push(...scheduler.events.slice(0, 10).map((event) => `    - ${event.kind} status=${event.scheduler_status}${event.tick_id ? ` tick=${event.tick_id}` : ""}${event.message ? `: ${preview(redactText(event.message))}` : ""}`))
  if (scheduler.commandError) out.push(`  command_error=${redactText(scheduler.commandError)}`)
  return out
}

function playbookLines(state: UiState): string[] {
  const playbooks = state.commanderPlaybooks
  const out = ["Commander playbooks"]
  if (!playbooks) {
    out.push("  catalog=0")
    return out
  }
  out.push(`  catalog=${playbooks.catalog.length}`)
  out.push("  catalog_rows")
  if (playbooks.catalog.length === 0) out.push("    - empty")
  else {
    out.push(...playbooks.catalog.slice(0, 10).map((playbook) => {
      return `    - ${playbook.playbook_id}: ${preview(redactText(playbook.title))} actions=${playbook.generated_action_kinds.join(",") || "none"}`
    }))
  }
  if (playbooks.selectedPlaybook) {
    const selected = playbooks.selectedPlaybook
    out.push(`  selected_playbook=${selected.playbook_id}`)
    out.push(`  title=${preview(redactText(selected.title))}`)
    out.push(`  description=${preview(redactText(selected.description))}`)
    out.push(`  fields=${selected.required_fields.map((field) => `${field.name}:${field.field_type}${field.required ? "*" : ""}`).join(", ") || "none"}`)
    out.push(`  actions=${selected.generated_action_kinds.join(",") || "none"}`)
    out.push(`  creates_bundle=${selected.creates_bundle}`)
  } else {
    out.push("  selected_playbook=none")
  }
  if (playbooks.lastDraft) {
    const draft = playbooks.lastDraft
    out.push(`  last_draft=${draft.draft_id ?? draft.playbook_id}`)
    out.push(`  playbook=${draft.playbook_id}`)
    out.push(`  proposals=${draft.proposal_ids.join(",") || "none"}`)
    out.push(`  bundle=${draft.bundle_id ?? "none"}`)
    out.push(`  reviews=${draft.review_ids?.join(",") || "none"}`)
  } else {
    out.push("  last_draft=none")
  }
  if (playbooks.commandError) out.push(`  command_error=${redactText(playbooks.commandError)}`)
  return out
}

function workbenchLines(state: UiState): string[] {
  const workbench = state.commanderWorkbench
  const out = ["Commander workbench"]
  if (!workbench) {
    out.push("  drafts=0")
    return out
  }
  if (workbench.summary) {
    const summary = workbench.summary
    out.push(`  summary drafted=${summary.drafted_count} review_requested=${summary.review_requested_count} partial=${summary.partially_review_requested_count} cancelled=${summary.cancelled_count} last=${summary.last_draft_id ?? "none"}`)
  }
  out.push(`  drafts=${workbench.drafts.length}`)
  out.push("  draft_rows")
  if (workbench.drafts.length === 0) out.push("    - empty")
  else {
    out.push(...workbench.drafts.slice(0, 10).map((draft) => {
      return `    - ${draft.draft_id}: ${draft.status} playbook=${draft.playbook_id} proposals=${draft.proposal_ids.length} bundle=${draft.bundle_id ?? "none"}`
    }))
  }
  if (workbench.selectedDraft) {
    const draft = workbench.selectedDraft
    out.push(`  selected_draft=${draft.draft_id} [${draft.status}] playbook=${draft.playbook_id}`)
    out.push(`  proposals=${draft.proposal_ids.join(",") || "none"}`)
    out.push(`  bundle=${draft.bundle_id ?? "none"}`)
    out.push(`  reviews=${draft.review_ids?.join(",") || "none"}`)
    if (draft.cancellation_reason) out.push(`  cancellation_reason=${preview(redactText(draft.cancellation_reason))}`)
  } else {
    out.push("  selected_draft=none")
  }
  if (workbench.readiness) {
    const readiness = workbench.readiness
    out.push(`  readiness=${readiness.ready_to_apply ? "ready" : "blocked"} proposals=${readiness.proposal_count} reviews=${readiness.review_count} missing_reviews=${readiness.missing_review_count} approved_reviews=${readiness.approved_review_count} rejected_reviews=${readiness.rejected_review_count} cancelled_reviews=${readiness.cancelled_review_count} applied=${readiness.applied_proposal_count}`)
    if (readiness.blockers.length > 0) {
      out.push("  blockers")
      out.push(...readiness.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  }
  if (workbench.commandError) out.push(`  command_error=${redactText(workbench.commandError)}`)
  return out
}

function applyLines(state: UiState): string[] {
  const apply = state.commanderApply
  const out = ["Commander apply"]
  if (!apply) {
    out.push("  preview=none")
    return out
  }
  if (apply.preview) {
    const applyPreview = apply.preview
    out.push(`  preview=${applyPreview.target_type}:${applyPreview.target_id} ${applyPreview.ready_to_apply ? "ready" : "blocked"} mode=${applyPreview.apply_mode}`)
    out.push(`  counts approved=${applyPreview.approved_count} applied=${applyPreview.applied_count} blocked=${applyPreview.blocked_count}`)
    out.push(`  would_apply=${applyPreview.would_apply.slice(0, 10).join(",") || "none"}`)
    out.push(`  would_skip=${applyPreview.would_skip.slice(0, 10).join(",") || "none"}`)
    if (applyPreview.blockers.length > 0) {
      out.push("  blockers")
      out.push(...applyPreview.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  } else {
    out.push("  preview=none")
  }
  if (apply.lastResult) {
    const result = apply.lastResult
    out.push(`  last_result=${result.target_type}:${result.target_id} applied=${result.applied}`)
    out.push(`  applied=${result.applied_proposal_ids.slice(0, 10).join(",") || "none"}`)
    out.push(`  skipped=${result.skipped_proposal_ids.slice(0, 10).join(",") || "none"}`)
    out.push(`  summary=${preview(redactText(result.result_summary))}`)
  } else {
    out.push("  last_result=none")
  }
  if (apply.commandError) out.push(`  command_error=${redactText(apply.commandError)}`)
  return out
}

function auditLines(state: UiState): string[] {
  const audit = state.commanderAudit
  const out = ["Commander audit"]
  if (!audit) {
    out.push("  timeline=empty")
    return out
  }
  out.push("  timeline")
  if (audit.timeline.length === 0) out.push("    - empty")
  else {
    out.push(...audit.timeline.slice(0, 10).map((event) => {
      const target = event.target_type && event.target_id ? `${event.target_type}:${event.target_id}` : "none"
      return `    - #${event.event_index} ${event.category}/${event.kind} target=${target}: ${preview(redactText(event.summary))}`
    }))
  }
  if (audit.selectedChain) {
    const chain = audit.selectedChain
    out.push(`  chain=${chain.target_type}:${chain.target_id}`)
    out.push("  chain_events")
    if (chain.events.length === 0) out.push("    - empty")
    else {
      out.push(...chain.events.slice(0, 20).map((event) => {
        const target = event.target_type && event.target_id ? `${event.target_type}:${event.target_id}` : "none"
        return `    - #${event.event_index} ${event.category}/${event.kind} target=${target}: ${preview(redactText(event.summary))}`
      }))
    }
    if (chain.missing_links.length > 0) {
      out.push("  missing_links")
      out.push(...chain.missing_links.slice(0, 10).map((link) => `    - ${preview(redactText(link))}`))
    }
  } else {
    out.push("  chain=none")
  }
  if (audit.commandError) out.push(`  command_error=${redactText(audit.commandError)}`)
  return out
}

function queueLines(state: UiState): string[] {
  const queues = state.commanderQueues
  const out = ["Commander queues"]
  if (!queues) {
    out.push("  selected=needs_review total=0")
    return out
  }
  if (queues.summary) {
    const summary = queues.summary
    out.push(`  summary needs_review=${summary.needs_review_count} ready_to_apply=${summary.ready_to_apply_count} blocked=${summary.blocked_count} failed_apply=${summary.failed_apply_count} recently_applied=${summary.recently_applied_count} drafts=${summary.drafts_needing_review_count} bundles=${summary.bundles_needing_review_count} stale=${summary.stale_open_count}`)
  }
  out.push(`  selected=${queues.selectedQueue ?? "needs_review"} total=${queues.totalConsidered ?? queues.items.length} limit=${queues.limit ?? queues.items.length}`)
  out.push("  rows")
  if (queues.items.length === 0) out.push("    - empty")
  else {
    out.push(...queues.items.slice(0, 20).map((item) => {
      const related = Object.entries(item.related_ids).flatMap(([key, values]) => values.slice(0, 3).map((value) => `${key}=${value}`)).slice(0, 4).join(" ")
      return `    - ${item.target_type}:${item.target_id} [${item.status}] ${preview(redactText(item.title))}${related ? ` ${related}` : ""}`
    }))
  }
  const blockerRows = queues.items.flatMap((item) => (item.blockers ?? []).slice(0, 3).map((blocker) => `${item.target_type}:${item.target_id} ${blocker}`)).slice(0, 10)
  if (blockerRows.length > 0) {
    out.push("  blockers")
    out.push(...blockerRows.map((blocker) => `    - ${preview(redactText(blocker))}`))
  }
  if (queues.commandError) out.push(`  command_error=${redactText(queues.commandError)}`)
  return out
}

function navigationLines(state: UiState): string[] {
  const navigation = state.commanderNavigation
  const out = ["Commander target context"]
  if (!navigation) {
    out.push("  selected=none")
    return out
  }
  const context = navigation.selected
  if (!context) {
    out.push("  selected=none")
  } else {
    out.push(`  selected=${context.target_type}:${context.target_id} found=${context.found}`)
    out.push(`  status=${context.status ?? "unknown"} kind=${context.record_kind ?? "unknown"}`)
    out.push(`  title=${preview(redactText(context.title))}`)
    out.push(`  summary=${preview(redactText(context.summary))}`)
    out.push(`  queues=${context.queue_membership.join(",") || "none"}`)
    out.push("  related")
    const related = Object.entries(context.related_ids).flatMap(([key, values]) => values.slice(0, 5).map((value) => `${key}=${value}`)).slice(0, 20)
    if (related.length === 0) out.push("    - empty")
    else out.push(...related.map((item) => `    - ${item}`))
    out.push(`  audit_events=${context.audit_event_count}`)
    if (context.recent_audit_events.length > 0) {
      out.push("  recent_audit")
      out.push(...context.recent_audit_events.slice(0, 10).map((event) => {
        const target = event.target_type && event.target_id ? `${event.target_type}:${event.target_id}` : "none"
        return `    - #${event.event_index} ${event.category}/${event.kind} target=${target}: ${preview(redactText(event.summary))}`
      }))
    }
    if (context.suggested_commands.length > 0) {
      out.push("  suggested_commands")
      out.push(...context.suggested_commands.slice(0, 12).map((command) => {
        const flags = [command.command_type, command.requires_review ? "review" : undefined, command.requires_active_runtime ? "active" : undefined].filter(Boolean).join(",")
        return `    - ${preview(redactText(command.label))} [${flags}]: ${preview(redactText(command.command))}`
      }))
    }
    if (context.missing_links.length > 0) {
      out.push("  missing_links")
      out.push(...context.missing_links.slice(0, 10).map((link) => `    - ${preview(redactText(link))}`))
    }
  }
  if (navigation.commandError) out.push(`  command_error=${redactText(navigation.commandError)}`)
  return out
}

function operatorActionLines(state: UiState): string[] {
  const actions = state.operatorActions
  const out = ["Operator actions"]
  if (!actions) {
    out.push("  staged=none")
    return out
  }
  if (actions.staged) {
    const staged = actions.staged
    const flags = [
      staged.command_type,
      staged.requires_review ? "review" : undefined,
      staged.requires_active_runtime ? "active" : undefined,
    ].filter(Boolean).join(",")
    const source = staged.source_target_type && staged.source_target_id ? `${staged.source_target_type}:${staged.source_target_id}` : "none"
    out.push(`  staged=${preview(redactText(staged.label))} [${flags}] source=${source}`)
    out.push(`  command=${preview(redactText(staged.command))}`)
  } else {
    out.push("  staged=none")
  }
  if (actions.lastResult) {
    const result = actions.lastResult
    const affected = result.affected_target_type && result.affected_target_id ? `${result.affected_target_type}:${result.affected_target_id}` : "none"
    out.push(`  last_result=${result.ok ? "ok" : "failed"} affected=${affected}`)
    out.push(`  last_command=${preview(redactText(result.command))}`)
    out.push(`  summary=${preview(redactText(result.summary))}`)
  }
  if (actions.commandError) out.push(`  command_error=${redactText(actions.commandError)}`)
  return out
}

function externalApiLines(state: UiState): string[] {
  const api = state.externalApi
  const out = ["External API"]
  if (!api) {
    out.push("  connectors=0")
    return out
  }
  out.push(`  connectors=${api.connectors.length}`)
  if (api.connectors.length > 0) {
    out.push("  connector_rows")
    out.push(...api.connectors.slice(0, 10).map((connector) => {
      return `    - ${connector.connector_id}: ${preview(redactText(connector.title))} methods=${connector.allowed_methods.join(",") || "none"} hosts=${connector.allowed_hosts.join(",") || "none"}`
    }))
  }
  if (api.selectedConnector) {
    const connector = api.selectedConnector
    out.push(`  selected_connector=${connector.connector_id}`)
    out.push(`  base_url=${preview(redactText(connector.base_url))}`)
    out.push(`  timeout_ms=${connector.timeout_ms} max_response_bytes=${connector.max_response_bytes}`)
    out.push(`  credentials=${connector.credential_refs?.map((ref) => `${ref.name}:${ref.inject_as}:${ref.target_name}`).join(",") || "none"}`)
  } else {
    out.push("  selected_connector=none")
  }
  if (api.preview) {
    const previewResult = api.preview
    out.push(`  preview=${previewResult.connector_id} ${previewResult.method} allowed=${previewResult.allowed}`)
    out.push(`  preview_url=${preview(redactText(previewResult.url))}`)
    out.push(`  body_bytes=${previewResult.body_bytes} has_body=${previewResult.has_body}`)
    if (previewResult.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewResult.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  }
  if (api.lastResult) {
    const result = api.lastResult
    out.push(`  last_result=${result.request_id} ${result.ok ? "ok" : "failed"} dry_run=${result.dry_run} status=${result.status_code ?? "none"}`)
    out.push(`  result_url=${preview(redactText(result.url))}`)
    if (result.response_preview) out.push(`  response=${preview(redactText(result.response_preview))}`)
    if (result.error) out.push(`  error=${preview(redactText(result.error))}`)
  }
  out.push(`  audit=${api.audit.length}`)
  if (api.audit.length > 0) {
    out.push(...api.audit.slice(0, 10).map((record) => {
      return `  - ${record.request_id} ${record.connector_id} ${record.method} ${record.ok ? "ok" : "failed"} dry_run=${record.dry_run} status=${record.status_code ?? "none"}`
    }))
  }
  if (api.commandError) out.push(`  command_error=${redactText(api.commandError)}`)
  const research = api.research
  out.push("External API research ingestion")
  if (!research) {
    out.push("  ingestions=0")
    return out
  }
  if (research.preview) {
    const ingestPreview = research.preview
    out.push(`  ingest_preview=${ingestPreview.connector_id} ${ingestPreview.method} topic=${ingestPreview.topic_id} allowed=${ingestPreview.allowed}`)
    out.push(`  ingest_url=${preview(redactText(ingestPreview.url))}`)
    out.push(`  would_create_source=${ingestPreview.would_create_source} would_create_note=${ingestPreview.would_create_note} max_bytes=${ingestPreview.max_ingested_bytes}`)
    if (ingestPreview.blockers.length > 0) {
      out.push("  ingest_blockers")
      out.push(...ingestPreview.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  }
  if (research.lastResult) {
    const result = research.lastResult
    out.push(`  ingest_last_result=${result.ingestion_id} ${result.ok ? "ok" : "failed"} dry_run=${result.dry_run} bytes=${result.ingested_bytes}`)
    out.push(`  evidence source=${result.source_id ?? "none"} note=${result.note_id ?? "none"} artifact=${result.artifact_id ?? "none"}`)
    if (result.response_preview) out.push(`  ingest_response=${preview(redactText(result.response_preview))}`)
    if (result.error) out.push(`  ingest_error=${preview(redactText(result.error))}`)
  }
  out.push(`  ingestions=${research.ingestions.length}`)
  if (research.ingestions.length > 0) {
    out.push(...research.ingestions.slice(0, 10).map((record) => {
      return `  - ${record.ingestion_id} ${record.connector_id} topic=${record.topic_id} ${record.ok ? "ok" : "failed"} dry_run=${record.dry_run} source=${record.source_id ?? "none"} note=${record.note_id ?? "none"}`
    }))
  }
  if (research.commandError) out.push(`  ingest_command_error=${redactText(research.commandError)}`)
  return out
}

function researchLines(state: UiState): string[] {
  const research = state.research
  const out = ["Research records"]
  if (!research) {
    out.push("  topics=0")
    return out
  }
  if (research.projection) {
    out.push(`  projection=${research.projection.ok ? "ok" : "not-ok"} stale=${research.projection.stale} pending=${research.projection.pending_count}`)
    out.push(`  projection_mode=${research.projection.mode}`)
    if (research.projection.last_event_id) out.push(`  last_event=${research.projection.last_event_id}`)
    if (research.projection.reason) out.push(`  projection_reason=${research.projection.reason}`)
  }
  out.push(`  topics=${research.topics.length}`)
  if (research.topics.length === 0) out.push("  topic_rows=empty")
  else out.push(...research.topics.map((topic) => `  - topic ${topic.id} [${topic.status}]: ${topic.title}`))
  if (research.selectedTopic) {
    out.push(`  selected_topic=${research.selectedTopic.topic.id} [${research.selectedTopic.topic.status}]: ${research.selectedTopic.topic.title}`)
    out.push(
      `  selected_counts sources=${research.selectedTopic.stats.source_count} notes=${research.selectedTopic.stats.note_count} artifacts=${research.selectedTopic.stats.artifact_count} reports=${research.selectedTopic.stats.report_count}`,
    )
  } else if (research.selectedTopicId) {
    out.push(`  selected_topic=${research.selectedTopicId} [missing]`)
  }
  if (research.lastQuery) out.push(`  last_query=${research.lastQuery}`)
  out.push(`  notes=${research.notes.length}`)
  if (research.notes.length > 0) {
    out.push(...research.notes.map((note) => `  - note ${note.id} topic=${note.topic_id} source=${note.source_id ?? "none"} tags=${note.tags.join(",") || "none"}: ${note.content}`))
  }
  out.push(`  events=${research.events.length}`)
  if (research.events.length > 0) {
    out.push(...research.events.map((event) => `  - event ${event.event_type} ${event.entity_type}/${event.entity_id} id=${event.event_id} time=${event.created_at ?? "unknown"}`))
  }
  if (research.commandError) out.push(`  command_error=${redactText(research.commandError)}`)
  return out
}

function researchSynthesisLines(state: UiState): string[] {
  const synthesis = state.researchSynthesis
  const out = ["Research synthesis"]
  if (!synthesis) {
    out.push("  syntheses=0")
    return out
  }
  if (synthesis.preview) {
    const previewResult = synthesis.preview
    out.push(`  preview_topic=${previewResult.topic_id}: ${preview(redactText(previewResult.topic_title))}`)
    out.push(`  evidence sources=${previewResult.evidence_counts.sources} notes=${previewResult.evidence_counts.notes} artifacts=${previewResult.evidence_counts.artifacts} ingestions=${previewResult.evidence_counts.ingestions}`)
    out.push(`  context_bytes=${previewResult.context_bytes}/${previewResult.max_context_bytes} excluded=${previewResult.excluded_evidence_count}`)
    if (previewResult.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewResult.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  }
  if (synthesis.selected) {
    const selected = synthesis.selected
    out.push(`  selected_synthesis=${selected.synthesis_id} provider=${selected.provider_id} topic=${selected.topic_id}`)
    out.push(`  note=${selected.source_note_id ?? "none"} artifact=${selected.artifact_id ?? "none"} proposals=${selected.proposal_ids?.join(",") || "none"}`)
    out.push(`  title=${preview(redactText(selected.title))}`)
    out.push(`  summary=${preview(redactText(selected.summary))}`)
    if (selected.findings.length > 0) out.push(...selected.findings.slice(0, 5).map((finding) => `  - finding ${preview(redactText(finding))}`))
    if (selected.risks.length > 0) out.push(...selected.risks.slice(0, 5).map((risk) => `  - risk ${preview(redactText(risk))}`))
    if (selected.open_questions.length > 0) out.push(...selected.open_questions.slice(0, 5).map((question) => `  - question ${preview(redactText(question))}`))
  } else {
    out.push("  selected_synthesis=none")
  }
  out.push(`  syntheses=${synthesis.recent.length}`)
  if (synthesis.recent.length > 0) {
    out.push(...synthesis.recent.slice(0, 10).map((record) => {
      return `  - ${record.synthesis_id} provider=${record.provider_id} topic=${record.topic_id}: ${preview(redactText(record.title))}`
    }))
  }
  if (synthesis.commandError) out.push(`  command_error=${redactText(synthesis.commandError)}`)
  return out
}

function commanderCycleLines(state: UiState): string[] {
  const cycle = state.commanderCycle
  const out = ["Commander cycle"]
  if (!cycle) {
    out.push("  cycles=0")
    return out
  }
  if (cycle.preview) {
    const previewResult = cycle.preview
    if (previewResult.topic_id) out.push(`  preview_topic=${previewResult.topic_id}`)
    if (previewResult.mission_id) out.push(`  preview_mission=${previewResult.mission_id}`)
    out.push(`  context sources=${previewResult.context_counts.sources} notes=${previewResult.context_counts.notes} artifacts=${previewResult.context_counts.artifacts} syntheses=${previewResult.context_counts.syntheses} proposals=${previewResult.context_counts.proposals}`)
    out.push(`  context_bytes=${previewResult.context_bytes}/${previewResult.max_context_bytes}`)
    if (previewResult.blockers.length > 0) {
      out.push("  blockers")
      out.push(...previewResult.blockers.slice(0, 10).map((blocker) => `    - ${preview(redactText(blocker))}`))
    }
  }
  if (cycle.selected) {
    const selected = cycle.selected
    out.push(`  selected_cycle=${selected.cycle_id} provider=${selected.provider_id} topic=${selected.topic_id ?? "none"} mission=${selected.mission_id ?? "none"}`)
    out.push(`  proposals=${selected.proposal_ids?.join(",") || "none"} bundle=${selected.bundle_id ?? "none"}`)
    out.push(`  title=${preview(redactText(selected.title))}`)
    out.push(`  summary=${preview(redactText(selected.summary))}`)
    if (selected.findings.length > 0) out.push(...selected.findings.slice(0, 5).map((finding) => `  - finding ${preview(redactText(finding))}`))
    if (selected.risks.length > 0) out.push(...selected.risks.slice(0, 5).map((risk) => `  - risk ${preview(redactText(risk))}`))
    if (selected.recommended_actions.length > 0) out.push(...selected.recommended_actions.slice(0, 5).map((action) => `  - action ${preview(redactText(action.title))}`))
  } else {
    out.push("  selected_cycle=none")
  }
  out.push(`  cycles=${cycle.recent.length}`)
  if (cycle.recent.length > 0) {
    out.push(...cycle.recent.slice(0, 10).map((record) => {
      return `  - ${record.cycle_id} provider=${record.provider_id} topic=${record.topic_id ?? "none"} mission=${record.mission_id ?? "none"}: ${preview(redactText(record.title))}`
    }))
  }
  if (cycle.commandError) out.push(`  command_error=${redactText(cycle.commandError)}`)
  return out
}

function missionExecutionLines(state: UiState): string[] {
  const execution = state.missionExecution
  const out = ["Mission execution"]
  if (!execution) {
    out.push("  selected_mission=none")
    return out
  }
  if (execution.selectedMission) {
    out.push(`  selected_mission=${execution.selectedMission.mission_id} [${execution.selectedMission.status}]`)
    if (execution.selectedMission.objective) out.push(`  objective=${preview(execution.selectedMission.objective)}`)
    if (execution.selectedMission.completion_result_id) out.push(`  completion_result=${execution.selectedMission.completion_result_id}`)
  } else {
    out.push(`  selected_mission=${execution.selectedMissionId ?? "none"}${execution.selectedMissionId ? " [missing]" : ""}`)
  }
  out.push(`  selected_claim=${execution.selectedClaimId ?? "none"}`)
  out.push(`  selected_result=${execution.selectedResultId ?? "none"}`)
  out.push(`  claims=${execution.claims.length}`)
  if (execution.claims.length > 0) {
    out.push(...execution.claims.map((claim) => `  - claim ${claim.claim_id} [${claim.status}] executor=${claim.executor_id}`))
  }
  out.push(`  progress=${execution.progress.length}`)
  if (execution.progress.length > 0) {
    out.push(...execution.progress.map((progress) => `  - progress ${progress.progress_id} claim=${progress.claim_id}: ${preview(progress.message)}`))
  }
  out.push(`  results=${execution.results.length}`)
  if (execution.results.length > 0) {
    out.push(...execution.results.map((result) => `  - result ${result.result_id} [${result.status}] claim=${result.claim_id}: ${preview(result.summary)}`))
  }
  if (execution.commandError) out.push(`  command_error=${redactText(execution.commandError)}`)
  return out
}

function countMapSummary(value: Record<string, number>): string {
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8)
    .map(([key, count]) => `${redactText(key)}=${count}`)
  return entries.join(",") || "none"
}

function preview(value: string): string {
  return value.length > 160 ? `${value.slice(0, 160)}...` : value
}

function adapterSummary(adapter: Record<string, unknown>): string {
  const fields = ["kind", "phase", "status", "message"]
    .map((key) => {
      const value = adapter[key]
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? `${key}=${redactText(String(value))}`
        : undefined
    })
    .filter(Boolean)
  return fields.join(" ") || "present"
}
