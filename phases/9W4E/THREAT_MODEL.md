# 9W4E Threat Model

| Threat | Control |
| --- | --- |
| TUI state becomes authority | Server reconstructs candidates from exact recipe IDs and revalidates every preview/commit. |
| Matrix/catalog/user claim creates Commander support | Exact built-in setup catalog and conformance registry only. |
| Secret or endpoint enters setup | Exact credential-free event allowlist; configuration grammar; recursive forbidden-value tests. |
| Stale/concurrent confirmation wins | Expected revision, candidate hash, and EventStore expected-tail compare-and-append. |
| Partial write becomes active | Strict JSON/event/hash projection fails closed. |
| Active registry mutates | Startup-only construction; commit is pending-next-start. |
| Role fallback shares authority | Independent explicit bindings; unconfigured remains unconfigured. |
| Equal credential IDs share secrets | Commander and Executor readiness resolvers remain independent. |
| Legacy/explicit/persisted authority merges | Pairwise startup conflict checks. |
| Setup changes auxiliary OpenCode models | Existing exact single primary `--model` projection only. |
| Caller object methods/proxies execute | Setup parser delegates semantic state to hardened ADR-035 validators and reconstructs exact primitive recipe inputs. |
| Shutdown races append | Commit registers owned work before its first await, acquires or reuses the run lock, and shutdown drains it before `runtime_shutdown`. |
| OpenCode catalog/auth becomes selection authority | Observer receives an exact immutable projection and emits only matching tri-state evidence; unrelated entries are discarded in the child. |
| Raw OpenCode state crosses process boundary | Strict one-object protocol and output cap; no lists, auth records, paths, URLs, headers, plugin data, or raw errors are accepted. |
| Partial OpenCode state becomes definitive absence | Child/process/timeout/truncation failures map to `unknown`; only a complete observation may emit `unavailable` or `disconnected`. |
| Observer outlives RuntimeServer | Runtime owns each subprocess before its first await; shutdown terminates and drains all observations before `runtime_shutdown`. |
| Fixture or caller forges readiness identity | Runtime validates projection/provider/model/binding/version and recomputes the evidence ID from safe semantic results. |
| Environment replaces the production observer | Launch rejects the former observer command/argument keys; production always spawns the checked-in OpenCode-side child through `process.execPath`. |

GitHub/provider content and OpenCode observations remain evidence, not setup
authority. No provider request is performed during setup.
