# Architecture Decision Records

TOPO uses ADRs for durable architectural choices. Implementation details can change without an ADR; changes to the product's authority, privacy or source-of-truth model should not.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-memory-and-practice-are-separate.md) | Context/memory and governed practice are separate layers | Accepted |
| [0002](0002-claims-are-the-canonical-unit.md) | Claims, with explicit epistemic type and provenance, are canonical | Accepted |
| [0003](0003-local-first-core-and-portable-storage.md) | Core is local-first; storage is replaceable; portable format is independent | Accepted |
| [0004](0004-proposal-first-agent-writes.md) | Agent writes are proposal-first by default | Accepted |
| [0005](0005-derived-documents-are-projections.md) | Generated memory documents are derived projections, not evidence | Accepted |
| [0006](0006-sqlite-local-store.md) | SQLite is the first-class local store, behind a replaceable adapter | Accepted |
| [0007](0007-tauri-desktop-runtime-boundary.md) | Desktop uses Tauri/Rust for native capabilities while domain semantics remain portable | Accepted |
| [0008](0008-mcp-review-authority-is-explicit.md) | MCP clients are agents by default; user review authority requires explicit delegation | Accepted |
