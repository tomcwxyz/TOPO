# ADR 0007 — Tauri desktop runtime boundary

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

RACK already ships a Tauri/React desktop architecture across Windows, macOS and Linux. Its domain and composition logic remain TypeScript while Rust owns native filesystem/document operations and packaging.

TOPO needs similar native capabilities for a durable local database, local service/MCP integration, secure secret storage, document access, backups and browser-extension pairing.

The first TOPO SQLite adapter used `better-sqlite3`, which is appropriate for Node CLI/MCP processes but is a poor desktop boundary because a Tauri WebView is not a Node runtime.

## Decision

TOPO Desktop will use Tauri 2 + React + TypeScript + Rust.

The boundary is:

```text
React / TypeScript
      |
  Tauri invoke
      |
     Rust
      |
native capabilities
(SQLite, files, secrets, local services)
```

Domain semantics remain TypeScript-first and runtime-portable. Rust mirrors only the stable interchange contract needed to validate and serialise canonical data at native boundaries; it does not independently reimplement claim lifecycle policy.

Storage is split into:

- `@topo/store` — runtime-neutral persistence contracts;
- `@topo/store-node` — Node SQLite adapter using `better-sqlite3`;
- future Rust SQLite adapter — native TOPO Desktop persistence;
- future IndexedDB adapter — standalone browser-extension persistence.

The TypeScript and Rust domain representations must share contract fixtures in CI.

RACK consumes TOPO through an explicit API/MCP/context adapter in future. It must not open TOPO's SQLite database directly.

## Consequences

Positive:

- TOPO follows a proven Good Ship desktop architecture;
- Windows/macOS/Linux packaging does not depend on a Node native SQLite module;
- CLI and MCP can remain productive TypeScript/Node applications;
- native security-sensitive capabilities stay behind a narrow Tauri boundary;
- cross-language contract drift is testable.

Costs:

- some interchange structs exist in both TypeScript and Rust;
- schema changes require cross-language fixture updates;
- desktop persistence will need its own Rust adapter and migration tests.

## Invariant

> Native implementations may differ; canonical TOPO semantics and portable data must not.
