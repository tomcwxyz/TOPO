# TOPO capture architecture

TOPO becomes useful when it can learn from normal work without requiring people to maintain a memory database by hand.

See also [ChatGPT, Claude and desktop capture surfaces](CAPTURE_SURFACES.md) and [Memory architecture](MEMORY_ARCHITECTURE.md).

The capture product contract remains:

> **Ambient capture, governed memory.**

A person opts a source into capture once. TOPO may then observe that source automatically, but observations do not become established memory without the candidate/review lifecycle.

What changes in the new architecture is the extraction target: TOPO should propose **coherent Memory Pages**, not atomise every useful interaction into claims.

## Product loop

```text
normal work
    |
    +-- ChatGPT / Claude / Gemini / Copilot
    +-- Hermes / OpenClaw / other agents
    +-- imports and other local tools
    |
    v
captured interaction
    |
    v
TOPO page-first extraction
    |
    +-- not worth remembering -> discard
    +-- duplicate -> add supporting evidence
    +-- extension/change -> review
    +-- new Memory Page -> review
    |
    v
memory inbox
    |
    +-- confirm
    +-- edit
    +-- reject
    +-- merge / supersede
    |
    v
canonical Memory Pages
    |
    +-- optional structured annotations
    |
    v
purpose-bound context
```

Capture should disappear into the person's normal workflow. Governance should remain visible at the point where an observation becomes durable context.

## Capture is not confirmation

Source consent and memory authority are deliberately separate.

Enabling capture means TOPO may read interactions from that source while capture is enabled, identify potential future-useful context, compare it with existing memory and retain the minimum evidence necessary for review and provenance.

It does not mean:

- every turn becomes memory;
- the connected AI can confirm its own interpretation;
- assistant-authored text becomes evidence about the user;
- questions automatically become facts;
- captured material is automatically shared with other tools;
- semantic similarity overrides disclosure boundaries.

Durable memory remains proposal-first.

## Extraction goal

The extractor should ask:

> **What small pieces of context would materially improve a future interaction, and can each be expressed faithfully as a coherent memory?**

A good proposed Memory Page should:

- preserve enough context to remain meaningful when read later;
- be concise enough to retrieve and compose;
- be grounded in identifiable source evidence;
- avoid turning nuance into many disconnected facts;
- state uncertainty where the source is uncertain;
- avoid invented rationale or inferred personal traits unless explicitly warranted;
- have a plausible useful horizon: durable, project or temporary.

Optional structured annotations may be proposed when they provide real value, for example an explicit preference, project constraint or temporal value. They should not multiply the user's review burden by default.

## Evidence rules

The first extraction policy remains intentionally conservative.

1. Every proposed memory must be grounded in at least one user-authored turn or other explicitly authoritative source.
2. Assistant, system and tool output may explain context but is not independent evidence about the user.
3. Questions are weak evidence and must not be transformed into personal facts unless the user explicitly discloses the fact.
4. Interpretation must remain distinguishable from direct evidence where the distinction matters.
5. Confidence does not grant authority.
6. The extractor should prefer context likely to improve a future interaction rather than collecting trivia.
7. Secrets and credentials are never memory candidates.
8. Generated Memory Page prose cannot cite itself as evidence.

These rules belong in the capture/domain policy rather than solely in prompting.

## Memory horizons

Candidates should identify their expected useful lifetime:

- **durable** — stable preferences and enduring personal/work context;
- **project** — useful while a project, role or body of work remains active;
- **temporary** — short-lived circumstances that should expire.

TOPO should prefer explicit validity dates when the source provides them and should not invent dates merely to make temporary context expire.

## Source retention

TOPO should not become a second archive of every AI transcript.

The default source retention remains **review-window**:

- the capture/extraction transport may process the full interaction;
- the canonical Source keeps metadata and the evidence needed to support proposed memories;
- each Memory Page links back to one or more Sources and, where useful, evidence excerpts/locators;
- unrelated transcript content is not retained by default.

**full-source** is an explicit opt-in for people who want complete local transcript retention.

Later work should add configurable review-window expiry and source pruning.

## Comparison and change

Page-first capture still needs deterministic change handling.

For each proposed page, TOPO should distinguish:

- **duplicate** — same meaning; add supporting evidence rather than another candidate;
- **extension** — existing memory is still right but new context enriches it;
- **potential change** — newer context may update or narrow the existing memory;
- **contradiction** — source conflicts with existing memory;
- **replacement** — a new state clearly supersedes an older one;
- **historical change** — both old and new states are worth retaining over time.

Structured annotations can assist these comparisons where useful, but the review surface should present the human meaning of the change.

## Browser capture

The browser extension remains the primary capture surface for hosted AI products.

Initial target order:

1. ChatGPT
2. Claude
3. Gemini
4. Microsoft Copilot
5. generic adapter API

The extension should be compatible with Chromium browsers first, then Firefox where APIs permit the same behaviour.

The useful parts of `llm-memory-extractor` should be migrated by behaviour and tests: site detection, message parsing, SPA navigation handling, mutation observation and capture diagnostics. Its old IndexedDB fact model and aggressive extraction semantics are not carried forward.

### Ambient behaviour

For an enabled site the extension should:

- recognise the conversation surface automatically;
- capture stable completed turns rather than every DOM mutation;
- deduplicate repeated DOM renders;
- record provider/conversation identifiers where available;
- send batches after a completed assistant turn and at navigation/session boundaries;
- recover unsent local batches after browser restart;
- visibly indicate that TOPO capture is enabled for the site;
- offer “do not capture this conversation” and per-site pause controls.

Normal use should not require a start/stop recording ritual.

### Desktop transport

The preferred connected-desktop transport is browser Native Messaging rather than a broadly reachable HTTP write endpoint.

This keeps capture local, explicitly associated with the installed TOPO extension, independent of a fixed port, and separate from the read-only local context endpoint used by RACK.

## Agent capture

Agent runtimes already have memory systems. TOPO should complement them rather than silently replacing them.

The working distinction is:

- **agent-native memory** — hot working cache, session continuity and runtime-specific state;
- **TOPO** — durable, reviewed, portable cross-agent context;
- **RACK** — governed practice and instructions.

### Hermes

The preferred TOPO integration remains a general Hermes plugin rather than replacing its memory provider. A successful completed interaction can be submitted to TOPO as source material and then pass through the same page-first extraction/review pipeline.

Explicit TOPO retrieval and “remember this” actions can use MCP or dedicated tools.

### OpenClaw

The preferred TOPO integration remains a companion plugin. Completed interaction material can be offered to TOPO without taking over OpenClaw's primary memory capability.

TOPO retrieval can remain tool/MCP based so context is fetched when useful rather than injected wholesale into every prompt.

### Memory pressure

TOPO should help with full agent memories without becoming another automatic dump.

When an agent-native memory store approaches its budget:

1. retain immediate working/session state in the agent store;
2. offer durable entries/interactions to TOPO as captured source material;
3. let TOPO create or extend governed Memory Pages;
4. remove or compact the agent copy only when the runtime's own policy allows;
5. retrieve older durable context from TOPO on demand.

TOPO should not automatically mirror its entire canonical memory back into agent memory files.

## Agent capture API

Capture should expose a high-level path where the runtime provides the interaction and lets TOPO own extraction semantics.

Target shape:

```ts
topo_capture_interaction({
  id,
  provider: "hermes",
  subject: "self",
  turns: [
    { id: "u1", role: "user", content: "..." },
    { id: "a1", role: "assistant", content: "..." }
  ]
})
```

The runtime should not need to understand TOPO's Memory Page schema simply to contribute source material.

A later explicit proposal tool may accept a drafted Memory Page when a trusted client intentionally wants to propose one.

## Inbox, not database administration

Capture changes the primary desktop experience.

The default surface should be a source-grouped memory inbox containing a small number of coherent candidates:

```text
3 things worth remembering
from 2 interactions

ChatGPT — TOPO planning
  RACK should consume TOPO through purpose-bound Context Packets
  rather than depending on TOPO's memory representation.

Claude — Event implementation
  Event uses Neon for its managed database and should not
  introduce Supabase as an alternative architecture by default.
```

The person can edit the prose directly, confirm, reject, merge or supersede it.

Optional structured annotations should normally be hidden behind the memory rather than presented as extra review cards.

Duplicates should be absorbed as supporting evidence. Potential changes and contradictions should be surfaced more prominently than ordinary new memories.

## Delivery sequence

The current claim-based capture implementation remains migration infrastructure.

### M1 — Memory Page contract
- canonical page schema
- Source links
- events/versioning
- optional annotations
- TypeScript/Rust fixtures

### M2 — Portable Markdown
- deterministic page rendering
- bundle/import support
- round-trip tests

### M3 — Page-first capture and inbox
- page-first extraction
- evidence validation
- page-level duplicate/change comparison
- prose-centred review UX

### M4 — Page-aware retrieval
- authorised page filtering
- FTS
- purpose/task ranking
- Context Packet rendering

### M5 — Optional local semantic index
- rebuildable embeddings
- hybrid FTS/semantic retrieval
- no canonical dependency on the index

### Existing capture surfaces
- retain browser capture mechanics
- retain desktop ingestion/diagnostics
- retain Hermes/OpenClaw capture paths
- adapt them to feed M3 rather than expanding claim extraction

After the page-first path is working, measure real daily use before broadening capture surfaces.
