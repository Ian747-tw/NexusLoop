import { redactText } from "../security/redaction"
import type { ResearchSynthesisConfidence, ResearchSynthesisRecommendedAction } from "./research-synthesis-types"

export interface ResearchSynthesisProviderEvidence {
  evidence_id: string
  evidence_type: "source" | "note" | "artifact" | "ingestion"
  title: string
  content: string
  created_at?: string
}

export interface ResearchSynthesisProviderInput {
  topic_id: string
  topic_title: string
  objective?: string
  sources: ResearchSynthesisProviderEvidence[]
  notes: ResearchSynthesisProviderEvidence[]
  artifacts: ResearchSynthesisProviderEvidence[]
  ingestions: ResearchSynthesisProviderEvidence[]
  max_output_bytes: number
  requested_by: string
}

export interface ResearchSynthesisProviderResult {
  title: string
  summary: string
  findings: string[]
  risks: string[]
  open_questions: string[]
  recommended_actions: ResearchSynthesisRecommendedAction[]
  confidence: ResearchSynthesisConfidence
}

export interface ResearchSynthesisProvider {
  readonly provider_id: string
  synthesize(input: ResearchSynthesisProviderInput): Promise<ResearchSynthesisProviderResult>
}

export class FakeResearchSynthesisProvider implements ResearchSynthesisProvider {
  readonly provider_id = "fake-research-synthesis"

  async synthesize(input: ResearchSynthesisProviderInput): Promise<ResearchSynthesisProviderResult> {
    const allEvidence = [...input.sources, ...input.notes, ...input.artifacts, ...input.ingestions]
    const evidenceIds = allEvidence.map((item) => item.evidence_id).slice(0, 8)
    const objective = input.objective ? ` Objective: ${redactText(input.objective)}` : ""
    return {
      title: redactText(`Synthesis for ${input.topic_title}`),
      summary: redactText(`Deterministic synthesis over ${allEvidence.length} evidence records.${objective}`),
      findings: [
        redactText(`Evidence records considered: ${allEvidence.length}`),
        redactText(`Primary evidence ids: ${evidenceIds.join(", ") || "none"}`),
      ],
      risks: [allEvidence.length === 0 ? "No evidence was available." : "Fake provider does not make real-world claims."],
      open_questions: ["Operator should review whether the evidence is sufficient for the next decision."],
      recommended_actions: [{
        title: "Operator checkpoint",
        summary: redactText(`Review synthesis for topic ${input.topic_id} before any follow-on action.`),
        action_kind: "operator_checkpoint",
        evidence_ids: evidenceIds,
      }],
      confidence: allEvidence.length > 2 ? "medium" : "low",
    }
  }
}
