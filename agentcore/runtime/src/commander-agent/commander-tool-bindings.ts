import { COMMANDER_TOOL_REGISTRY } from "../commander-tools/commander-tool-registry"
import type { CommanderToolDescriptor } from "../commander-tools/commander-tool-types"
import type { CommanderToolBinding, CommanderToolBindingDependencies, CommanderToolBindingRegistry } from "./commander-tool-execution-types"

export const COMMANDER_BOUND_TOOL_IDS = [
  "commander.tool_search",
  "commander.tool_get",
  "commander.tool_profile",
  "authority.describe",
  "memory.search",
  "continuity.search",
  "repo.search_text",
  "repo.read_lines",
  "repo.git_status",
  "repo.git_diff",
] as const

export type CommanderBoundToolId = typeof COMMANDER_BOUND_TOOL_IDS[number]

export function createCommanderToolBindingRegistry(deps: CommanderToolBindingDependencies, descriptors: CommanderToolDescriptor[] = COMMANDER_TOOL_REGISTRY): CommanderToolBindingRegistry {
  const descriptor = (toolId: CommanderBoundToolId) => {
    const found = descriptors.find((item) => item.tool_id === toolId)
    if (!found) throw new Error(`missing Commander tool descriptor ${toolId}`)
    return found
  }
  const make = (toolId: CommanderBoundToolId, execute: CommanderToolBinding["execute"]): CommanderToolBinding => {
    const tool = descriptor(toolId)
    return { tool_id: toolId, descriptor_version: tool.version, descriptor_schema_hash: tool.schema_metadata.input_schema_hash, execute }
  }
  const bindings: CommanderToolBinding[] = [
    make("commander.tool_search", (_ctx, args) => deps.commanderToolService.search(args)),
    make("commander.tool_get", (_ctx, args) => deps.commanderToolService.get(args)),
    make("commander.tool_profile", (_ctx, args) => deps.commanderToolService.profile(args)),
    make("authority.describe", (_ctx, args) => deps.commandAuthorityService.get(String(args.command ?? ""))),
    make("memory.search", (_ctx, args) => deps.researchMemoryService.preview(args)),
    make("continuity.search", (_ctx, args) => deps.operationalMemorySearchService.search(args)),
    make("repo.search_text", (_ctx, args) => deps.repoReadService.searchText(args)),
    make("repo.read_lines", (_ctx, args) => deps.repoReadService.readLines(args)),
    make("repo.git_status", () => deps.repoReadService.gitStatus()),
    make("repo.git_diff", (_ctx, args) => deps.repoReadService.gitDiff(args)),
  ]
  const duplicates = duplicateIds(bindings.map((item) => item.tool_id))
  return {
    bindings,
    lookup: (toolId) => bindings.find((item) => item.tool_id === toolId),
    validation_summary: {
      binding_count: bindings.length,
      duplicate_tool_ids: duplicates,
      tool_ids: bindings.map((item) => item.tool_id),
    },
  }
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}
