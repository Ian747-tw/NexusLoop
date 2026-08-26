# 9W4E Validation Record

This file records the commands used for the local gate. Development failures
and invalid invocations remain separate from final release evidence; the final
handoff reports the fresh detached exact-head rerun.

## Required commands

```text
cd agentcore/upstream
npx -y bun@1.3.13 install --frozen-lockfile
npx -y bun@1.3.13 install --frozen-lockfile
npx -y bun@1.3.13 run --cwd packages/opencode build:nexusloop-readiness
npx -y bun@1.3.13 run --cwd packages/opencode test:nexusloop-readiness-package
cd packages/opencode
npx -y bun@1.3.13 test test/cli/nexusloop-executor-readiness.test.ts test/cli/nexusloop-executor-readiness-state.test.ts

cd agentcore/runtime
bun install --frozen-lockfile
bun test src/model-configuration/model-setup.test.ts src/model-configuration/opencode-executor-readiness-resolver.test.ts src/runtime.test.ts
bun test
bun run typecheck

cd agentcore/tui
bun install --frozen-lockfile
bun test test/keyboard.test.ts test/launch.test.ts test/runtime-client-factory.test.ts test/runtime-effects.test.ts test/runtime-state-merge.test.ts
bun test
bun run typecheck

uv run pytest tests/integration/cli -q
uv run pytest tests/e2e_user/scenarios/test_model_setup_executor_readiness_tui.py -q
uv run pytest tests/e2e_user -q
git diff --check
```

## Candidate historical gate

The repaired implementation candidate `26de3cc0afb0254b3d81737e16761c96a9f4f9c1`
completed the unfiltered historical suite:

```text
........................................................................ [ 80%]
..................                                                       [100%]
90 passed in 2097.99s (0:34:57)
real 2114.57
user 1395.14
sys 489.74
```

## Invalid and failed development runs

- A detached-worktree command containing recursive removal was rejected before
  execution; it changed nothing and is excluded.
- A simplistic pre-install `node_modules` check reported the tracked
  `agentcore/server-fork/node_modules` fixture. A follow-up proved it was the
  only such path and that no untracked dependency directory was inherited.
- An upstream test invocation from the workspace root ran no tests because the
  root intentionally points test discovery at `do-not-run-tests-from-root`.
  The supported package invocation subsequently passed all 50 readiness tests.
- `python -m py_compile` was invalid because `python` was unavailable. The
  supported `uv run python -m py_compile` exposed one f-string syntax error;
  the error was fixed and the identical supported command passed.
- Two early targeted E2E invocations were not polled to an exit code and are
  excluded. The identical targeted command subsequently passed.
- The first Runtime full run found one stale authority-test expectation. The
  assertion was corrected to the truthful non-process setup classification and
  the identical suite subsequently passed.
- The first TUI full run found six established-project fixture assumptions.
  Those fixtures were updated to commit explicit unconfigured setup rather
  than weakening onboarding, and the identical suite subsequently passed.
- The first full historical run produced `47 failed, 43 passed` because
  established scenarios lacked durable setup. The second produced
  `6 failed, 84 passed` because six no-mutation assertions included the real
  setup prerequisite lifecycle. The harness now records that exact boundary;
  those assertions inspect only later events. The next identical unfiltered
  run passed all 90 scenarios as shown above.
