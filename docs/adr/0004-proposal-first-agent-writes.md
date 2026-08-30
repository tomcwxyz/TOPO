# ADR 0004 — Agent writes are proposal-first

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Allowing an AI client to write directly to durable personal memory creates compounding errors: an inference can become established context and then be repeatedly re-used as evidence.

The current MCP prototype has a useful draft workflow, but also provides direct-write tools that default persisted facts to confirmed.

## Decision

The default machine-write path in TOPO is:

```text
propose → review/edit → confirm or reject
```

Machine-created claims begin as candidates.

Interfaces should make proposal the obvious/default operation. Direct confirmed writes may exist only as an explicit higher-trust capability granted by the user or calling environment.

Manual user entry can be confirmed immediately because the user is the authority performing the write.

## Consequences

- autonomous agents can contribute without silently rewriting the user's durable context;
- candidate review becomes a core UX rather than an extension-specific feature;
- high-volume capture requires useful deduplication, batching and review tools;
- trusted automation remains possible through explicit permissions.

Confirmation is not the same as truth: confirmed claims still retain epistemic type, source and temporal state.
