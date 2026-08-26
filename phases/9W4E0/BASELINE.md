# 9W4E0 Baseline

- Base: `ce0d4a7080ec1b6730b47576d779621e8f97c6b0`
- Branch: `redesign/branch9w4e0-opencode-readiness-packaging`
- Frozen 9W4E head (not in this branch): `4e21010c4984e9b7cc2ad580dc83b251f0ae02aa`
- Required upstream toolchain: `bun@1.3.13` from `agentcore/upstream/package.json`.
- Host default Bun at audit time: `1.3.11`; validation uses an isolated Bun `1.3.13` installation.

Clean-base reproduction with Bun 1.3.13:

```text
$ cd agentcore/upstream
$ bun install --frozen-lockfile
bun install v1.3.13 (bf2e2cec)
Resolving dependencies
Resolved, downloaded and extracted [5]
error: lockfile had changes, but lockfile is frozen
note: try re-running without --frozen-lockfile and commit the updated lockfile
```

This failure is the packaging defect exposed by the blocked 9W4E clean-checkout gate. Existing developer `node_modules` is not evidence.

## Clean Base Verifiers

```text
$ cd agentcore/runtime
$ bun install --frozen-lockfile && /usr/bin/time -p bun test && /usr/bin/time -p bun run typecheck
Checked 19 installs across 20 packages (no changes) [5.00ms]
1005 pass
0 fail
9523 expect() calls
Ran 1005 tests across 9 files. [136.01s]
real 136.07
user 86.07
sys 31.54
$ tsc --noEmit
real 5.10
user 9.17
sys 0.39
```

```text
$ cd agentcore/tui
$ bun install --frozen-lockfile && /usr/bin/time -p bun test && /usr/bin/time -p bun run typecheck
Checked 179 installs across 188 packages (no changes) [11.00ms]
323 pass
0 fail
4149 expect() calls
Ran 323 tests across 7 files. [5.24s]
real 5.27
user 4.37
sys 1.25
$ tsc --noEmit
real 5.45
user 9.54
sys 0.43
```

```text
$ uv run pytest tests/integration/cli -q
.......                                                                  [100%]
7 passed in 1.97s
real 2.42
user 2.39
sys 0.31
```
