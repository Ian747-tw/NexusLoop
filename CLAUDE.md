# NexusLoop execution rules

## Before writing any code
1. State which phase you are in and which step number
2. Read `phases/M<N>/FORBIDDEN.md` — do not modify anything listed
3. Read `phases/M<N>/checklist.md` — find the current unchecked step
4. Read the test for that step (if missing, write the test first)
5. Run the test. It must fail. If it passes, the feature already exists — skip to next step
6. Implement the smallest change to make the test pass
7. Run `scripts/verify_step.sh <phase> <step>` — must exit 0
8. Tick the box in `checklist.md`, commit with message `M<N>.<step>: <description>`
9. Those phase mds and scripts may not exists in the folder, but the content will appear in the prompt, if the user enter a long prompt, collect information and create those mds and scripts first before writing any code. and constantly update or delete those mds and scripts when new information is provided and olds are done. 
10. 'NON_NEGOTIABLE_RULES_dev.md' is the dev version of 'NON_NEGOTIABLE_RULES.md', it is used for development purposes only while 'NON_NEGOTIABLE_RULES.md' is for run time research rules for users only. 

## Forbidden behaviors
- Never edit `NON_NEGOTIABLE_RULES.md` and `NON_NEGOTIABLE_RULES_dev.md`
- Never create hard code cheat tests to pass the tests and pretend it works. the tests should be generic and reusable for the users' needs.
- Never write to `events.jsonl` except via `EventLog.append()`
- Never modify a file listed in `FROZEN.lock`
- Never invent a file path; if a file does not exist, ask before creating
- Never claim a step is done without running its verifier
- Never skip a failing test by marking it `xfail` or `skip`
- Never install packages globally (NON_NEGOTIABLE #4)

## When stuck
- If a verifier fails 3 times for the same reason, stop and report; do not "try alternative approaches" indefinitely
- If a test reveals a design problem, stop and ask before changing the design
- If you discover scope creep, write the new requirement to `phases/M<N>/SCOPE_QUESTIONS.md` and continue with the original scope

## Verifier infrastructure (built once in M-1, used by all phases)
scripts/
├── verify_step.sh <phase> <step>       # Per-step automated check
├── verify_phase.sh <phase>             # Full phase exit gate
├── heartbeat.sh                        # End-of-session sanity
├── replay_check.sh                     # Event log → state byte-diff
├── policy_fuzz.sh <iterations>         # Adversarial policy tests
└── chaos_run.sh <duration>             # Fault injection

