# E2E Failure Categories (Phase B audit)

## Summary
- Total E2E: 47
- Passed: 32
- Failed: 15 (not 18 as originally estimated)

---

## Category 1: Provider initialization broken (~3 tests)
**Root cause:** `Cannot instantiate typing.Union` error in provider initialization path. Not just missing API keys — the code itself crashes before any API call.

Files:
- `test_provider_anthropic_dry_run`
- `test_provider_ollama_dry_run`
- `test_provider_openai_dry_run`

**Fix approach:** Fix the typing.Union instantiation bug in the provider initialization code. Then add mock provider fixture.

---

## Category 2: init_build_mode missing nxl-init.md (1 test)
**Root cause:** `nxl init --project-mode build --auto --plugin cc` does not create `.claude/commands/nxl-init.md`.

File:
- `test_user_inits_empty_project_in_build_mode`

**Fix approach:** Fix the scaffold generator to produce the plugin command file in build mode.

---

## Category 3: Resume bugs (~3 tests)
**Root causes:**
1. `ResumeCapsule` object has no attribute `volatile_tail` — missing field in the model
2. `test_resume_rejects_spec_hash_mismatch` passes when it should fail — spec hash validation not implemented
3. `test_user_can_resume_after_session_death` fails because no events.jsonl exists yet (need to run at least one cycle first)

Files:
- `test_resume_with_message_merges_guidance`
- `test_resume_rejects_spec_hash_mismatch`
- `test_user_can_resume_after_session_death`

---

## Category 4: "no provider selected" error for dry-run without provider (~2 tests)
**Root cause:** `nxl run --once --dry-run` requires a provider even in dry-run mode. M0/M1 tests that expected dry-run to work without a provider are now failing.

Files:
- `test_user_can_run_once_dry_run`
- `test_skill_dispatch_slash_command`

**Fix approach:** Make `--dry-run` work without a real provider (perhaps using a mock provider by default for dry-run).

---

## Category 5: MCP events empty (~3 tests)
**Root cause:** The CLI commands that should emit MCP tool events (`nxl run --once --dry-run`, `nxl check`) are not producing events. Likely because they fail before reaching the MCP dispatch layer, or because the event log is not being written correctly.

Files:
- `test_mcp_code_read_edit_no_rm`
- `test_mcp_hypothesis_crud`
- `test_mcp_spec_returns_pointer`

---

## Category 6: Policy engine not enforcing rules (1 test)
**Root cause:** Policy is in 'open' mode by default, allowing all actions. The `test_mcp_policy_denies_on_rule_violation` test expects denial but gets allowance because mode='open'.

File:
- `test_mcp_policy_denies_on_rule_violation`

---

## Category 7: Dashboard "Leaderboard" missing (1 test)
**Root cause:** Dashboard HTML doesn't contain "Leaderboard" text in initial response (likely rendered via JS after connection).

File:
- `test_dashboard_serves_locally`

---

## Category 8: 12h smoke test failure (1 test)
**Root cause:** Unknown — assertion failure in the smoke test itself.

File:
- `test_12h_overnight_smoke`

---

## Priority order for fixing:
1. Resume volatile_tail bug (quick fix, unblocks 2 tests)
2. Provider typing bug (crashes all 3 provider tests)
3. init_build_mode nxl-init.md (1 test)
4. Make --dry-run work without provider (unblocks 2 tests)
5. Policy 'open' mode issue (1 test)
6. MCP events empty (3 tests, deeper issue)
7. Dashboard + smoke test (2 tests)