# Rule / Mechanism
1. Schema before code: Define Pydantic model + test, run test (red), then implement (green)
2. Test before feature: Every public API needs a failing test in tests/ before its implementation
3. No scope creep mid-phase: Each phase has a FORBIDDEN.md; touching anything in it must fail CI
4. Acceptance script must pass: Each phase has scripts/verify_phase_<N>.sh; exit gate = green
5. No silent edits to frozen files: M-1 ends with FROZEN.lock listing files that subsequent phases may not modify
6. Typed boundaries: mypy --strict on nxl_core/; failure blocks merge
7. Append-only state: After M0, events.jsonl is the only state mutator; direct file writes to state.json are forbidden
8. Replay diff = zero: After every change, nxl replay must reproduce stored final state byte-for-byte
9. Reference fixtures for golden tests: tests/fixtures/golden/ holds expected outputs; tests diff against these, not regenerate them
10. Daily heartbeat: At end of each work session, run scripts/heartbeat.sh; commits that fail it are reverted