# M-1 Forbidden Actions

- Adding new features beyond rename
- Modifying `NON_NEGOTIABLE_RULES.md`
- Modifying `NON_NEGOTIABLE_RULES_dev.md`
- Touching logic in `nxl/core/`
- Touching logic in `drl_autoresearch/core/`
- Refactoring oversized files
- Writing to `events.jsonl` except via `EventLog.append()`
- Modifying any file listed in `FROZEN.lock`
- Importing `nxl` or `nxl_core` inside any file under `tests/e2e_user/`
- Monkey-patching NexusLoop internals in `tests/e2e_user/`
- Marking any E2E test `@pytest.mark.skip` or `@pytest.mark.xfail`
- Relaxing an E2E assertion to make a failing test pass
- Committing a phase as complete while any `phase_m_minus_1` E2E scenario is red
