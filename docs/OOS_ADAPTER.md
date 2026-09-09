# Organisational OS adapter

TOPO is a local-first memory/context node in the draft Organisational OS architecture.

The first TOPO integration deliberately starts with **Context provision**, not automatic ingestion of every external OOS object.

## Why context first?

A FlowLance task is operational work state. It should not become TOPO memory merely because the protocols can connect.

That would collapse two distinct concepts:

- authoritative external organisational state;
- personal durable context that TOPO governs.

The adapter therefore proves the useful direction first:

A Context Packet is a purpose-bound disclosure. It does not grant the requester a reusable copy of the person's profile, and organisational/project membership does not grant access to canonical personal memory. A different purpose — including evaluation or analytics — requires a new explicit disclosure.

The adapter is deliberately **representation-independent**:

```text
RACK / another node
        │
   Context request
        │
        ▼
      TOPO
reviewed memory
+ sensitivity
+ temporal validity
+ subject/project scope
        │
        ▼
  context resolver
        │
        ▼
  Context Packet
```

During the alpha migration, the resolver may use legacy Claims, Memory Pages or both. Consumers should not need to know which internal representation supplied the packet.

## Current behaviour

The existing adapter currently reads confirmed claim-based memory, because that is what the working alpha store implements.

It:

- reads reviewed context for one subject;
- excludes expired/not-yet-valid information;
- defaults to ordinary + personal sensitivity only;
- preserves provenance;
- returns source IDs as evidence references;
- caps context size;
- emits a draft OOS Context Packet;
- defaults the packet to private/local-use-only;
- carries no implied permission for organisational analytics, individual monitoring, persistent host memory or conversion into shared practice.

It advertises no OOS event ingestion or action capabilities yet.

### Memory Page migration

The adapter should migrate without changing the consumer contract:

1. TOPO authorises eligible Memory Pages before retrieval;
2. purpose/task relevance ranks those pages;
3. concise page excerpts are rendered into the existing Context Packet shape;
4. packet provenance includes Memory Page ID/revision plus source evidence references;
5. legacy Claim rendering remains a compatibility fallback until migration completes.

RACK and other OOS consumers should not add `MemoryPage`-specific assumptions.

### Purpose-aware selection

Context requests may include a task query in `wanted.query`. TOPO combines that with the packet's required `purpose` to rank otherwise-authorised context.

The current alpha does this deterministically across Claim fields. The next resolver will rank Memory Page title/body/tags plus optional structured annotations, with metadata/full-text search first and optional semantic assistance later.

Ranking never widens access, changes sensitivity ceilings or grants a new purpose. Consent and purpose-bound disclosure are applied before or alongside relevance scoring.

## Important architectural finding

**TOPO should not silently turn OOS operational objects into personal memory.**

Before FlowLance events or similar operational state are ingested, TOPO needs one of two explicit designs:

1. a linked external-object/event ledger alongside canonical memory; or
2. connector policy that says which authoritative external facts may become proposed memory and which must remain references.

The first option currently looks more faithful to the Organisational OS model.

The same rule applies after the Memory Page reorientation: prose-first memory is not permission to summarise every connected operational object into a personal profile.

## RACK boundary

RACK should see TOPO as a `ContextSource`, not as a memory database.

```text
TOPO Memory Pages
       │
       ▼
TOPO resolver
       │
       ▼
Context Packet
       │
       ▼
RACK ContextSource ─────┐
                       │
RACK PracticeSources ───┼──► assembled working context
                       │
other task context ─────┘
```

This preserves the core distinction:

- TOPO supplies **descriptive context appropriate to the purpose**;
- RACK supplies **normative practice for how the AI should work**.

TOPO may propose a practice change from repeated reviewed context. It cannot establish one silently.

This also makes RACK only one consumer among many: the same TOPO memories can be exported or resolved for another AI/tool without passing through RACK.

## Local desktop endpoint

The TOPO desktop exposes a deliberately narrow local-only OOS endpoint while the app is running.

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

This is **not** a general HTTP API and must not be bound to a non-loopback interface. It is a local-alpha transport intended to let another installed local application such as RACK request context without reading TOPO's SQLite database.

## Next step

The next integration test should happen after the Memory Page resolver slice exists:

1. create/confirm several page-first memories;
2. request purpose-bound context from RACK;
3. verify RACK receives concise relevant context without any Memory Page-specific parsing;
4. verify the same memory can be consumed by a non-RACK client or plain Markdown export;
5. verify changing the purpose requires a new disclosure and changes retrieval without changing permissions.

After that, design the external-object/event ledger required for FlowLance catch-up without weakening TOPO's personal-context boundary.
