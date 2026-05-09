# ADR-015: research DB and results registry

## Context

Research-heavy runtime behavior cannot depend on transient model memory,
unstructured prose, or ad hoc local files if we expect recovery, search,
comparison, and promotion discipline.

We need:

- typed research results
- stable result labels
- artifact and citation linkage
- reproduction records
- a searchable registry
- rebuildability from the authoritative event stream

## Decision

Adopt a typed research results registry backed by a rebuildable `research.db`
projection.

- authoritative research state is emitted through runtime events
- `research.db` stores searchable projections and indexes
- core labels include `probe`, `full_training`, `trial`, and `finding`
- results link to artifacts, citations, and reproduction records
- commander recommendations cross runtime write barriers before durable mutation

## Rationale

This keeps research memory durable and auditable without trusting the model to
reconstruct old evidence correctly from prose.

It also separates concerns cleanly:

- events carry authority
- projections carry ergonomics and query performance
- commander carries interpretation, not unilateral mutation authority

## Consequences

- in-memory-only candidate, trial, or finding authority is forbidden
- a deleted projection database must be recoverable from `events.jsonl`
- promotion and mission-impacting judgments require structured durable records,
  not conversational summaries alone

## Non-Goals

This ADR does not claim that the registry is already implemented. It defines the
required authority boundary for future work.
