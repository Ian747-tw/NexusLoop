import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { redactValue } from "../security/redaction"

export class PolicyService {
  constructor(readonly projectDir: string) {}

  get policyPath(): string {
    return join(this.projectDir, ".nxl", "spec", "policy.json")
  }

  async metadata(): Promise<Record<string, unknown>> {
    try {
      const policy = JSON.parse(await readFile(this.policyPath, "utf8")) as Record<string, unknown>
      return redactValue({
        present: true,
        keys: Object.keys(policy).sort(),
        policy,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false, keys: [] }
      throw error
    }
  }
}
