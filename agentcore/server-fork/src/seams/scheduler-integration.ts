/**
 * seams/scheduler-integration.ts
 * ------------------------------
 * Tier-2 seam: outer scheduler (two-tier scheduling, ADR-008).
 *
 * The outer scheduler operates at cycle granularity (minute-to-hour scale).
 * Proposals come from the LLM (Decision Principle); TS only ranks/picks.
 *
 * Schema locked: ADR-008
 * Surface locked: SEAM_CONTRACT_TIER2.md
 */
import { z } from 'zod';
import type { ResearchNamespace, CycleProposal } from './research-state';

// ---------------------------------------------------------------------------
// CycleDriverHooks (inlined — not counted as export to stay within budget)
// ---------------------------------------------------------------------------

type CycleDriverHooks = {
  onCycleStart?: (brief: string, cycleId: string) => void;
  onTurnEnd?: (turn: number) => void;
  onCycleEnd?: (cycleId: string) => void;
};

// Decision type inferred inline (avoids extra const export)
const _SchedulerDecisionSchema = z.object({
  selected_hypothesis_id: z.string().nullable(),
  reason: z.string(),
});

// ---------------------------------------------------------------------------
// Priority queue entry with ranking metadata
// ---------------------------------------------------------------------------

interface RankedProposal {
  proposal: CycleProposal;
  score: number;
}

// ---------------------------------------------------------------------------
// OuterScheduler
// ---------------------------------------------------------------------------

export class OuterScheduler {
  private _queue: RankedProposal[] = [];
  private _hooks: CycleDriverHooks = {};
  private _registered = false;

  registerWithCycleDriver(hooks: CycleDriverHooks): void {
    if (this._registered) return;
    this._hooks = { ...hooks };
    this._registered = true;
  }

  enqueueProposal(proposal: CycleProposal): void {
    this._queue.push({ proposal, score: this._rank(proposal) });
  }

  tick(ns: ResearchNamespace): z.infer<typeof _SchedulerDecisionSchema> {
    if (this._queue.length === 0) {
      return { selected_hypothesis_id: null, reason: 'queue_empty' };
    }

    const runningHypothesisId = ns.current_cycle?.hypothesis_id ?? null;

    const eligible = this._queue.filter(
      (rp) => rp.proposal.hypothesis_id !== runningHypothesisId,
    );

    if (eligible.length === 0) {
      return {
        selected_hypothesis_id: runningHypothesisId,
        reason: 'only_running_hypothesis',
      };
    }

    eligible.sort((a, b) => b.score - a.score);

    const winner = eligible[0]!.proposal;

    this._queue = this._queue.filter(
      (rp) => rp.proposal.cycle_proposal_id !== winner.cycle_proposal_id,
    );

    return {
      selected_hypothesis_id: winner.hypothesis_id,
      reason: `top_ranked:${winner.proposed_by}`,
    };
  }

  private _rank(proposal: CycleProposal): number {
    const sourceBonus = proposal.proposed_by === 'llm' ? 1.0 : 0.0;
    const priorityScore = Math.max(0, Math.min(1, proposal.priority));
    return priorityScore + sourceBonus;
  }
}
