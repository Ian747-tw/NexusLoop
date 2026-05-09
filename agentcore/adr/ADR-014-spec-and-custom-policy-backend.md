# ADR-014: spec and custom policy backend

## Context

Project intent currently begins as plain text, prompt context, and scattered
local rules. That is insufficient for a system that needs durable approvals,
versioning, and reproducible runtime behavior.

We need a backend that can:

- onboard providers globally
- ingest project spec source material
- extract structure with LLM assistance
- ask clarifying questions
- preserve approval history
- store user custom policies as durable project truth

## Decision

Introduce a versioned spec backend as the approved project truth.

- provider onboarding is stored durably and reused across projects
- project spec onboarding begins from plain text source material
- LLM extraction produces provisional structured candidates
- clarification and approval are explicit runtime steps
- approved spec and custom policy state are versioned and queryable
- runtime spec adjustment is allowed through the unified message box, but only
  through staged, approved version updates

## Rationale

Plain prompt context is too weak to act as a contract.

- models forget
- prompts drift
- informal edits are hard to audit
- policy overlays need provenance and approval semantics

A spec backend turns project truth into something the runtime can depend on.

## Consequences

- no prompt-injection-only implementation is sufficient for spec or policy
  authority
- no prose-only instruction should silently mutate the approved project contract
- runtime decisions that depend on project truth should reference approved,
  versioned backend state

## Non-Goals

This ADR does not prescribe a final schema or storage engine beyond the need for
durable versioned state and approval tracking.
