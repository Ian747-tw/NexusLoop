import type { CommanderInvestigationProviderAuditSummary } from "./commander-investigation-provider-types"
import type { CommanderInvestigationWorkingSet } from "./commander-investigation-types"
import type { CommanderEvidenceCard, CommanderReadSourceRef } from "../commander-tools/commander-read-types"
import { redactText, redactValue } from "../security/redaction"
import { stableHash } from "./commander-model-schema"

export function stableCommanderInvestigationWorkingSet(value: CommanderInvestigationWorkingSet): unknown {
  const { working_set_hash: _workingSetHash, ...rest } = value
  return {
    ...rest,
    evidence_cards: value.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
    provider_audit: stableCommanderInvestigationProviderAudit(value.provider_audit),
  }
}

export function durableCommanderInvestigationWorkingSet(input: CommanderInvestigationWorkingSet): CommanderInvestigationWorkingSet {
  const workingSet = {
    objective_preview: bound(input.objective_preview, 1000),
    phase: input.phase,
    loaded_tool_ids: [...input.loaded_tool_ids].sort(),
    evidence_cards: sanitizeEvidence(input.evidence_cards),
    recent_execution_digests: input.recent_execution_digests.map((digest) => redactValue({
      turn_index: digest.turn_index,
      tool_id: digest.tool_id,
      call_signature_hash: digest.call_signature_hash,
      execution_status: digest.execution_status,
      result_hash: digest.result_hash,
      evidence_ids: digest.evidence_ids.slice(0, 8),
      loaded_tool_outcome: bound(digest.loaded_tool_outcome, 160),
      blocker_warning_summary: bound(digest.blocker_warning_summary, 320),
      order: digest.order,
    })).slice(-24) as CommanderInvestigationWorkingSet["recent_execution_digests"],
    recent_load_outcomes: input.recent_load_outcomes.map((item) => bound(item, 240)).slice(-24),
    current_blockers: input.current_blockers.map((item) => bound(item, 300)).slice(-16),
    current_warnings: input.current_warnings.map((item) => bound(item, 300)).slice(-24),
    provider_audit: sanitizedProviderAudit(input.provider_audit),
    omitted_evidence_count: input.omitted_evidence_count,
    omitted_digest_count: input.omitted_digest_count,
    omitted_turn_count: input.omitted_turn_count,
    consecutive_no_progress_turns: input.consecutive_no_progress_turns,
    cumulative_tool_result_bytes: input.cumulative_tool_result_bytes,
    model_turn_count: input.model_turn_count,
    tool_call_count: input.tool_call_count,
    tool_search_call_count: input.tool_search_call_count,
    recent_result_signatures: input.recent_result_signatures.slice(-64).map((item) => ({ signature_hash: item.signature_hash, count: item.count, last_turn_index: item.last_turn_index })),
    working_set_hash: "",
  } satisfies CommanderInvestigationWorkingSet
  workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
  return workingSet
}

export function durableCommanderEvidenceCards(cards: CommanderEvidenceCard[]): CommanderEvidenceCard[] {
  return sanitizeEvidence(cards)
}

export function stableCommanderInvestigationProviderAudit(value: CommanderInvestigationProviderAuditSummary): unknown {
  return {
    ...value,
    audit_request_ids: [],
  }
}

function sanitizeEvidence(cards: CommanderEvidenceCard[]): CommanderEvidenceCard[] {
  return cards.map((card) => {
    const contentBearing = card.content_included || ["repository_file", "repository_search_match", "repository_symbol", "git_diff", "test_manifest"].includes(card.source_kind)
    const durableWarning = "Durable journal stores pointer/hash metadata only for content-bearing evidence."
    const warnings = card.warnings.map((item: string) => bound(item, 200))
    if (contentBearing && !warnings.includes(durableWarning)) warnings.push(durableWarning)
    return redactValue({
      ...card,
      title: bound(card.title, 180),
      summary_preview: contentBearing ? durablePointerSummary(card) : bound(card.summary_preview, 500),
      source_refs: card.source_refs.map((ref: CommanderReadSourceRef) => ({
        ...ref,
        label: bound(ref.label, 160),
        summary_preview: contentBearing ? durablePointerSummary(card) : bound(ref.summary_preview, 240),
        pointer_only: true as const,
      })).slice(0, 8),
      warnings: warnings.slice(0, 6),
      content_included: false,
      content_truncated: card.content_truncated || contentBearing,
    }) as CommanderEvidenceCard
  })
}

function durablePointerSummary(card: CommanderEvidenceCard): string {
  return bound(`${card.source_kind} evidence content omitted from durable journal; use source_id=${card.source_id} evidence_hash=${card.evidence_hash ?? ""}`.trim(), 500)
}

function sanitizedProviderAudit<T extends { audit_request_ids: string[] }>(audit: T): T {
  return { ...audit, audit_request_ids: audit.audit_request_ids.map((item) => bound(item, 120)).slice(0, 24) }
}

function bound(value: unknown, max: number): string {
  return redactText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max)
}
