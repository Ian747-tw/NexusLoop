import { describe, expect, test } from "bun:test"
import { selectedCommanderTools, toModelTool, validateArguments } from "../src/contracts"
import { runSchemaCompatibilityProbe } from "../src/probes/schema-compatibility-probe"

describe("schema compatibility", () => {
  test("selected real descriptors remain compatible with SDK-derived tool schemas", () => {
    const result = runSchemaCompatibilityProbe()
    expect(result.status).toBe("pass")
    expect(result.errors).toEqual([])
    for (const toolId of ["memory.search", "continuity.search", "repo.search_text", "repo.git_diff"]) {
      expect(result.schema_hashes[toolId]).toBeString()
    }
  })

  test("valid arguments survive round trip and invalid arguments fail", () => {
    const gitDiff = toModelTool(selectedCommanderTools().find((tool) => tool.tool_id === "repo.git_diff")!)
    expect(validateArguments(gitDiff, { scope: "working_tree", stat_only: true }).valid).toBe(true)
    expect(validateArguments(gitDiff, { scope: 7 }).valid).toBe(false)
    expect(validateArguments(gitDiff, { scope: "working_tree", unexpected: true }).valid).toBe(false)
  })
})
