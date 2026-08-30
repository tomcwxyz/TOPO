# ADR 0008 — MCP review authority is explicit

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

TOPO's core distinguishes machine proposals from user-reviewed memory. A candidate can only be edited, confirmed or rejected by a `user` actor under the default trust model.

An MCP tool call normally originates from an AI client. Treating every MCP invocation as a user action would therefore defeat the proposal-first model at the transport boundary even though the core lifecycle remained strict.

The predecessor `mymemory-mcp-server` allowed direct fact storage and could save draft facts as confirmed by default. TOPO must not inherit that authority model.

## Decision

A normal TOPO MCP connection is an **agent boundary**.

By default an MCP client may:

- inspect its capabilities;
- propose candidate claims;
- list candidates within its sensitivity scope;
- search confirmed, currently-valid claims;
- retrieve an allowed confirmed claim;
- inspect history for an allowed claim.

It may not:

- create a confirmed claim directly;
- edit a candidate as though it were the user;
- confirm or reject a candidate;
- silently overwrite or delete established memory.

Review-decision tools are registered only when the person running the server explicitly enables a higher-trust option (`--allow-review-decisions` / `TOPO_MCP_ALLOW_REVIEW_DECISIONS=1`).

Enabling that option is an explicit delegation of user review authority to that MCP connection. Events created through the delegated path use a user actor with an auditable delegation identifier rather than pretending the operation came from the ordinary agent actor.

The first MCP release is stdio-only. It does not expose HTTP. A later network transport requires a separate security decision and must preserve TOPO's rule that non-loopback operation cannot be unauthenticated.

MCP reads are sensitivity-scoped. The server has a maximum readable sensitivity, defaulting to `personal`; `sensitive` and `restricted` memory require explicit configuration.

No broad `memory://profile`-style automatic resource is exposed until TOPO has a purpose-aware context resolver.

## Consequences

Positive:

- transport code cannot silently bypass the core authority model;
- users can opt into trusted agent workflows without making them the default;
- confirmation decisions remain auditable;
- sensitive memory has an explicit MCP disclosure ceiling;
- TOPO avoids full-profile context injection before relevance/scope controls exist.

Costs:

- some MCP hosts cannot complete review entirely inside the AI conversation by default;
- trusted review mode is a meaningful permission users must understand;
- context resources arrive later than basic search/proposal tools.

## Invariant

> Connecting an AI client to TOPO does not, by itself, grant that client the authority of the user.
