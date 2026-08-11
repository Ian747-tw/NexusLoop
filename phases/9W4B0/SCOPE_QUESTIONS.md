# Branch 9W4B0 Scope Questions

All questions are resolved from the base source before production code.

## Where does the kernel live?

`agentcore/runtime/src/model-configuration/` is a new package-internal runtime
domain directory. The existing provider configuration is under
`agentcore/runtime/src/commander-agent/`, but the new vocabulary is shared
selection intent and must not make Executor authority a Commander submodule.

## Is OpenCode provider state an input?

No. OpenCode's catalog, config, auth, connected-provider list, plugins, and
loaded provider objects are excluded. Executor projection emits only an exact
provider ID and model ID after a separately validated NexusLoop-owned Executor
provider-mapping registry proves that exact provider ID belongs to the selected
provider kind. Commander projection accepts only its separate conformance
registry.

## How can one profile select both roles without sharing authority?

A profile contains only connection and model identity. Each role has an exact
binding. The connection carries role-specific mapping identifiers, while its
opaque credential-binding ID is a non-secret semantic reference. Commander and
Executor must resolve and authorize that reference independently in 9W4B1.
Neither projection contains credentials or grants one role access to the
other's credential store.

## What does `executor` mean?

Only the primary tactical OpenCode model. It does not set the small, title,
summary, compaction, command, agent, or subagent model. Those need future
explicit roles.

## How is Commander conformance represented?

A package-internal, immutable registry of exact entries binds conformance ID,
provider kind, transport kind, Commander provider ID, and exact model ID. The
user configuration references an entry but cannot define protocol authority.
Registry construction is pure for testing and future NexusLoop composition; it
is not exported as public runtime configuration in 9W4B0.

## Can model-ID syntax prove or deny endpoint authority?

No. OpenCode model IDs span broad external namespaces, including colon, slash,
dot, and URI-like forms. A finite denylist cannot distinguish every model ID
from every endpoint syntax. The exact bounded model ID is therefore inert data.
Endpoint, header, package, plugin, fetch, and callback fields are structurally
absent, and role projections cannot derive them from model text.

## Does 9W4B0 change current Commander selection or recovery identity?

No. There is no RuntimeServer wiring and no change to 9W4A provider,
capability, execution-envelope, journal, or recovery code. 9W4B1 owns legacy
environment adaptation and integration.

## Can the shared credential reference be implemented without copying secrets?

Yes at the contract level: it identifies credential authority, not storage.
9W4B1 must prove role-specific resolvers can obtain the same authority without
reading OpenCode `auth.json` from Commander or persisting duplicate material.
Until then both role readiness states remain outside this kernel.
