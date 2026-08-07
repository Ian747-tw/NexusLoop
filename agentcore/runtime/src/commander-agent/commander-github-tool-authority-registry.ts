import type { CommandAuthorityRecord } from "../authority/command-authority-types"
import { COMMANDER_GITHUB_READ_TOOL_IDS } from "../commander-tools/commander-github-read-types"

const profile: CommandAuthorityRecord["validation_profile"] = {
  unit_runtime: true, unit_tui: false, typecheck_runtime: true, typecheck_tui: false, integration_cli: false,
  targeted_e2e: ["tests/e2e_user/scenarios/test_commander_github_read_gateway_tui.py"], optional_regression_e2e: [],
  full_e2e_required_when: ["Commander external-read authority changes require release-gate validation."], live_provider_required: false, real_opencode_required: false,
}

export const COMMANDER_GITHUB_TOOL_AUTHORITY_RECORDS: CommandAuthorityRecord[] = COMMANDER_GITHUB_READ_TOOL_IDS.map((toolId) => ({
  authority_id: `commander_tool_authority_${toolId.replace(/[^a-z0-9]+/gi, "_")}`,
  // This is an internal binding identity, not a command-dispatch route.
  slash_command: "/commander-tool-external-read",
  aliases: [], risk: "safe_read", gate: "external_api_runtime", owner: "commander_tools",
  mutates_events: false, creates_external_process: false, calls_provider: false,
  requires_active_runtime: true, requires_run_lock: true, requires_approval: false,
  expected_event_kinds: ["external_api_request_executed", "external_api_request_failed"],
  blocked_by_default: true, current_phase_status: "implemented", recommended_reads: ["/commander-tool-show"], validation_profile: profile,
  notes: ["Internal Commander binding authority for one exact bounded GitHub read descriptor. It is not a public slash command or generic GitHub browser."],
  out_of_scope: ["GitHub mutation", "arbitrary REST/GraphQL", "search", "provider calls", "approval authority"],
}))

export function commanderGithubToolAuthority(toolId: string): CommandAuthorityRecord | undefined {
  return COMMANDER_GITHUB_TOOL_AUTHORITY_RECORDS.find((record) => record.authority_id.endsWith(toolId.replace(/[^a-z0-9]+/gi, "_")))
}
