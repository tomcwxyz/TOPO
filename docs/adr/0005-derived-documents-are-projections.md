# ADR 0005 — Derived documents are projections, not evidence

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Human-readable category documents and an “About Me” profile are valuable. However, repeatedly summarising generated prose and treating it as new factual evidence creates provenance loss and can amplify earlier mistakes.

The current browser extractor also uses timestamps to guess whether a fact has been merged into a document, which does not prove incorporation.

## Decision

Canonical direction is:

```text
sources → claims → derived documents → context views
```

Generated documents are projections over identified claims.

Each generated version must be able to record:

- the source claim IDs used;
- generation time;
- generator/model metadata where applicable;
- review state;
- version lineage.

A derived document cannot, by itself, establish a new canonical claim without an explicit new source/evidence event.

## Consequences

- every generated statement remains traceable to underlying memory;
- document regeneration is safe because documents are replaceable;
- manual edits can be retained as document edits without silently mutating claims;
- context can use concise documents while audit/review still reaches canonical evidence.
