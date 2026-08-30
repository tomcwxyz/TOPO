# ADR 0001 — Memory and practice are separate layers

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

TOPO is intended to connect with RACK in future. Both systems can influence what an AI receives, but they represent different kinds of authority.

Memory/context is descriptive: what appears to be true, relevant or useful to know.

Practice is normative: how an AI is instructed to behave or work.

If these are modelled as one source type, observations and inferences can accidentally acquire the authority of instructions.

## Decision

TOPO will own user-governed context and memory.

RACK will own governed working practice.

RACK must not model TOPO as a `PracticeSource`. A future integration should introduce a parallel `ContextSource` abstraction with context-specific resolution semantics such as relevance, sensitivity, freshness, scope and budget.

TOPO may later propose a practice change based on confirmed evidence or repeated patterns. The change remains a candidate until explicitly accepted through RACK.

## Consequences

Positive:

- descriptive evidence cannot silently become an instruction;
- RACK's authority/precedence model remains coherent;
- TOPO can serve tools that do not use RACK;
- each product can evolve independently.

Cost:

- destination assembly must eventually combine two separately resolved layers;
- some information may appear in either system depending on intent, requiring clear UX.

## Invariant

> TOPO may suggest practice. TOPO cannot establish practice.
