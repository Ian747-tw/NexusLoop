# Branch 9W4C Clean Baseline

- Base SHA: `c2287ea88f55a2800e41ba304a03c281ee1eda57`
- Branch: `redesign/branch9w4c-native-gemini`
- Local `main` and `origin/main` matched exactly before branch creation.
- Initial worktree: clean.
- Base ancestry against `origin/main`: `0 0`.

## Runtime

```text
Checked 17 installs across 18 packages (no changes) [4.00ms]

977 pass
0 fail
9003 expect() calls
Ran 977 tests across 8 files. [128.12s]
real 128.16
user 78.16
sys 29.74

$ tsc --noEmit
real 4.65
user 8.33
sys 0.38
```

## TUI

```text
Checked 179 installs across 188 packages (no changes) [6.00ms]

323 pass
0 fail
4149 expect() calls
Ran 323 tests across 7 files. [4.61s]
real 4.62
user 3.53
sys 1.11

$ tsc --noEmit
real 5.37
user 9.38
sys 0.39
```

## CLI Integration

```text
.......                                                                  [100%]
7 passed in 1.70s
real 2.16
user 2.13
sys 0.26
```
