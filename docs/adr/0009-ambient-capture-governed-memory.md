# ADR 0009 — Capture is ambient; memory remains governed

**Status:** Accepted

## Context

TOPO's local store, desktop manager, MCP interface and RACK context path can already manage and disclose governed memory. The product is not yet useful enough because the person must still populate that memory deliberately.

The original product loop requires capture from the AI interactions and tools where useful context is naturally created.

Requiring a manual start/stop workflow for every interaction would preserve governance but undermine the ambient product goal. Allowing captured material to become confirmed memory automatically would make capture seamless but weaken TOPO's authority model.

## Decision

TOPO separates **capture consent** from **memory authority**.

When a person enables a capture source, TOPO may automatically observe and locally process interactions from that source according to its retention policy.

Captured material may produce candidate Claims. It does not become confirmed memory without the existing review authority rules.

The default extraction policy requires user-authored evidence for every candidate. Assistant, system and tool output may provide conversational context but cannot independently establish a claim about the user.

Browser capture should prefer a TOPO-owned extension connected to TOPO Desktop through Native Messaging.

Agent integrations should prefer companion capture/retrieval tools over replacing an agent runtime's native memory subsystem. Native agent memory remains useful as a bounded working cache; TOPO owns durable cross-agent governed context.

## Consequences

- capture can be on continuously without granting continuous write authority;
- the desktop experience should prioritise a memory inbox;
- extraction and deduplication become core TOPO behaviour rather than provider-specific agent behaviour;
- raw transcript retention can be minimised independently of canonical Claim retention;
- agent stores do not need to be mirrored into TOPO or vice versa;
- TOPO can relieve agent memory pressure by becoming a durable retrieval layer;
- capture integrations must expose clear source-level pause/disable controls.
