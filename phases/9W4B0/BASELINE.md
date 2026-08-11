# Branch 9W4B0 Clean Baseline

- Base SHA: `771e27136e5405c7f053321cbb1bc29c1dab9eb5`
- Base source: merged PR #127, Branch 9W4A
- Branch: `redesign/branch9w4b0-unified-model-profile-boundary`
- Worktree before branch creation: clean

## Runtime

```text
Checked 17 installs across 18 packages (no changes) [5.00ms]

929 pass
0 fail
8593 expect() calls
Ran 929 tests across 4 files. [119.24s]

real  1m59.289s
user  1m8.790s
sys   0m26.565s
$ tsc --noEmit

real  0m4.618s
user  0m8.208s
sys   0m0.394s
```

## TUI

```text
Checked 179 installs across 188 packages (no changes) [14.00ms]

323 pass
0 fail
4149 expect() calls
Ran 323 tests across 7 files. [3.68s]

real  0m3.694s
user  0m2.516s
sys   0m0.720s
$ tsc --noEmit

real  0m6.244s
user  0m11.114s
sys   0m0.357s
```

## CLI Integration

```text
7 passed in 1.59s

real  0m1.935s
user  0m1.924s
sys   0m0.206s
```

## Historical User E2E

The complete suite ran in a detached clean worktree pinned to the base SHA,
after frozen runtime and TUI installs:

```text
........................................................................ [ 83%]
..............                                                           [100%]
86 passed in 468.36s (0:07:48)

real  7m48.944s
user  6m19.963s
sys   1m39.533s
```
