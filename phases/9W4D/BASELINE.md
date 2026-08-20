# 9W4D Baseline

## Repository

- Base: `c869a2a0c891bc8bb21d4c0321762986dad889a8`
- Branch: `redesign/branch9w4d-openai-responses-compatibility-matrix`
- Base ancestry at creation: `0 0` against `origin/main`
- Worktree at creation: clean

## Installed graph

- `ai@7.0.29`
- `@ai-sdk/provider@4.0.3`
- `@ai-sdk/provider-utils@5.0.10`
- `@ai-sdk/openai-compatible@3.0.11`
- `@ai-sdk/anthropic@4.0.15`
- `@ai-sdk/google@4.0.15`

Registry inspection selected `@ai-sdk/openai@4.0.15`. Its published integrity is
`sha512-JpTLQp5RUbRcs5nOyPEu5NRdxZLUnD/uCyT3qzy26D+iunCeL7KJV58ER9kwisAKnTjWravfNblaQNiWr20M9A==`.
It resolves exactly `@ai-sdk/provider@4.0.3` and
`@ai-sdk/provider-utils@5.0.10`; no shared AI SDK upgrade is required.

## Clean-base verification

The clean-base TUI suite passed 323 tests, both runtime and TUI typechecks
passed, and CLI integration passed 7 tests. A first combined runtime capture
was too large for the command wrapper. Three attempted compact recaptures
incorrectly yielded while their child processes remained live; those duplicate
processes were terminated and are excluded from evidence. The complete runtime
suite is required again at final head and no baseline count is inferred here.

