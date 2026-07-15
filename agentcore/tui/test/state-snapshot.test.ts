import { describe, expect, test } from "bun:test"
import { snapshotUiState } from "../src/state-snapshot"
import { initialState } from "../src/state"
import { layoutSnapshot } from "../src/snapshot"

describe("TUI state snapshot", () => {
  test("captures an immutable baseline for async runtime effects", () => {
    const state = initialState("/tmp/demo")
    state.systemActions.push({ title: "before" })

    const snapshot = snapshotUiState(state)
    state.systemActions.push({ title: "after" })
    state.header.activeMissionId = "mission-after"

    expect(snapshot.systemActions).toEqual([{ title: "before" }])
    expect(snapshot.header.activeMissionId).toBe("none")
  })

  test("escapes repository-derived control characters in layout snapshots", () => {
    const state = initialState("/tmp/demo") as any
    state.screen = "main"
    state.commanderInternalReads = {
      repoTree: {
        tool_id: "repo.tree",
        status: "ready",
        trust_class: "repository_content_untrusted",
        instruction_semantics: "none",
        result: {
          entries: [{ path: "src/a\nforged=1.ts", kind: "file" }],
        },
        evidence: [],
        filesystem_written: false,
        events_appended: false,
        network_called: false,
        provider_called: false,
        mcp_called: false,
        research_db_written: false,
        mission_mutated: false,
        proposal_mutated: false,
        opencode_action_performed: false,
        shell_used: false,
        arbitrary_command_executed: false,
        git_process_invoked: false,
        warnings: [],
      },
    }

    const snapshot = layoutSnapshot(state)

    expect(snapshot).toContain("src/a\\nforged=1.ts")
    expect(snapshot).not.toContain("\nforged=1.ts")
  })
})
