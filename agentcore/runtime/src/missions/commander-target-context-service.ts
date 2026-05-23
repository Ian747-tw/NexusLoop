import { redactText, redactValue } from "../security/redaction"
import type { RuntimeStatus } from "../events/event-types"
import type { MissionRegistry } from "./mission-registry"
import type { ReviewRegistry } from "./review-registry"
import type { ProposalRegistry } from "./proposal-registry"
import type { ProposalBundleRegistry } from "./proposal-bundle-registry"
import type { CommanderPlaybookDraftRegistry } from "./commander-playbook-draft-registry"
import type { CommanderApplyService } from "./commander-apply-service"
import type { CommanderAuditService } from "./commander-audit-service"
import type { CommanderQueueService } from "./commander-queue-service"
import type { CommanderSuggestedCommand, CommanderTargetContext, CommanderTargetType } from "./commander-target-context-types"

const TARGET_TYPES = new Set<CommanderTargetType>(["mission", "claim", "result", "review", "proposal", "bundle", "draft", "runtime"])
const TITLE_LIMIT = 120
const SUMMARY_LIMIT = 260
const RELATED_LIMIT = 50
const AUDIT_LIMIT = 20

export interface CommanderTargetContextServiceOptions {
  missionRegistry: MissionRegistry
  reviewRegistry: ReviewRegistry
  proposalRegistry: ProposalRegistry
  proposalBundleRegistry: ProposalBundleRegistry
  commanderPlaybookDraftRegistry: CommanderPlaybookDraftRegistry
  applyService: CommanderApplyService
  auditService: CommanderAuditService
  queueService: CommanderQueueService
  runtimeStatus?: () => Promise<RuntimeStatus>
}

export class CommanderTargetContextService {
  constructor(private readonly options: CommanderTargetContextServiceOptions) {}

  async context(targetType: string, targetId: string): Promise<CommanderTargetContext> {
    const target = readTarget(targetType, targetId)
    const base = await this.recordContext(target.target_type, target.target_id)
    const chain = await this.options.auditService.authorityChain(target.target_type, target.target_id)
    const queueMembership = await this.options.queueService.membership(target.target_type, target.target_id)
    const relatedIds = mergeRelatedIds(base.related_ids, chain.related_ids)
    const missingLinks = uniqueStrings([...base.missing_links, ...chain.missing_links])
    const context: CommanderTargetContext = {
      target_type: target.target_type,
      target_id: safe(target.target_id, TITLE_LIMIT),
      found: base.found,
      title: safe(base.title, TITLE_LIMIT),
      summary: safe(base.summary, SUMMARY_LIMIT),
      status: base.status ? safe(base.status, TITLE_LIMIT) : undefined,
      record_kind: base.record_kind,
      related_ids: relatedIds,
      queue_membership: queueMembership,
      audit_event_count: chain.events.length,
      recent_audit_events: chain.events.slice(-AUDIT_LIMIT).reverse(),
      suggested_commands: suggestedCommands(target.target_type, target.target_id, base.status, queueMembership, relatedIds),
      missing_links: missingLinks.map((link) => safe(link, SUMMARY_LIMIT)).slice(0, 20),
    }
    return redactValue(context)
  }

  private async recordContext(targetType: CommanderTargetType, targetId: string): Promise<Omit<CommanderTargetContext, "target_type" | "target_id" | "queue_membership" | "audit_event_count" | "recent_audit_events" | "suggested_commands">> {
    switch (targetType) {
      case "mission": {
        const mission = await this.options.missionRegistry.getMission(targetId)
        if (!mission) return missing(targetType, targetId)
        const [claims, progress, results] = await Promise.all([
          this.options.missionRegistry.listMissionClaims(mission.mission_id),
          this.options.missionRegistry.listMissionProgress(mission.mission_id),
          this.options.missionRegistry.listMissionResults(mission.mission_id),
        ])
        return found({
          title: `mission ${mission.mission_id}`,
          summary: mission.objective ?? mission.completion_summary ?? mission.failure_reason ?? mission.cancellation_reason ?? "mission record",
          status: mission.status,
          record_kind: "mission",
          related_ids: {
            mission_id: [mission.mission_id],
            intent_id: optionalArray(mission.intent_id),
            claim_id: claims.map((claim) => claim.claim_id),
            progress_id: progress.map((item) => item.progress_id),
            result_id: results.map((result) => result.result_id),
          },
        })
      }
      case "claim": {
        const claim = await this.options.missionRegistry.getMissionClaim(targetId)
        if (!claim) return missing(targetType, targetId)
        return found({
          title: `claim ${claim.claim_id}`,
          summary: `executor=${claim.executor_id}`,
          status: claim.status,
          record_kind: "mission_claim",
          related_ids: { claim_id: [claim.claim_id], mission_id: [claim.mission_id] },
        })
      }
      case "result": {
        const result = await this.options.missionRegistry.getMissionResult(targetId)
        if (!result) return missing(targetType, targetId)
        return found({
          title: `result ${result.result_id}`,
          summary: result.summary,
          status: result.status,
          record_kind: "mission_result",
          related_ids: { result_id: [result.result_id], mission_id: [result.mission_id], claim_id: [result.claim_id], research_result_id: result.research_result_ids ?? [] },
        })
      }
      case "review": {
        const review = await this.options.reviewRegistry.getReviewRequest(targetId)
        if (!review) return missing(targetType, targetId)
        const proposals = (await this.options.proposalRegistry.listAllProposals()).filter((proposal) => proposal.review_id === review.review_id)
        return found({
          title: review.title,
          summary: review.summary,
          status: review.status,
          record_kind: "review_request",
          related_ids: {
            review_id: [review.review_id],
            proposal_id: proposals.map((proposal) => proposal.proposal_id),
            mission_id: optionalArray(review.mission_id),
            claim_id: optionalArray(review.claim_id),
            result_id: optionalArray(review.result_id),
          },
        })
      }
      case "proposal": {
        const proposal = await this.options.proposalRegistry.getProposal(targetId)
        if (!proposal) return missing(targetType, targetId)
        const bundles = (await this.options.proposalBundleRegistry.listAllBundles()).filter((bundle) => bundle.proposal_ids.includes(proposal.proposal_id))
        const drafts = (await this.options.commanderPlaybookDraftRegistry.listAllDrafts()).filter((draft) => draft.proposal_ids.includes(proposal.proposal_id))
        let previewSummary: string | undefined
        try {
          const preview = await this.options.applyService.preview({ target_type: "proposal", target_id: proposal.proposal_id })
          previewSummary = preview.ready_to_apply ? "ready to apply" : preview.blockers.slice(0, 3).join("; ")
        } catch {
          previewSummary = undefined
        }
        return found({
          title: proposal.title,
          summary: previewSummary ? `${proposal.summary} (${previewSummary})` : proposal.summary,
          status: proposal.status,
          record_kind: "commander_proposal",
          related_ids: {
            proposal_id: [proposal.proposal_id],
            review_id: optionalArray(proposal.review_id),
            bundle_id: bundles.map((bundle) => bundle.bundle_id),
            draft_id: drafts.map((draft) => draft.draft_id),
            mission_id: optionalArray(proposal.mission_id),
            claim_id: optionalArray(proposal.claim_id),
            result_id: optionalArray(proposal.result_id),
          },
        })
      }
      case "bundle": {
        const bundle = await this.options.proposalBundleRegistry.getBundle(targetId)
        if (!bundle) return missing(targetType, targetId)
        const readiness = await this.options.proposalBundleRegistry.readiness(bundle.bundle_id)
        return found({
          title: bundle.title,
          summary: `${bundle.summary} (${readiness.ready_to_apply ? "ready" : `blocked=${readiness.blocked_count}`})`,
          status: bundle.status,
          record_kind: "commander_proposal_bundle",
          related_ids: { bundle_id: [bundle.bundle_id], proposal_id: bundle.proposal_ids },
        })
      }
      case "draft": {
        const draft = await this.options.commanderPlaybookDraftRegistry.getDraft(targetId)
        if (!draft) return missing(targetType, targetId)
        const readiness = await this.options.commanderPlaybookDraftRegistry.readiness(draft.draft_id)
        return found({
          title: draft.playbook_id,
          summary: `playbook draft (${readiness.ready_to_apply ? "ready" : `blocked=${readiness.blockers.length}`})`,
          status: draft.status,
          record_kind: "commander_playbook_draft",
          related_ids: { draft_id: [draft.draft_id], proposal_id: draft.proposal_ids, bundle_id: optionalArray(draft.bundle_id), review_id: draft.review_ids ?? [] },
        })
      }
      case "runtime": {
        const status = await this.options.runtimeStatus?.()
        return found({
          title: `runtime ${targetId}`,
          summary: status ? `${status.runtimeStatus} mode=${status.mode}` : "runtime audit context",
          status: status?.runtimeStatus,
          record_kind: "runtime",
          related_ids: { intent_id: [targetId] },
        })
      }
    }
  }
}

function readTarget(targetType: string, targetId: string): { target_type: CommanderTargetType; target_id: string } {
  if (!targetType.trim()) throw new Error("targetType is required")
  if (!targetId.trim()) throw new Error("targetId is required")
  if (!TARGET_TYPES.has(targetType as CommanderTargetType)) throw new Error(`unknown commander target type: ${redactText(targetType)}`)
  return { target_type: targetType as CommanderTargetType, target_id: targetId.trim() }
}

function found(input: { title: string; summary: string; status?: string; record_kind: string; related_ids: Record<string, string[] | undefined> }): Omit<CommanderTargetContext, "target_type" | "target_id" | "queue_membership" | "audit_event_count" | "recent_audit_events" | "suggested_commands"> {
  return {
    found: true,
    title: input.title,
    summary: input.summary,
    status: input.status,
    record_kind: input.record_kind,
    related_ids: relatedIds(input.related_ids),
    missing_links: [],
  }
}

function missing(targetType: CommanderTargetType, targetId: string): Omit<CommanderTargetContext, "target_type" | "target_id" | "queue_membership" | "audit_event_count" | "recent_audit_events" | "suggested_commands"> {
  return {
    found: false,
    title: `${targetType} ${targetId}`,
    summary: "target record not found",
    record_kind: targetType,
    related_ids: relatedIds({ [`${targetType}_id`]: [targetId] }),
    missing_links: [`${targetType} record not found: ${targetId}`],
  }
}

function suggestedCommands(targetType: CommanderTargetType, targetId: string, status: string | undefined, queues: string[], relatedIds: Record<string, string[]>): CommanderSuggestedCommand[] {
  const id = safe(targetId, TITLE_LIMIT)
  const missionId = relatedIds.mission_id?.[0] ?? id
  const commands: CommanderSuggestedCommand[] = []
  const add = (label: string, command: string, command_type: "read" | "write" = "read", extra: Partial<CommanderSuggestedCommand> = {}) => commands.push({ label, command, command_type, ...extra })
  if (targetType === "mission") {
    add("Open mission", `/mission ${id}`)
    add("Audit mission", `/audit mission ${id}`)
  } else if (targetType === "claim") {
    add("List claims", `/claims ${missionId}`)
    add("Audit claim", `/audit claim ${id}`)
    add("Propose release", `/propose-release ${id} <title> -- <reason>`, "write", { requires_review: true, requires_active_runtime: true })
  } else if (targetType === "result") {
    add("List results", `/results ${missionId}`)
    add("Audit result", `/audit result ${id}`)
    add("Draft completion", `/draft-complete ${missionId} ${id} <title> -- <summary>`, "write", { requires_review: true, requires_active_runtime: true })
  } else if (targetType === "review") {
    add("Open review", `/review ${id}`)
    add("Audit review", `/audit review ${id}`)
    if (status === "pending") {
      add("Approve review", `/approve ${id}`, "write", { requires_active_runtime: true })
      add("Reject review", `/reject ${id} <reason>`, "write", { requires_active_runtime: true })
    }
  } else if (targetType === "proposal") {
    add("Open proposal", `/proposal ${id}`)
    add("Request review", `/proposal-review ${id} <title> -- <summary>`, "write", { requires_review: true, requires_active_runtime: true })
    add("Preview apply", `/apply-preview proposal ${id}`)
    if (status === "approved") add("Apply proposal", `/apply-target proposal ${id}`, "write", { requires_review: true, requires_active_runtime: true })
  } else if (targetType === "bundle") {
    add("Open bundle", `/bundle ${id}`)
    add("Check readiness", `/bundle-ready ${id}`)
    add("Request reviews", `/bundle-review ${id}`, "write", { requires_review: true, requires_active_runtime: true })
    add("Preview apply", `/apply-preview bundle ${id}`)
    if (status === "approved") add("Apply bundle", `/apply-target bundle ${id}`, "write", { requires_review: true, requires_active_runtime: true })
  } else if (targetType === "draft") {
    add("Open draft", `/draft ${id}`)
    add("Check readiness", `/draft-ready ${id}`)
    add("Request reviews", `/draft-review ${id}`, "write", { requires_review: true, requires_active_runtime: true })
    add("Preview apply", `/apply-preview draft ${id}`)
    if (status !== "cancelled") add("Apply draft", `/apply-target draft ${id}`, "write", { requires_review: true, requires_active_runtime: true })
  } else {
    add("Runtime status", "/status")
    add("Audit runtime", `/audit runtime ${id}`)
  }
  for (const queue of queues) add(`Open ${queue}`, `/queue ${queue}`)
  return commands.slice(0, 12).map((command) => redactValue(command))
}

function mergeRelatedIds(...records: Record<string, string[]>[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const record of records) {
    for (const [key, values] of Object.entries(record)) out[key] = uniqueStrings([...(out[key] ?? []), ...values]).slice(0, RELATED_LIMIT)
  }
  return Object.fromEntries(Object.entries(out).filter(([, values]) => values.length > 0).sort(([a], [b]) => a.localeCompare(b)))
}

function relatedIds(value: Record<string, string[] | undefined>): Record<string, string[]> {
  return mergeRelatedIds(Object.fromEntries(Object.entries(value).map(([key, values]) => [key, (values ?? []).map((item) => safe(item, TITLE_LIMIT))])))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map((value) => safe(value, TITLE_LIMIT)))].sort()
}

function optionalArray(value?: string): string[] {
  return value ? [value] : []
}

function safe(value: string, max: number): string {
  const clean = redactText(value)
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}
