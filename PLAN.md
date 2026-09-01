# TOPO Product and Architecture Plan

## 1. Purpose

TOPO is a user-owned context layer for AI.

It gathers, reviews, maintains and selectively supplies useful context about a person, their work and their ongoing activity across different AI tools and providers.

The problem is not simply that AI systems forget. Useful context is fragmented between products, buried in conversations, inferred without adequate evidence, or repeatedly re-entered by the user. Provider-native memory can be useful, but it is usually provider-specific and difficult to inspect, govern or move.

TOPO provides a portable, inspectable context layer underneath those systems.

> Keep what matters. Know where it came from. Decide what AI gets to use.

## 2. Relationship to RACK

TOPO and RACK are separate layers.

- **TOPO** answers: **What should this AI know?**
- **RACK** answers: **How should this AI work?**

TOPO contains descriptive context: claims, preferences, observations, current circumstances, project context, relevant history and derived patterns.

RACK contains normative practice: methods, instructions, guardrails, voice, tasks, tools and reusable working approaches.

A TOPO observation such as “the user has requested British English repeatedly” is evidence. A RACK instruction such as “use British English” is governed practice.

TOPO may later propose a RACK change. It must never silently establish one.

### Personal context is not organisational evidence

TOPO remains controlled by the person whose context it holds, even when it participates in a wider organisational system.

- A TOPO claim is context about or for a person; it is not evidence for judging that person.
- RACK verification/evaluation may assess AI practice, generated work and whether agreed practice was followed. It must not turn TOPO context into individual performance, compliance or capability scoring.
- "Personal" sensitivity remains personal. A local transport ceiling that can technically carry personal context is not blanket organisational permission to use it.
- Context crossing into RACK or another node must stay purpose-bound, explicitly permitted and minimised to what is useful for that piece of work.
- Organisational relationships should not be encoded in TOPO as an assumed up/down hierarchy. Consumers can describe work happening inside, between, beneath, across or around organisational boundaries through the purpose of a Context Packet without changing the ownership of the underlying memory.

The default organisational pattern is therefore **use context without absorbing ownership**: TOPO supplies a bounded private snapshot; RACK records provenance/digest where needed; the receiving system does not silently copy personal claims into organisational records.

## 3. Product principles

### User authority
AI systems may propose additions. The default lifecycle is:

```text
capture → extract → candidate → review → confirm/edit/reject → memory
```

Direct writes are an explicit higher-trust permission, not the default.

### Claims, not unquestioned facts
The canonical unit is a **claim**, because context can be asserted, observed, inferred, preferred or derived. Confidence does not erase that distinction.

### Provenance by default
It should be possible to answer:

- Where did this come from?
- When was it learned?
- Was it stated, observed or inferred?
- What evidence supports it?
- Has the user reviewed it?
- Has it been superseded?

### Local first
TOPO should work without an account, hosted database, telemetry or required cloud model.

### Portable by design
The user should be able to leave TOPO without losing their memory. Native structured export and human-readable Markdown are product requirements, not backup features.

### Derived content is not evidence
Generated profiles and category documents are useful views over claims. They do not become source evidence merely because an LLM wrote them.

### Selective context
TOPO should resolve context for a task rather than dump an entire profile into every interaction.

### Inspectability over magic
Candidates, changes, contradictions, stale information, sources and context sharing should be visible.

## 4. Canonical domain model

### Claim

The exact schema will be validated during implementation, but the durable concepts are:

```ts
type EpistemicType =
  | "assertion"
  | "observation"
  | "inference"
  | "preference"
  | "derived-pattern";

type ClaimStatus =
  | "candidate"
  | "confirmed"
  | "rejected"
  | "superseded"
  | "expired";

type Sensitivity =
  | "ordinary"
  | "personal"
  | "sensitive"
  | "restricted";

interface MemoryClaim {
  id: string;
  subject: string;
  key: string;
  value: unknown;
  category?: string;
  tags: string[];

  epistemicType: EpistemicType;
  confidence: number;

  provenance: {
    sourceType:
      | "conversation"
      | "document"
      | "manual"
      | "mcp"
      | "import"
      | "connector";
    provider?: string;
    sourceId?: string;
    evidence?: string;
    capturedAt: string;
  };

  status: ClaimStatus;
  sensitivity: Sensitivity;

  validFrom?: string;
  validUntil?: string;
  supersedes?: string[];

  createdAt: string;
  updatedAt: string;
}
```

User confirmation and model confidence are separate concepts. A high-confidence inference remains an inference.

### Source
A source represents the original evidence container: a conversation, document, manual entry, import bundle or connector record. Multiple claims may reference one source.

### Event
TOPO maintains an append-oriented history of meaningful changes, for example:

- `source.captured`
- `claim.proposed`
- `claim.confirmed`
- `claim.edited`
- `claim.rejected`
- `claim.superseded`
- `claim.expired`
- `document.generated`
- `document.accepted`
- `context.resolved`
- `context.shared`

### Memory document
A Markdown synthesis of confirmed claims. Each generated version records its source claim IDs, generator/model, generation time and review state.

Canonical direction:

```text
sources → claims → derived documents → context views
```

Never:

```text
claims → prose → summarised prose → untraceable new facts
```

### Schema
A configurable schema defines categories, descriptions, extraction hints, examples, sensitivity defaults and context visibility defaults. The default schema must remain editable rather than becoming a fixed ontology.

## 5. Context resolution

The primary output of TOPO is ultimately **resolved context**, not a database dump.

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

1. review status
2. expiry / temporal validity
3. sensitivity
4. explicit visibility
5. relevance to the task
6. recency
7. confidence
8. context budget

The returned context should include provenance and a stable revision/digest suitable for audit or snapshotting.

Start with deterministic lexical/full-text retrieval, categories, tags, recency and explicit relationships. Embeddings are optional later.

## 6. Architecture

TOPO should be a monorepo with the domain model isolated from UI, storage and transport.

```text
topo/
├── apps/
│   ├── desktop/
│   ├── extension/
│   └── cli/
├── packages/
│   ├── schemas/
│   ├── core/
│   ├── store/
│   ├── store-node/
│   ├── formats/
│   ├── capture/
│   ├── retrieval/
│   ├── providers/
│   └── mcp/
├── crates/
│   └── topo-contracts/
├── adapters/
│   └── rack/
├── docs/
└── test-fixtures/
```

### Schemas
`packages/schemas` owns the canonical serialisable/runtime-validated interchange contract. Stable fixtures are shared with the Rust native boundary so TypeScript and Rust agree on the same claim, source and event records.

### Core
`packages/core` owns lifecycle and authority policy over those contracts. It should remain independent of UI, database and transport implementations.

### Store
`packages/store` owns runtime-neutral persistence interfaces. `packages/store-node` is the Node SQLite implementation used by CLI and later MCP. TOPO Desktop uses a native Rust persistence implementation behind the same conceptual contract rather than embedding a Node native SQLite module. Browser-only standalone mode can use IndexedDB.

### Desktop
`apps/desktop` follows the RACK pattern: React/TypeScript for the application layer, with Tauri/Rust owning native capabilities such as SQLite, filesystem access, secrets and local-service integration. Rust should not independently reimplement TOPO lifecycle policy.

### Capture
Capture is a reusable pipeline:

```text
capture source
  → normalise
  → extract
  → validate
  → compare
  → detect duplicate/contradiction/change
  → candidate claims
```

### MCP
MCP is an adapter around the shared core, not a separate memory implementation. The normal agent path is proposal/review rather than direct confirmed writes.

### Browser extension
The current `llm-memory-extractor` provides useful capture adapters, review UX, local-model support, schema editing, document views, diff/version UX and filesystem sync. These should migrate onto the canonical TOPO model rather than retain a second source of truth.

## 7. Portable format

TOPO defines a versioned native bundle independent of internal database layout. The first contract is intentionally small:

```text
topo-bundle/
├── manifest.json
├── sources.jsonl
├── claims.jsonl
└── events.jsonl
```

The v0.1 bundle is complete for the records implemented today, validates internal references, and imports conservatively without overwriting existing IDs. Future format versions may add `schema.json`, derived documents and other assets explicitly through the manifest.

Adapters may additionally support Markdown, JSON, OKF and MCP resources. See `docs/BUNDLE_FORMAT.md`.

## 8. Security posture

Before remote or managed functionality, TOPO needs an explicit threat model.

Initial rules:

- local-only by default
- loopback network binding by default
- no unauthenticated non-loopback transport
- no secrets or encryption keys in query strings
- no analytics by default
- cloud-model disclosure must be explicit
- sensitivity-aware context filtering
- at-rest encryption, if enabled, must cover sensitive history as well as current records
- no zero-knowledge or end-to-end claims unless the architecture genuinely guarantees them

## 9. Temporal memory and contradictions

TOPO should distinguish:

- duplicate
- extension
- contradiction
- replacement
- historical change

A newer preference should not necessarily erase the older state. Temporal change is useful context in its own right.

## 10. RACK integration

RACK integration comes after the TOPO core stabilises.

RACK should gain a **ContextSource** abstraction separate from its existing PracticeSource/authority model. TOPO context is selected by relevance, sensitivity, confidence, freshness, scope and budget. RACK practice is resolved by explicit authority and precedence.

For live-capable destinations, TOPO can remain a dynamic context resource. For static destinations, RACK can snapshot selected TOPO context and record the revision/digest in its build manifest.

### Promote to practice
A later bridge may identify a repeated confirmed preference or pattern and propose a RACK module/change.

The invariant is:

> TOPO may suggest practice. TOPO cannot establish practice.

## 11. Existing repositories

### mymemory
Reference implementation. Preserve useful ideas around staging, imports, selective disclosure, provenance and provider abstraction. Do not carry forward its current hosted encryption/key-handling assumptions or mixed legacy storage model.

### llm-memory-extractor
Primary source for browser capture mechanics and UX. Preserve adapters, configurable extraction, review, local model support, derived documents, version/diff UX and OKF ideas. Replace its canonical IndexedDB model, aggressive inference semantics and timestamp-only document provenance.

### mymemory-mcp-server
Primary source for local agent interaction patterns. Preserve candidate workflows, MCP tools/resources, search, stale review, attribution, audit and schema customisation. Replace the flat JSON canonical store, direct-write defaults, broad profile injection and unsafe optional remote authentication.

### myAImemory
Historical snapshot; no architectural dependency.

## 12. v0.1 success criteria

TOPO v0.1 succeeds when:

1. it runs locally without an account;
2. multiple AI clients can use one local memory store;
3. AI clients can propose claims without silently confirming them;
4. users can inspect evidence/provenance;
5. assertions and inferences remain distinct;
6. claims can expire, change or supersede one another;
7. useful retrieval works without mandatory embeddings;
8. the complete store can be exported in a documented portable format;
9. browser capture can populate the same canonical model;
10. the architecture leaves a clean path to RACK integration.

## 13. Explicit non-goals for v0.1

Defer:

- hosted accounts
- team memory
- automatic broad email ingestion
- SaaS connector ecosystem
- mobile app
- automatic RACK modification
- organisation-wide memory
- vector database dependency
- autonomous hidden extraction
- automatic sharing of sensitive context
