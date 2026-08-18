# Branch 9W4B1 Clean Baseline

- Base SHA: `cb83208620e88b2f87f1f7bc8f4e446bc0ea8f8f`
- Branch: `redesign/branch9w4b1-model-profile-runtime-registry`
- `origin/main`, local `main`, and the branch point matched before edits.
- Worktree before branch creation: clean.

## Runtime

```text
bun install v1.3.11 (af24e281)

Checked 17 installs across 18 packages (no changes) [152.00ms]
real 0.24
user 0.01
sys 0.04

951 pass
0 fail
8868 expect() calls
Ran 951 tests across 5 files. [131.44s]
real 131.49
user 79.06
sys 29.38

$ tsc --noEmit
real 4.79
user 8.53
sys 0.35
```

## TUI

```text
bun install v1.3.11 (af24e281)

Checked 179 installs across 188 packages (no changes) [104.00ms]
real 0.11
user 0.02
sys 0.03

323 pass
0 fail
4149 expect() calls
Ran 323 tests across 7 files. [4.99s]
real 5.01
user 4.14
sys 1.21

$ tsc --noEmit
real 5.50
user 9.49
sys 0.41
```

## CLI Integration

```text
.......                                                                  [100%]
7 passed in 2.22s
real 3.41
user 2.74
sys 0.48
```
