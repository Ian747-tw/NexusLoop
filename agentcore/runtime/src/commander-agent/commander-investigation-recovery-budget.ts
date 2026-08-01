import type { CommanderToolProfile } from "../commander-tools/commander-tool-types"
import { stableHash } from "./commander-model-schema"
import type { CommanderInvestigationCheckpoint, CommanderInvestigationModelStepStartedPayload } from "./commander-investigation-journal-types"
import type { CommanderInvestigationRecoveryContinuationBudget } from "./commander-investigation-recovery-execution-types"
import type { CommanderInvestigationRecoveryCurrentContextBudget } from "./commander-investigation-recovery-types"

export const COMMANDER_INVESTIGATION_HARD_CAPS = {
  max_model_turns: 24,
  max_tool_calls: 32,
  max_tool_search_calls: 8,
  max_loaded_schemas: 12,
  max_tool_calls_per_turn: 4,
  max_cumulative_tool_result_bytes: 96_000,
  max_wall_time_ms: 120_000,
  max_consecutive_no_progress_turns: 3,
  max_evidence_cards: 24,
  max_turn_summaries: 12,
} as const

export type CommanderInvestigationRecoveryCurrentPolicyLimits = {
  max_model_turns: number
  max_tool_calls: number
  max_tool_search_calls: number
  max_loaded_schemas: number
  max_tool_calls_per_turn: number
  max_cumulative_tool_result_bytes: number
  max_wall_time_ms: number
  max_consecutive_no_progress_turns: number
  max_evidence_cards: number
  max_turn_summaries: number
  max_context_bytes?: number
  max_context_tokens?: number
  tool_schema_allocation_bytes?: number
  tool_schema_allocation_tokens?: number
}

export function commanderInvestigationRecoveryCurrentPolicyLimits(input: {
  profile: CommanderToolProfile
  context: CommanderInvestigationRecoveryCurrentContextBudget
}): CommanderInvestigationRecoveryCurrentPolicyLimits {
  const { profile, context } = input
  return {
    max_model_turns: Math.min(COMMANDER_INVESTIGATION_HARD_CAPS.max_model_turns, Math.max(4, Math.ceil(profile.max_tool_calls_future / 2) + profile.max_tool_search_calls_future + 2)),
    max_tool_calls: Math.min(COMMANDER_INVESTIGATION_HARD_CAPS.max_tool_calls, profile.max_tool_calls_future),
    max_tool_search_calls: Math.min(COMMANDER_INVESTIGATION_HARD_CAPS.max_tool_search_calls, profile.max_tool_search_calls_future),
    max_loaded_schemas: Math.min(COMMANDER_INVESTIGATION_HARD_CAPS.max_loaded_schemas, profile.max_loaded_schemas),
    max_tool_calls_per_turn: COMMANDER_INVESTIGATION_HARD_CAPS.max_tool_calls_per_turn,
    max_cumulative_tool_result_bytes: Math.min(COMMANDER_INVESTIGATION_HARD_CAPS.max_cumulative_tool_result_bytes, profile.max_cumulative_result_bytes_future),
    max_wall_time_ms: Math.min(COMMANDER_INVESTIGATION_HARD_CAPS.max_wall_time_ms, profile.max_wall_time_ms_future),
    max_consecutive_no_progress_turns: COMMANDER_INVESTIGATION_HARD_CAPS.max_consecutive_no_progress_turns,
    max_evidence_cards: COMMANDER_INVESTIGATION_HARD_CAPS.max_evidence_cards,
    max_turn_summaries: COMMANDER_INVESTIGATION_HARD_CAPS.max_turn_summaries,
    max_context_bytes: context.input_context_bytes,
    max_context_tokens: context.input_context_tokens,
    tool_schema_allocation_bytes: context.tool_schema_allocation_bytes,
    tool_schema_allocation_tokens: context.tool_schema_allocation_tokens,
  }
}

export function deriveCommanderInvestigationRecoveryContinuationBudget(input: {
  checkpoint: CommanderInvestigationCheckpoint
  current_policy_limits: Partial<CommanderInvestigationRecoveryCurrentPolicyLimits>
  pending_model_step?: CommanderInvestigationModelStepStartedPayload
}): CommanderInvestigationRecoveryContinuationBudget {
  const { checkpoint, current_policy_limits: limits } = input
  const stored = checkpoint.budget
  const uncertainCharge = input.pending_model_step ? 1 : 0
  const unresolvedAttempts = input.pending_model_step ? 1 : 0
  const budget = {
    ...stored,
    max_model_turns: boundedCurrentLimit(limits.max_model_turns, stored.max_model_turns),
    max_tool_calls: boundedCurrentLimit(limits.max_tool_calls, stored.max_tool_calls),
    max_tool_search_calls: boundedCurrentLimit(limits.max_tool_search_calls, stored.max_tool_search_calls),
    max_loaded_schemas: boundedCurrentLimit(limits.max_loaded_schemas, stored.max_loaded_schemas),
    max_tool_calls_per_turn: boundedCurrentLimit(limits.max_tool_calls_per_turn, stored.max_tool_calls_per_turn),
    max_cumulative_tool_result_bytes: boundedCurrentLimit(limits.max_cumulative_tool_result_bytes, stored.max_cumulative_tool_result_bytes),
    max_wall_time_ms: boundedCurrentLimit(limits.max_wall_time_ms, stored.max_wall_time_ms),
    max_consecutive_no_progress_turns: boundedCurrentLimit(limits.max_consecutive_no_progress_turns, stored.max_consecutive_no_progress_turns),
    max_evidence_cards: boundedCurrentLimit(limits.max_evidence_cards, stored.max_evidence_cards),
    max_turn_summaries: boundedCurrentLimit(limits.max_turn_summaries, stored.max_turn_summaries),
    max_context_bytes: boundedOptionalCurrentLimit(limits.max_context_bytes, stored.max_context_bytes),
    max_context_tokens: boundedOptionalCurrentLimit(limits.max_context_tokens, stored.max_context_tokens),
    tool_schema_allocation_bytes: boundedOptionalCurrentLimit(limits.tool_schema_allocation_bytes, stored.tool_schema_allocation_bytes),
    tool_schema_allocation_tokens: boundedOptionalCurrentLimit(limits.tool_schema_allocation_tokens, stored.tool_schema_allocation_tokens),
    budget_hash: "",
  }
  budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
  const consumed = {
    model_turns: checkpoint.working_set.model_turn_count + uncertainCharge,
    provider_requests: checkpoint.provider_request_count,
    tool_calls: checkpoint.working_set.tool_call_count,
    tool_search_calls: checkpoint.working_set.tool_search_call_count,
    cumulative_tool_result_bytes: checkpoint.working_set.cumulative_tool_result_bytes,
    elapsed_active_ms: checkpoint.elapsed_active_ms,
    evidence_cards: checkpoint.working_set.evidence_cards.length + checkpoint.working_set.omitted_evidence_count,
    turn_summaries: checkpoint.turn_summaries.length + checkpoint.working_set.omitted_turn_count,
    consecutive_no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns,
    loaded_schemas: checkpoint.loaded_tools.length,
  }
  const remaining = {
    model_turns: budget.max_model_turns - consumed.model_turns,
    tool_calls: budget.max_tool_calls - consumed.tool_calls,
    tool_search_calls: budget.max_tool_search_calls - consumed.tool_search_calls,
    cumulative_tool_result_bytes: budget.max_cumulative_tool_result_bytes - consumed.cumulative_tool_result_bytes,
    wall_time_ms: budget.max_wall_time_ms - consumed.elapsed_active_ms,
    evidence_cards: budget.max_evidence_cards - checkpoint.working_set.evidence_cards.length,
    turn_summaries: budget.max_turn_summaries - checkpoint.turn_summaries.length,
    loaded_schemas: budget.max_loaded_schemas - consumed.loaded_schemas,
  }
  const exhaustedDimensions = Object.entries(remaining)
    .filter(([key, value]) => key === "model_turns" || key === "wall_time_ms" ? value <= 0 : value < 0)
    .map(([key]) => key)
  const stricterDimensions = Object.entries(limits)
    .filter(([key, value]) => {
      const storedValue = (stored as unknown as Record<string, unknown>)[key]
      return typeof value === "number" && typeof storedValue === "number" && value < storedValue
    })
    .map(([key]) => key)
    .sort()
  const result: CommanderInvestigationRecoveryContinuationBudget = {
    original_budget_id: stored.budget_id,
    original_budget_hash: stored.budget_hash,
    effective_budget: budget,
    effective_budget_hash: budget.budget_hash,
    consumed,
    remaining,
    uncertain_model_turn_charge: uncertainCharge,
    unresolved_provider_attempt_count: unresolvedAttempts,
    stricter_current_policy_dimensions: stricterDimensions,
    exhausted_dimensions: exhaustedDimensions,
    budget_hash: "",
  }
  result.budget_hash = stableHash({ ...result, budget_hash: "" })
  return result
}

function boundedCurrentLimit(current: number | undefined, stored: number): number {
  return typeof current === "number" && Number.isFinite(current) ? Math.min(stored, Math.max(0, Math.floor(current))) : stored
}

function boundedOptionalCurrentLimit(current: number | undefined, stored: number | undefined): number | undefined {
  if (typeof current !== "number" || !Number.isFinite(current)) return stored
  return stored === undefined ? Math.max(0, Math.floor(current)) : Math.min(stored, Math.max(0, Math.floor(current)))
}
