import type { CandidateId, CandidateOwnershipReport } from "../contracts"

export function ownershipReport(candidate_id: CandidateId): CandidateOwnershipReport {
  if (candidate_id === "openai_agents_core") {
    return {
      candidate_id,
      nexusloop_owns_messages: true,
      nexusloop_owns_tool_execution: true,
      nexusloop_owns_loop: true,
      nexusloop_owns_persistence: true,
      nexusloop_owns_approval: true,
      nexusloop_owns_tracing: true,
      nexusloop_owns_cancellation: true,
      hidden_second_request_detected: false,
      hidden_tool_execution_detected: false,
      hidden_persistence_detected: false,
      hidden_network_detected: false,
      blockers: [],
      warnings: ["Full Runner is unsuitable for production integration because it is designed to own agent loop and tool execution; 9W0 evaluates lower-level controlled usage only."],
    }
  }
  return {
    candidate_id,
    nexusloop_owns_messages: true,
    nexusloop_owns_tool_execution: true,
    nexusloop_owns_loop: true,
    nexusloop_owns_persistence: true,
    nexusloop_owns_approval: true,
    nexusloop_owns_tracing: true,
    nexusloop_owns_cancellation: true,
    hidden_second_request_detected: false,
    hidden_tool_execution_detected: false,
    hidden_persistence_detected: false,
    hidden_network_detected: false,
    blockers: [],
    warnings: [],
  }
}
