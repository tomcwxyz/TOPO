# TOPO for Claude Desktop

This MCP Bundle connects Claude Desktop to a running TOPO Desktop instance.

It does not open the TOPO SQLite database and does not contain a second memory store.

## Authority

The bundle exposes:

- `topo_capabilities`
- `topo_context`
- `topo_search`
- `topo_propose_claims`

TOPO Desktop separately controls:

- **Share context** — allows purpose-bound context and confirmed-memory search.
- **Accept contributions** — allows local tools to create reviewable candidate memories.

Both permissions reset when TOPO restarts.

The bundle never receives candidate confirmation/rejection authority.

## Build

~~~bash
npm run build --workspace @topo/claude-mcpb
~~~

Validate the manifest:

~~~bash
npm run check --workspace @topo/claude-mcpb
~~~

Create an installable bundle:

~~~bash
npm run pack --workspace @topo/claude-mcpb
~~~

Output:

~~~text
apps/claude-mcpb/dist/topo-claude-desktop.mcpb
~~~

Open the `.mcpb` file with Claude Desktop on macOS or Windows to install it.

TOPO Desktop must be running when Claude calls a TOPO tool.
