# TOPO Product and Architecture Plan

## 1. Purpose

TOPO is a user-owned context layer for AI and other tools.

It gathers, reviews, maintains and selectively supplies useful context about a person, their work and their ongoing activity across different AI tools and providers.

The problem is not simply that AI systems forget. Useful context is fragmented between products, buried in conversations, inferred without adequate evidence, repeatedly re-entered by the user, and often stored in forms that are difficult to inspect or move.

TOPO provides a portable, inspectable context layer underneath those systems.

> Keep what matters. Know where it came from. Decide what gets to use it.

A new architectural principle now follows from that purpose:

> **The durable memory itself should remain useful outside TOPO.**

See [Memory architecture](docs/MEMORY_ARCHITECTURE.md) and [ADR 0011](docs/adr/0011-memory-pages-are-the-primary-durable-memory-unit.md).

## 2. Relationship to RACK

TOPO and RACK remain separate layers.

- **TOPO** answers: **What should this AI know for this purpose?**
- **RACK** answers: **How should this AI work?**

TOPO contains descriptive context: memories, preferences, observations, current circumstances, project context, relevant history and patterns.

RACK contains normative practice: methods, instructions, guardrails, voice, tasks, tools and reusable working approaches.

A TOPO memory such as “the user repeatedly requests British English” is descriptive context. A RACK instruction such as “use British English” is governed practice.

TOPO may propose a RACK change. It must never silently establish one.

RACK consumes TOPO through a stable `ContextSource`/Context Packet boundary and must not depend on TOPO's internal schema.

## 3. Product principles

### User authority

AI systems may propose additions. The default lifecycle becomes:

```text
capture → propose Memory Page → review/edit → confirm/reject → durable memory
```

Direct confirmed writes remain an explicit higher-trust permission, not the default.

### Meaning before atomisation

TOPO should preserve coherent meaning before introducing structure.

A memory should normally be a short piece of readable contextual prose. Structured Claims/annotations are optional and exist where they materially improve machine reasoning or interoperability.

### Provenance by default

It should be possible to answer:

- Where did this come from?
- When was it learned?
- What evidence supports it?
- Has the user reviewed it?
- Has it changed or been superseded?
- Is it appropriate to use for this purpose?

### Governance is independent of representation

Moving from Claims to prose-first Memory Pages does not weaken authority, sensitivity, temporal validity or disclosure rules.

Semantic relevance is never permission.

### Local first

TOPO should work without an account, hosted database, telemetry or required cloud model.

### Portable by design

The user should be able to leave TOPO without losing their memory.

Human-readable Markdown memories and open structured metadata are part of the core product contract, not backup features.

### Derived views are not evidence

Generated profiles, category summaries and other syntheses are projections over canonical memories. They do not become source evidence merely because an LLM wrote them.

### Selective context

TOPO resolves context for a task rather than dumping an entire profile into every interaction.

### Inspectability over magic

Candidates, edits, changes, contradictions, stale information, sources and context sharing should be visible.

## 4. Canonical domain model

### Memory Page

The primary durable memory unit is a **Memory Page**.

A Memory Page is short human-readable prose plus compact governance metadata.

Conceptually:

```ts
interface MemoryPage {
  id: string;
  title: string;
  body: string;

  subject: string;
  category?: string;
  tags: string[];

  status:
    | "candidate"
    | "confirmed"
    | "rejected"
    | "superseded"
    | "expired";

  sensitivity:
    | "ordinary"
    | "personal"
    | "sensitive"
    | "restricted";

  horizon?: "durable" | "project" | "temporary";

  sourceIds: string[];
  evidence?: Array<{
    sourceId: string;
    excerpt?: string;
    locator?: string;
  }>;

  validFrom?: string;
  validUntil?: string;
  supersedes?: string[];

  createdAt: string;
  updatedAt: string;
}
```

The exact schema may evolve, but the durable concepts are:

- the prose body carries meaning;
- source evidence remains explicit;
- review status and sensitivity remain explicit;
- temporal validity remains explicit;
- version/supersession history remains inspectable.

### Structured annotation / Claim

The existing Claim model remains available as an optional structured annotation.

It is useful when structure earns its keep, for example:

```ts
interface MemoryAnnotation {
  id: string;
  memoryPageId: string;
  key: string;
  value: unknown;
  epistemicType?:
    | "assertion"
    | "observation"
    | "inference"
    | "preference"
    | "derived-pattern";
  confidence?: number;
  validFrom?: string;
  validUntil?: string;
}
```

Examples include explicit preferences, architectural constraints, temporary locations and machine-readable compatibility facts.

A Memory Page may have no structured annotations at all.

User confirmation and model confidence remain separate concepts when annotations carry epistemic metadata.

### Source

A Source represents original evidence: a conversation, document, manual entry, import bundle or connector record. Multiple Memory Pages may reference one Source and a Memory Page may cite several Sources.

### Event

TOPO maintains an append-oriented history of meaningful changes, for example:

- `source.captured`
- `memory.proposed`
- `memory.confirmed`
- `memory.edited`
- `memory.rejected`
- `memory.superseded`
- `memory.expired`
- `annotation.added`
- `annotation.changed`
- `view.generated`
- `context.resolved`
- `context.shared`

### Derived view

A generated profile, category summary, About Me document or other synthesis is a view over identified Memory Pages.

Each generated version should be able to record:

- source Memory Page IDs/revisions;
- generator/model;
- generation time;
- review state;
- version lineage.

Canonical direction:

```text
sources → Memory Pages → context views / Context Packets
             │
             └── optional structured annotations
```

Never:

```text
source → generated prose → summarised prose → untraceable new truth
```

### Schema

A configurable schema may provide categories, extraction hints, examples, sensitivity defaults and visibility defaults. It must not become a mandatory ontology for every memory.

## 5. Context resolution

The primary output of TOPO is **resolved context**, not a database dump.

Conceptually:

```ts
resolveContext({
  purpose: "software-development",
  project: "rack",
  query: "review this pull request",
  tokenBudget: 1500,
  allowedSensitivity: ["ordinary", "personal"]
})
```

Resolution considers:

1. explicit sharing/authority;
2. review status;
3. sensitivity;
4. temporal validity;
5. subject/project scope;
6. relevance to purpose/task;
7. freshness;
8. optional confidence/epistemic information;
9. context budget.

The resolver returns concise excerpts or renderings from authorised Memory Pages with provenance and stable revision/digest metadata.

Start with deterministic metadata filters and full-text search. Add a small local semantic index when it demonstrably improves recall.

Embeddings are retrieval infrastructure, not canonical memory.

## 6. Architecture

TOPO remains a monorepo with the domain model isolated from UI, storage and transport.

```text
topo/
├── apps/
│   ├── desktop/
│   ├── extension/
│   ├── mcp/
│   └── cli/
├── packages/
│   ├── schemas/
│   ├── core/
│   ├── store/
│   ├── store-node/
│   ├── formats/
│   ├── capture/
│   ├── retrieval/
│   └── mcp/
├── crates/
│   └── topo-contracts/
├── adapters/
│   └── oos/
├── docs/
└── test-fixtures/
```

### Schemas

`packages/schemas` owns the canonical serialisable/runtime-validated interchange contracts for Memory Pages, Sources, annotations, Events and Context Packets.

Stable fixtures are shared with the Rust native boundary so TypeScript and Rust agree on the same interchange semantics.

### Core

`packages/core` owns lifecycle and authority policy. Representation changes must not duplicate governance rules across UI, database or transport layers.

### Store

`packages/store` owns runtime-neutral persistence interfaces. SQLite remains the primary local operational store.

The database is an implementation of the memory model, not the user's only representation of it.

### Portable files

Markdown Memory Pages are first-class portable artefacts. TOPO may maintain an internal SQLite representation for efficient operation while guaranteeing round-trip export/import to open files and metadata.

### Desktop

`apps/desktop` follows the RACK pattern: React/TypeScript for the application layer, with Tauri/Rust owning native capabilities such as SQLite, filesystem access, secrets and local-service integration.

### Capture

Capture becomes a reusable page-first pipeline:

```text
capture source
  → normalise
  → identify useful future context
  → draft coherent Memory Pages
  → validate against evidence
  → compare duplicate/extension/change
  → candidate memories
```

Optional structured annotations can be extracted when useful, but should not multiply review burden by default.

### Retrieval

Retrieval is layered:

```text
governance filters
       ↓
metadata + FTS
       ↓
optional local semantic index
       ↓
purpose/task ranking
       ↓
context budget/composition
       ↓
Context Packet
```

Any embedding index must be completely reconstructable from canonical Memory Pages.

### MCP

MCP remains an adapter around the shared core, not a separate memory implementation.

The normal agent path is proposal/review rather than silent confirmed writes. MCP resources and tools will migrate from claim-first operations to page-first operations while retaining compatibility during alpha.

### Browser extension

The Chromium capture companion remains a capture surface only. It must not become a second memory store.

## 7. Portable format

TOPO defines a versioned native bundle independent of internal database layout.

Target direction:

```text
topo-bundle/
├── manifest.json
├── memories/
│   └── *.md
├── sources.jsonl
├── annotations.jsonl
├── events.jsonl
└── index.sqlite        # optional, disposable
```

The exact vNext contract will be introduced additively alongside the existing v0.1 Claim bundle.

Portable format rules:

- Memory Page Markdown is first-class;
- governance metadata is documented and open;
- meaning must not depend on `annotations.jsonl`;
- source/evidence links must survive round trip;
- the index is optional and rebuildable;
- imports remain conservative about identity/conflicts;
- the filesystem representation should be usable from Git, notes tools and other AI systems.

## 8. Security posture

Initial rules remain:

- local-only by default;
- loopback network binding by default;
- no unauthenticated non-loopback transport;
- no secrets or encryption keys in query strings;
- no analytics by default;
- cloud-model disclosure must be explicit;
- sensitivity-aware context filtering;
- purpose-bound disclosure;
- at-rest encryption, if enabled, must cover sensitive history as well as current records;
- no zero-knowledge or end-to-end claims unless the architecture genuinely guarantees them.

A semantic index must never become a path around governance filters.

## 9. Temporal memory and contradictions

TOPO should distinguish:

- duplicate;
- supporting evidence;
- extension;
- contradiction;
- replacement;
- historical change.

A newer state should not necessarily erase older context.

Page-level edits and supersession should retain meaningful history. Structured annotations can assist deterministic comparison where useful, but the user-facing memory should remain coherent prose.

## 10. RACK integration

RACK integration is deliberately representation-independent.

RACK gains/retains a **ContextSource** abstraction separate from its PracticeSource/authority model.

TOPO context is selected by authority, sensitivity, scope, freshness, relevance and budget. RACK practice is resolved by explicit authority and precedence.

```text
TOPO Memory Pages
       │
       ▼
TOPO resolver
       │
       ▼
Context Packet
       │
       ▼
RACK ContextSource ─────┐
                       │
RACK PracticeSources ───┼──► working context/instructions
                       │
other task context ─────┘
```

For live-capable destinations, TOPO remains a dynamic context resource.

For static destinations, RACK may snapshot selected TOPO context and record packet revision/digest/provenance in its build manifest.

### Promote context to practice

A repeated confirmed memory or pattern may later lead TOPO to propose a RACK module/change.

The invariant remains:

> TOPO may suggest practice. TOPO cannot establish practice.

### Portability consequence

RACK should be one consumer among many.

A user should be able to provide the same governed TOPO memory to another agent, model, local tool or future working-practice system without converting it through RACK first.

## 11. Organisational OS boundary

Operational state remains distinct from personal durable memory.

A FlowLance task, calendar event or organisational record should not become a canonical Memory Page merely because TOPO can connect to it.

TOPO may reference external state or propose a memory from it under explicit connector policy, but organisational systems do not inherit access to a person's memory field.

Context disclosure remains purpose-bound.

## 12. Migration from the claim-based alpha

Do not rewrite the working alpha in one step.

Migration sequence:

1. add Memory Page schemas/fixtures alongside Claims;
2. add SQLite persistence and events;
3. add Markdown round-trip export/import;
4. link existing confirmed Claims to provisional Memory Pages where useful;
5. change capture extraction to page-first proposals;
6. redesign the inbox around coherent memories;
7. make context resolution page-aware while preserving Context Packet transport;
8. add optional semantic retrieval after deterministic page retrieval works;
9. migrate MCP/CLI operations;
10. remove assumptions that every durable memory must be a Claim only after compatibility and data migration tests pass.

Existing Sources, Event history and provenance are assets and must survive.

## 13. Evaluation

TOPO should optimise for **useful future context**, not extraction volume.

The end-to-end test becomes:

```text
known source interaction
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
useful context in another tool/model
```

Measure:

- useful-memory precision/recall;
- faithfulness to evidence;
- contextual completeness;
- overreach;
- fragmentation/duplication;
- temporal correctness;
- review effort;
- cross-tool recall success;
- portable round-trip integrity;
- context/token efficiency.

A conversation where nothing is worth remembering is a successful result when TOPO proposes nothing.

## 14. vNext success criteria

TOPO's next architecture milestone succeeds when:

1. it runs locally without an account;
2. Memory Pages can be proposed, reviewed and confirmed;
3. each memory remains traceable to source evidence;
4. Markdown export is readable/useful without TOPO;
5. export/import round trips without losing governance/history;
6. structured annotations remain optional;
7. browser capture can populate the page-first model;
8. purpose-bound retrieval works over Memory Pages;
9. RACK consumes the same stable Context Packet boundary without depending on page internals;
10. another non-RACK AI/tool can consume the same portable context;
11. semantic indexing, if enabled, is fully disposable/rebuildable;
12. existing alpha Claim data can migrate without losing provenance.

## 15. Explicit non-goals for the migration

Defer:

- hosted accounts;
- team memory;
- automatic broad email ingestion;
- SaaS connector ecosystem;
- mobile app;
- automatic RACK modification;
- organisation-wide memory;
- knowledge graph/ontology infrastructure;
- vector database dependency;
- autonomous hidden extraction;
- automatic sharing of sensitive context.
