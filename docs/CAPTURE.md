# TOPO capture architecture

TOPO becomes useful when it can learn from normal work without requiring people to maintain a memory database by hand.

The capture product contract is:

> **Ambient capture, governed memory.**

A person opts a source into capture once. TOPO may then observe that source automatically, but observations do not become established memory without the existing candidate/review lifecycle.

## Product loop

~~~text
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
TOPO extraction
    |
    +-- not worth remembering -> discard
    +-- duplicate -> add supporting evidence
    +-- potential change -> review
    +-- new candidate -> review
    |
    v
memory inbox
    |
    +-- confirm
    +-- edit
    +-- reject
    |
    v
canonical Claims
    |
    v
purpose-bound context
~~~

Capture should disappear into the person's normal workflow. Governance should remain visible at the point where an observation becomes durable context.

## Capture is not confirmation

Source consent and memory authority are deliberately separate.

Enabling capture means TOPO may read interactions from that source while capture is enabled, extract and compare potential memories, and retain the minimum evidence necessary for review and provenance.

It does not mean every turn is memory, the connected AI can confirm its own inference, assistant-authored text becomes evidence about the user, questions automatically become facts, or captured material is automatically shared with other tools.

Canonical memory remains proposal-first.

## Evidence rules

The first extraction policy is intentionally conservative.

1. Every proposed memory must be grounded in at least one user-authored turn.
2. Assistant, system and tool output may explain context but is not evidence about the user.
3. Questions are weak evidence and must not be transformed into personal facts unless the user explicitly discloses the fact.
4. Assertions, preferences, observations, inferences and derived patterns remain distinct.
5. Confidence does not promote an inference into an assertion.
6. The extractor should prefer context likely to improve a future interaction rather than collecting trivia.
7. Secrets and credentials are never memory candidates.

These rules are encoded in the capture package rather than being left solely to prompting.

## Memory horizons

Candidates should identify their expected useful lifetime:

- **durable** — stable preferences and enduring personal/work context;
- **project** — useful while a project, role or body of work remains active;
- **temporary** — short-lived circumstances that should expire.

TOPO should prefer explicit validity dates when the source provides them and should not invent dates merely to make a temporary claim expire.

## Source retention

TOPO should not become a second archive of every AI transcript.

The default source retention is **review-window**:

- the capture/extraction transport may process the full interaction;
- the canonical Source keeps metadata and only the evidence turns supporting proposed memories;
- each Claim retains its evidence text and Source reference;
- unrelated transcript content is not retained by default.

**full-source** is an explicit opt-in for people who want complete local transcript retention.

Later work should add configurable review-window expiry and source pruning.

## Browser capture

The browser extension is the primary capture surface for hosted AI products.

Initial target order:

1. ChatGPT
2. Claude
3. Gemini
4. Microsoft Copilot
5. generic adapter API

The extension should be compatible with Chromium browsers first, then Firefox where APIs permit the same behaviour.

The useful parts of llm-memory-extractor should be migrated by behaviour and tests: site detection, message parsing, SPA navigation handling, mutation observation and capture diagnostics. Its old IndexedDB fact model and aggressive extraction semantics are not carried forward.

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

This keeps the capture path local, explicitly associated with the installed TOPO extension, independent of a fixed port, and separate from the read-only local context endpoint used by RACK.

Standalone browser storage can remain an optional later mode, but connected TOPO Desktop is the primary product.

## Agent capture

Agent runtimes already have memory systems. TOPO should complement them rather than silently replacing them.

The working distinction is:

- **agent-native memory** — hot working cache, session continuity and runtime-specific state;
- **TOPO** — durable, reviewed, cross-agent user context;
- **RACK** — governed practice and instructions.

### Hermes

Hermes maintains bounded MEMORY.md and USER.md state and can also use one external memory provider alongside built-in memory.

The preferred TOPO integration is a **general Hermes plugin**, not a memory-provider replacement. Hermes exposes a post_llm_call hook after a successful turn with the user message, assistant response and conversation history. A TOPO plugin can use that hook to send a completed interaction to local TOPO automatically, without relying on the model remembering to call a tool.

The same integration can register TOPO tools or use MCP for explicit retrieval and “remember this” actions.

This means people can keep whichever Hermes external memory provider they already use. Hermes native memory remains its compact hot cache; TOPO receives durable cross-agent candidates through the normal governance pipeline.

A native Hermes MemoryProvider remains an optional later adapter for people who explicitly want TOPO in that provider slot, but it is not the default architecture.

### OpenClaw

OpenClaw has workspace memory, daily notes, active recall and an exclusive primary memory capability.

The preferred TOPO integration is a **companion OpenClaw plugin**. OpenClaw exposes an agent_end observation hook after a turn, and plugins can register ordinary agent tools without claiming the exclusive memory capability. With explicit conversation-access permission, the hook can submit completed interaction material to TOPO automatically.

TOPO retrieval can initially remain tool/MCP based so context is fetched when useful rather than injected wholesale into every prompt. A later opt-in before_prompt_build integration can add selected purpose-bound TOPO context when the user explicitly enables that behaviour.

OpenClaw can therefore keep memory-core, LanceDB or another selected memory capability while TOPO receives only durable cross-agent candidates.

### Memory pressure

TOPO should help with full agent memories without becoming another automatic dump.

When an agent-native memory store approaches its budget:

1. retain immediate working/session state in the agent store;
2. offer durable entries to TOPO as captured source material;
3. let TOPO deduplicate and govern them;
4. remove or compact the agent copy only when the runtime's own policy allows;
5. retrieve older durable context from TOPO on demand.

TOPO should not automatically mirror its entire canonical memory back into agent memory files. That recreates the same context-budget problem.

## Agent capture API

MCP already exposes claim proposals. Capture adds a higher-level path where the runtime can provide the interaction and let TOPO own extraction semantics.

Target shape:

~~~ts
topo_capture_interaction({
  id,
  provider: "hermes",
  subject: "self",
  turns: [
    { id: "u1", role: "user", content: "..." },
    { id: "a1", role: "assistant", content: "..." }
  ]
})
~~~

The runtime should not need to understand TOPO's complete claim ontology simply to contribute source material.

Direct claim proposal remains useful for explicit agent reasoning and specialised integrations.

## Inbox, not database administration

Capture changes the primary desktop experience.

The default surface should become a source-grouped memory inbox:

~~~text
7 things worth remembering
from 3 interactions

ChatGPT — TOPO planning
  Preference: use British English
  Project context: TOPO owns durable context
  Inference: prefers local-first architectures

Claude — Event implementation
  Project context: Neon is the project database
~~~

The person can confirm, edit or reject candidates in batches.

Duplicates should normally be absorbed as supporting evidence rather than shown as repeated candidates. Potential changes and contradictions should be surfaced more prominently than ordinary new memories.

## Delivery sequence

### 5A — Capture contract
- capture package
- captured interaction/turn contract
- evidence-grounded proposals
- retention policy
- duplicate/supporting-evidence comparison
- conservative extraction prompt
- deterministic tests

### 5B — Desktop ingestion
- local capture service
- extraction provider abstraction
- transactional source/candidate persistence
- source retention/pruning hooks

### 5C — Browser extension
- extension shell
- ChatGPT + Claude + Gemini adapters
- ambient completed-turn capture
- Native Messaging connection
- pause/exclude controls
- capture diagnostics

### 5D — Memory inbox
- source-grouped review
- batch confirm/reject
- evidence preview
- duplicate/change presentation
- source/connection health

### 5E — Agent capture
- high-level MCP interaction capture
- Hermes companion integration
- OpenClaw companion integration
- explicit remember path
- memory-pressure handoff experiments

### 5F — Bootstrap imports
- ChatGPT history
- Claude history
- Gemini/Google history
- llm-memory-extractor migration

After 5F, measure real daily use before broadening capture surfaces.
