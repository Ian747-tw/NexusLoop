# M-1 Scope Questions

## Frozen Execution Contract Conflict

The user requested adding the E2E testing contract section to `CLAUDE.md`, but
`CLAUDE.md` is listed in root `FROZEN.lock` and phase rules forbid modifying
frozen files after M-1. `AGENTS.md` has been created with the requested E2E
content and cross-links to `CLAUDE.md`; updating `CLAUDE.md` requires explicit
approval to thaw or regenerate `FROZEN.lock`.

## Manual Verification Bug: `--auto` Still Prompts

Manual verification on 2026-04-23 found that:

```bash
nxl init --auto --project-mode improve
```

still enters interactive onboarding prompts even though the CLI help says
`--auto` implies `--skip-onboarding`. After feeding `END` repeatedly, init also
entered environment remediation and did not return promptly before being
interrupted. The project was mostly scaffolded and later `nxl run --once
--dry-run` and `nxl dashboard --port 18765` worked, but the exact README-style
manual flow did not fully succeed.

M-1 forbids touching `nxl/core/`, so this was recorded rather than fixed in this
E2E scaffolding task.
