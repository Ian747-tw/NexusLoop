# M0 Forbidden Actions

- Modify files listed in `FROZEN.lock`
- Modify `NON_NEGOTIABLE_RULES.md`
- Modify `NON_NEGOTIABLE_RULES_dev.md`
- Write to `events.jsonl` except via `EventLog.append()`
- Importing `nxl` or `nxl_core` inside any file under `tests/e2e_user/`
- Monkey-patching NexusLoop internals in `tests/e2e_user/`
- Marking any E2E test `@pytest.mark.skip` or `@pytest.mark.xfail`
- Relaxing an E2E assertion to make a failing test pass
- Committing a phase as complete while any `phase_m0` E2E scenario is red
