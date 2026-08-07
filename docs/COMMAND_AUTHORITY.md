# Command Authority Inventory

Branch 8A adds a read-only command authority inventory for slash commands and runtime command surfaces.

The canonical implementation is the typed registry in `agentcore/runtime/src/authority/command-authority-registry.ts`.
The registry is static by design: runtime commands do not parse source files dynamically, append events, stage commands, approve commands, or execute commands.

The inventory covers runtime/status reads, research and reasoning provider surfaces, checkpoint/restore, wake/scheduler, scheduler navigation staging/execution/approval/checkpoint comparison, continuation, OpenCode handoff, mission/proposal/review/apply commands, and external API request/research-ingestion commands.

It also covers the exact Commander recovery surface:

- `/commander-recoveries`, `/commander-recovery-show`, and
  `/commander-recovery-preview` are safe reads. They append no events and call
  no provider.
- `/commander-recovery-approve` is a blocked-by-default human-only durable
  approval write requiring active runtime and run lock. It calls no provider.
- `/commander-recovery-execute` is a blocked-by-default high-impact,
  approval-gated, event-mutating, provider/network-capable operation.
- `/commander-recovery-cancel` is blocked-by-default active-operation control.
  It appends no event and makes no provider call itself.

These commands are operator surfaces only. Approve, execute, and cancel are not
Commander tools and are not included in provider-visible schemas.

## Bounded GitHub Evidence

9XA adds six internal `github_read` Commander descriptors through the existing
binding registry: repository, exact commit, pull-request/files, issue,
exact-SHA checks, and pull-request review/thread state. They are safe-read,
run-lock-bound, network/credential-capable runtime services rather than slash
commands or generic GitHub access. Runtime owns their exact repository
allowlist, fixed paths/query, credentials, pagination ceilings, cancellation,
audit, redaction, and normalization. GitHub content is untrusted evidence only;
there is no mutation, search, governance intent, or approval authority.

## Runtime Surface

- `runtime.command_authority_summary`
- `runtime.command_authority_list`
- `runtime.command_authority_get`
- `runtime.command_authority_validation_profile`

All four commands are read-like, require no active runtime or run lock, and are routed by the TUI runtime client without auto-starting the runtime.

## TUI Surface

- `/authority`
- `/authority-summary`
- `/authority-list risk=<risk> gate=<gate> owner=<owner> limit=<n>`
- `/authority-show <slashCommand>`
- `/authority-profile <slashCommand>`

Aliases:

- `/command-authority`
- `/command-map`

## Validation Policy

The authority inventory recommends targeted validation profiles. Full historical E2E is reserved for release-candidate gates, shared parser/global dispatch changes, broad snapshot/state merge changes, or explicit reviewer request.

Authority records use the concrete event kinds emitted by owner services. For example, OpenCode handoff records `opencode_handoff_started` and `opencode_handoff_created`, reasoning smoke records `reasoning_provider_smoke_succeeded` or `reasoning_provider_smoke_failed`, recovery acknowledgement records `runtime_wake_scheduler_recovery_recorded`, continuation step execution records `runtime_continuation_step_*` events, and external API ingestion records `external_api_request_*` plus `external_api_research_ingestion_*` terminal events. Dry-run surfaces that append no events, such as `/wake-tick-dry-run`, `/handoff-dry-run`, `/reasoning-smoke-dry-run`, `/api-dry-run`, `/scheduler-nav-write-run-dry-run`, and `/scheduler-nav-checkpoint-run-dry-run`, are marked non-mutating. Local TUI commands such as `/cancel` are represented separately from runtime mutation commands. Handoff read routes such as `/handoffs`, `/handoff-show`, `/handoff-followup-summary`, and queue aliases are represented as safe reads. Scheduler start/stop aliases and review request/cancellation commands map to their runtime authority gates rather than falling through as unsupported.

For Branch 8A, targeted validation is:

- Runtime unit tests and typecheck
- TUI unit tests and typecheck
- CLI launcher and entrypoint integration tests
- `tests/e2e_user/scenarios/test_command_authority_inventory_tui.py`

## No-Authority Guarantee

The inventory may classify and explain authority. It must not perform authority:

- No command execution
- No command staging
- No approval mutation
- No scheduler/wake/checkpoint/continuation/recovery/handoff/proposal/mission mutation
- No OpenCode launch
