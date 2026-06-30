# Research Backend

This document defines the intended durable research record model for NexusLoop.

## Purpose

The research backend exists to capture structured results, provenance, and
decision-grade evidence in a form that survives model turnover, UI changes, and
projection rebuilds.

`research.db` is a rebuildable projection, not the root authority. The root
authority remains the runtime event log.

## Typed Research Results

Research results should be typed records rather than loose prose blobs.

Examples of typed fields include:

- hypothesis or question under test
- method or execution mode
- metric summary
- observed outcome
- confidence or evidence strength
- links to artifacts and reproductions
- citations
- related event ids

Typed storage makes later search, comparison, and adjudication possible without
trusting the model to re-parse its own old prose correctly.

## Result Labels

Every research result should carry an explicit label describing its role in the
system. The core labels are:

- `probe`
- `full_training`
- `trial`
- `finding`

These labels are not cosmetic. They drive UI grouping, search, promotion rules,
and commander review behavior.

### `probe`

A quick, bounded exploration used to learn whether a direction merits deeper
investment.

### `full_training`

A heavier-weight training run or equivalent expensive execution meant to produce
substantial evidence.

### `trial`

A concrete attempt tied to a candidate, configuration, or step in the mission.
Trials should preserve outcome shape whether they succeed, fail, or abort.

### `finding`

A normalized research conclusion that can be cited, compared, and surfaced to
the commander as durable evidence.

## Artifacts, Citations, And Reproduction Records

Every meaningful result should link to supporting records where applicable.

- artifacts: logs, model outputs, generated files, plots, checkpoints
- citations: external papers, docs, URLs, or prior internal findings
- reproduction records: commands, inputs, environment details, and other data
  required to rerun or validate the result

Results without evidence may still exist as provisional notes, but they should
not be promoted as durable findings without attached support.

## Commander Write Barriers

Commander may interpret research and recommend actions, but it must cross
runtime-owned write barriers before authoritative mutation occurs.

Examples:

- promoting a result into a finding
- marking a candidate promising or exhausted
- linking a trial outcome to mission progress
- requesting spec changes due to research evidence

This prevents a conversational summary from silently becoming research truth.

## Projection Model

`research.db` should materialize runtime-friendly views such as:

- result registry
- artifact index
- citation graph or citation table
- candidate/trial relationships
- replay and reproduction lookup

Those views exist for speed and ergonomics. They do not supersede the event log.

## Read-Only Retrieval And Novelty Preview

Branch 9B4 adds a read-only research-memory retrieval and novelty-check
planner for Commander research/training decisions.

The planner:

- reads existing research memory/projections when available
- returns bounded candidate previews and pointer-only source refs
- includes prior failures by default so failed work is not repeated blindly
- computes deterministic lexical duplicate-risk and novelty-score previews
- flags repeated-looking work as needing justification
- accepts bounded repetition reasons such as replication, bug fix, changed
  model, changed dataset, changed method, changed config, inconclusive prior
  result, new external evidence, or human-directed repeat
- returns empty/missing-memory warnings when no projection exists

The planner does not decide research direction. It does not block by topic,
forbid repetition, call providers, call MCPs or online sources, launch
OpenCode, write `research.db`, ingest research records, create missions or
proposals, mutate authority records, or run Commander cycle/synthesis.

## Rebuildability

`research.db` must be rebuildable from `events.jsonl`.

That means:

- required authority fields must appear in events or event-linked durable
  records
- projection rebuild must not depend on hidden in-memory state
- the system must tolerate projection loss and recover without semantic drift

If a research fact matters, it must be representable in the runtime event
stream and its referenced durable records.
