# Commander Agent Runtime SDK Fit Spike

This package is an isolated 9W0 compatibility spike. It compares Vercel AI SDK
Core, OpenAI Agents SDK lower-level usage, and a minimal custom adapter baseline
against the NexusLoop Commander model-step contract.

The package is intentionally not imported by production runtime or TUI code.
Candidate SDK dependencies live only here.

Required validation:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run probe
bun run report
git diff --exit-code -- results.json RESULTS.md
```

Default tests use deterministic local fixtures only. The optional live smoke is
opt-in and requires `NXL_SDK_SPIKE_LIVE=1`.
