# 9W4E0 Validation Ledger

Candidate validated before this ledger-only commit:
`4a2a16465da86d6a53adf76aa9e9f985a3a5f99f`.

All Bun commands below used Bun `1.3.13` from an isolated binary directory.
The detached candidate worktree started with zero `node_modules` directories
under `agentcore/upstream`, `agentcore/runtime`, and `agentcore/tui`.

## Upstream full-suite comparison

Exact-head command, run alone:

```bash
cd agentcore/upstream/packages/opencode
/usr/bin/time -p /tmp/nexusloop-bun-1.3.13.UZZcHp/bin/bun test --timeout 30000
```

Verbatim summary:

```text
4 tests failed:
(fail) tool.registry > loads tools from .opencode/tool (singular) [30013.87ms]
  ^ this test timed out after 30000ms.
(fail) tool.write > file permissions > sets file permissions when writing sensitive data [47.00ms]
(fail) cancel interrupts shell and resolves cleanly [333.00ms]
(fail) cancel persists aborted shell result when shell ignores TERM [342.00ms]

 2072 pass
 20 skip
 1 todo
 4 fail
 10254 expect() calls
Ran 2097 tests across 162 files. [236.96s]
real 237.10
user 300.12
sys 96.56
```

The exact base cannot run its package suite after a frozen install because the
base lockfile is the packaging defect repaired by this branch:

```bash
cd agentcore/upstream
/tmp/nexusloop-bun-1.3.13.UZZcHp/bin/bun install --frozen-lockfile
```

```text
bun install v1.3.13 (bf2e2cec)
Resolving dependencies
Resolved, downloaded and extracted [5]
error: lockfile had changes, but lockfile is frozen
note: try re-running without --frozen-lockfile and commit the updated lockfile
real 0.99
user 0.16
sys 0.10
```

For failure classification only, a separate detached base worktree used a
non-frozen install and then the identical isolated package test command. This
is comparison evidence, not release install evidence:

```text
4 tests failed:
(fail) tool.write > file permissions > sets file permissions when writing sensitive data [92.00ms]
(fail) cancel interrupts shell and resolves cleanly [425.00ms]
(fail) cancel persists aborted shell result when shell ignores TERM [354.00ms]
(fail) cancel interrupts loop queued behind shell [462.00ms]

 2023 pass
 20 skip
 1 todo
 4 fail
 10079 expect() calls
Ran 2048 tests across 160 files. [204.99s]
real 205.02
user 260.99
sys 92.10
```

The exact-head-only registry timeout did not reproduce when its complete test
file ran alone:

```bash
cd agentcore/upstream/packages/opencode
/usr/bin/time -p /tmp/nexusloop-bun-1.3.13.UZZcHp/bin/bun test test/tool/registry.test.ts --timeout 30000
```

```text
 3 pass
 0 fail
 3 expect() calls
Ran 3 tests across 1 file. [7.07s]
real 7.17
user 8.89
sys 3.16
```

## Fresh detached exact-head gate

Upstream installation was run twice from a checkout with no inherited
upstream dependencies:

```bash
cd agentcore/upstream
bun install --frozen-lockfile
bun install --frozen-lockfile
```

```text
4757 packages installed [4.15s]
real 4.16
user 5.72
sys 5.80
Checked 2420 installs across 2671 packages (no changes) [1.69s]
real 1.70
user 0.89
sys 0.34
lockfile_unchanged=yes
```

Packaged executable build and verifier:

```bash
cd agentcore/upstream
bun run --cwd packages/opencode build:nexusloop-readiness
bun run --cwd packages/opencode test:nexusloop-readiness-package
```

```text
Smoke test passed: 0.0.0--202608250720
real 2.50
user 5.11
sys 1.09
packaged readiness executable: pass
source-tree dependency resolution: absent
persistent writes: 0
provider/model requests: 0
real 2.18
user 2.54
sys 0.44
```

Runtime:

```bash
cd agentcore/runtime
bun install --frozen-lockfile
/usr/bin/time -p bun test
/usr/bin/time -p bun run typecheck
```

```text
 1005 pass
 0 fail
 9523 expect() calls
Ran 1005 tests across 9 files. [132.93s]
real 132.97
user 81.43
sys 30.09
$ tsc --noEmit
real 4.81
user 8.53
sys 0.37
```

TUI:

```bash
cd agentcore/tui
bun install --frozen-lockfile
/usr/bin/time -p bun test
/usr/bin/time -p bun run typecheck
```

```text
 323 pass
 0 fail
 4149 expect() calls
Ran 323 tests across 7 files. [5.51s]
real 5.54
user 4.58
sys 1.31
$ tsc --noEmit
real 5.53
user 9.74
sys 0.43
```

CLI integration:

```bash
uv run pytest tests/integration/cli -q
```

```text
.......                                                                  [100%]
7 passed in 2.31s
real 18.75
user 14.01
sys 4.84
```

Targeted packaged-command E2E:

```bash
uv run pytest tests/e2e_user/scenarios/test_opencode_executor_readiness_package.py -q
```

```text
.                                                                        [100%]
1 passed in 1.69s
real 2.36
user 1.99
sys 0.60
```

Complete historical user E2E:

```bash
uv run pytest tests/e2e_user -q
```

```text
........................................................................ [ 80%]
.................                                                        [100%]
89 passed in 1732.21s (0:28:52)
real 1732.66
user 1286.25
sys 455.93
```

## Invalid invocations retained

1. A detached base install was first launched from the development checkout
   because the shell did not change directory. It is excluded.
2. The first base comparison suite was launched from the upstream workspace
   root and hit its intentional `do-not-run-tests-from-root` guard. It is
   excluded.
3. The first detached candidate build used the pinned Bun binary only for the
   outer command; nested scripts resolved host Bun `1.3.11` and stopped at the
   version gate. The build and verifier were rerun with the Bun `1.3.13`
   directory first on `PATH` and passed.

The complete historical gate must be repeated after this ledger changes the
exact head. CI and exact-head review must also be refreshed.
