import { redactText, redactValue } from "../security/redaction"
import type { WakeScheduleService } from "./wake-schedule-service"
import type { WakeSchedulerNavigationStagedRunService } from "./wake-scheduler-navigation-staged-run-service"
import type { WakeSchedulerNavigationLowRiskWriteExecution } from "./wake-scheduler-navigation-write-run-types"

const SUMMARY_CHARS = 1024

export class WakeSchedulerNavigationLowRiskWriteExecutor {
  constructor(
    private readonly wakeScheduleService: WakeScheduleService,
    private readonly stagedReadRunService: WakeSchedulerNavigationStagedRunService,
  ) {}

  supports(command: string): boolean {
    const [name, ...args] = command.trim().split(/\s+/)
    if (name === "/wake-tick-dry-run") return args.length === 0
    if (name === "/scheduler-nav-run") return args.length === 1 && Boolean(args[0]?.trim())
    return false
  }

  async preflightBlockers(command: string): Promise<string[]> {
    const [name, ...args] = command.trim().split(/\s+/)
    if (name !== "/scheduler-nav-run" || args.length !== 1 || !args[0]?.trim()) return []
    const preview = await this.stagedReadRunService.preview({ staged_id: args[0] })
    return preview.can_execute ? [] : preview.blockers.length > 0 ? preview.blockers : ["downstream staged read cannot execute"]
  }

  async execute(command: string, requestedBy: string): Promise<WakeSchedulerNavigationLowRiskWriteExecution> {
    const [name, ...args] = command.trim().split(/\s+/)
    if (name === "/wake-tick-dry-run") {
      if (args.length > 0) throw new Error("/wake-tick-dry-run does not accept staged execution arguments")
      const tick = await this.wakeScheduleService.executeTick({ dry_run: true, requested_by: requestedBy })
      return redactValue({
        execution_kind: "wake_tick_dry_run",
        result_kind: "wake_tick_dry_run",
        result_summary: summary(`dry_run=true processed=${tick.processed_count} wake_ids=${tick.wake_ids.length} plan_ids=${tick.plan_ids.length} skipped=${tick.skipped.length}`),
        warnings: ["wake tick dry-run used dry_run=true and did not append tick completion events"],
      })
    }
    if (name === "/scheduler-nav-run") {
      if (args.length !== 1 || !args[0]?.trim()) throw new Error("/scheduler-nav-run requires exactly one staged read id")
      const downstream = await this.stagedReadRunService.execute({ staged_id: args[0], requested_by: requestedBy })
      if (downstream.status !== "succeeded") throw new Error(downstream.error ?? `downstream staged read ${downstream.status}`)
      return redactValue({
        execution_kind: "staged_safe_read",
        result_kind: downstream.result_kind ?? "scheduler_navigation_staged_read",
        result_summary: summary(downstream.result_summary ?? downstream.command),
        downstream_run_id: downstream.run_id,
        warnings: ["scheduler navigation write run executed exactly one staged safe-read downstream"],
      })
    }
    throw new Error("staged write command is not in the 7V low-risk executor whitelist")
  }
}

function summary(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > SUMMARY_CHARS ? `${clean.slice(0, SUMMARY_CHARS - 3)}...` : clean
}
