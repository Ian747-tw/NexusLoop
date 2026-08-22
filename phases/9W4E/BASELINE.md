# 9W4E Clean Baseline

- Base: `ce0d4a7080ec1b6730b47576d779621e8f97c6b0`
- Branch: `redesign/branch9w4e-first-run-model-setup`
- Local and `origin/main` divergence before branch creation: `0 0`
- Worktree before branch creation: clean

## Runtime

```text
bun install v1.3.11 (af24e281)

Checked 19 installs across 20 packages (no changes) [5.00ms]

1005 pass
0 fail
9523 expect() calls
Ran 1005 tests across 9 files. [132.31s]
real 132.36
user 81.47
sys 30.93
$ tsc --noEmit
real 4.77
user 8.52
sys 0.42
```

## TUI

```text
bun install v1.3.11 (af24e281)

Checked 179 installs across 188 packages (no changes) [34.00ms]

323 pass
0 fail
4149 expect() calls
Ran 323 tests across 7 files. [5.39s]
real 5.41
user 4.51
sys 1.34
$ tsc --noEmit
real 5.51
user 9.57
sys 0.46
```

## CLI Integration

```text
.......                                                                  [100%]
7 passed in 1.94s
real 2.39
user 2.31
sys 0.32
```

Frozen paths, manifest/lock hashes, and the upstream tree were recorded before
production edits. The upstream tree was
`5fd52c04d6b6e98a742ddc7d3ca82b59bc3c0c3a`.
