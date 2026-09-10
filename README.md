# TOPO

**Portable, user-owned context for AI.**

TOPO is a local-first context layer that helps people gather, review, maintain and selectively share useful context across AI tools and providers — while keeping that context useful outside TOPO itself.

It is designed around a simple distinction:

- **TOPO** — what AI can know about you and your context.
- **RACK** — how AI should work.

TOPO takes a **prose-first memory** approach. The primary durable memory object is a **Memory Page**: a short, coherent, human-readable piece of context with governance metadata and traceable evidence. Structured Claims remain available as optional annotations where structure genuinely helps, but TOPO does not need to atomise all memory into database facts by default.

See [Memory architecture](docs/MEMORY_ARCHITECTURE.md) and [ADR 0011](docs/adr/0011-memory-pages-are-the-primary-durable-memory-unit.md).

## Principles

- **User authority** — proposed memories are reviewable before they become durable.
- **Meaning before atomisation** — preserve coherent context first; add structure only where it earns its keep.
- **Provenance by default** — memory retains where it came from, when and what evidence supports it.
- **Governance independent of representation** — sensitivity, temporal validity and disclosure rules apply whether context is prose or structured.
- **Local first** — no account, hosted database or cloud model should be required.
- **Portable by design** — human-readable Markdown and open structured metadata are part of the product contract.
- **Selective context** — TOPO resolves relevant context for a purpose rather than injecting an entire profile.
- **Inspectability over magic** — changes, contradictions, stale information and context sharing should be visible.
- **Derived views are not evidence** — generated profiles and summaries remain projections over canonical memories.
- **Disposable retrieval infrastructure** — FTS/semantic indexes may be rebuilt; the user's memory must not depend on them.

## Status

TOPO is in **local alpha**, with the desktop application as the primary product surface.

The earlier claim-based alpha proved the governed foundation: Sources, Claims and Events; local SQLite persistence; proposal-first MCP; Tauri desktop management; browser capture for ChatGPT, Claude and Gemini; local extraction; source-aware review; and purpose-bound context sharing to RACK/Hermes/OpenClaw-style consumers.

The primary path has now been reoriented from **Claim-as-memory** to **Memory Page-as-memory** while preserving that foundation:

1. the canonical Memory Page contract is implemented;
2. portable Markdown Memory Pages are implemented;
3. capture and review are page-first;
4. local context resolution and `/v0/search` are Memory Page first;
5. deterministic SQLite FTS5 retrieval is measured against a labelled evaluation set.

Claims remain useful as optional structured annotations and compatibility records rather than the required carrier of all meaning.

The immediate priority is now **dogfooding the complete loop**, not adding more retrieval infrastructure. The first deterministic retrieval fixture baseline recalls all ordinary lexical/FTS cases and deliberately misses one unmatched semantic-vocabulary case. See [ROADMAP.md](ROADMAP.md) and [retrieval evaluation](docs/RETRIEVAL_EVALUATION.md). A semantic/embedding index remains optional and should only be built if repeated real misses demonstrate that it earns its complexity.

The practical product proof is:

> Use AI normally for a day, review a small number of coherent memories worth keeping, then see the right context surface in another AI/tool — while the memories still make sense when opened outside TOPO.

## RACK integration

TOPO remains a local context node for RACK and the draft Organisational OS.

The important boundary is:

```text
TOPO Memory Pages
    ↓
TOPO resolver
    ↓
purpose-bound Context Packet
    ↓
RACK ContextSource
```

RACK does not need to know whether TOPO internally used Memory Pages, legacy Claims or a future representation. RACK receives authorised context for the stated purpose and combines it with its separate governed practice sources.

TOPO may suggest a RACK practice change. It cannot establish practice automatically.

See [Product/architecture plan](PLAN.md), [roadmap](ROADMAP.md), [memory architecture](docs/MEMORY_ARCHITECTURE.md), [capture architecture](docs/CAPTURE.md), [capture evaluation](docs/CAPTURE_EVALUATION.md), [retrieval evaluation](docs/RETRIEVAL_EVALUATION.md), [agent integrations](docs/AGENT_INTEGRATIONS.md), [Organisational OS adapter](docs/OOS_ADAPTER.md), [local alpha releases](docs/RELEASE.md) and [ADRs](docs/adr/README.md).

## Install and first run

TOPO `0.1.1-alpha.1` is being shaped as an installer-first desktop alpha for **Windows and Linux**.

Normal setup should be graphical from start to finish:

1. install TOPO using the Windows installer, Linux `.deb`, or Linux AppImage;
2. open TOPO;
3. follow the first-run card to prepare private local extraction;
4. let TOPO install its recommended local model;
5. let TOPO register the bundled browser capture companion;
6. grant the browser's one explicit extension permission;
7. start using ChatGPT, Claude or Gemini normally.

There should be no Node/npm/Rust setup and no terminal commands in the normal user journey. Windows user-facing releases are required to be signed; unsigned builds are internal smoke-test artefacts only. Linux local-engine setup is launched by TOPO behind the normal graphical system-authorisation prompt rather than asking people to paste an install command.

See [docs/RELEASE.md](docs/RELEASE.md) for the exact release/trust contract.

## Repository shape

- `packages/schemas` — canonical runtime/interchange schemas, including Memory Pages.
- `packages/core` — lifecycle, authority and governance policy.
- `packages/capture` — captured interaction contracts, evidence policy and candidate preparation.
- `packages/store` — runtime-neutral persistence interfaces.
- `packages/store-node` — Node SQLite adapter for integration/developer use.
- `crates/topo-contracts` — Rust representation of the native interchange boundary.
- `packages/formats` — portable TOPO bundle import/export.
- `adapters/oos` — purpose-bound Organisational OS Context Packet adapter.
- `packages/mcp` — proposal-first MCP service and tool policy.
- `apps/mcp` — local stdio MCP server over the same governed local store.
- `apps/cli` — advanced command-line workflows for development/integrations.
- `apps/desktop` — Tauri + React desktop application and primary user surface, including the local Memory Page resolver and disposable FTS projection.
- `apps/extension` — packaged Chromium capture companion.
- `test-fixtures/domain` — contract fixtures shared by TypeScript and Rust.

## Portable memory

TOPO's portable format makes Markdown Memory Pages first-class:

```text
topo/
├── memories/
│   └── *.md
├── sources.jsonl
├── annotations.jsonl
├── events.jsonl
├── manifest.json
└── index.sqlite        # optional / rebuildable
```

The format is versioned independently of the internal SQLite layout. The retrieval index is optional infrastructure: canonical Memory Pages, source evidence and governance metadata must remain sufficient to rebuild it.

A TOPO export should be usable from a filesystem, Git repository, notes tool, local agent, cloud AI or another future context system.

## Retrieval evaluation

The current deterministic resolver applies governance before relevance, then combines lexical relevance with a local SQLite FTS5 projection and bounded context composition.

Run the labelled retrieval baseline with:

```bash
npm run test:retrieval-eval
```

The initial six-case synthetic baseline is intentionally imperfect: required-page recall `0.833`, non-semantic recall `1.000`, semantic-challenge recall `0.000`, MRR `0.833`, zero forbidden disclosures, and roughly `236` average context characters. The miss is a deliberate vocabulary mismatch between **offline-first** and **without a network connection**.

That miss is a benchmark, not a mandate for embeddings. Real dogfooding must show repeated semantic misses before TOPO adds an optional semantic index.

## Advanced interfaces

TOPO exposes CLI and MCP interfaces for development, automation and integrations. They operate over the same governed local store as the desktop and do not define a separate memory model.

The default store is `~/.topo/topo.sqlite`.

MCP clients are proposal-first by default and cannot silently turn generated interpretation into durable confirmed memory without explicit authority.

## Prior work

TOPO consolidates lessons from three earlier experiments:

- `mymemory` — hosted personal context, staging, imports and selective sharing;
- `llm-memory-extractor` — local-first browser capture, configurable extraction and derived memory documents;
- `mymemory-mcp-server` — local MCP access, candidate workflows, search, expiry and attribution.

Those repositories are references, not architectural dependencies.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
