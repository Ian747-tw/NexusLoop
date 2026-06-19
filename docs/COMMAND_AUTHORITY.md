# Command Authority Inventory

Branch 8A adds a read-only command authority inventory for slash commands and runtime command surfaces.

The canonical implementation is the typed registry in `agentcore/runtime/src/authority/command-authority-registry.ts`.
The registry is static by design: runtime commands do not parse source files dynamically, append events, stage commands, approve commands, or execute commands.

## Runtime Surface

- `runtime.command_authority_summary`
- `runtime.command_authority_list`
- `runtime.command_authority_get`
- `runtime.command_authority_validation_profile`

All four commands are read-like and require no active runtime or run lock.

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
