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

TOPO is in **local alpha**, with the desktop application now the primary product surface. The canonical claim lifecycle, local SQLite store, proposal-first MCP server and Tauri desktop manager are working. Ambient Chromium capture for ChatGPT, Claude and Gemini can reach TOPO, be extracted locally and appear as source-aware candidate memory for review. Governed Hermes and OpenClaw integrations can retrieve purpose-bound context and contribute interaction captures without replacing their native working memory.

The current product priority is not more infrastructure. It is proving that a normal day of AI use produces a short, high-quality memory inbox that can be reviewed quickly and recalled correctly elsewhere. See [capture evaluation](docs/CAPTURE_EVALUATION.md).

TOPO also acts as a local context node for RACK and the draft [Organisational OS](https://github.com/tomcwxyz/Organisational-OS). The authenticated local bridge exposes purpose-bound Context Packets with explicit per-session sharing consent and ranks authorised confirmed context against the stated purpose/task before falling back to recency. External operational state remains distinct from canonical memory Claims.

See [PLAN.md](PLAN.md), [ROADMAP.md](ROADMAP.md), [capture architecture](docs/CAPTURE.md), [capture alpha test](docs/CAPTURE_ALPHA_TEST.md), [capture evaluation](docs/CAPTURE_EVALUATION.md), [agent integrations](docs/AGENT_INTEGRATIONS.md), [Organisational OS adapter](docs/OOS_ADAPTER.md), [local alpha releases](docs/RELEASE.md) and [docs/adr](docs/adr).

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

- `packages/schemas` — canonical runtime/interchange schemas.
- `packages/core` — claim lifecycle and domain policy.
- `packages/capture` — captured interaction contracts, evidence policy and candidate preparation.
- `packages/store` — runtime-neutral persistence interfaces.
- `packages/store-node` — Node SQLite adapter for integration/developer use.
- `crates/topo-contracts` — Rust representation of the native interchange boundary.
- `packages/formats` — portable TOPO bundle import/export.
- `adapters/oos` — purpose-bound Organisational OS Context Packet adapter.
- `packages/mcp` — proposal-first MCP service and tool policy.
- `apps/mcp` — local stdio MCP server over the same SQLite store.
- `apps/cli` — advanced command-line workflows for development/integrations.
- `apps/desktop` — Tauri + React desktop application and primary user surface.
- `apps/extension` — packaged Chromium capture companion.
- `test-fixtures/domain` — contract fixtures shared by TypeScript and Rust.

## Advanced interfaces

TOPO still exposes CLI and MCP interfaces for development, automation and integrations. They operate over the same governed local store as the desktop and do not define a separate memory model.

The default store is `~/.topo/topo.sqlite`. MCP clients can propose and retrieve memory within their sensitivity ceiling but cannot silently confirm it. See [docs/MCP.md](docs/MCP.md).

Native bundles are documented in [docs/BUNDLE_FORMAT.md](docs/BUNDLE_FORMAT.md). Import is conservative: existing record IDs are treated as conflicts rather than overwritten.

## Prior work

TOPO consolidates lessons from three earlier experiments:

- `mymemory` — hosted personal context, staging, imports and selective sharing.
- `llm-memory-extractor` — local-first browser capture, configurable extraction and derived memory documents.
- `mymemory-mcp-server` — local MCP access, candidate workflows, search, expiry and attribution.

Those repositories are references, not architectural dependencies.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
