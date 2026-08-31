# TOPO Roadmap

The immediate product priority is now **capture**: TOPO has a credible governed local memory core and a working context path into RACK, but it does not yet learn enough from normal work to be useful day to day.

The near-term milestone is:

> Use AI tools normally for a day, open TOPO, review a short high-quality inbox of things worth remembering, then see confirmed context surface correctly in another tool.

See [Capture architecture](docs/CAPTURE.md) and [capture surfaces](docs/CAPTURE_SURFACES.md).

## Completed foundation

### Phase 0 — Foundation

Product principles, architecture boundaries, ADRs, threat model and repository conventions are established.

### Phase 1 — Core

Claim/Source/Event contracts, proposal-first lifecycle, sensitivity, expiry/supersession, SQLite persistence, audit events, CLI, search and portable bundles are implemented.

### Iteration 2.5 — Desktop runtime alignment

Tauri/React desktop architecture, runtime-neutral storage contracts and shared TypeScript/Rust interchange fixtures are implemented.

### Phase 2 — MCP

A proposal-first stdio MCP server is implemented with search, candidate proposal, optional delegated review, history and sensitivity ceilings.

### Early RACK/OOS context bridge

TOPO Desktop exposes an authenticated loopback context endpoint with explicit per-session sharing consent. RACK can discover TOPO, request selected context and record context provenance.

This bridge is useful enough for current testing. Do not broaden it ahead of capture.

---

## Phase 3 — Capture-first product loop

### Iteration 5A — Capture contract

**Goal:** make captured interactions a first-class input to canonical TOPO memory.

Build:

- the TOPO capture package;
- captured interaction and turn contracts;
- ChatGPT, Claude, Gemini, Copilot, agent and generic source identities;
- user-evidence requirement;
- memory horizons: durable / project / temporary;
- default review-window source retention;
- candidate preparation over the canonical Claim lifecycle;
- duplicate/supporting-evidence/potential-change comparison;
- conservative extraction prompt and tests.

**Exit:** a captured interaction plus extracted proposals can produce traceable candidate Claims without weakening review authority.

### Iteration 5B — Desktop ingestion and extraction

**Goal:** accept captured interactions without manual data entry.

Build:

- local capture ingestion service;
- extraction provider abstraction;
- local model option;
- cloud-provider disclosure/consent;
- transactional Source + candidate persistence;
- extraction-run diagnostics;
- source pruning hooks;
- retry and failure queue.

**Exit:** a conversation payload can enter TOPO, be extracted and appear in the desktop review inbox automatically.

### Iteration 5C — Ambient browser capture

**Goal:** make normal hosted-AI use populate TOPO.

First adapters:

1. ChatGPT
2. Claude
3. Gemini
4. Microsoft Copilot
5. generic adapter contract

Migrate the strongest capture mechanics from llm-memory-extractor rather than its storage or inference model.

Build:

- Chromium extension shell;
- site/conversation detection;
- stable completed-turn capture;
- SPA navigation handling;
- render deduplication;
- local unsent queue;
- Native Messaging connection to TOPO Desktop;
- per-site enable/pause;
- per-conversation exclusion;
- visible connection/capture state;
- capture diagnostics.

Then consider Firefox and additional providers.

**Exit:** normal ChatGPT/Claude/Gemini use creates source-grouped TOPO candidates without start/stop recording.

### Iteration 5D — Memory inbox

**Goal:** make governance fast enough for ambient capture.

Build:

- Inbox as the desktop default;
- group candidates by source interaction;
- evidence preview;
- batch confirm/reject;
- inline edit;
- duplicate/supporting-evidence absorption;
- potential-change/contradiction emphasis;
- source and connection health;
- review counts/badges.

**Exit:** a normal day's capture can be governed in a few minutes rather than managed claim-by-claim.

### Iteration 5E — Agent capture and memory pressure

**Goal:** make TOPO useful to long-running agents without replacing their runtime memory.

Build:

- a high-level MCP interaction-capture path;
- explicit “remember this” path;
- purpose-bound TOPO retrieval for agent sessions;
- Hermes general plugin using post_llm_call for ambient capture;
- OpenClaw companion plugin using agent_end for ambient capture;
- memory-pressure handoff experiments;
- small hot-context projection where explicitly useful.

Principle:

> Agent memory is a bounded hot cache; TOPO is governed durable cross-agent context.

Do not mirror all canonical TOPO memory into an agent's MEMORY.md or equivalent.

**Exit:** Hermes/OpenClaw can contribute durable candidates to TOPO and retrieve relevant older context while retaining their own native working memory.

### Iteration 5F — Bootstrap existing histories

**Goal:** make a new TOPO useful immediately.

Build:

- ChatGPT history import;
- Claude history import;
- Gemini/Google history import;
- generic conversation archives;
- legacy llm-memory-extractor import;
- legacy MyMemory imports.

All imports use the same extraction, evidence, deduplication and review pipeline as live capture.

**Exit:** an existing AI history can create a governed starting memory without becoming an unreviewed profile.

---

## Phase 4 — Purpose-aware context resolution

After capture is producing real memory, improve the read path.

Build:

- purpose/query-aware lexical scoring;
- project/category/key/tag relevance;
- freshness and epistemic weighting;
- token budgets;
- explainable selection;
- context manifests and digests;
- later optional embedding assistance.

**Exit:** RACK and agents receive compact context selected for the work they are actually doing, not merely the newest confirmed claims.

## Phase 5 — Derived human-readable views

Build category documents, profile/About Me views, version/diff review, filesystem sync and Markdown/OKF exports as projections over canonical Claims.

## Phase 6 — Broader connectors

Only after browser and agent capture are validated in daily use:

- additional AI sites;
- selected local application hooks;
- external-object/event ledger for OOS/FlowLance-style operational data;
- connector-specific promotion policy.

Operational records should not silently become canonical memory.

## Phase 7 — Mature RACK bridge

Extend the existing bridge with:

- stable ContextSource abstraction;
- live/static context modes;
- purpose-aware context budgets;
- snapshot provenance;
- “promote repeated context to practice” review flow.

TOPO may suggest RACK practice. It never establishes practice automatically.

## Phase 8 — Optional sync / managed TOPO

Only after the local capture/review/retrieval loop is trustworthy:

- encrypted multi-device sync;
- backup/recovery;
- managed connectors;
- team/shared boundaries;
- mobile client.

Local use must remain first-class.
