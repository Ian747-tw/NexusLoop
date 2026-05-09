# ADR-016: OpenTUI product shell

## Context

Earlier plans assumed a browser dashboard would become the main operator
experience. That creates the wrong product center of gravity for a runtime-led
system and splits the user experience between CLI commands, browser views, and
detached approval flows.

We need a default shell that:

- opens directly from `nxl`
- supports init and resume as first-class flows
- exposes execution, command, approvals, and search in one place
- works well for local operator control

## Decision

Adopt OpenTUI as the default NexusLoop product shell.

- `nxl` should open the TUI application
- first-open initialization happens inside the TUI
- resume happens inside the TUI
- the shell includes executor, commander, system actions, search/records,
  approval/clarification, and unified message surfaces
- the shell uses resizable panels rather than separate products for each mode
- the legacy dashboard is deprecated as the primary UX target

## Rationale

OpenTUI matches the local-first operator workflow better than a browser-first
dashboard while still allowing rich state visibility and intervention.

It also reinforces the authority model:

- one session
- one runtime
- one durable event history
- one primary operator shell

## Consequences

- future product work should assume keyboard-driven TUI coverage is required
- dashboard-centric feature planning is deprecated
- compatibility surfaces may exist temporarily, but should not define the main
  architecture

## Non-Goals

This ADR defines the product shell direction. It does not claim the full TUI is
already implemented.
