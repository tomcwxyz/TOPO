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
- defaults the packet to private/local-use-only.

It advertises no OOS event ingestion or action capabilities yet.

## Important architectural finding

**TOPO should not silently turn OOS operational objects into memory claims.**

Before FlowLance events are ingested, TOPO needs one of two explicit designs:

1. a linked external-object/event ledger alongside canonical claims; or
2. connector policy that says which authoritative external facts may become confirmed memory and which must remain references.

The first option currently looks more faithful to the Organisational OS model.

## Next step

Use this adapter as the local ContextSource for RACK.

After that, design the external-object/event ledger required for FlowLance catch-up without weakening TOPO's claim-review model.
