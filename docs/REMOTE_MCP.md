# Remote MCP

TOPO now has a **read-only remote MCP surface in code**, but it does not yet run a public hosted MCP service.

That distinction matters.

- `apps/mcp` remains the local **stdio** MCP process used by Codex CLI, Claude Code, Gemini CLI and other local clients.
- `createTopoRemoteMcpServer()` in `@topo/mcp` is a minimal MCP server contract intended for a future authenticated hosted endpoint.
- `TopoRemoteContextClient` in `@topo/oos/remote-client` calls the read-only remote Context Packet gateway.
- the remote gateway can resolve through the online-device relay, so canonical Memory Pages can remain on the user's TOPO device.

## Remote v0 tool surface

The remote MCP server exposes exactly two tools:

- `topo_capabilities`
- `topo_context`

It deliberately does **not** expose:

- global Memory Page search;
- interaction capture;
- memory contribution/proposal;
- review decisions;
- legacy claim tools.

The point of remote v0 is to prove that a hosted AI client can obtain the **smallest authorised Context Packet for a stated purpose** without turning remote MCP connectivity into broader memory authority.

## Composition

```text
hosted MCP client
       │
       │ MCP
       ▼
createTopoRemoteMcpServer
       │
       ▼
TopoRemoteContextClient
       │
       │ HTTPS + short-lived remote grant
       ▼
read-only TOPO context gateway
       │
       ▼
ephemeral online-device relay
       │
       ▲ outbound device connection
       │
user's TOPO device
       │
       ▼
TopoLocalClient
       │
       ▼
Desktop /v0/context
       │
       ▼
canonical Memory Page resolver
```

The remote MCP layer never receives direct database access and never needs to understand TOPO's SQLite schema or Memory Page persistence internals.

## Remote client transport rules

`TopoRemoteContextClient` currently enforces:

1. HTTPS for non-loopback endpoints;
2. no credentials embedded in the gateway URL;
3. fetch redirects are refused, so the bearer is not intentionally followed to another URL;
4. a configurable maximum response size;
5. context-only requests containing `subject`, `purpose`, optional `query` and optional `maxItems`.

The MCP caller's local identity is not forwarded as remote authority. The gateway derives `requestedBy` from the authenticated remote grant.

## Deployment boundary

The library is **not** permission to expose TOPO Desktop directly to the internet.

A future hosted MCP deployment should terminate MCP/HTTP separately from Desktop and use the authenticated remote gateway contract. Desktop should continue to make only outbound relay connections.

Before calling a hosted service production-ready, TOPO still needs:

- production delegated/OAuth authentication rather than prototype static bearer grants;
- durable device enrolment, rotation and revocation storage;
- a long-lived authenticated outbound device session rather than one-shot polling;
- explicit Desktop remote-sharing consent/state;
- request/use audit events that do not log Memory Page contents;
- abuse/rate limits and operational monitoring;
- disconnect, expiry, revocation and lost-device testing.

## Relationship to mobile

Remote MCP can eventually serve AI applications that support authenticated remote MCP directly. Mobile TOPO does not need to wait for that capability, though: the same remote context gateway can power a TOPO **Use my context** action and share the resulting bounded packet/text projection into another app.

**Remember this** remains a separate capture authority and is intentionally absent from remote MCP v0.
