# ADR 0005 — Derived documents are projections, not evidence

- **Status:** Accepted
- **Date:** 2026-08-30
- **Refined by:** [ADR 0011](0011-memory-pages-are-the-primary-durable-memory-unit.md)

## Context

Human-readable category documents and an “About Me” profile are valuable. However, repeatedly summarising generated prose and treating it as new factual evidence creates provenance loss and can amplify earlier mistakes.

ADR 0011 introduces canonical **Memory Pages**, which are themselves human-readable prose. That requires a clear distinction between:

- reviewed canonical prose that intentionally represents one durable memory; and
- generated synthesis/projection prose over several memories.

Human-readable format alone does not determine authority.

## Decision

Canonical direction is now:

```text
sources → Memory Pages → derived views / Context Packets
             │
             └── optional structured annotations
```

A **Memory Page** is canonical only after it passes the normal memory authority/review lifecycle and retains source evidence.

A generated profile, category summary, “About Me” document or other synthesis is a **derived view** over identified canonical Memory Pages.

Each generated view version must be able to record:

- the source Memory Page IDs/revisions used;
- generation time;
- generator/model metadata where applicable;
- review state;
- version lineage.

A derived view cannot, by itself, establish a new canonical Memory Page or structured annotation without an explicit source/evidence and proposal event.

## Consequences

- TOPO can use readable prose as its durable memory representation without treating every generated document as truth;
- every generated statement remains traceable to underlying canonical memories;
- derived view regeneration is safe because views are replaceable;
- manual edits to a generated view do not silently mutate underlying memories;
- context can use concise views where useful while audit/review still reaches canonical Memory Pages and source evidence.
