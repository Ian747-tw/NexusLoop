import type { RuntimeEvent } from "../events/event-types"
import { redactText } from "../security/redaction"
import { RuntimeServer } from "../server"
import type { RuntimeClient, SubmitUserMessageResult } from "./runtime-client"

const serverStartTasks = new WeakMap<RuntimeServer, Promise<void>>()
const noStartCommands = new Set([
  "runtime.command_authority_summary",
  "runtime.command_authority_list",
  "runtime.command_authority_get",
  "runtime.command_authority_validation_profile",
  "runtime.preview_opencode_process_smoke",
  "runtime.list_opencode_process_smokes",
  "runtime.get_opencode_process_smoke",
  "runtime.preview_opencode_handoff_readiness",
  "runtime.opencode_handoff_readiness_summary",
  "runtime.preview_opencode_result_review_packet",
  "runtime.opencode_result_review_packet_summary",
  "runtime.preview_opencode_session_plan",
  "runtime.create_opencode_session_plan",
  "runtime.list_opencode_sessions",
  "runtime.get_opencode_session",
  "runtime.opencode_session_summary",
  "runtime.list_model_capabilities",
  "runtime.get_model_capability",
  "runtime.context_budget_summary",
  "runtime.preview_context_budget",
  "runtime.preview_context_packet",
  "runtime.context_packet_summary",
  "runtime.preview_opencode_session_instruction_pack",
  "runtime.write_opencode_session_instruction_pack",
  "runtime.list_opencode_session_instruction_packs",
  "runtime.get_opencode_session_instruction_pack",
  "runtime.preview_opencode_launch_readiness",
  "runtime.opencode_launch_readiness_summary",
  "runtime.preview_opencode_session_launch",
  "runtime.launch_opencode_session",
  "runtime.list_opencode_session_launches",
  "runtime.get_opencode_session_launch",
  "runtime.preview_opencode_progress",
  "runtime.record_opencode_progress",
  "runtime.list_opencode_progress",
  "runtime.get_opencode_progress",
  "runtime.latest_opencode_progress",
  "runtime.opencode_progress_summary",
  "runtime.preview_opencode_watchdog",
  "runtime.record_opencode_watchdog",
  "runtime.request_opencode_forced_report",
  "runtime.list_opencode_watchdogs",
  "runtime.get_opencode_watchdog",
  "runtime.list_opencode_forced_report_requests",
  "runtime.get_opencode_forced_report_request",
  "runtime.opencode_watchdog_summary",
  "runtime.preview_opencode_commander_question",
  "runtime.create_opencode_commander_question",
  "runtime.list_opencode_commander_questions",
  "runtime.get_opencode_commander_question",
  "runtime.latest_opencode_commander_question",
  "runtime.opencode_commander_question_summary",
  "runtime.preview_commander_guidance",
  "runtime.create_commander_guidance",
  "runtime.list_commander_guidance",
  "runtime.get_commander_guidance",
  "runtime.latest_commander_guidance",
  "runtime.commander_guidance_summary",
  "runtime.preview_commander_guidance_delivery",
  "runtime.deliver_commander_guidance",
  "runtime.list_commander_guidance_deliveries",
  "runtime.get_commander_guidance_delivery",
  "runtime.latest_commander_guidance_delivery",
  "runtime.commander_guidance_delivery_summary",
  "runtime.preview_opencode_human_control",
  "runtime.record_opencode_human_control",
  "runtime.list_opencode_human_controls",
  "runtime.get_opencode_human_control",
  "runtime.latest_opencode_human_control",
  "runtime.opencode_human_control_summary",
  "runtime.preview_opencode_wake_supervisor",
  "runtime.opencode_wake_supervisor_summary",
  "runtime.preview_opencode_wake_supervisor_execution",
  "runtime.record_opencode_wake_supervisor_execution",
  "runtime.preview_opencode_wake_supervisor_batch",
  "runtime.record_opencode_wake_supervisor_batch",
  "runtime.list_opencode_wake_supervisor_executions",
  "runtime.get_opencode_wake_supervisor_execution",
  "runtime.latest_opencode_wake_supervisor_execution",
  "runtime.opencode_wake_supervisor_execution_summary",
  "runtime.preview_opencode_wake_action_execution",
  "runtime.record_opencode_wake_action_execution",
  "runtime.list_opencode_wake_action_executions",
  "runtime.get_opencode_wake_action_execution",
  "runtime.latest_opencode_wake_action_execution",
  "runtime.opencode_wake_action_execution_summary",
  "runtime.preview_opencode_result_report",
  "runtime.record_opencode_result_report",
  "runtime.list_opencode_result_reports",
  "runtime.get_opencode_result_report",
  "runtime.latest_opencode_result_report",
  "runtime.opencode_result_report_summary",
  "runtime.preview_opencode_result_review",
  "runtime.record_opencode_result_review",
  "runtime.list_opencode_result_reviews",
  "runtime.get_opencode_result_review",
  "runtime.latest_opencode_result_review",
  "runtime.opencode_result_review_summary",
  "runtime.preview_research_ingestion",
  "runtime.record_research_ingestion",
  "runtime.list_research_ingestions",
  "runtime.get_research_ingestion",
  "runtime.latest_research_ingestion",
  "runtime.research_ingestion_summary",
  "runtime.research_memory_summary",
  "runtime.preview_research_memory_retrieval",
  "runtime.preview_research_novelty_check",
  "runtime.preview_commander_executor_review",
  "runtime.execute_commander_executor_review",
  "runtime.list_commander_executor_reviews",
  "runtime.get_commander_executor_review",
  "runtime.preview_executor_review_proposal_drafts",
  "runtime.executor_review_proposal_draft_summary",
  "runtime.preview_executor_review_proposal_create",
  "runtime.create_executor_review_proposal",
  "runtime.list_executor_review_proposal_creates",
  "runtime.get_executor_review_proposal_create",
  "runtime.preview_executor_review_proposal_review_request",
  "runtime.request_executor_review_proposal_review",
  "runtime.list_executor_review_proposal_review_requests",
  "runtime.get_executor_review_proposal_review_request",
  "runtime.preview_executor_review_proposal_review_decision",
  "runtime.decide_executor_review_proposal_review",
  "runtime.list_executor_review_proposal_review_decisions",
  "runtime.get_executor_review_proposal_review_decision",
  "runtime.preview_executor_review_proposal_apply_readiness",
  "runtime.executor_review_proposal_apply_readiness_summary",
  "runtime.list_executor_review_proposal_apply_readiness",
  "runtime.get_executor_review_proposal_apply_readiness",
  "runtime.preview_executor_review_proposal_narrow_apply",
  "runtime.apply_executor_review_proposal_narrow",
  "runtime.list_executor_review_proposal_narrow_applies",
  "runtime.get_executor_review_proposal_narrow_apply",
  "runtime.preview_minimax_live_validation",
  "runtime.execute_minimax_live_validation",
  "runtime.list_minimax_live_validations",
  "runtime.get_minimax_live_validation",
])

export interface RuntimeServerClientOptions {
  server: RuntimeServer
  autoStart?: boolean
  ownsServer?: boolean
}

export class RuntimeServerClient implements RuntimeClient {
  readonly server: RuntimeServer
  private readonly autoStart: boolean
  private readonly ownsServer: boolean
  private startTask: Promise<void> | null = null
  private shutdownTask: Promise<void> | null = null
  private started = false
  private shutdownRequested = false

  constructor(options: RuntimeServerClientOptions) {
    this.server = options.server
    this.autoStart = options.autoStart ?? false
    this.ownsServer = options.ownsServer ?? false
  }

  async start(): Promise<void> {
    if (this.shutdownRequested) throw new Error("runtime client has been shut down")
    if (this.started) {
      try {
        const status = await this.server.status()
        if (status.runtimeStatus === "started") return
        this.started = false
        this.startTask = null
      } catch (error) {
        throw redactError(error)
      }
    }
    this.startTask ??= (async () => {
      const status = await this.server.status()
      if (status.runtimeStatus !== "started") await startServerOnce(this.server)
    })()
      .then(() => {
        this.started = true
      })
      .catch((error) => {
        this.startTask = null
        throw redactError(error)
      })
    await this.startTask
  }

  command = (async (name: string, payload: Record<string, unknown> = {}): Promise<unknown> => {
    if (this.shutdownRequested) throw new Error("runtime client has been shut down")
    try {
      if (await this.shouldAutoStart(name, payload)) await this.ensureStarted()
      const result = await this.server.command(name, payload)
      if (name === "runtime.shutdown") {
        this.started = false
        this.startTask = null
      }
      return result
    } catch (error) {
      throw redactError(error)
    }
  }) as RuntimeClient["command"]

  async submitUserMessage(message: string): Promise<SubmitUserMessageResult> {
    await this.ensureStarted()
    try {
      return await this.server.submitUserMessage(message)
    } catch (error) {
      throw redactError(error)
    }
  }

  async *stream(): AsyncIterable<RuntimeEvent> {
    const queue: RuntimeEvent[] = []
    let wake: (() => void) | null = null
    const unsubscribe = this.server.eventBus.subscribe((event) => {
      queue.push(event)
      wake?.()
      wake = null
    })
    try {
      const status = await this.server.status()
      yield {
        type: "RuntimeReady",
        projectName: status.projectName,
        runtimeStatus: status.runtimeStatus,
      }
      if (status.runtimeStatus === "started" || status.specApproved) {
        yield { type: "ProjectInitialized", projectDir: status.projectDir }
      }
      while (true) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve))
        while (queue.length) yield queue.shift()!
      }
    } finally {
      unsubscribe()
      const pendingWake = wake as (() => void) | null
      if (pendingWake) pendingWake()
    }
  }

  async shutdown(options: { force?: boolean } = {}): Promise<void> {
    if (!this.ownsServer && !options.force) {
      this.shutdownRequested = true
      return
    }
    this.shutdownRequested = true
    this.shutdownTask ??= this.server.shutdown().catch((error) => {
      this.shutdownTask = null
      throw redactError(error)
    })
    await this.shutdownTask
  }

  private async ensureStarted(): Promise<void> {
    if (!this.autoStart) return
    await this.start()
  }

  private async shouldAutoStart(name: string, payload: Record<string, unknown>): Promise<boolean> {
    if (name === "runtime.shutdown") return false
    if (name === "runtime.execute_opencode_process_smoke" && (payload.dryRun === true || payload.dry_run === true)) return false
    if (name === "runtime.execute_opencode_process_smoke") {
      const preview = await this.server.command("runtime.preview_opencode_process_smoke", {
        timeoutMs: payload.timeoutMs,
        timeout_ms: payload.timeout_ms,
      }) as { can_execute?: unknown; opt_in_present?: unknown }
      return preview.opt_in_present === true && preview.can_execute === true
    }
    return !noStartCommands.has(name)
  }
}

function redactError(error: unknown): Error {
  return new Error(redactText(error instanceof Error ? error.message : String(error)))
}

async function startServerOnce(server: RuntimeServer): Promise<void> {
  let task = serverStartTasks.get(server)
  if (!task) {
    task = server.start().finally(() => {
      serverStartTasks.delete(server)
    })
    serverStartTasks.set(server, task)
  }
  await task
}
