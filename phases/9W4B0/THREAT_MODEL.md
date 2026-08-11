# Branch 9W4B0 Threat Model

## Assets

- independent Commander and Executor authorization;
- exact provider/model selection intent;
- credential-free semantic hashes;
- current 9W4A Commander transport and recovery identity;
- the distinction between observed Executor availability and verified
  Commander conformance.

## Untrusted Inputs

- caller-owned configuration objects and arrays;
- display labels;
- OpenCode catalog, connected-provider, auth, plugin, and provider-config state;
- remote model metadata and model-name patterns;
- opaque identifiers supplied before validation.

## Threats And Controls

| Threat | Control |
| --- | --- |
| OpenCode support authorizes Commander | Commander projection requires an exact NexusLoop conformance entry and never accepts OpenCode observations. |
| One role falls back to the other | Exact independent role bindings; absence fails closed. |
| Caller mutation redirects a projection | Validate, clone, canonicalize, recursively freeze, then project only from the snapshot. |
| Caller-controlled array methods forge validated authority | Dense own-index reconstruction rejects holes, accessors, symbols, non-index properties, and custom prototypes without invoking caller methods or iterators. |
| Duplicate or confusable identity | ASCII grammar, bounded normalized identifiers, and duplicate checks after normalization. |
| Secret or endpoint authority enters state/hash/error | Strict field allowlists exclude endpoint/package/header/plugin authority; credential and environment material is rejected; bounded redacted errors. Model IDs remain inert data. |
| Display/catalog drift stales authority | Display metadata and all remote observations are excluded from semantic projections and hashes. |
| Commander-only policy stales Executor | Role-specific authority projections and hashes. |
| Executor mapping stales Commander | Role-specific authority projections and hashes. |
| User or OpenCode assertion pairs a provider ID with the wrong kind | Static NexusLoop Executor mapping registry requires an exact ID/kind match and binds selected mapping policy into the Executor hash. |
| Model-name inference grants capability | Exact provider/model equality against conformance; no substring or family matching. |
| Shared profile shares runtime objects | Projections contain data only and construct no provider, fetch, SDK, session, context, or lifecycle object. |

## Trust Sources

| Source | Executor observation | Commander authority |
| --- | --- | --- |
| Model configuration snapshot | selection intent | selection intent only |
| OpenCode `models.dev` | possible catalog observation in a later branch | never |
| OpenCode `auth.json` | possible Executor connection observation in a later branch | never |
| OpenCode `provider.list` | possible Executor availability observation in a later branch | never |
| NexusLoop Commander conformance registry | not Executor readiness | required protocol/model authority |
| NexusLoop Executor provider-mapping registry | required provider-ID/kind selection authority | never Commander conformance |
| Existing Commander connector/readiness gates | none | required later in 9W4B1 |

## Residual Boundary

9W4B0 does not resolve credentials or establish role readiness. 9W4B1 must
prove scoped resolution and integration without turning OpenCode state into
Commander authority.
