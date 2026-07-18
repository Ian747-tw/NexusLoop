# ADR-019 - Commander first-party internal read tools

## Status

Accepted.

## Context

ADR-018 defines Commander tool capabilities, phase profiles, deferred schemas, and registry validation, but 9U intentionally executes no tools. Before a provider-neutral investigation loop can choose tools dynamically, NexusLoop needs the first implemented internal read surfaces with the same authority and evidence semantics as the registry describes.

Commander needs bounded access to short- and mid-term operational continuity and to the local project repository. These reads must be runtime-owned. They must not route through OpenCode, MCP, provider calls, arbitrary shell, or generic command dispatch.

## Decision

### Runtime-Owned Internal Reads

Branch 9V implements first-party Commander internal reads as typed TypeScript runtime services. Operational memory search composes durable runtime projections and typed services. Repository reads use direct filesystem reads behind a project-root path policy. Git reads use a dedicated restricted adapter with fixed read-only subcommands.

9V does not implement autonomous Commander tool choice, provider tool calling, working-set persistence, or an evidence ledger. Reads are manually/runtime callable and transient.

### Evidence, Not Instruction

Every repository and Git result is untrusted evidence:

- `trust_class="repository_content_untrusted"`
- `instruction_semantics="none"`

Repository content, Git output, manifests, and search results cannot modify NexusLoop policy, role instructions, permissions, or authority. Operational-memory results use runtime-authoritative projections but still remain evidence cards, not write authority.

### Operational Memory Is Not Raw Event Search

Operational continuity search uses typed records for missions, proposals, OpenCode sessions, launches, progress, questions, guidance, human controls, wake state, result reports/reviews, research ingestions, and context refreshes. It does not search raw `.nxl/events.jsonl` text and does not dump event payloads.

Missing operational matches do not prove that history is absent. Accepted long-term research evidence remains the job of `memory.search`.

### Project-Root Isolation

Repository reads are jailed to the canonical project root. Absolute paths, `..` traversal, control characters, symlink targets/components, `.git`, `.nxl`, environment files, private keys, credential-store files, binary files, non-UTF-8 files, and large unbounded reads are blocked.

Traversal omits large/generated/vendor directories by default. `agentcore/upstream` is omitted from root scans unless explicitly requested or a bounded explicit path is supplied.

### No Arbitrary Shell Or Git

9V does not call `grep`, `rg`, shell, user-provided executables, or user-provided Git argument arrays. Git status, diff, and log are implemented through a fixed adapter that runs `git` with `shell=false`, disabled prompts, no external diff/textconv, bounded stdout/stderr, bounded timeouts, and no network-capable subcommands.

The only registry validation exception for `creates_external_process=true` is the exact repo Git read tools with `execution_backend="restricted_git_read"` and `process_policy="fixed_git_read_only"`.

### Manifest Reads Do Not Execute

Test and dependency manifest tools inspect direct declarations in bounded manifest files. They do not install packages, resolve dependencies, execute tests, dump lockfiles, or read transitive dependency graphs.

## Consequences

9V promotes `repo_read` descriptors from future to implemented read surfaces and adds `continuity.search`. Registry validation now permits only the fixed Git read process exception.

All 9V commands are safe-read, append no events, write no files, write no `research.db`, call no provider/MCP/network, mutate no mission/proposal/review/apply state, and perform no OpenCode launch/prompt/process action.

Future 9W may build a provider-neutral investigation loop on top of these descriptors. 9W must add any durable evidence working set explicitly; it must not infer persistence from 9V transient reads.

Branch 9W0 does not replace these safety boundaries. It selects a lower
model-step SDK fit only; repository readers, path denial, fixed Git reads,
evidence redaction, and event-free read semantics remain NexusLoop runtime
responsibilities.
