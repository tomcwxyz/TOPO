# TOPO MCP

TOPO exposes governed context to MCP-compatible AI clients without giving those clients silent ownership of memory.

The implementation uses the MCP TypeScript SDK v2 and stdio transport.

Memory Page retrieval now follows the same principle as the RACK/OOS bridge:

```text
TOPO Memory Pages
      ↓
TOPO Desktop resolver
      ↓
purpose-bound Context Packet
      ↓
topo-mcp
      ↓
AI client
```

MCP is a transport over TOPO's context contract. It is not a second memory model or a second retrieval engine.

See [Context everywhere](CONTEXT_EVERYWHERE.md) for the broader CLI/cloud/mobile architecture.

## Default trust model

Connecting an MCP client grants **agent** authority, not **user** authority.

When TOPO Desktop is running, the normal MCP surface includes:

| Tool | Purpose |
| --- | --- |
| `topo_capabilities` | Report authority, sensitivity, context mode and transport policy |
| `topo_context` | Resolve a small purpose-bound Context Packet from governed Memory Pages |
| `topo_search_pages` | Search confirmed, currently-valid Memory Pages |
| `topo_propose_claims` | Legacy/structured compatibility: add candidate claims |
| `topo_search` | Legacy/structured compatibility: search confirmed claims |
| `topo_get_claim` | Legacy/structured compatibility: read one confirmed claim |
| `topo_list_candidates` | Inspect candidate structured claims |
| `topo_claim_history` | Read audit events for an allowed structured claim |

There is deliberately no `store confirmed fact` tool.

For ordinary AI work, clients should prefer `topo_context` when they can describe the current purpose/task. `topo_search_pages` is useful for explicit lookup. The claim-shaped tools remain compatibility/advanced interfaces while the representation migration finishes.

## Desktop context bridge

`topo-mcp` discovers the currently running TOPO Desktop instance through:

```text
~/.topo/oos-local.json
```

The discovery file contains a loopback endpoint and per-run bearer token. MCP refuses a discovery endpoint that resolves away from loopback.

Memory Page tools delegate to Desktop's `/v0/context` and `/v0/search` routes, so MCP inherits the canonical page-first resolver rather than reading/interpreting Memory Pages directly from SQLite.

Before an AI client can retrieve context:

1. TOPO Desktop must be running;
2. **Share context** must be enabled in TOPO Desktop for the current session;
3. the requested context must pass TOPO's governance/relevance rules.

If Desktop is closed or sharing is disabled, the MCP context tool returns an explicit error rather than silently falling back to a broad profile or ungoverned store read.

A custom discovery path may be supplied with:

```bash
topo-mcp --discovery /path/to/oos-local.json
```

or `TOPO_LOCAL_DISCOVERY`.

## Purpose-bound context

A typical request is conceptually:

```json
{
  "subject": "project:topo",
  "purpose": "Continue implementing the mobile context architecture",
  "query": "MCP remote context mobile",
  "maxItems": 8
}
```

TOPO applies sharing authority, review state, sensitivity, temporal validity, subject scope, task relevance, freshness and context budget before returning a compact Context Packet with Memory Page/revision/source provenance.

Do not use MCP to inject every Memory Page into every prompt. The useful contract is **the smallest authorised context that materially helps the current task**.

## Review delegation

Candidate editing, confirmation and rejection represent user review decisions in TOPO's legacy structured-claim lifecycle. They are therefore not registered on an ordinary MCP connection.

Launch with:

```bash
topo-mcp --allow-review-decisions
```

or:

```text
TOPO_MCP_ALLOW_REVIEW_DECISIONS=1
```

to explicitly delegate those decisions to the connected MCP client.

This adds:

- `topo_edit_candidate`
- `topo_confirm_candidate`
- `topo_reject_candidate`

Events produced through this path are recorded with a user actor ID of `mcp-review-delegation`, making the delegation visible in history.

This delegation does **not** currently grant Memory Page review authority. A page-first contribution/review surface will be added separately so an AI client cannot acquire durable page-confirmation authority merely because it can retrieve context.

## Sensitivity

The default maximum MCP sensitivity is:

```text
personal
```

So ordinary and personal material may be disclosed; sensitive and restricted material is excluded from the current local sharing path.

Configure a different MCP ceiling with:

```bash
topo-mcp --max-sensitivity ordinary
topo-mcp --max-sensitivity sensitive
topo-mcp --max-sensitivity restricted
```

or `TOPO_MCP_MAX_SENSITIVITY`.

The MCP ceiling can only narrow what the Desktop resolver is willing to share. It cannot widen Desktop's own context-sharing boundary. The bridge performs a final disclosure filtering step on returned Memory Page material for this reason.

Legacy claim proposal/retrieval also continues to honour the MCP ceiling.

## Store

Legacy structured-claim tools use the same Node SQLite adapter as the CLI.

Default:

```text
~/.topo/topo.sqlite
```

Override with:

```bash
topo-mcp --store /path/to/topo.sqlite
```

or `TOPO_DB`.

Memory Page context is intentionally **not** reimplemented against this SQLite adapter. It is resolved by the running Desktop service so MCP, RACK and agent adapters share the same governance/retrieval behaviour.

## Transport

The MCP host transport remains **stdio only**.

TOPO does not currently expose MCP itself over HTTP. This is intentional: a network transport introduces authentication, device identity, revocation, binding, origin and sync/key-management concerns that should not be inherited accidentally from predecessor implementations.

The Desktop bridge uses an authenticated **loopback-only** HTTP service. It must not be exposed directly to a network.

A future remote MCP/API layer is specified separately in [Context everywhere](CONTEXT_EVERYWHERE.md) and must preserve local-first operation and authenticated, revocable, purpose-bound access.

## No full-profile resource

TOPO deliberately does not expose a `memory://profile` equivalent.

A full-profile resource encourages broad context injection and weakens purpose/sensitivity boundaries. Clients should ask `topo_context` for the current task, or use `topo_search_pages` for an explicit lookup.

## Example client configuration

After building the repository, an MCP host can launch:

```json
{
  "command": "node",
  "args": ["/path/to/TOPO/apps/mcp/dist/index.js"]
}
```

For non-default paths, add `--store` and/or `--discovery` to `args`.

The normal flow is then:

1. launch TOPO Desktop;
2. enable **Share context**;
3. start/use the MCP client;
4. allow the client to call `topo_context` for relevant tasks;
5. keep durable memory review in TOPO unless review authority has been explicitly delegated.

Do not put API keys, encryption keys or other secrets in TOPO MCP arguments unless a future feature explicitly documents a safe mechanism for them.
