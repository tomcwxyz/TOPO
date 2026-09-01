# Organisational OS adapter

TOPO is a local-first memory/context node in the draft Organisational OS architecture.

The first TOPO integration deliberately starts with **Context provision**, not automatic ingestion of every external OOS object.

## Why context first?

TOPO's canonical store is built around reviewed memory Claims, Sources and Events.

A FlowLance task is operational work state. It should not become a TOPO memory Claim merely because the protocols can connect.

That would collapse two distinct concepts:

- authoritative external organisational state;
- canonical memory claims that TOPO governs.

The adapter therefore proves the useful direction first:

A Context Packet is a purpose-bound disclosure. It does not grant the requester a reusable copy of the person's profile, and organisational/project membership does not grant access to canonical personal memory. A different purpose — including evaluation or analytics — requires a new explicit disclosure.

~~~text
RACK / another node
        │
   Context request
        │
        ▼
      TOPO
confirmed claims
+ sensitivity
+ temporal validity
+ subject scope
        │
        ▼
  Context Packet
~~~

## Current behaviour

The adapter:

- reads confirmed claims for one subject;
- excludes expired/not-yet-valid claims;
- defaults to ordinary + personal sensitivity only;
- can filter by requested key/category;
- preserves claim provenance;
- returns source IDs as evidence references;
- caps context size;
- emits a draft OOS Context Packet;
- defaults the packet to private/local-use-only;
- carries no implied permission for organisational analytics, individual monitoring, persistent host memory or conversion into shared practice.

It advertises no OOS event ingestion or action capabilities yet.

### Purpose-aware selection

Context requests may include a task query in `wanted.query`. TOPO combines that with the packet's required `purpose` to rank otherwise-authorised confirmed Claims by deterministic lexical relevance across key, category, tags and value. Recency and confidence are tie-breakers; if nothing matches, ordering falls back to recency.

The packet records the selection method and non-content relevance metadata in `extensions`. This ranking does not widen access, change sensitivity ceilings or grant a new purpose: consent and the purpose-bound disclosure rules above still apply before ranking.

## Important architectural finding

**TOPO should not silently turn OOS operational objects into memory claims.**

Before FlowLance events are ingested, TOPO needs one of two explicit designs:

1. a linked external-object/event ledger alongside canonical claims; or
2. connector policy that says which authoritative external facts may become confirmed memory and which must remain references.

The first option currently looks more faithful to the Organisational OS model.

## Local desktop endpoint

The TOPO desktop now exposes a deliberately narrow local-only OOS endpoint while the app is running.

Discovery is written to `~/.topo/oos-local.json`. The file contains a loopback endpoint and a per-process bearer token. On Unix the discovery file is written with mode `0600`.

The endpoint is discoverable while TOPO is running, but **context sharing is disabled by default for every TOPO session**. The person using TOPO must explicitly choose **Allow local tools** in the desktop UI before another local app can request context.

The endpoint:

- binds only to `127.0.0.1` on an ephemeral port;
- requires the bearer token for every request;
- exposes capability discovery at `GET /v0/capabilities`;
- advertises no context query capability while local sharing is disabled;
- returns a refusal for `POST /v0/context` until the person enables local sharing;
- exposes purpose-bound context at `POST /v0/context` only for that enabled session;
- caps request bodies at 64 KiB;
- never exposes sensitive or restricted memory through this transport;
- resets local sharing to off when TOPO restarts;
- does not expose write/review/action capabilities.

This is **not** a general HTTP API and must not be bound to a non-loopback interface. It is a local-alpha transport intended to let another installed local application such as RACK request context without reading TOPO's SQLite database or requiring a Node CLI path.

## Next step

Use this authenticated local endpoint from the RACK desktop and test desktop-to-desktop context consumption.

After that, design the external-object/event ledger required for FlowLance catch-up without weakening TOPO's claim-review model.
