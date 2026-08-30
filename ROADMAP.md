# TOPO Roadmap

The roadmap is staged to validate the memory model before expanding capture surfaces or managed infrastructure.

## Phase 0 — Foundation

**Goal:** establish the project contract before moving code.

Deliverables:

- product plan and principles
- architecture decision records
- canonical terminology
- repository conventions
- licence and contribution/security guidance
- CI/test/release conventions
- predecessor migration inventory
- initial threat model

**Exit:** architecture boundaries are explicit enough that old implementations can be mined for features without importing their assumptions.

## Phase 1 — Core

**Goal:** prove the canonical memory model locally.

Build:

- Claim, Source, Event, Schema and MemoryDocument types
- validation
- candidate → confirmed/rejected lifecycle
- edits, supersession and expiry
- sensitivity
- storage abstraction
- embedded local store + migrations
- audit events
- CLI
- search
- native import/export bundle
- deterministic tests

**Exit:** a complete useful memory can be created, reviewed, searched and exported without a browser extension or cloud service.

## Phase 2 — MCP

**Goal:** let multiple AI clients use and contribute to one local TOPO store.

Build:

- stdio MCP transport
- `memory_search`
- context retrieval
- candidate proposal/review/edit/discard/confirm
- explicit higher-trust direct-write permission
- stale review
- change history
- schema inspection
- import/export
- resources
- rate limiting and safe transport defaults

**Exit:** two different MCP-compatible clients can safely use the same local store.

## Phase 3 — Browser capture

**Goal:** migrate the strongest parts of `llm-memory-extractor`.

First adapters:

1. Claude
2. ChatGPT
3. generic adapter interface

Then:

- Gemini
- Mistral
- Perplexity
- Grok

Capabilities:

- conversation capture
- extraction
- candidate review
- provider abstraction
- local-model option
- standalone IndexedDB mode
- connected local-service mode

**Exit:** captured conversations from Claude and ChatGPT can create reviewed TOPO claims that are usable by an MCP client.

## Phase 4 — Derived documents

**Goal:** create useful human-readable memory without losing provenance.

Build:

- category documents
- About Me/profile view
- source claim IDs on every generated version
- diff review
- version history
- manual edits
- filesystem sync
- Markdown export
- OKF import/export

**Exit:** every generated document can be traced back to canonical claims.

## Phase 5 — Context resolution

**Goal:** replace “return my profile” with task-relevant context.

Build:

- purpose/query-aware retrieval
- sensitivity filtering
- category visibility
- freshness/confidence weighting
- token/context budgets
- explainable selection
- context manifest and digest
- `memory://context/... ` resources

Optional later:

- embedding-assisted retrieval

**Exit:** different tasks receive compact, explainable and appropriately scoped context.

## Phase 6 — Migration and import

**Goal:** make TOPO useful immediately to people with existing AI histories.

Importers:

- ChatGPT export
- Claude export
- Gemini/Google export
- generic conversation archives
- legacy MyMemory export
- legacy llm-memory-extractor store
- legacy mymemory-mcp-server store
- OKF
- Markdown

Imports preserve provenance, deduplicate, identify contradictions and enter review where appropriate.

## Phase 7 — RACK bridge

**Goal:** connect contextual memory to governed practice without conflating them.

Build:

- TOPO-backed RACK ContextSource
- context snapshots
- build provenance/digest
- sensitivity controls
- context budgets
- live mode where supported
- static snapshot mode where required
- prototype “promote to practice” review flow

**Invariant:** no automatic change to RACK practice.

## Phase 8 — Optional sync / managed TOPO

Only after the local system is trustworthy:

- encrypted multi-device sync
- remote TOPO service
- backup/recovery
- server-assisted connectors
- team/shared context boundaries
- mobile client

Managed features must not make the local-first implementation second-class.

---

## First five implementation iterations

### Iteration 1 — Domain contract
- monorepo/tooling
- `packages/core`
- Claim, Source and Event schemas
- lifecycle invariants
- unit tests

### Iteration 2 — Local persistence
- repository interfaces
- embedded store
- migrations
- candidate review persistence
- event log

### Iteration 3 — CLI and portability
- add/propose/review/confirm/search commands
- expiry/supersession
- native TOPO bundle
- import/export round-trip tests

### Iteration 4 — MCP
- shared-core MCP package
- stdio server
- proposal-first tools
- retrieval resources
- permissions/security hardening

### Iteration 5 — Browser end-to-end
- extension shell
- Claude + ChatGPT adapters
- extraction into canonical claims
- candidate review
- connected TOPO service mode

After Iteration 5, stop and test the actual cross-tool experience before migrating more legacy surface area.
