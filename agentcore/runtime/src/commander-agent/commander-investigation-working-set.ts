import type { CommanderInvestigationProviderAuditSummary } from "./commander-investigation-provider-types"
import type { CommanderInvestigationWorkingSet } from "./commander-investigation-types"

export function stableCommanderInvestigationWorkingSet(value: CommanderInvestigationWorkingSet): unknown {
  const { working_set_hash: _workingSetHash, ...rest } = value
  return {
    ...rest,
    evidence_cards: value.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
    provider_audit: stableCommanderInvestigationProviderAudit(value.provider_audit),
  }
}

export function stableCommanderInvestigationProviderAudit(value: CommanderInvestigationProviderAuditSummary): unknown {
  return {
    ...value,
    audit_request_ids: [],
  }
}
