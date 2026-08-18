# Branch 9W4B1 Threat Model

## Assets

- immutable role selection authority and role-isolated semantic hashes;
- existing Commander connector, audit, recovery, and lifecycle authority;
- OpenCode primary tactical model selection without auxiliary-model mutation;
- independent credential and readiness evidence for Commander and Executor.

## Untrusted Inputs

- RuntimeServer option objects and purported validated snapshots;
- legacy environment strings before existing parser validation;
- caller provider/model assertions on readiness and launch requests;
- Executor availability/connection observations;
- caller-owned arrays, records, accessors, proxies, and mutable resolver output.

## Controls

| Threat | Control |
| --- | --- |
| Mutable or forged validated state enters runtime | Require deeply frozen 9W4B0 snapshots, revalidate/project them, detach registry state, and freeze all outputs. |
| Getter, proxy, sparse array, symbol, or custom prototype fabricates authority | Preserve 9W4B0 own-data/null-prototype/dense-array/proxy rejection at every new structured boundary. |
| Legacy and explicit authority are silently merged | Launch configuration rejects simultaneous sources before RuntimeServer construction. |
| Caller assertions override selection | Exact provider/model equality is required whenever a role projection is active. |
| OpenCode auth/catalog authorizes Commander | Commander code imports neither upstream nor OpenCode runtime modules; only existing connector readiness is composed. |
| Executor observation creates mapping authority | Static 9W4B0 mapping is required before observations are considered. |
| Shared opaque credential ID becomes shared secret storage | Separate role-owned resolvers return bounded status evidence only. |
| Secret rotation stales selection | Selection hashes exclude live readiness; readiness evidence hashes include bounded resolver revision/status. |
| Executor profile overwrites auxiliary models | Inject only `opencode run --model provider/model`; do not write config or pass agent/command overrides. |
| Existing launch args override registry selection | Reject `--model`, `--model=...`, `-m`, and compact `-m...` when registry authority is active. |

## Fail-Closed Readiness Matrix

| Selection | Static authority | Availability | Credential | Lifecycle | Ready |
| --- | --- | --- | --- | --- | --- |
| absent | n/a | n/a | n/a | n/a | no: role unconfigured |
| selected | missing/mismatch | any | any | any | no |
| selected + verified | unknown | unknown | any | any | no |
| selected + verified | available | disconnected/unknown | any | any | no |
| selected + verified | available | connected | blocked/unknown | no |
| selected + verified | available | connected | ready | yes |

Commander availability/credential/configuration/lifecycle facts come from the
existing provider readiness preview. Executor availability/connection facts
come from its separate observation resolver; absent evidence remains unknown.
