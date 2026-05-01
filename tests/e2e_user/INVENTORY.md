# E2E Suite Inventory

Audit date: 2026-05-01

Classification key:
- `GREEN` — passes in isolation and still represents a valid user-facing CLI scenario
- `RED-fixable` — fails for a repairable reason such as stale assertions or stale fixture data
- `DEFERRED-TO-P7` — honest E2E coverage depends on upstream/session-path work already deferred to P7
- `DEAD` — should not live in `tests/e2e_user/` because it imports internals or no longer tests an honest user-facing scenario

| Scenario | Classification | Reason |
| --- | --- | --- |
| `test_12h_overnight_smoke.py` | `GREEN` | Passes as a lightweight dry-run smoke check through the real CLI. |
| `test_capability_postcondition_fail_rolls_back.py` | `DEAD` | Imports elasticity internals directly and fails on IPC test-harness assumptions instead of exercising the CLI. |
| `test_capability_token_expires_after_ttl.py` | `DEAD` | Imports capability internals directly and is a unit test misfiled as E2E. |
| `test_dashboard_launches.py` | `GREEN` | Passes after updating the stale HTML assertions to match the current dashboard template. |
| `test_first_install.py` | `GREEN` | Passes and still represents first-install CLI behavior. |
| `test_fs_archive_and_restore.py` | `DEAD` | Instantiates `FsMCP` directly with mocks; this is integration/unit coverage, not user simulation. |
| `test_hard_compact_produces_deterministic_capsule.py` | `DEAD` | Exercises compaction internals directly and fails because it is not using the runtime event-emission harness expected by current code. |
| `test_init_build_mode.py` | `GREEN` | Passes and validates real `nxl init` build-mode scaffolding. |
| `test_init_improve_mode.py` | `GREEN` | Passes and validates real `nxl init` improve-mode scaffolding. |
| `test_irreplaceable_demos.py` | `GREEN` | Passes through real `status` and `plan` CLI commands. |
| `test_mcp_code_read_edit_no_rm.py` | `DEAD` | The name claims code-MCP behavior, but the body only checks for `spec.*` events after a dry run, so it is not an honest E2E for the stated feature. |
| `test_mcp_hypothesis_crud.py` | `DEAD` | The name claims hypothesis CRUD, but the body only checks for `spec.*` events after a dry run, so it does not test the advertised behavior. |
| `test_mcp_policy_denies_on_rule_violation.py` | `DEAD` | Asserts CLI `nxl check` covers MCP-layer policy gates (`shell.exec` TTL/cwd). By design, `nxl check` only covers `PolicyEngine`; MCP-local gates are domain-specific and only fire on real dispatch. |
| `test_mcp_spec_returns_pointer.py` | `GREEN` | Passes and honestly checks that a real dry-run cycle emits `spec.*` tool events. |
| `test_package_install_via_pkg_mcp.py` | `GREEN` | Passes through the documented CLI surface. |
| `test_pkg_install_with_capability_token.py` | `DEAD` | Instantiates `PkgMCP` directly with mocks, so it is not a user-simulation scenario. |
| `test_policy_blocks_bad_action.py` | `GREEN` | Passes and still validates the CLI policy-check surface. |
| `test_provider_anthropic_dry_run.py` | `GREEN` | Passes and still validates dry-run provider selection. |
| `test_provider_ollama_dry_run.py` | `GREEN` | Passes and still validates dry-run provider selection. |
| `test_provider_openai_dry_run.py` | `GREEN` | Passes and still validates dry-run provider selection. |
| `test_resume_across_sessions.py` | `GREEN` | Passes and still validates the user-facing resume command. |
| `test_resume_loads_handoff_and_continues.py` | `RED-fixable` | Uses the real CLI, but one handoff fixture encodes a stale spec-hash assumption that now trips the intended mismatch guard. |
| `test_run_once.py` | `GREEN` | Passes and still validates `nxl run --once --dry-run`. |
| `test_shell_denies_write_outside_scratch.py` | `DEAD` | Instantiates `ShellMCP` directly with mocks instead of simulating a user CLI flow. |
| `test_skill_dispatch_slash_command.py` | `DEFERRED-TO-P7` | The file claims to test slash-command flow but only runs `nxl run --once --dry-run`, which does not emit skill events; honest E2E coverage depends on the P7 upstream/session-path work. |
| `test_soft_compact_emits_event_at_threshold.py` | `DEAD` | Exercises compaction internals directly and fails because it is not a real CLI scenario. |

## Deferred To P7

### `test_skill_dispatch_slash_command.py`

What it used to test:
- A user-facing slash-command skill-dispatch flow.

What changed:
- The current scenario does not actually issue a slash command; it runs `nxl run --once --dry-run` and then looks for skill events that the dry-run path does not emit.
- Real end-to-end skill-dispatch coverage depends on the later upstream/session integration work already deferred to P7.

What should test the new behavior:
- A future P7 E2E scenario that drives a real slash-command flow through the actual upstream session path rather than inferring behavior from dry-run bookkeeping.
