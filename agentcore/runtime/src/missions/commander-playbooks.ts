import { redactText, redactValue } from "../security/redaction"
import type { ProposalBundleRegistry } from "./proposal-bundle-registry"
import type { ProposalRegistry } from "./proposal-registry"
import type { CommanderProposalInput, ProposalActionKind } from "./proposal-types"
import type {
  CommanderPlaybook,
  CommanderPlaybookDraftInput,
  CommanderPlaybookDraftResult,
  CommanderPlaybookField,
} from "./commander-playbook-types"

export interface DraftCommanderPlaybookOptions {
  proposalRegistry: ProposalRegistry
  proposalBundleRegistry: ProposalBundleRegistry
  now?: () => Date
}

const COMPLETE_FROM_RESULT_FIELDS = [
  field("mission_id", "Mission ID", "mission_id"),
  field("result_id", "Result ID", "result_id"),
  field("title", "Title", "title"),
  field("summary", "Summary", "summary"),
]

const SUBMIT_RESULT_AND_COMPLETE_FIELDS = [
  field("mission_id", "Mission ID", "mission_id"),
  field("claim_id", "Claim ID", "claim_id"),
  field("result_summary", "Result summary", "summary"),
  field("completion_summary", "Completion summary", "summary"),
  field("title", "Title", "title"),
]

const RECORD_PROGRESS_FIELDS = [
  field("mission_id", "Mission ID", "mission_id"),
  field("claim_id", "Claim ID", "claim_id"),
  field("message", "Message", "text"),
  field("title", "Title", "title"),
]

const FAIL_MISSION_FIELDS = [
  field("mission_id", "Mission ID", "mission_id"),
  field("reason", "Reason", "reason"),
  field("title", "Title", "title"),
]

const CANCEL_MISSION_FIELDS = [
  field("mission_id", "Mission ID", "mission_id"),
  field("reason", "Reason", "reason"),
  field("title", "Title", "title"),
]

const RELEASE_CLAIM_FIELDS = [
  field("claim_id", "Claim ID", "claim_id"),
  field("reason", "Reason", "reason"),
  field("title", "Title", "title"),
]

export const COMMANDER_PLAYBOOK_CATALOG: readonly CommanderPlaybook[] = Object.freeze([
  playbook(
    "complete-from-result",
    "Complete mission from result",
    "Drafts a complete_mission proposal that references an existing mission result.",
    COMPLETE_FROM_RESULT_FIELDS,
    ["complete_mission"],
    false,
  ),
  playbook(
    "submit-result-and-complete",
    "Submit result and complete mission",
    "Drafts submit_result and complete_mission proposals as an ordered bundle.",
    SUBMIT_RESULT_AND_COMPLETE_FIELDS,
    ["submit_result", "complete_mission"],
    true,
  ),
  playbook(
    "record-progress",
    "Record mission progress",
    "Drafts a record_progress proposal for an active mission claim.",
    RECORD_PROGRESS_FIELDS,
    ["record_progress"],
    false,
  ),
  playbook(
    "fail-mission",
    "Fail mission",
    "Drafts a fail_mission proposal with an explicit reason.",
    FAIL_MISSION_FIELDS,
    ["fail_mission"],
    false,
  ),
  playbook(
    "cancel-mission",
    "Cancel mission",
    "Drafts a cancel_mission proposal with an explicit reason.",
    CANCEL_MISSION_FIELDS,
    ["cancel_mission"],
    false,
  ),
  playbook(
    "release-claim",
    "Release claim",
    "Drafts a release_claim proposal with an explicit reason.",
    RELEASE_CLAIM_FIELDS,
    ["release_claim"],
    false,
  ),
])

export function listCommanderPlaybooks(): CommanderPlaybook[] {
  return redactValue([...COMMANDER_PLAYBOOK_CATALOG])
}

export function getCommanderPlaybook(playbookId: string): CommanderPlaybook | null {
  const id = cleanRequiredString(playbookId, "playbook_id")
  return redactValue(COMMANDER_PLAYBOOK_CATALOG.find((item) => item.playbook_id === id) ?? null)
}

export async function draftCommanderPlaybook(input: CommanderPlaybookDraftInput, options: DraftCommanderPlaybookOptions): Promise<CommanderPlaybookDraftResult> {
  const playbook = requirePlaybook(input.playbook_id)
  const fields = readFields(input.fields)
  const proposedBy = redactText(cleanRequiredString(input.proposed_by ?? input.requested_by, "proposed_by"))
  const requestedBy = redactText(cleanRequiredString(input.requested_by ?? input.proposed_by, "requested_by"))
  const createBundle = input.create_bundle === true || playbook.generated_action_kinds.length > 1
  const requestReviews = input.request_reviews === true
  validateRequiredFields(playbook, fields)

  const createdAt = (options.now ?? (() => new Date()))().toISOString()
  const proposalInputs = proposalInputsForPlaybook(playbook.playbook_id, fields, proposedBy)
  const proposals = []
  for (const proposalInput of proposalInputs) {
    proposals.push(await options.proposalRegistry.createProposal(proposalInput))
  }

  let bundleId: string | undefined
  if (createBundle) {
    const bundle = await options.proposalBundleRegistry.createBundle({
      title: input.bundle_title ?? defaultBundleTitle(playbook, fields),
      summary: input.bundle_summary ?? defaultBundleSummary(playbook, fields),
      created_by: proposedBy,
    })
    bundleId = bundle.bundle_id
    for (const proposal of proposals) {
      await options.proposalBundleRegistry.addProposal(bundle.bundle_id, proposal.proposal_id)
    }
  }

  let reviewIds: string[] | undefined
  if (requestReviews) {
    if (bundleId) {
      await options.proposalBundleRegistry.requestReviews(bundleId, { requested_by: requestedBy })
      reviewIds = await reviewIdsForProposals(options.proposalRegistry, proposals.map((proposal) => proposal.proposal_id))
    } else {
      reviewIds = []
      for (const proposal of proposals) {
        const reviewed = await options.proposalRegistry.requestReview(proposal.proposal_id, { requested_by: requestedBy })
        if (reviewed.review_id) reviewIds.push(reviewed.review_id)
      }
    }
  }

  return redactValue({
    playbook_id: playbook.playbook_id,
    proposal_ids: proposals.map((proposal) => proposal.proposal_id),
    bundle_id: bundleId,
    review_ids: reviewIds,
    created_at: createdAt,
  })
}

function proposalInputsForPlaybook(playbookId: string, fields: Record<string, string>, proposedBy: string): CommanderProposalInput[] {
  switch (playbookId) {
    case "complete-from-result":
      return [{
        mission_id: fields.mission_id,
        result_id: fields.result_id,
        action_kind: "complete_mission",
        title: fields.title,
        summary: fields.summary,
        proposed_by: proposedBy,
        action_payload: { mission_id: fields.mission_id, result_id: fields.result_id, summary: fields.summary },
      }]
    case "submit-result-and-complete":
      return [
        {
          mission_id: fields.mission_id,
          claim_id: fields.claim_id,
          action_kind: "submit_result",
          title: fields.title,
          summary: fields.result_summary,
          proposed_by: proposedBy,
          action_payload: { mission_id: fields.mission_id, claim_id: fields.claim_id, summary: fields.result_summary },
        },
        {
          mission_id: fields.mission_id,
          action_kind: "complete_mission",
          title: fields.title,
          summary: fields.completion_summary,
          proposed_by: proposedBy,
          action_payload: { mission_id: fields.mission_id, summary: fields.completion_summary },
        },
      ]
    case "record-progress":
      return [{
        mission_id: fields.mission_id,
        claim_id: fields.claim_id,
        action_kind: "record_progress",
        title: fields.title,
        summary: fields.message,
        proposed_by: proposedBy,
        action_payload: { mission_id: fields.mission_id, claim_id: fields.claim_id, message: fields.message },
      }]
    case "fail-mission":
      return [{
        mission_id: fields.mission_id,
        action_kind: "fail_mission",
        title: fields.title,
        summary: fields.reason,
        proposed_by: proposedBy,
        action_payload: { mission_id: fields.mission_id, reason: fields.reason },
      }]
    case "cancel-mission":
      return [{
        mission_id: fields.mission_id,
        action_kind: "cancel_mission",
        title: fields.title,
        summary: fields.reason,
        proposed_by: proposedBy,
        action_payload: { mission_id: fields.mission_id, reason: fields.reason },
      }]
    case "release-claim":
      return [{
        claim_id: fields.claim_id,
        action_kind: "release_claim",
        title: fields.title,
        summary: fields.reason,
        proposed_by: proposedBy,
        action_payload: { claim_id: fields.claim_id, reason: fields.reason },
      }]
    default:
      throw new Error(`unknown commander playbook: ${playbookId}`)
  }
}

async function reviewIdsForProposals(proposalRegistry: ProposalRegistry, proposalIds: string[]): Promise<string[]> {
  const reviewIds: string[] = []
  for (const proposalId of proposalIds) {
    const proposal = await proposalRegistry.getProposal(proposalId)
    if (proposal?.review_id) reviewIds.push(proposal.review_id)
  }
  return reviewIds
}

function validateRequiredFields(playbook: CommanderPlaybook, fields: Record<string, string>): void {
  for (const requiredField of playbook.required_fields.filter((item) => item.required)) {
    cleanRequiredString(fields[requiredField.name], requiredField.name)
  }
}

function defaultBundleTitle(playbook: CommanderPlaybook, fields: Record<string, string>): string {
  return fields.title ?? playbook.title
}

function defaultBundleSummary(playbook: CommanderPlaybook, fields: Record<string, string>): string {
  return fields.completion_summary ?? fields.summary ?? fields.reason ?? playbook.description
}

function requirePlaybook(playbookId: string): CommanderPlaybook {
  const id = cleanRequiredString(playbookId, "playbook_id")
  const playbook = COMMANDER_PLAYBOOK_CATALOG.find((item) => item.playbook_id === id)
  if (!playbook) throw new Error(`unknown commander playbook: ${id}`)
  return playbook
}

function readFields(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error("fields must be an object")
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) out[cleanRequiredString(key, "field name")] = cleanRequiredString(raw, key)
  return out
}

function field(name: string, label: string, fieldType: CommanderPlaybookField["field_type"]): CommanderPlaybookField {
  return { name, label, required: true, field_type: fieldType }
}

function playbook(
  playbookId: string,
  title: string,
  description: string,
  requiredFields: CommanderPlaybookField[],
  generatedActionKinds: ProposalActionKind[],
  createsBundle: boolean,
): CommanderPlaybook {
  return {
    playbook_id: playbookId,
    title,
    description,
    required_fields: requiredFields,
    generated_action_kinds: generatedActionKinds,
    creates_bundle: createsBundle,
  }
}

function cleanRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} is required`)
  return redactText(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
