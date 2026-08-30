# TOPO

**Portable, user-owned context for AI.**

TOPO is a local-first context layer that helps people gather, review, maintain and selectively share useful context across AI tools and providers.

It is designed around a simple distinction:

- **TOPO** — what AI can know about you and your context.
- **RACK** — how AI should work.

TOPO treats memory as governed context rather than an opaque store of inferred facts. AI systems may propose claims; people decide what becomes established memory.

## Principles

- **User authority** — proposed memory is reviewable before it becomes canonical.
- **Claims, not unquestioned facts** — assertions, observations, inferences, preferences and derived patterns remain distinguishable.
- **Provenance by default** — memory should retain where it came from, when, and what evidence supports it.
- **Local first** — no account, hosted database or cloud model should be required.
- **Portable by design** — structured and human-readable exports are part of the product contract.
- **Selective context** — TOPO resolves relevant context for a task rather than injecting an entire profile.
- **Inspectability over magic** — changes, contradictions, stale information and context sharing should be visible.
- **Derived views are not evidence** — generated profiles and documents remain projections over canonical claims.

## Status

TOPO is at the foundation stage. The initial work is to establish the canonical data model, local store, candidate-review lifecycle, portable format and MCP interface before migrating browser capture features from earlier prototypes.

See [PLAN.md](PLAN.md), [ROADMAP.md](ROADMAP.md) and [docs/adr](docs/adr).

## Prior work

TOPO consolidates lessons from three earlier experiments:

- `mymemory` — hosted personal context, staging, imports and selective sharing.
- `llm-memory-extractor` — local-first browser capture, configurable extraction and derived memory documents.
- `mymemory-mcp-server` — local MCP access, candidate workflows, search, expiry and attribution.

Those repositories are references, not architectural dependencies.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
