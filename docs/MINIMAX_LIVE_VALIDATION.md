# MiniMax Live Validation

Branch 8G adds an opt-in MiniMax provider validation surface. The default local
and CI paths remain fake/non-live.

## Default Behavior

- `/minimax-live-preview` inspects configuration only.
- `/minimax-live-dry-run` does not call MiniMax and appends no events.
- `/minimax-live-validate` blocks unless `NXL_MINIMAX_LIVE_VALIDATION=1`.
- Live validation records only bounded `minimax_live_validation_*` metadata.
- Live validation does not create proposals, run Commander cycle, synthesize
  research as product behavior, launch OpenCode, mutate missions, or execute
  scheduler/wake/continuation/recovery writes.

## Manual Live Command

Use an existing MiniMax connector and credential configuration. Do not add raw
secrets to test output or events. Run this from a disposable NexusLoop project
that already has an approved `.nxl/spec/current.json`; do not point it at a
production workspace.

```bash
cd /path/to/disposable-approved-nexusloop-project

NXL_TUI_HEADLESS=1 \
NXL_RUNTIME_CLIENT=real \
NXL_OPENCODE_ADAPTER=fake \
NXL_MINIMAX_LIVE_VALIDATION=1 \
NXL_REASONING_PROVIDER_KIND=minimax \
NXL_REASONING_ENABLE_COMMANDER_EXECUTOR_REVIEW=1 \
NXL_REASONING_CONNECTOR_ID=<your-existing-minimax-connector-id> \
NXL_REASONING_MODEL=<your-minimax-model> \
NXL_TUI_KEYS='[
  {"type":"submit"},
  {"type":"insert","text":"/minimax-live-preview surface=commander_executor_review"},
  {"type":"submit"},
  {"type":"insert","text":"/minimax-live-validate surface=commander_executor_review"},
  {"type":"submit"},
  {"type":"insert","text":"/minimax-live-validations"},
  {"type":"submit"}
]' \
uv run --project /path/to/NexusLoop nxl
```

Optional surfaces can be enabled explicitly:

```bash
NXL_REASONING_ENABLE_RESEARCH_SYNTHESIS=1
NXL_REASONING_ENABLE_COMMANDER_CYCLE=1
```

The default E2E scenario does not perform live calls and intentionally clears
MiniMax live/provider environment variables. It verifies the TUI surface,
redaction, no-start behavior, and no product mutation in the fake/default path;
do not use that pytest scenario as manual live-provider evidence.
