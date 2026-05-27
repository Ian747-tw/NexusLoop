import { redactText } from "../security/redaction"
import type { CommanderCycleRecommendedAction } from "./commander-cycle-types"

export interface CommanderCycleProviderEvidence {
  evidence_id: string
  evidence_type: "source" | "note" | "artifact"
  title: string
  content: string
  created_at?: string
}

export interface CommanderCycleProviderSynthesis {
  synthesis_id: string
  title: string
  summary: string
  created_at?: string
}

export interface CommanderCycleProviderQueueItem {
  target_type: string
  target_id: string
  title: string
  status: string
  created_at?: string
}

export interface CommanderCycleProviderInput {
  cycle_id: string
  objective?: string
  topic_id?: string
  mission_id?: string
  topic_title?: string
  sources: CommanderCycleProviderEvidence[]
  notes: CommanderCycleProviderEvidence[]
  artifacts: CommanderCycleProviderEvidence[]
  syntheses: CommanderCycleProviderSynthesis[]
  queue_items: CommanderCycleProviderQueueItem[]
  max_output_bytes: number
  requested_by: string
}

export interface CommanderCycleProviderResult {
  title: string
  summary: string
  findings: string[]
  risks: string[]
  recommended_actions: CommanderCycleRecommendedAction[]
  should_create_proposals?: boolean
  confidence: "low" | "medium" | "high"
}

export interface CommanderCycleProvider {
  provider_id: string
  run(input: CommanderCycleProviderInput): Promise<CommanderCycleProviderResult>
}

export class FakeCommanderCycleProvider implements CommanderCycleProvider {
  readonly provider_id = "fake-commander-cycle"

  async run(input: CommanderCycleProviderInput): Promise<CommanderCycleProviderResult> {
    const evidenceIds = [...input.sources, ...input.notes, ...input.artifacts].map((item) => item.evidence_id)
    const synthesisIds = input.syntheses.map((item) => item.synthesis_id)
    return {
      title: redactText(`Commander cycle for ${input.topic_id ?? input.mission_id ?? "operator objective"}`),
      summary: redactText(`Deterministic commander cycle reviewed ${evidenceIds.length} evidence records and ${synthesisIds.length} syntheses.`),
      findings: [
        `Evidence records considered: ${evidenceIds.length}`,
        `Synthesis records considered: ${synthesisIds.length}`,
      ],
      risks: ["Fake provider does not execute proposals or mutate missions."],
      recommended_actions: [{
        title: "Operator checkpoint",
        summary: "Review the bounded commander cycle recommendations before requesting reviews or apply.",
        action_kind: "operator_checkpoint",
        rationale: "Human checkpoint preserves review/apply authority.",
        evidence_ids: evidenceIds.slice(0, 5),
        synthesis_ids: synthesisIds.slice(0, 5),
        related_target_type: input.mission_id ? "mission" : input.topic_id ? "topic" : undefined,
        related_target_id: input.mission_id ?? input.topic_id,
      }],
      should_create_proposals: false,
      confidence: evidenceIds.length + synthesisIds.length > 0 ? "medium" : "low",
    }
  }
}
