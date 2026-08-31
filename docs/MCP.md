# TOPO MCP

TOPO exposes its local memory store to MCP-compatible AI clients without giving those clients silent ownership of memory.

The implementation uses the MCP TypeScript SDK v2 and stdio transport.

## Default trust model

Connecting an MCP client grants **agent** authority, not **user** authority.

Default tools:

| Tool | Purpose |
| --- | --- |
| `topo_capabilities` | Report authority, sensitivity and transport policy |
| `topo_propose_claims` | Add one or more candidate claims |
| `topo_search` | Search confirmed, currently-valid claims |
| `topo_get_claim` | Read one allowed confirmed claim |
| `topo_list_candidates` | Inspect candidate claims |
| `topo_claim_history` | Read audit events for an allowed claim |

There is deliberately no `store confirmed fact` tool.

## Review delegation

Candidate editing, confirmation and rejection represent user review decisions in TOPO's core lifecycle. They are therefore not registered on an ordinary MCP connection.

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

Enabling this mode means the connected AI client can make durable review decisions. It should only be used for a client/configuration the user intends to trust at that level.

## Sensitivity

The default maximum MCP sensitivity is:

```text
personal
```

So ordinary and personal claims may be disclosed; sensitive and restricted claims are excluded.

Configure another ceiling with:

```bash
topo-mcp --max-sensitivity ordinary
topo-mcp --max-sensitivity sensitive
topo-mcp --max-sensitivity restricted
```

or `TOPO_MCP_MAX_SENSITIVITY`.

The ceiling applies to proposal creation as well as retrieval, avoiding a client creating memory that it is not allowed to inspect.

## Store

The MCP server uses the same Node SQLite adapter as the CLI.

Default:

```text
~/.topo/topo.sqlite
```

Override with:

```bash
topo-mcp --store /path/to/topo.sqlite
```

or `TOPO_DB`.

The MCP package does not own a separate database model.

## Transport

v0.1 is **stdio only**.

TOPO does not currently expose MCP over HTTP. This is intentional: a network transport introduces authentication, binding and origin/security concerns that should not be inherited accidentally from predecessor implementations.

A future HTTP implementation must preserve the threat-model invariant that non-loopback operation cannot be unauthenticated.

## Context resources

TOPO does not expose a `memory://profile` equivalent yet.

A full-profile resource would encourage broad context injection before TOPO has implemented purpose-aware retrieval, sensitivity selection, token budgets and an explainable context manifest.

For now, clients should use `topo_search` and explicit claim retrieval. Purpose-aware context resources belong to the context-resolution phase.

## Example client configuration

After building the repository, an MCP host can launch:

```json
{
  "command": "node",
  "args": ["/path/to/TOPO/apps/mcp/dist/index.js"]
}
```

For a non-default store, add `--store` and the store path to `args`.

Do not put API keys, encryption keys or other secrets in TOPO MCP arguments unless a future feature explicitly documents a safe mechanism for them.
