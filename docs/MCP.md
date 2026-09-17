# TOPO MCP

TOPO exposes governed context to MCP-compatible AI clients without giving those clients silent ownership of memory.

The implementation uses the MCP TypeScript SDK v2 and stdio transport.

Memory Page retrieval follows the same principle as the RACK/OOS bridge:

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
| `topo_capabilities` | Report authority, sensitivity, context mode, capture support and transport policy |
| `topo_context` | Resolve a small purpose-bound Context Packet from governed Memory Pages |
| `topo_search_pages` | Search confirmed, currently-valid Memory Pages |
| `topo_capture_interaction` | Queue a completed interaction into TOPO's governed capture inbox |
| `topo_propose_claims` | Legacy/structured compatibility: add candidate claims |
| `topo_search` | Legacy/structured compatibility: search confirmed claims |
| `topo_get_claim` | Legacy/structured compatibility: read one confirmed claim |
| `topo_list_candidates` | Inspect candidate structured claims |
| `topo_claim_history` | Read audit events for an allowed structured claim |

There is deliberately no `store confirmed fact` tool.

For ordinary AI work, clients should prefer `topo_context` when they can describe the current purpose/task. `topo_search_pages` is useful for explicit lookup. `topo_capture_interaction` sends source material through TOPO's normal capture → extraction → review path; it does not create durable memory directly.

The claim-shaped tools remain compatibility/advanced interfaces while the representation migration finishes.

## Desktop context bridge

`topo-mcp` discovers the currently running TOPO Desktop instance through:

```text
~/.topo/oos-local.json
```

The discovery file contains a loopback endpoint and per-run bearer token. MCP refuses a discovery endpoint that resolves away from loopback.

Memory Page tools delegate to Desktop's `/v0/context` and `/v0/search` routes. Interaction capture delegates to `/v0/capture`. This means MCP inherits the canonical resolver and capture inbox rather than reading/interpreting Memory Pages or writing captures directly to SQLite.

TOPO Desktop keeps local permissions separate:

1. **Share context** — permits purpose-bound retrieval;
2. **Capture interactions** — permits completed interactions to enter the capture inbox;
3. **Accept contributions** — separately governs explicit memory proposals.

Enabling one does not imply another, and the permissions reset when Desktop restarts.

If Desktop is closed or a required permission is disabled, the MCP tool returns an explicit error rather than silently bypassing TOPO's governance boundary.

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

## Interaction capture

`topo_capture_interaction` accepts TOPO's normal `CapturedInteraction` contract. A minimal shape is:

```json
{
  "interaction": {
    "id": "interaction-123",
    "kind": "conversation",
    "product": "generic",
    "client": "terminal",
    "mode": "generic",
    "captureMethod": "local-mcp",
    "fidelity": "conversation-turns",
    "provider": "my-agent",
    "subject": "project:topo",
    "capturedAt": "2026-09-17T07:00:00.000Z",
    "turns": [
      { "id": "u1", "role": "user", "content": "Continue the TOPO work." },
      { "id": "a1", "role": "assistant", "content": "Implemented the next tranche." }
    ],
    "retention": "review-window"
  }
}
```

The interaction is queued only when **Capture interactions** is enabled in Desktop. TOPO then decides what, if anything, is worth proposing as a Memory Page. A successful capture can legitimately result in no durable memory.

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

This delegation does **not** grant Memory Page review authority. A page-first contribution/review surface will be added separately so an AI client cannot acquire durable page-confirmation authority merely because it can retrieve context or capture interactions.

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

## Build before connecting clients

From the repository root:

```bash
npm ci
npm run build --workspace @topo/schemas
npm run build --workspace @topo/core
npm run build --workspace @topo/store
npm run build --workspace @topo/store-node
npm run build --workspace @topo/mcp
npm run build --workspace @topo/mcp-server
```

Then use the absolute path to:

```text
/path/to/TOPO/apps/mcp/dist/index.js
```

TOPO Desktop must be running for Memory Page context/search/capture.

## Codex CLI

Codex supports local stdio MCP servers through `codex mcp add` and stores configuration in `~/.codex/config.toml` or project `.codex/config.toml`.

Add TOPO:

```bash
codex mcp add topo -- node /absolute/path/to/TOPO/apps/mcp/dist/index.js
```

Verify:

```bash
codex mcp list
```

For a context-only default, use `config.toml` to allow only the retrieval tools:

```toml
[mcp_servers.topo]
command = "node"
args = ["/absolute/path/to/TOPO/apps/mcp/dist/index.js"]
enabled_tools = ["topo_capabilities", "topo_context", "topo_search_pages"]
default_tools_approval_mode = "prompt"
```

Add `topo_capture_interaction` to `enabled_tools` only when you want Codex sessions to be able to submit completed interactions to TOPO. Desktop's **Capture interactions** permission remains the final gate.

## Claude Code

Claude Code supports local stdio MCP servers with `claude mcp add`.

User-scoped example:

```bash
claude mcp add --transport stdio --scope user topo -- \
  node /absolute/path/to/TOPO/apps/mcp/dist/index.js
```

Verify:

```bash
claude mcp list
```

Inside Claude Code, `/mcp` shows the connected server and its tools. Keep **Capture interactions** disabled in TOPO Desktop unless you want capture available; context retrieval continues to use the separate **Share context** permission.

## Gemini CLI

Gemini CLI supports local stdio MCP servers through `gemini mcp add` or the `mcpServers` object in `settings.json`.

A conservative user-scoped setup that exposes only TOPO retrieval tools:

```bash
gemini mcp add --scope user \
  --include-tools topo_capabilities,topo_context,topo_search_pages \
  topo node /absolute/path/to/TOPO/apps/mcp/dist/index.js
```

Verify:

```bash
gemini mcp list
```

Equivalent `~/.gemini/settings.json` configuration:

```json
{
  "mcpServers": {
    "topo": {
      "command": "node",
      "args": ["/absolute/path/to/TOPO/apps/mcp/dist/index.js"],
      "includeTools": [
        "topo_capabilities",
        "topo_context",
        "topo_search_pages"
      ],
      "trust": false
    }
  }
}
```

Add `topo_capture_interaction` only when capture is desired. Leaving `trust` false keeps Gemini's normal tool confirmation boundary as an additional layer.

## Direct CLI use without MCP

Scripts that do not host MCP can now ask the running Desktop resolver directly:

```bash
topo context \
  --subject project:topo \
  --purpose "Continue the implementation" \
  --query "MCP mobile context" \
  --max-items 8
```

This uses the same Desktop discovery file, bearer token and `/v0/context` resolver as MCP. It therefore requires TOPO Desktop to be running with **Share context** enabled.

`topo oos context` remains available as a legacy structured-claim compatibility command; new integrations should use `topo context` or MCP.

## Recommended local flow

1. launch TOPO Desktop;
2. enable **Share context**;
3. optionally enable **Capture interactions** if you want the AI client to feed completed work back into TOPO;
4. start/use the MCP client or `topo context`;
5. let the client request bounded context for relevant tasks;
6. review proposed Memory Pages in TOPO rather than granting silent durable memory writes.

Do not put API keys, encryption keys or other secrets in TOPO MCP arguments unless a future feature explicitly documents a safe mechanism for them.
