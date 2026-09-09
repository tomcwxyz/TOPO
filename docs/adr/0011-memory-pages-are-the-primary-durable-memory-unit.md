# ADR 0011 — Memory Pages are the primary durable memory unit

- **Status:** Accepted
- **Date:** 2026-09-09
- **Supersedes:** ADR 0002 in its choice of Claims as the canonical memory unit
- **Refines:** ADR 0005 by distinguishing canonical Memory Pages from generated projection documents

## Context

TOPO began with Claims as the canonical memory unit. That gave the alpha a strong governance model: provenance, epistemic type, review state, sensitivity, temporal validity and supersession were explicit rather than hidden inside generated prose.

However, treating every useful memory as a structured claim also pushes capture towards atomisation. Nuanced context can be split into many small key/value facts, losing the surrounding meaning that made the original conversation useful and increasing review work.

TOPO's product goal is broader than maintaining a fact database. It is to preserve useful, user-owned context in a form that can move across AI systems and beyond them.

A durable memory representation should therefore remain useful when opened as a file, versioned in Git, read in a notes tool, supplied directly to another model or imported into a future context system.

## Decision

TOPO's primary durable memory unit is a **Memory Page**: a short human-readable piece of contextual prose plus compact governance metadata and links to source evidence.

The body of the Memory Page is the memory. Metadata governs the memory.

Claims remain supported as **optional structured annotations** where structure materially helps with temporal comparison, deterministic filtering, explicit constraints/preferences or interoperability.

The durable direction becomes:

```text
sources → Memory Pages → Context Packets
             │
             └── optional structured annotations
```

Generated profiles, category summaries and other synthesised views remain projections over canonical memories and are not evidence in their own right.

## Governance

The move to prose-first memory does not weaken TOPO's governance model.

Memory Pages retain:

- review/authority state;
- provenance and source identity;
- sensitivity;
- temporal validity and horizon;
- version/supersession history;
- disclosure boundaries;
- optional epistemic annotations where useful.

Semantic relevance never implies permission to disclose context.

## Portability

The portable format should make Markdown Memory Pages first-class.

Indexes, including any semantic embedding index, are disposable caches that must be reconstructable from canonical memory and metadata.

A TOPO export should remain meaningfully usable without TOPO itself.

## Retrieval

Context resolution operates over authorised Memory Pages and optional annotations.

Retrieval may combine:

- metadata and temporal filters;
- full-text search;
- optional local semantic search;
- purpose/task-aware ranking;
- context budgets.

Consumers receive stable purpose-bound Context Packets rather than direct access to TOPO's internal representation.

## RACK consequence

RACK consumes TOPO through a `ContextSource` abstraction and must not depend on whether TOPO internally stores Memory Pages, Claims or future representations.

TOPO supplies the context appropriate to the stated purpose. RACK separately supplies governed practice for how the AI should work.

TOPO memory may propose a RACK practice change but cannot establish one automatically.

## Migration

The existing Claim implementation remains valid alpha infrastructure during migration.

Migration is additive:

1. introduce Memory Pages alongside Claims;
2. preserve all current Sources, Events and provenance;
3. link useful Claims as structured annotations;
4. change capture to propose coherent Memory Pages first;
5. make retrieval and Context Packets page-aware;
6. make Markdown pages first-class in export/import;
7. remove the assumption that every confirmed memory must be a Claim only after compatibility is proven.

## Consequences

- memory can retain more of the meaning present in the source interaction;
- the inbox can review fewer, richer candidate memories;
- portability becomes a property of the canonical representation rather than only an export feature;
- structured facts remain available without forcing all memory into a schema;
- TOPO stays more loosely coupled to RACK and other consumers;
- retrieval indexes can evolve without threatening the user's durable memory;
- migration work is required across schemas, capture, review UX, retrieval and bundle formats.
