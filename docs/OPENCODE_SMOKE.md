# OpenCode Process Smoke

Branch 8B adds an opt-in smoke surface for the real OpenCode process boundary.

Default behavior is non-live:

- `/opencode-smoke-preview` inspects readiness without launching OpenCode.
- `/opencode-smoke-dry-run` returns predicted diagnostics and writes no events.
- `/opencode-smoke` blocks unless `NXL_REAL_OPENCODE_SMOKE=1` is set.
- `/opencode-smokes` and `/opencode-smoke-show <smokeId>` read bounded smoke metadata records.

Manual live smoke example:

```bash
NXL_REAL_OPENCODE_SMOKE=1 \
NXL_OPENCODE_BIN=/path/to/opencode \
uv run pytest tests/e2e_user/scenarios/test_opencode_process_smoke_tui.py -q
```

The live smoke records bounded/redacted process diagnostics only. It must not mutate missions,
proposals, reviews, scheduler state, wake state, continuation state, or provider state.
