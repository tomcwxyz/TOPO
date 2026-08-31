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

TOPO is now in **local alpha**. The canonical claim lifecycle, local SQLite store, CLI, proposal-first MCP server and a usable Tauri desktop memory manager are working. Desktop, CLI, MCP and interoperability adapters share the same local store rather than maintaining parallel memory.

The desktop application is intended to become the primary local manager. CLI, MCP and browser-extension clients will use the same portable domain contract rather than owning separate definitions of memory.

TOPO is also beginning to act as a local memory/context node for the draft [Organisational OS](https://github.com/tomcwxyz/Organisational-OS). The first adapter exposes purpose-bound Context Packets while deliberately keeping external operational state distinct from canonical memory Claims.

See [PLAN.md](PLAN.md), [ROADMAP.md](ROADMAP.md), [Organisational OS adapter](docs/OOS_ADAPTER.md), [local alpha releases](docs/RELEASE.md) and [docs/adr](docs/adr).

## Repository shape

- `packages/schemas` — canonical runtime/interchange schemas.
- `packages/core` — claim lifecycle and domain policy.
- `packages/store` — runtime-neutral persistence interfaces.
- `packages/store-node` — Node SQLite adapter for CLI/MCP use.
- `crates/topo-contracts` — Rust representation of the native interchange boundary.
- `packages/formats` — portable TOPO bundle import/export.
- `adapters/oos` — purpose-bound Organisational OS Context Packet adapter.
- `packages/mcp` — proposal-first MCP service and tool policy.
- `apps/mcp` — local stdio MCP server over the same SQLite store.
- `apps/cli` — local command-line workflows for claims, review, search and portability.
- `apps/desktop` — Tauri + React desktop application.
- `test-fixtures/domain` — contract fixtures shared by TypeScript and Rust.

## Local CLI

The CLI is intentionally a thin client over the same core/store contracts that MCP and desktop will use.

```bash
npm run topo -- init
npm run topo -- claim add writing.locale en-GB --type preference
npm run topo -- claim propose work.focus "software architecture" --type inference --confidence 0.6
npm run topo -- candidate list
npm run topo -- candidate confirm <claim-id>
npm run topo -- search "en-GB"
npm run topo -- export ./topo-export
npm run topo -- --store ./other.sqlite import ./topo-export
```

The default store is `~/.topo/topo.sqlite`. Pass `--store <path>` or set `TOPO_DB` to use another store.

Run the proposal-first MCP server against that same store:

```bash
npm run topo:mcp
```

Normal MCP clients can propose and retrieve memory within their sensitivity ceiling but cannot silently confirm it. See [docs/MCP.md](docs/MCP.md).

Native bundles are documented in [docs/BUNDLE_FORMAT.md](docs/BUNDLE_FORMAT.md). Import is conservative: existing record IDs are treated as conflicts rather than overwritten.

## Prior work

TOPO consolidates lessons from three earlier experiments:

- `mymemory` — hosted personal context, staging, imports and selective sharing.
- `llm-memory-extractor` — local-first browser capture, configurable extraction and derived memory documents.
- `mymemory-mcp-server` — local MCP access, candidate workflows, search, expiry and attribution.

Those repositories are references, not architectural dependencies.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
