import { redactText } from "../security/redaction"
import type { OpenCodeResultReviewPacket } from "../opencode/opencode-result-review-packet-types"
import type { CommandAuthoritySummary } from "../authority/command-authority-types"
import type {
  CommanderExecutorReviewCommand,
  CommanderExecutorReviewDecision,
  CommanderExecutorReviewFinding,
} from "./commander-executor-review-types"

export type CommanderExecutorReviewProviderInput = {
  packet: OpenCodeResultReviewPacket
  authority_summary?: CommandAuthoritySummary
  max_output_chars: number
  instruction_version: string
}

export type CommanderExecutorReviewProviderResult = {
  decision: CommanderExecutorReviewDecision
  confidence: number
  summary: string
  findings: CommanderExecutorReviewFinding[]
  recommended_commands?: CommanderExecutorReviewCommand[]
  raw_response_preview?: string
}

export interface CommanderExecutorReviewProvider {
  readonly provider_id: string
  reviewExecutorResult(input: CommanderExecutorReviewProviderInput): Promise<CommanderExecutorReviewProviderResult>
}

export class FakeCommanderExecutorReviewProvider implements CommanderExecutorReviewProvider {
  readonly provider_id = "fake-commander-executor-review"

  async reviewExecutorResult(input: CommanderExecutorReviewProviderInput): Promise<CommanderExecutorReviewProviderResult> {
    const packet = input.packet
    const evidenceIds = packet.evidence.map((item) => item.evidence_id).slice(0, 8)
    const ready = packet.status === "ready_for_commander_review"
    const command = packet.result_id
      ? `/result-review-packet result=${packet.result_id}`
      : packet.mission_id
        ? `/result-review-packet mission=${packet.mission_id}`
        : "/result-review-packet"
    return {
      decision: ready ? "accept_result" : "blocked",
      confidence: ready ? 0.82 : 0.28,
      summary: redactText(
        ready
          ? `Deterministic Commander review accepted packet ${packet.packet_id} for manual follow-up.`
          : `Deterministic Commander review blocked packet ${packet.packet_id} because it is not ready.`,
      ),
      findings: [{
        finding_id: "finding_executor_packet_readiness",
        severity: ready ? "info" : "blocker",
        title: "Executor packet readiness",
        summary: ready
          ? `Packet includes ${evidenceIds.length} bounded evidence records and no hard blockers.`
          : `Packet status is ${packet.status}; Commander review cannot produce an action proposal.`,
        evidence_ids: evidenceIds,
        recommended_commands: [{ label: "Reopen result review packet", command, command_type: "read" }],
      }],
      recommended_commands: [
        { label: "Inspect result packet", command, command_type: "read" },
        { label: "Inspect handoff readiness", command: packet.handoff_id ? `/handoff-readiness handoff=${packet.handoff_id}` : "/handoff-readiness", command_type: "read" },
        { label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" },
      ],
      raw_response_preview: "fake provider returned schema-valid Commander executor review",
    }
  }
}
