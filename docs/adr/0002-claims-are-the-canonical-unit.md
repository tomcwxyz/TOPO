# ADR 0002 — Claims are the canonical memory unit

- **Status:** Superseded by [ADR 0011](0011-memory-pages-are-the-primary-durable-memory-unit.md)
- **Date:** 2026-08-30

## Context

The predecessor projects use incompatible notions of a “fact”. Some store structured key/value data; some store prose facts; some infer personal information from questions and treat confidence as the primary safeguard.

A memory system needs to represent uncertainty and origin without pretending every extracted statement is equally true.

## Original decision

TOPO's canonical unit was a **claim**.

Every claim retained:

- an epistemic type;
- user-review status;
- provenance/source identity;
- confidence;
- sensitivity;
- temporal validity where relevant;
- supersession relationships where relevant.

Initial epistemic types were:

- `assertion` — explicitly stated by the subject/user;
- `observation` — directly observed behaviour or repeated evidence;
- `inference` — model/system interpretation that goes beyond direct evidence;
- `preference` — an expressed preference;
- `derived-pattern` — a pattern derived from multiple observations.

Model confidence and user confirmation were separate dimensions.

## Supersession

ADR 0011 keeps the valuable governance distinctions proved by this ADR but changes the primary durable memory representation from atomised Claims to coherent human-readable **Memory Pages**.

Claims remain useful as optional structured annotations where structure earns its keep. They are no longer required to carry all of the meaning of memory.

The existing Claim implementation remains part of the alpha migration path and should not be removed before Memory Page compatibility is proven.
