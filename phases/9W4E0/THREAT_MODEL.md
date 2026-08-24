# 9W4E0 Threat Model

## Assets

- Exact Executor provider/model selection asserted by NexusLoop.
- OpenCode credential and configuration material.
- Readiness truthfulness and process lifecycle.

## Threats And Controls

| Threat | Control |
| --- | --- |
| Arbitrary executable forges readiness | Command is compiled into the configured OpenCode executable; no command override exists. |
| Input smuggles authority | Strict bounded JSON, exact keys, own-data reconstruction, duplicate-key rejection, canonical identifier grammar. |
| Catalog/plugin/auth state selects a different model | Request identity is echoed exactly; output contains no alternatives; Runtime must revalidate it later. |
| Plugin or remote config causes network/mutation | Such sources produce `unknown`; plugin code and remote reads are not run. |
| Credential material escapes | Output is an enum-only projection plus a fixed evidence ID; raw errors and source details are discarded. |
| Missing model is falsely definitive | `unavailable` is emitted only for complete local observations; ambiguity is `unknown`. |
| Startup writes occur | Readiness command bypasses normal database migration and uses read-only config/auth/catalog access. |
| Developer dependencies mask packaging defects | Detached checkout removes all inherited `node_modules`, performs frozen install, builds, then runs the binary. |
| Child hangs or emits unbounded output | One request, bounded stdin/stdout, no background work, signal-aware exit; caller owns timeout. |
