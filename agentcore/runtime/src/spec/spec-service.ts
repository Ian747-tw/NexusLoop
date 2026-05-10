import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { redactValue } from "../security/redaction"

export interface SpecSummary {
  specId: string
  version: number
  status: string
  objective: string
  projectMode?: string
  domain?: string
  successMetrics: string[]
  approvedBy?: string
  approvedAt?: string
}

export class SpecService {
  constructor(readonly projectDir: string) {}

  get currentPath(): string {
    return join(this.projectDir, ".nxl", "spec", "current.json")
  }

  async readCurrent(): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await readFile(this.currentPath, "utf8")) as Record<string, unknown>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  async requireApproved(): Promise<SpecSummary> {
    const spec = await this.readCurrent()
    if (!spec) throw new Error("approved spec missing: .nxl/spec/current.json")
    if (spec.status !== "approved") throw new Error(`approved spec required, found status=${String(spec.status)}`)
    return this.toSummary(spec)
  }

  toSummary(spec: Record<string, unknown>): SpecSummary {
    return redactValue({
      specId: String(spec.spec_id ?? "unknown"),
      version: Number(spec.version ?? 0),
      status: String(spec.status ?? "unknown"),
      objective: String(spec.objective ?? ""),
      projectMode: spec.project_mode ? String(spec.project_mode) : undefined,
      domain: spec.domain ? String(spec.domain) : undefined,
      successMetrics: Array.isArray(spec.success_metrics) ? spec.success_metrics.map(String) : [],
      approvedBy: spec.approved_by ? String(spec.approved_by) : undefined,
      approvedAt: spec.approved_at ? String(spec.approved_at) : undefined,
    })
  }
}
