# ADR 0009 — Capture is ambient; memory remains governed

- **Status:** Accepted
- **Refined by:** [ADR 0011](0011-memory-pages-are-the-primary-durable-memory-unit.md) for the durable memory representation

## Context

TOPO's local store, desktop manager, MCP interface and RACK context path can already manage and disclose governed memory. The product is not useful enough if the person must populate that memory deliberately.

The product loop therefore requires capture from the AI interactions and tools where useful context is naturally created.

Requiring a manual start/stop workflow for every interaction would preserve governance but undermine the ambient product goal. Allowing captured material to become durable memory automatically would make capture seamless but weaken TOPO's authority model.

## Decision

TOPO separates **capture consent** from **memory authority**.

When a person enables a capture source, TOPO may automatically observe and locally process interactions from that source according to its retention policy.

Captured material may produce candidate Memory Pages. During migration it may also produce or retain legacy candidate Claims. Neither becomes confirmed durable memory without the review authority rules.

The default extraction policy requires user-authored or otherwise explicitly authoritative evidence for every proposed memory. Assistant, system and tool output may provide conversational context but cannot independently establish personal memory.

Browser capture should prefer a TOPO-owned extension connected to TOPO Desktop through Native Messaging.

Agent integrations should prefer companion capture/retrieval tools over replacing an agent runtime's native memory subsystem. Native agent memory remains useful as a bounded working cache; TOPO owns durable cross-agent governed context.

## Consequences

- capture can be on continuously without granting continuous write authority;
- the desktop experience should prioritise a memory inbox;
- extraction and deduplication remain core TOPO behaviour rather than provider-specific agent behaviour;
- page-first extraction can reduce atomisation without weakening governance;
- raw transcript retention can be minimised independently of canonical Memory Page retention;
- agent stores do not need to be mirrored into TOPO or vice versa;
- TOPO can relieve agent memory pressure by becoming a durable retrieval layer;
- capture integrations must expose clear source-level pause/disable controls;
- semantic retrieval does not alter the authority required to create or disclose memory.
