# agentcore/INTERVENTION_ALGEBRA.md — Canonical 12 Verbs

These 12 verbs are the complete set of intervention actions from Python → TS.

| Verb | Definition | When Used |
|------|------------|------------|
| `ask` | Request user input before proceeding | Uncertain policy |
| `warn` | Log warning, allow to proceed | Low-severity concern |
| `narrow` | Replace args with safer subset, proceed | Correctable call |
| `deny` | Block tool call, return error to model | Policy violation |
| `escalate` | Pause cycle, alert human | High-severity |
| `trap` | Capture and record, do not execute | Honeypot |
| `scaffold` | Provide extra context to model | Guidance |
| `redirect` | Route to different tool or handler | Rewriting |
| `explain` | Provide reasoning for decision | Transparency |
| `guide` | Step-by-step instruction | Education |
| `review` | Request human review before continuing | Review gate |
| `confirm` | Await explicit user confirmation | Trust boundary |

All verbs map to `Intervention` messages over IPC.
