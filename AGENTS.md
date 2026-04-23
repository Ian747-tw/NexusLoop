# NexusLoop Execution Rules

Codex agents must follow the same execution contract as [CLAUDE.md](CLAUDE.md).

## End-to-end user-simulation testing

In addition to unit, integration, and adversarial tests, NexusLoop has **user-simulation E2E tests** in `tests/e2e_user/`. These are distinct from all other test types and represent the final ground truth for local release validation.

### Rules for E2E tests

1. **Every new user-facing feature must ship with an E2E scenario.** If a user can run it, we must simulate a user running it.

2. **E2E scenarios use only the real CLI.** Never import NexusLoop modules inside an E2E test. Never monkey-patch internals. If you feel the urge to patch, the test belongs in `tests/integration/`, not `tests/e2e_user/`.

3. **Every E2E scenario runs inside a fresh sandbox.** Use the `sandbox` fixture from `conftest.py`. It creates a fresh temp dir, fresh venv, fresh config; it does not share state with other tests or the developer's machine.

4. **Every E2E scenario is tagged with its minimum phase.** `@pytest.mark.phase_m<N>` — so earlier phases don't run scenarios that require features they haven't built yet.

5. **When an E2E test fails, the bug is in NexusLoop — not in the test.** Never "relax" an E2E assertion to make it pass. Reproduce the failure manually, fix the bug, re-run.

6. **E2E tests run locally, not in default GitHub CI.** Keep the user-simulation harness as a local developer/release gate. The default CI pipeline runs non-E2E checks only.

7. **Never skip an E2E test.** If it's flaky, fix the flakiness. If it's slow, optimize runtime or run it manually outside default CI. Never `@pytest.mark.skip`.

### Workflow when adding any user-facing feature

1. Write the E2E scenario first (red)
2. Write the unit tests (red)
3. Implement the feature
4. E2E (local) + unit/non-E2E tests (CI) go green
5. Commit as `M<phase>.<step>: <description>`
