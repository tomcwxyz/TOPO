# ADR 0002 — Claims are the canonical memory unit

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

The predecessor projects use incompatible notions of a “fact”. Some store structured key/value data; some store prose facts; some infer personal information from questions and treat confidence as the primary safeguard.

A memory system needs to represent uncertainty and origin without pretending every extracted statement is equally true.

## Decision

TOPO's canonical unit is a **claim**.

Every claim must retain:

- an epistemic type;
- user-review status;
- provenance/source identity;
- confidence;
- sensitivity;
- temporal validity where relevant;
- supersession relationships where relevant.

Initial epistemic types:

- `assertion` — explicitly stated by the subject/user;
- `observation` — directly observed behaviour or repeated evidence;
- `inference` — model/system interpretation that goes beyond direct evidence;
- `preference` — an expressed preference;
- `derived-pattern` — a pattern derived from multiple observations.

Model confidence and user confirmation are separate dimensions.

## Consequences

- a high-confidence inference remains visibly an inference;
- extraction prompts can be generous without silently converting interpretation into fact;
- contradictions and changes over time can be represented rather than flattened;
- adapters can use a simple human-readable rendering without losing structured metadata.

The exact TypeScript/storage schema may evolve. These semantic distinctions require an ADR change to remove.
