import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export async function makeProject(root: string, options: { approvedSpec?: boolean; draftSpec?: boolean; policy?: Record<string, unknown> } = {}): Promise<void> {
  await mkdir(join(root, ".nxl", "spec"), { recursive: true })
  if (options.approvedSpec || options.draftSpec) {
    await writeFile(
      join(root, ".nxl", "spec", "current.json"),
      JSON.stringify(
        {
          spec_id: "spec_test",
          version: 1,
          status: options.approvedSpec ? "approved" : "draft",
          objective: "Build a deterministic test project with secret sk-test-SHOULDREDACT",
          project_mode: "build",
          domain: "test",
          success_metrics: ["tests pass"],
          evaluation_protocol: "run tests",
          approved_by: options.approvedSpec ? "tester" : null,
          approved_at: options.approvedSpec ? "2026-05-10T00:00:00Z" : null,
        },
        null,
        2,
      ),
    )
  }
  if (options.policy) {
    await writeFile(join(root, ".nxl", "spec", "policy.json"), JSON.stringify(options.policy, null, 2))
  }
}
