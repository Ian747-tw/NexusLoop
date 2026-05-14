import { MISSION_TOOL_NAMES, type MissionToolName } from "../missions/mission-tool-types"
import { redactText } from "../security/redaction"

export const OPEN_CODE_SESSION_CONTRACT_VERSION = 1

export const OPEN_CODE_INPUT_ENVELOPE_TYPES = [
  "nxl.session_start",
  "nxl.mission_packet",
  "nxl.executor_tool_result",
] as const

export const OPEN_CODE_OUTPUT_ENVELOPE_TYPES = [
  "nxl.executor_tool_call",
] as const

export type OpenCodeInputEnvelopeType = (typeof OPEN_CODE_INPUT_ENVELOPE_TYPES)[number]
export type OpenCodeOutputEnvelopeType = (typeof OPEN_CODE_OUTPUT_ENVELOPE_TYPES)[number]

export interface OpenCodeSessionContractInput {
  projectDir: string
  objective: string
}

export interface OpenCodeSessionContractRules {
  jsonlToolCalls: string
  missionAuthority: string
  diagnosticStdout: string
  toolResultSource: string
  secretHandling: string
  completionFlow: string
  progressFlow: string
  claimFlow: string
  failureFlow: string
  cancellationFlow: string
  unknownTools: string
}

export interface OpenCodeSessionContract {
  protocolVersion: typeof OPEN_CODE_SESSION_CONTRACT_VERSION
  projectDir: string
  objective: string
  allowedToolNames: readonly MissionToolName[]
  inputEnvelopeTypes: readonly OpenCodeInputEnvelopeType[]
  outputEnvelopeTypes: readonly OpenCodeOutputEnvelopeType[]
  rules: OpenCodeSessionContractRules
  prompt: string
}

export function buildOpenCodeSessionContract(input: OpenCodeSessionContractInput): OpenCodeSessionContract {
  const contractWithoutPrompt = {
    protocolVersion: OPEN_CODE_SESSION_CONTRACT_VERSION,
    projectDir: redactText(input.projectDir),
    objective: redactText(input.objective),
    allowedToolNames: [...MISSION_TOOL_NAMES],
    inputEnvelopeTypes: [...OPEN_CODE_INPUT_ENVELOPE_TYPES],
    outputEnvelopeTypes: [...OPEN_CODE_OUTPUT_ENVELOPE_TYPES],
    rules: buildContractRules(),
  } satisfies Omit<OpenCodeSessionContract, "prompt">

  return {
    ...contractWithoutPrompt,
    prompt: renderOpenCodeSessionPrompt(contractWithoutPrompt),
  }
}

function buildContractRules(): OpenCodeSessionContractRules {
  return {
    jsonlToolCalls: "Emit one JSON object per line only when sending a structured nxl.executor_tool_call envelope.",
    missionAuthority: "Do not invent mission state. Mission authority belongs to RuntimeServer/MissionRegistry.",
    diagnosticStdout: "Child prose/stdout is diagnostic only and is not authoritative unless it is a structured tool call.",
    toolResultSource: "Tool results must be read from nxl.executor_tool_result input envelopes.",
    secretHandling: "Do not echo raw secrets into diagnostic stdout.",
    claimFlow: "Use mission.claim before performing mission work that requires a claim.",
    progressFlow: "Use mission.record_progress for progress updates and mission.submit_result for mission results.",
    completionFlow: "Mission completion flow is mission.claim -> mission.record_progress/mission.submit_result -> mission.complete.",
    failureFlow: "Use mission.fail for mission failure.",
    cancellationFlow: "Use mission.cancel for mission cancellation.",
    unknownTools: "Unknown tools are invalid.",
  }
}

function renderOpenCodeSessionPrompt(contract: Omit<OpenCodeSessionContract, "prompt">): string {
  return [
    "NexusLoop OpenCode session contract",
    `Protocol version: ${contract.protocolVersion}`,
    `Project directory: ${contract.projectDir}`,
    `Objective: ${contract.objective}`,
    `Input envelope types: ${contract.inputEnvelopeTypes.join(", ")}`,
    `Output envelope types: ${contract.outputEnvelopeTypes.join(", ")}`,
    `Allowed mission tools: ${contract.allowedToolNames.join(", ")}`,
    "Rules:",
    ...Object.values(contract.rules).map((rule) => `- ${rule}`),
  ].join("\n")
}
