# User-Simulation E2E Tests

## Philosophy
These tests simulate a **real user** installing NexusLoop into a **fresh environment** and using it via the **real CLI**. They are not unit tests. They are not integration tests. They catch the class of bugs that only appear when someone actually installs the tool.

## What these tests ARE
- Real `pip install` / `uv pip install` into a fresh venv
- Real `nxl <command>` subprocess invocations
- Real filesystem artifacts verified via `os.path.exists` etc.
- Real network calls mocked ONLY for external paid APIs (model API, HF Hub); everything else real
- Real stdin feeding for interactive prompts

## What these tests ARE NOT
- Not `import nxl; nxl.init(...)` — that's a unit test, skip it
- Not `mock.patch('nxl.core.run.CycleRunner')` — if you need to patch, you're in the wrong directory
- Not "happy-path only" — include failures, bad inputs, interrupted runs

## Running locally
```bash
pytest tests/e2e_user/ -v
```

## If a test fails
1. Do NOT "fix" the test — the test is the spec
2. Reproduce manually: `cd <sandbox dir> && nxl <the failing command>`
3. Fix the actual bug in NexusLoop code
4. Re-run the E2E test until it passes
