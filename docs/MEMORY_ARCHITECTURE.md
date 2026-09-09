# TOPO memory architecture

## Purpose

TOPO is a portable, user-owned context layer for AI and other tools.

The durable thing TOPO preserves should be useful outside TOPO itself. A person should be able to inspect it, copy it, version it, search it, give it to another model, use it in a notes tool, or leave TOPO entirely without first reconstructing meaning from a proprietary database.

This leads to a prose-first architecture:

> **Memory should preserve meaning first and structure only where structure earns its keep.**

TOPO therefore treats a **Memory Page** as the primary durable memory object. Claims remain available as optional structured annotations for cases where machine-readable structure materially improves reasoning, comparison, temporal change or interoperability.

## Core model

```text
captured sources
      │
      ▼
proposed Memory Pages
      │
      ▼
review / edit / confirm
      │
      ▼
canonical Memory Pages ───────► optional structured annotations
      │                                    │
      ├──────────────┬─────────────────────┘
      ▼              ▼
   FTS index    semantic index
      │              │
      └──────┬───────┘
             ▼
      context resolver
             │
             ▼
      Context Packet
             │
      ┌──────┴─────────┐
      ▼                ▼
     RACK          other AI/tools
```

Sources and event history sit underneath this flow and remain the evidence trail.

## Memory Page

A Memory Page is a short, human-readable piece of contextual prose plus compact governance metadata.

It should usually capture one coherent thing worth remembering: a project decision, a preference with useful context, a working relationship, a recurring pattern, a current circumstance, or a piece of background likely to improve future work.

Example:

```markdown
---
id: mem_018f...
title: RACK architecture decisions
status: confirmed
sensitivity: ordinary
horizon: project
created: 2026-08-31
updated: 2026-09-09
valid_from: 2026-08-31
sources:
  - chat_018...
tags:
  - rack
  - architecture
---

RACK uses Neon rather than Supabase.

The managed architecture uses Neon Postgres with Drizzle and Neon Auth,
while local projects remain account-free. The choice of Neon is deliberate,
so future architecture work should not introduce Supabase as a dependency.
```

The body is the memory. The metadata governs it.

### Required qualities

A good Memory Page should be:

- **coherent** — readable as a small unit of context rather than an atomised fact dump;
- **portable** — useful as plain Markdown without TOPO-specific runtime machinery;
- **traceable** — linked to the source evidence that supports it;
- **governed** — review state, sensitivity and temporal validity remain explicit;
- **bounded** — concise enough to retrieve and compose into a context packet;
- **editable** — a person can correct the memory in ordinary language;
- **versionable** — meaningful edits and supersession remain visible.

## Structured annotations and claims

Claims are no longer the definition of memory.

They remain useful where structure provides a concrete benefit, for example:

```text
preferred_language = British English
rack.database = Neon
location = Austria, valid_until 2026-08-25
```

Structured annotations can support:

- temporal comparison and supersession;
- deterministic filters;
- explicit preferences or constraints;
- interoperability with systems expecting key/value facts;
- confidence or epistemic distinctions that are genuinely useful to expose;
- evaluation of changes across Memory Page versions.

A Memory Page may have zero, one or several structured annotations. An annotation must remain traceable to the Memory Page and ultimately to source evidence.

TOPO must not force nuanced context into many claims merely because it can.

## Governance remains first-class

Prose-first memory does not mean ungoverned memory.

Every durable Memory Page must retain enough metadata to answer:

- where did this come from?
- when was it learned or changed?
- has the person reviewed it?
- is it current, historical or temporary?
- how sensitive is it?
- is it appropriate to disclose for this purpose?
- what evidence supports it?

Semantic relevance is never sufficient permission to disclose memory.

The context decision remains conceptually:

```text
relevant
AND authorised
AND sufficiently trustworthy
AND current enough for the purpose
AND within the disclosure boundary
= eligible context
```

## Sources and evidence

A Source represents original evidence: a captured conversation, document, manual note, import, connector record or explicit memory contribution.

Memory Pages should cite Source IDs. Where practical they may also retain evidence excerpts or source spans, but generated prose must not masquerade as its own source.

The durable direction is:

```text
sources → Memory Pages → Context Packets
             │
             └── optional structured annotations
```

Generated profile documents, summaries and other views remain projections over canonical Memory Pages. They do not become evidence merely because a model wrote them.

## Events and temporal change

TOPO remains append-oriented. Meaningful events include:

- `source.captured`
- `memory.proposed`
- `memory.confirmed`
- `memory.edited`
- `memory.rejected`
- `memory.superseded`
- `memory.expired`
- `annotation.added`
- `annotation.changed`
- `context.resolved`
- `context.shared`

TOPO should distinguish duplicate information, supporting evidence, extension, contradiction, replacement and historical change.

Editing a page should not erase meaningful history. A newer state can supersede an older one while retaining the older context where it matters.

## Retrieval

TOPO's retrieval infrastructure is disposable; the memory is not.

The first-class portable representation is Memory Pages plus governance/evidence metadata. Retrieval indexes may be deleted and rebuilt.

Use a layered resolver:

```text
governance filters
       ↓
FTS + metadata filtering
       ↓
optional local semantic search
       ↓
purpose/task-aware ranking
       ↓
context budget + composition
       ↓
Context Packet
```

TOPO should not require a vector database. A small local embedding index, stored in or alongside SQLite and reconstructable from Memory Pages, is acceptable when it materially improves retrieval.

Retrieval must not widen permissions. Sensitivity, purpose, explicit sharing state and temporal validity are applied before or alongside relevance scoring.

## Portable representation

TOPO's portable contract should be genuinely useful without TOPO.

Target shape:

```text
topo/
├── memories/
│   ├── rack-architecture.md
│   ├── writing-style.md
│   └── project-context.md
├── sources.jsonl
├── annotations.jsonl
├── events.jsonl
├── manifest.json
└── index.sqlite        # optional, disposable, rebuildable
```

The exact package format remains versioned, but the principles are:

- Markdown memories are first-class;
- metadata is open and documented;
- structured annotations are optional rather than required to reconstruct meaning;
- indexes are caches, not canonical data;
- export must preserve provenance and history;
- import must remain conservative about identity/conflicts.

A TOPO export should be usable from a filesystem, Git repository, Obsidian-style notes workflow, local agent, cloud AI or another future context system.

## Capture

Ambient capture remains useful, but the extraction question changes.

Old framing:

> Which atomic claims can we extract from this conversation?

New framing:

> What small pieces of context would materially improve a future interaction, and can each be expressed as a coherent memory with traceable evidence?

The candidate inbox should therefore optimise for a small number of useful proposed Memory Pages. Structured annotations may be proposed behind the scenes or alongside a page where they add value, but should not multiply review work unnecessarily.

Evaluation should reward:

- usefulness in later tasks;
- contextual completeness;
- faithfulness to source evidence;
- low overreach;
- low duplication;
- temporal correctness;
- low review effort;
- successful cross-tool recall.

Raw extraction volume is not a success metric.

## RACK integration

The architecture strengthens the TOPO/RACK boundary.

TOPO answers:

> **What context is appropriate for this work?**

RACK answers:

> **How should the AI work?**

RACK must not depend on Memory Pages, claims, annotations or TOPO's SQLite schema directly. It consumes a stable `ContextSource` abstraction and receives purpose-bound Context Packets.

A packet can contain concise rendered excerpts from one or more Memory Pages with provenance and disclosure metadata. RACK can then combine that context with its separate governed practice modules.

```text
TOPO Memory Pages
       │
       ▼
TOPO context resolver
       │
       ▼
Context Packet
       │
       ▼
RACK ContextSource ─────┐
                       │
RACK PracticeSources ───┼──► assembled working context
                       │
other task context ─────┘
```

Important invariants:

- TOPO memory never becomes RACK practice automatically;
- RACK does not persist a hidden copy of the person's whole TOPO memory;
- a Context Packet is purpose-bound disclosure, not a reusable profile;
- static RACK builds may snapshot a packet only with explicit provenance/revision metadata;
- live-capable RACK destinations can request fresh context when the purpose changes;
- repeated confirmed context may propose a RACK practice change, but the person must review that change;
- RACK should work when TOPO is absent, and TOPO should remain useful to systems that know nothing about RACK.

This looser coupling is essential to true portability.

## Compatibility and migration

The existing claim-based alpha is valuable evidence and should not be discarded.

Migration should be additive:

1. introduce the Memory Page contract alongside current Claims;
2. render existing confirmed Claims into provisional pages without treating generated prose as new evidence;
3. change capture extraction to propose pages first;
4. link existing Claims as annotations where they remain useful;
5. make context resolution page-aware while preserving the existing Context Packet transport;
6. migrate review UX from claim cards towards coherent memory-page review;
7. update export/import so Markdown pages are first-class;
8. only then remove assumptions that every durable memory must be a Claim.

Existing source IDs, event history and provenance must survive migration.

## Non-goals

TOPO is not trying to become:

- a knowledge graph;
- an ontology authoring tool;
- a vector database product;
- an organisational surveillance layer;
- an autonomous profile inference engine;
- a replacement for an agent's bounded working memory;
- a replacement for RACK practice.

The aim is simpler: **keep useful context in a form a person owns, understands and can carry anywhere, while governing when and how that context is used.**
