# ADR 0003 — Local-first core and portable storage

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

The predecessor implementations use Neon/Postgres, browser IndexedDB and a single local JSON file. None should become TOPO's product contract.

The project needs strong local operation while remaining usable from browser-only and future managed environments.

## Decision

TOPO will separate the domain/core API from storage implementations.

The first-class local implementation will use an embedded database suitable for relationships, migrations, search and audit history.

Browser standalone mode may use IndexedDB behind equivalent repository contracts.

A documented versioned portable bundle will be independent of either database representation.

No account, hosted database, telemetry service or cloud model is required for the core product.

## Consequences

- storage can evolve without changing TOPO's conceptual model;
- extension and local-service modes can converge on one domain contract;
- exports remain useful if TOPO ceases to exist;
- migration/versioning becomes an explicit engineering responsibility.

A managed sync service, if later added, must not become the only canonical store.
