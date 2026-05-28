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
  out.push(...researchSynthesisLines(state))
  out.push(...commanderCycleLines(state))
  out.push(...opencodeHandoffLines(state))
  out.push(...opencodeFollowupLines(state))
  out.push(...runtimeCheckpointLines(state))
  out.push(...runtimeRestoreLines(state))
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
