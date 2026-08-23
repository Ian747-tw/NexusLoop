# OpenTUI UX

This document defines the intended default NexusLoop product shell. The browser
dashboard is deprecated as the primary UX and should be treated as historical
unless explicitly retained as a compatibility surface.

## Entry Point

`nxl` should open the OpenTUI application by default.

- Users should not need to choose between a CLI mode and a separate dashboard
  mode for normal operation.
- The TUI is the front door for mission setup, runtime monitoring, approvals,
  clarification, and search.
- Browser-first workflow is deprecated.

## First-Open Init Flow

When the user opens NexusLoop without an initialized project:

1. OpenTUI detects missing project/runtime state.
2. The app launches a keyboard-driven model setup view in OpenTUI rather than
   handing control to a separate dashboard or website.
3. Commander and the primary tactical Executor are selected independently from
   exact code-owned recipes; either may be intentionally left unconfigured.
4. The view separates selected/configured state, credential connection,
   lifecycle readiness, blockers, and unknown state. It previews bounded
   hashes and requires a second explicit confirmation.
5. RuntimeServer appends the credential-free selection authority to
   `events.jsonl`. It never stores or accepts API-key text in ordinary TUI
   state.
6. The first clean restart activates the immutable registry. Later changes are
   visibly pending for the next start and never hot-reload active work.
7. Project-spec approval and all existing mission/runtime gates remain separate;
   completing model setup does not imply mission readiness.

The init flow should feel like entering a system that is already alive, not a
detached setup script.

The normal onboarding panel shows active and pending model setup, independent
role readiness, and whether restart is required. `/model-setup` reopens the
same view for a later staged change; cached selections remain display evidence
and RuntimeServer reconstructs every preview and confirmation.

With no runtime-client override, legacy fake behavior is limited to pre-spec
onboarding. Once the project has an approved spec, OpenTUI constructs the real
RuntimeServer client, so a displayed model-setup commit is backed by the
append-only setup event. Explicit fake mode remains a fixture path and is not
durable setup evidence.

Executor readiness displayed by this view is fresh bounded evidence from the
production OpenCode-side observer after exact selection. `unknown` remains
blocked. The UI never receives model catalogs, credential sources, auth
records, environment names, or provider objects and cannot turn an observation
into a different selection.

## Resume Flow

When existing runtime state is present:

1. OpenTUI opens directly into the active or last-known mission context.
2. The runtime restores from `events.jsonl` and rebuilds projections such as
   `research.db` as needed.
3. The shell presents any pending approvals, clarifications, failed rebuilds,
   or interrupted execution states before resuming normal work.

Resume is a first-class product path, not an auxiliary command.

## Layout Model

The shell is composed of resizable panels. Users can rebalance the workspace
without losing the single-session mental model.

Required primary blocks:

- executor block
- commander block
- live system actions block
- search/records block
- approval/clarification block
- unified message box

## Executor Block

The executor block shows OpenCode's tactical execution surface.

- current turn activity
- tool execution and results
- subagent activity
- task-local status
- runtime notices relevant to execution

This block is where the user sees the "doing" layer of the system.

## Commander Block

The commander block shows mission and research governance state.

- mission objective and current status
- active hypotheses or next-step framing
- structured findings and pending judgments
- explanation of why the commander is asking for clarification,
  recommending a pivot, or requesting approval

This block is the "why" and "what next" layer, separate from tactical tool
execution noise.

## Live System Actions Block

The live system actions block surfaces runtime-controlled actions and their
status.

- current approvals waiting on the operator
- intervention hooks
- blocked actions and policy reasons
- rebuild/reindex/replay operations
- spec update proposals and state transitions

This block should expose operational leverage without requiring the user to
search through logs.

## Search And Records Block

The search/records block provides indexed access to durable system memory.

- research records
- findings
- trials
- artifacts and citations
- spec versions
- event-linked audit traces

This block is backed by projections and event-linked records, not model memory.

## Approval And Clarification Block

Approvals and clarifications need a dedicated surface.

- present the question, impacted state, and available choices clearly
- show whether a request comes from executor behavior, commander judgment, or
  runtime policy
- record the operator's answer as a structured event

The user should never need to infer whether a prose reply actually changed
system state.

### Commander Recovery Controls

The approval block also hosts the six Commander recovery controls: bounded
list, show, current preview, explicit approval, separate execution, and active
operation cancellation. The UI displays recovery kind, exact operator-safe
authority hashes, abbreviated confirmation references, fresh-context and
no-replay guarantees, and an explicit unknown-outcome warning when a historical
provider request is pending.

Approval and execution are never combined. Approval requires every explicit
acknowledgement; a generic yes is insufficient. Execute returns a
RuntimeServer-owned operation immediately so the UI remains responsive and can
send cancellation while recovery is active. The UI says "cancellation
requested", not "cancelled", and refreshes durable show state to distinguish a
terminal result from a consumed nonterminal attempt requiring human review.

Cached preview and operation state are display evidence only. Every mutation
sends exact identifiers/hashes to RuntimeServer for fresh validation.

## Unified Message Box

The user interacts through one message box that can route intent to the right
layer.

- normal mission instructions
- clarification answers
- spec change requests
- runtime adjustment requests
- approval responses

The message box must not imply that all messages are equal. The runtime should
decide whether a message is conversational, requires clarification, proposes a
spec update, or requests a state transition.

## Resizable Panels

Panel resizing is part of the product definition, not an optional flourish.

- users need to expand execution detail during debugging
- users need to expand search/records during investigation
- users need to foreground approvals during decision-heavy flows

The shell should support focused work without forcing modal context switches.

## Deprecated Surface

The legacy dashboard is deprecated.

- Do not treat it as the default UX target for new product work.
- Do not design future workflows assuming a browser dashboard is the main shell.
- Compatibility shims may exist temporarily, but OpenTUI is the intended
  product surface.
