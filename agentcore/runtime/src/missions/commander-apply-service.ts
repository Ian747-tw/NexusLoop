import { redactText, redactValue } from "../security/redaction"
import type { CommanderPlaybookDraftRegistry } from "./commander-playbook-draft-registry"
import type { ProposalBundleRegistry } from "./proposal-bundle-registry"
import { isGenericProposalApplyActionKind, type ProposalRegistry } from "./proposal-registry"
import type { CommanderProposal } from "./proposal-types"
import type {
  CommanderApplyOptions,
  CommanderApplyPreview,
  CommanderApplyResult,
  CommanderApplyTarget,
  CommanderApplyTargetType,
} from "./commander-apply-types"

export interface CommanderApplyServiceOptions {
  proposalRegistry: ProposalRegistry
  proposalBundleRegistry: ProposalBundleRegistry
  commanderPlaybookDraftRegistry: CommanderPlaybookDraftRegistry
  now?: () => Date
}

export class CommanderApplyService {
  private readonly proposalRegistry: ProposalRegistry
  private readonly proposalBundleRegistry: ProposalBundleRegistry
  private readonly commanderPlaybookDraftRegistry: CommanderPlaybookDraftRegistry
  private readonly now: () => Date

  constructor(options: CommanderApplyServiceOptions) {
    this.proposalRegistry = options.proposalRegistry
    this.proposalBundleRegistry = options.proposalBundleRegistry
    this.commanderPlaybookDraftRegistry = options.commanderPlaybookDraftRegistry
    this.now = options.now ?? (() => new Date())
  }

  async preview(target: CommanderApplyTarget): Promise<CommanderApplyPreview> {
    const clean = readTarget(target)
    switch (clean.target_type) {
      case "proposal":
        return redactValue(await this.previewProposal(clean.target_id))
      case "bundle":
        return redactValue(await this.previewBundle(clean.target_id, "bundle"))
      case "draft":
        return redactValue(await this.previewDraft(clean.target_id))
    }
  }

  async apply(target: CommanderApplyTarget, options: CommanderApplyOptions = {}): Promise<CommanderApplyResult> {
    const clean = readTarget(target)
    const allowPartial = options.allow_partial === true
    const dryRun = options.dry_run === true
    const preview = await this.preview(clean)
    if (dryRun) {
      return redactValue({
        target_type: clean.target_type,
        target_id: clean.target_id,
        applied: false,
        applied_proposal_ids: [],
        skipped_proposal_ids: preview.proposal_ids,
        result_summary: "dry run; no proposals applied",
        created_at: this.isoNow(),
      })
    }
    if (!preview.ready_to_apply && !allowPartial) {
      throw new Error(`commander apply target is not ready: ${preview.blockers.join("; ") || "blocked"}`)
    }
    if (allowPartial && preview.would_apply.length === 0) {
      throw new Error("partial commander apply did not have any approved proposals to apply")
    }

    const before = await this.proposalsById(preview.proposal_ids)
    switch (preview.apply_mode) {
      case "single":
        if (preview.would_apply.length > 0) await this.proposalRegistry.applyProposal(clean.target_id)
        break
      case "bundle":
      case "draft_bundle":
        if (preview.bundle_id && preview.would_apply.length > 0) await this.proposalBundleRegistry.applyBundle(preview.bundle_id, { allowPartial })
        break
      case "draft_proposals":
        for (const proposalId of preview.proposal_ids) {
          const proposal = before.get(proposalId)
          if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
          if (proposal.status === "approved" && isGenericProposalApplyActionKind(proposal.action_kind)) await this.proposalRegistry.applyProposal(proposal.proposal_id)
          else if (proposal.status !== "applied" && !allowPartial) throw new Error(`proposal is not approved: ${proposal.proposal_id}`)
        }
        break
    }
    const after = await this.proposalsById(preview.proposal_ids)
    const appliedProposalIds = preview.proposal_ids.filter((proposalId) => before.get(proposalId)?.status !== "applied" && after.get(proposalId)?.status === "applied")
    const skippedProposalIds = preview.proposal_ids.filter((proposalId) => !appliedProposalIds.includes(proposalId))
    return redactValue({
      target_type: clean.target_type,
      target_id: clean.target_id,
      applied: appliedProposalIds.length > 0,
      applied_proposal_ids: appliedProposalIds,
      skipped_proposal_ids: skippedProposalIds,
      result_summary: appliedProposalIds.length > 0
        ? `applied ${appliedProposalIds.length} proposal(s); skipped ${skippedProposalIds.length}`
        : `no new proposals applied; skipped ${skippedProposalIds.length}`,
      created_at: this.isoNow(),
    })
  }

  private async previewProposal(proposalId: string): Promise<CommanderApplyPreview> {
    const proposal = await this.requireProposal(proposalId)
    const blockers = blockersForProposal(proposal)
    return {
      target_type: "proposal",
      target_id: proposal.proposal_id,
      ready_to_apply: blockers.length === 0,
      proposal_ids: [proposal.proposal_id],
      approved_count: proposal.status === "approved" ? 1 : 0,
      applied_count: proposal.status === "applied" ? 1 : 0,
      blocked_count: blockers.length,
      blockers,
      apply_mode: "single",
      would_apply: proposal.status === "approved" && blockers.length === 0 ? [proposal.proposal_id] : [],
      would_skip: proposal.status === "applied" ? [proposal.proposal_id] : [],
    }
  }

  private async previewBundle(bundleId: string, applyMode: "bundle" | "draft_bundle", draftId?: string): Promise<CommanderApplyPreview> {
    const bundle = await this.proposalBundleRegistry.getBundle(bundleId)
    if (!bundle) throw new Error(`commander proposal bundle not found: ${bundleId}`)
    const readiness = await this.proposalBundleRegistry.readiness(bundle.bundle_id)
    const proposals = await this.proposalsById(bundle.proposal_ids)
    const wouldApply = bundle.proposal_ids.filter((proposalId) => {
      const proposal = proposals.get(proposalId)
      return proposal?.status === "approved" && isGenericProposalApplyActionKind(proposal.action_kind)
    })
    const wouldSkip = bundle.proposal_ids.filter((proposalId) => proposals.get(proposalId)?.status === "applied")
    return {
      target_type: draftId ? "draft" : "bundle",
      target_id: draftId ?? bundle.bundle_id,
      ready_to_apply: readiness.ready_to_apply,
      proposal_ids: bundle.proposal_ids,
      bundle_id: bundle.bundle_id,
      draft_id: draftId,
      approved_count: readiness.approved_count,
      applied_count: readiness.applied_count,
      blocked_count: readiness.blocked_count,
      blockers: readiness.blockers.map(redactText),
      apply_mode: applyMode,
      would_apply: wouldApply,
      would_skip: wouldSkip,
    }
  }

  private async previewDraft(draftId: string): Promise<CommanderApplyPreview> {
    const draft = await this.commanderPlaybookDraftRegistry.getDraft(draftId)
    if (!draft) throw new Error(`commander playbook draft not found: ${draftId}`)
    const cancelledBlocker = draft.status === "cancelled" ? `draft ${draft.draft_id} is cancelled` : undefined
    if (draft.bundle_id) {
      const preview = await this.previewBundle(draft.bundle_id, "draft_bundle", draft.draft_id)
      if (!cancelledBlocker) return preview
      return {
        ...preview,
        ready_to_apply: false,
        blocked_count: preview.blocked_count + 1,
        blockers: [...preview.blockers, redactText(cancelledBlocker)],
        would_apply: [],
      }
    }
    const proposals = await this.proposalsById(draft.proposal_ids)
    const blockers: string[] = []
    for (const proposalId of draft.proposal_ids) {
      const proposal = proposals.get(proposalId)
      if (!proposal) {
        blockers.push(`missing proposal: ${proposalId}`)
        continue
      }
      blockers.push(...blockersForProposal(proposal))
    }
    if (cancelledBlocker) blockers.push(cancelledBlocker)
    return {
      target_type: "draft",
      target_id: draft.draft_id,
      ready_to_apply: blockers.length === 0 && draft.proposal_ids.length > 0,
      proposal_ids: draft.proposal_ids,
      draft_id: draft.draft_id,
      approved_count: [...proposals.values()].filter((proposal) => proposal.status === "approved").length,
      applied_count: [...proposals.values()].filter((proposal) => proposal.status === "applied").length,
      blocked_count: blockers.length,
      blockers: blockers.map(redactText),
      apply_mode: "draft_proposals",
      would_apply: cancelledBlocker ? [] : draft.proposal_ids.filter((proposalId) => {
        const proposal = proposals.get(proposalId)
        return proposal?.status === "approved" && isGenericProposalApplyActionKind(proposal.action_kind)
      }),
      would_skip: draft.proposal_ids.filter((proposalId) => proposals.get(proposalId)?.status === "applied"),
    }
  }

  private async requireProposal(proposalId: string): Promise<CommanderProposal> {
    const proposal = await this.proposalRegistry.getProposal(proposalId)
    if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
    return proposal
  }

  private async proposalsById(proposalIds: string[]): Promise<Map<string, CommanderProposal>> {
    const out = new Map<string, CommanderProposal>()
    for (const proposalId of proposalIds) {
      const proposal = await this.proposalRegistry.getProposal(proposalId)
      if (proposal) out.set(proposal.proposal_id, proposal)
    }
    return out
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function blockersForProposal(proposal: CommanderProposal): string[] {
  if (!isGenericProposalApplyActionKind(proposal.action_kind)) return [`proposal ${proposal.proposal_id} action ${proposal.action_kind} must use its dedicated command`]
  if (proposal.status === "approved" || proposal.status === "applied") return []
  if (proposal.status === "rejected" || proposal.status === "cancelled") return [`proposal ${proposal.proposal_id} is ${proposal.status}`]
  if (!proposal.review_id) return [`proposal ${proposal.proposal_id} has no linked review`]
  return [`proposal ${proposal.proposal_id} status is ${proposal.status}`]
}

function readTarget(value: CommanderApplyTarget): CommanderApplyTarget {
  const targetType = value.target_type
  if (targetType !== "proposal" && targetType !== "bundle" && targetType !== "draft") throw new Error("commander apply target_type is invalid")
  return {
    target_type: targetType,
    target_id: cleanRequiredString(value.target_id, "target_id"),
  }
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}
