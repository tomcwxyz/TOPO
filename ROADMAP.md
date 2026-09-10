# TOPO Roadmap

TOPO is moving from a **claim-first memory model** to a **portable prose-first memory model**.

The alpha has already proved important foundations: governed capture, provenance, review authority, temporal history, local SQLite persistence, purpose-bound context sharing and a working RACK/OOS bridge. Those foundations remain.

What changes is the durable thing TOPO is trying to create.

The primary durable memory object is now a **Memory Page**: a short, coherent, human-readable piece of context with governance metadata and traceable evidence. Claims remain available as optional structured annotations where structure materially helps, but TOPO should no longer atomise all useful memory into claims by default.

See [Memory architecture](docs/MEMORY_ARCHITECTURE.md) and [ADR 0011](docs/adr/0011-memory-pages-are-the-primary-durable-memory-unit.md).

Across every phase, personal context remains personal by default. TOPO uses the non-hierarchical **inside / between / beneath / around** model for reasoning about relationships and information movement. A Context Packet is a purpose-bound disclosure, not permission for secondary use, organisational analytics or individual monitoring.

## Current migration status

- **M1 — Canonical Memory Page contract:** implemented.
- **M2 — Portable Markdown:** implemented and merged.
- **M3 — Page-first capture and review:** implemented; now ready for dogfooding/hardening.
- **M4 — Page-aware context resolution:** **next implementation milestone**.
- **M5 — Small local semantic index:** only after deterministic M4 retrieval is measurable.

The important remaining migration boundary is retrieval: the desktop and capture loop are now page-first, while the current Context Packet resolver is still Claim-backed for compatibility.

## Near-term product proof

The next milestone is:

> Use AI tools normally for a day, open TOPO, review a small number of coherent memories worth keeping, then see the right context surface in another AI/tool without that tool needing to understand TOPO's internal storage model.

A successful memory should also remain useful when exported as ordinary Markdown and read outside TOPO.

---

## Completed foundation

### Phase 0 — Foundation

Product principles, architecture boundaries, ADRs, threat model and repository conventions are established.

### Phase 1 — Claim-based core

The existing Claim/Source/Event contracts, proposal-first lifecycle, sensitivity, expiry/supersession, SQLite persistence, audit events, CLI, search and portable bundles are implemented.

This remains useful migration infrastructure, but Claims are no longer the target canonical representation for all memory. ADR 0011 supersedes ADR 0002 on that point.

### Iteration 2.5 — Desktop runtime alignment

Tauri/React desktop architecture, runtime-neutral storage contracts and shared TypeScript/Rust interchange fixtures are implemented.

### Phase 2 — MCP

A proposal-first stdio MCP server is implemented with search, candidate proposal, optional delegated review, history and sensitivity ceilings.

The MCP transport remains useful, but its memory-facing contracts will become Memory Page aware during migration.

### Early RACK/OOS context bridge

TOPO Desktop exposes an authenticated loopback context endpoint with explicit per-session sharing consent. RACK can discover TOPO, request selected context and record context provenance.

This bridge is strategically important because it already demonstrates the boundary we want to preserve: **RACK consumes purpose-bound context, not TOPO's internal memory schema.**

Do not broaden the transport until the Memory Page migration is stable.

---

# Immediate reorientation — Memory Pages

## Iteration M1 — Canonical Memory Page contract

**Status:** implemented.

**Goal:** introduce the new durable memory representation without discarding the working alpha.

Implemented:

- `MemoryPage` schema with body, title/summary, review state, sensitivity, horizon, temporal validity, source references, tags and version/supersession metadata;
- runtime-neutral TypeScript + Rust interchange fixtures;
- store interfaces and SQLite persistence;
- explicit links between Memory Pages and existing Sources;
- optional structured annotations linked to Memory Pages;
- event types for propose/confirm/edit/reject/supersede/expire;
- compatibility adapters for existing Claims.

Rules:

- the body is the memory; metadata governs it;
- structured annotations are optional;
- existing Source IDs, events and provenance are preserved;
- generated text cannot cite itself as evidence;
- migration remains reversible during alpha.

**Exit achieved:** TOPO can persist, inspect and round-trip a governed Memory Page alongside existing Claims.

## Iteration M2 — Portable Markdown as a first-class representation

**Status:** implemented and merged.

**Goal:** make portability a property of canonical memory, not merely an export feature.

Implemented:

- deterministic Markdown rendering for Memory Pages;
- documented frontmatter/governance metadata;
- portable bundle update with `memories/*.md` as first-class entries;
- optional `annotations.jsonl` for structured annotations;
- conservative import and identity conflict handling;
- round-trip tests proving that meaning and governance survive export/import;
- human-readable filesystem export suitable for Git and notes tools.

Portable shape:

```text
topo/
├── memories/
│   └── *.md
├── sources.jsonl
├── annotations.jsonl
├── events.jsonl
├── manifest.json
└── index.sqlite        # optional/disposable
```

**Exit achieved:** a TOPO memory export remains meaningfully usable without TOPO.

## Iteration M3 — Page-first capture and review

**Status:** implemented; dogfooding/hardening next.

**Goal:** stop optimising the product around atomic claim extraction.

The capture question is now:

> What small pieces of context would materially improve a future interaction?

Implemented:

- shared TypeScript/Rust extraction contract proposing coherent Memory Pages;
- local Ollama page-first extraction in the desktop path;
- hard cap of four proposed pages per captured interaction, with prompts preferring fewer;
- mandatory user-authored evidence and source citation for every proposed page;
- optional structured annotation proposals only when structure adds value;
- page-level duplicate, supporting-evidence and potential-change detection;
- exact and same-batch duplicate suppression;
- supporting restatements enrich an existing page's provenance instead of creating another review card;
- potential changes remain explicit candidates and require individual confirmation before supersession;
- Memory Inbox cards centred on coherent prose, evidence, horizon and sensitivity;
- inline page editing;
- guarded batch confirm/reject for straightforward candidates;
- legacy Claim creation/review retained behind a compatibility/advanced surface.

**Exit achieved in implementation:** captured conversations now produce a small number of readable Memory Page candidates rather than a spray of atomised Claims.

**Dogfooding questions before calling the product loop proven:**

- are the proposed pages genuinely worth keeping after a normal day of use?;
- is one to four still too many for common conversations?;
- do supporting-evidence and potential-change thresholds behave sensibly across real writing styles?;
- can a normal day's inbox be governed in a few minutes?;
- do page edits preserve enough context without becoming mini-documents?

## Iteration M4 — Page-aware context resolution

**Priority:** next.

**Goal:** resolve useful context without requiring consumers to know TOPO's internal representation.

Build:

- authorised Memory Page filtering by review state, sensitivity, scope and temporal validity;
- deterministic FTS over Memory Page body/title/tags;
- purpose/task-aware ranking;
- context/token budgets;
- compact rendered excerpts in Context Packets;
- stable page/revision/source provenance;
- explainable selection metadata;
- Claim-based retrieval as a compatibility fallback rather than the default.

Rules:

- governance filters happen before relevance ranking;
- relevance never widens access;
- Context Packet consumers, including RACK, must not need to understand Memory Pages directly;
- retrieval tests must be deterministic before embeddings are introduced.

**Exit:** the same purpose-bound Context Packet transport can be fulfilled primarily from Memory Pages.

## Iteration M5 — Small local semantic index

**Goal:** improve retrieval quality without turning TOPO into vector infrastructure.

Build only after M4 has deterministic tests:

- optional local embeddings for Memory Pages;
- small SQLite/sidecar index;
- hybrid FTS + semantic ranking;
- complete index rebuild from canonical Memory Pages;
- no vector index data required for portable restore;
- local-model-first embedding path where practical.

Principle:

> The index is disposable. The memory is not.

**Exit:** semantic retrieval measurably improves real recall while deletion/rebuild of the index changes no canonical memory.

---

# Capture-first product loop

The existing capture implementation now feeds Memory Pages rather than being optimised around Claims.

## Iteration 5A — Capture contract

**Status:** page-first adaptation implemented in M3.

Implemented:

- captured interaction and turn contracts;
- ChatGPT, Claude, Gemini, Copilot, agent and generic source identities;
- user-evidence requirement;
- memory horizons: durable / project / temporary;
- review-window source retention;
- coherent Memory Page proposal contract;
- duplicate/supporting-evidence/potential-change comparison;
- conservative extraction prompt and tests;
- incomplete-source restrictions that prevent weak inference from becoming memory.

Next:

- dogfood proposal quality against real captured conversations;
- tune thresholds from evidence rather than intuition;
- extend evaluation from key extraction to memory utility, faithfulness and review burden.

## Iteration 5B — Desktop ingestion and extraction

**Status:** page-first local path implemented.

Captured interactions can enter TOPO, be extracted with local Ollama into Memory Pages, compared with current memory and persisted transactionally with Sources and provenance for review.

Supporting restatements add provenance to the existing page rather than producing another candidate. Potential changes remain reviewable and do not supersede automatically.

Next:

- retain diagnostics, failure queues and provider disclosure/consent;
- dogfood local model quality and latency;
- keep one page-first extraction pass rather than parallel Claim/Page extraction.

## Iteration 5C — Ambient browser capture

**Status:** first Windows + Chromium end-to-end path works for ChatGPT, Claude and Gemini.

Keep the capture mechanics:

- stable completed-turn capture;
- SPA navigation handling;
- render deduplication;
- local unsent queue;
- Native Messaging connection;
- per-site controls;
- per-conversation exclusion;
- visible connection/capture state;
- diagnostics.

Remaining hardening should be driven by real page-first dogfooding, not by adding providers for its own sake.

## Iteration 5D — Memory Inbox

**Status:** first page-first desktop inbox implemented in M3.

Implemented:

- proposed Memory Pages as the primary review surface;
- source/evidence preview;
- inline prose editing;
- confirm/reject;
- explicit potential-change/supersession warning;
- batch review only for straightforward candidates;
- search/status filtering;
- legacy structured Claims collapsed into a compatibility section.

Next:

- explicit merge/extend interaction when two pages overlap but neither is simply supporting evidence;
- optional structured annotation details collapsed within a page;
- clearer source/connection health inside the review surface;
- review counts and time-to-govern metrics;
- dogfood whether grouping by source is useful once candidate volume is genuinely low.

**Exit target:** a normal day's capture can be governed in a few minutes and leaves behind readable memories.

## Iteration 5E — Agent capture and memory pressure

**Status:** governed Hermes and OpenClaw integrations retrieve small purpose-bound context and contribute interactions into TOPO capture.

Keep the principle:

> Agent memory is a bounded hot cache; TOPO is governed durable cross-agent context.

Next:

- page-first agent memory proposals;
- explicit “remember this” → proposed Memory Page path;
- memory-pressure handoff experiments;
- small hot-context projection where explicitly useful;
- never mirror an entire TOPO field into `MEMORY.md` or equivalent.

## Iteration 5F — Bootstrap existing histories

**Goal:** make a new TOPO useful immediately.

Build:

- ChatGPT history import;
- Claude history import;
- Gemini/Google history import;
- generic conversation archives;
- legacy llm-memory-extractor import;
- legacy MyMemory imports.

All histories flow through the same page-first extraction, evidence, deduplication and review pipeline.

---

# Purpose-aware context and RACK

## Phase 4 — Purpose-aware context resolution

The current lexical Claim resolver is a useful compatibility prototype. M4 migrates the primary capability to Memory Pages.

Resolution order remains governance-first:

1. explicit sharing/authority;
2. review status;
3. sensitivity;
4. temporal validity;
5. subject/project scope;
6. relevance to purpose/task;
7. freshness;
8. context budget.

Relevance never widens access.

### RACK integration contract

RACK should consume a stable **ContextSource** abstraction.

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

RACK should not know or care whether a packet originated from Memory Pages, legacy Claims or a later TOPO representation.

For live-capable destinations, RACK can request fresh context when the purpose/task changes. For static destinations, it may snapshot explicitly selected context and record packet revision/digest/provenance.

### Practice-context loop

TOPO may provide context such as:

- project stage and expected lifetime;
- intended users and accessibility needs;
- data/security sensitivity;
- maintenance ownership and team capability;
- operating-cost sensitivity;
- explicitly accepted temporary constraints.

That context may help RACK select or explain practice. It must not establish practice.

The invariant remains:

> TOPO may suggest practice. TOPO cannot establish practice.

RACK + Ship Check must remain fully functional when TOPO is absent.

---

# Later phases

## Phase 5 — Derived views

Build category pages, profile/About Me views, version/diff views and other human-facing syntheses as **projections over canonical Memory Pages**.

These are different from canonical Memory Pages: a generated profile is a view, not evidence.

## Phase 6 — Broader connectors

Only after browser and agent capture are validated in daily use:

- additional AI sites;
- selected local application hooks;
- external-object/event ledger for OOS/FlowLance-style operational data;
- connector-specific promotion policy.

Operational records should not silently become personal memory.

## Phase 7 — Mature RACK bridge

Extend the existing bridge with:

- stable ContextSource abstraction;
- live/static context modes;
- purpose-aware context budgets;
- page/revision provenance;
- “promote repeated context to practice” review flow;
- optional practice-evidence context that explains why a principle matters without storing individual compliance history.

## Phase 8 — Optional sync / managed TOPO

Only after the local page-first capture/review/retrieval loop is trustworthy:

- encrypted multi-device sync;
- backup/recovery;
- managed connectors;
- team/shared boundaries that model shared context as a separate relationship/source rather than administrator access to personal memory;
- mobile client.

Local use and open portable files must remain first-class.

---

# Evaluation

The old capture metrics remain useful for migration comparisons, but key-level precision/recall is no longer sufficient.

Evaluate the complete product loop:

```text
source interaction
      ↓
expected useful memories
      ↓
proposed Memory Pages
      ↓
human review/edit
      ↓
confirmed portable memory
      ↓
purpose-bound recall
      ↓
useful context in another system
```

Track:

- useful-memory precision and recall;
- faithfulness to evidence;
- contextual completeness;
- overreach;
- duplicate/fragmentation rate;
- temporal correctness;
- review time per accepted memory;
- cross-tool recall success;
- portability/round-trip integrity;
- token cost of resolved context.

A clean interaction where nothing should be remembered is still a successful result when TOPO proposes nothing.

The practical alpha exit becomes:

> Use AI normally for a day, review a small high-quality set of coherent memories in a few minutes, export them in a form that still makes sense outside TOPO, and see the right context surface correctly in a different tool or model.
