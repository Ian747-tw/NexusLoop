# Spec Backend

This document defines the intended backend for provider configuration, project
spec state, and user-custom policy rules.

## Purpose

The spec backend exists to turn plain-language project intent into approved,
versioned, runtime-usable structure without pretending that extraction output
or model prose is automatically authoritative.

It is responsible for:

- provider onboarding state
- project spec onboarding and normalization
- clarification tracking
- approval records
- user custom policy and rule overlays
- versioned spec state consumed by the runtime

## Global Provider Onboarding

Provider onboarding is global user configuration rather than project-local
mission memory.

- provider credentials, model access, and capability checks should be captured
  through a durable onboarding flow
- onboarding outcomes should be stored in a backend that can be reused across
  projects
- the runtime should expose missing or invalid provider state as explicit
  blocking conditions

The user should not have to restate stable provider setup every time a new
project is created.

## Project Spec Onboarding From Plain Text

Project onboarding starts from user-supplied plain text and related documents.

Examples:

- a raw project brief
- requirements notes
- hard constraints
- local policy files
- pasted instructions in the message box

These inputs are the source material for extraction. They are not, by
themselves, a normalized runtime contract.

## Extraction, Clarification, And Approval

The intended flow is:

1. Ingest plain-text source material.
2. Use an LLM to extract structured spec candidates.
3. Detect ambiguity, conflicts, or missing required fields.
4. Ask the user targeted clarification questions.
5. Present the resulting structured spec for approval.
6. Persist the approved spec version and its provenance.

Important constraints:

- extraction output is provisional until approved
- clarification responses must be attached to the relevant proposed version
- approval is a runtime event, not an informal conversational assumption

## Spec Versioning

Spec state must be versioned.

Each version should preserve:

- normalized content
- source inputs and provenance
- clarification history
- approval status and approver identity
- supersession lineage

Runtime behavior should always reference a concrete approved version rather than
"whatever the model last said the spec was."

## User Custom Policy And Rules

Users need a durable place to define custom project rules beyond the base
product policy surface.

Examples:

- execution boundaries
- safety constraints
- preferred evaluation methodology
- forbidden tools or actions
- reporting requirements

These rules should be stored as explicit backend state with versioning and
approval semantics, not as scattered prompt snippets that may or may not be in
context.

## Runtime Spec Adjustment Through Message Box

Users should be able to adjust the project spec through the same unified OpenTUI
message box used for normal interaction.

That flow should:

1. interpret the message as a proposed spec change
2. stage a new candidate version
3. request clarification when the change is ambiguous
4. present the delta for approval
5. commit the new version only after approval

This keeps the UX simple without allowing free-form prose to silently mutate the
approved project contract.

## Authority Rules

The spec backend is the approved project truth only after durable approval.

- plain text is input
- extraction is proposal
- clarification is resolution
- approval is authority
- versioned backend state is what the runtime should trust

No component may treat transient prompt context as a substitute for approved
spec state.
