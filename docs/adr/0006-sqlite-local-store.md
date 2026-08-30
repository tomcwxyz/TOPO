# ADR 0006 — SQLite is the first-class local store

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

TOPO needs a durable local store for claims, sources, lifecycle events and later documents/schemas. The predecessor projects use Neon/Postgres, IndexedDB and a single JSON file; none should become the canonical product format.

The storage choice should support:

- transactional claim + event writes;
- relational provenance;
- migrations;
- full-text/search extensions later;
- cross-platform local use;
- straightforward backup/export;
- no required server.

Node's built-in `node:sqlite` is promising, but remains a release-candidate API at the time of this decision. TOPO should not make its first durable persistence layer depend on an API that may still change.

## Decision

Use SQLite as the first-class local database.

Use `better-sqlite3` for the initial Node/local adapter because it is mature, synchronous, transactional and currently supports the Node versions TOPO targets.

The domain layer depends only on a `MemoryStore` contract. SQLite schema/layout is implementation detail and is not the portable TOPO format.

Browser-only standalone mode may later implement the same conceptual store contract over IndexedDB.

## Consequences

Positive:

- no local database server is required;
- claim and event updates can be committed atomically;
- schema migrations are explicit;
- SQLite is inspectable and portable at the file level;
- the adapter can later be replaced without changing TOPO semantics.

Costs:

- `better-sqlite3` is a native dependency;
- packaging must verify Windows, macOS and Linux prebuild/install behaviour;
- synchronous database work should not be placed on latency-sensitive UI threads.

## Revisit

Revisit the adapter when `node:sqlite` reaches stable status and has sufficient cross-platform/packaging experience.

This ADR chooses a first adapter, not a permanent database API.
