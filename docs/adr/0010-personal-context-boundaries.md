# ADR 0010 — Personal context does not become organisational exhaust

**Status:** Accepted  
**Date:** 1 September 2026

## Context

TOPO is becoming useful alongside RACK and agent runtimes. Its purpose-bound Context Packet already provides a safer alternative to copying a whole memory store into another tool.

As RACK grows into shared and organisational practice, TOPO needs a durable answer to two questions:

- does belonging to an organisation or shared workspace give that organisation a claim over personal context?
- can context disclosed for one task later be reused for evaluation, analytics, reporting or shared practice?

The answer to both must be no by default.

The organisational model also cannot assume a simple hierarchy. People work simultaneously inside personal contexts, between teams and collaborators, above infrastructure, and around networks and communities.

## Decision

### User authority remains primary

Canonical TOPO memory is user-governed context.

Membership of an organisation, project, team, partnership or network does not transfer ownership or administrative access to a person's canonical TOPO Claims.

There is no manager/admin bypass for personal memory.

### Relationship topology

TOPO uses the same explanatory topology as RACK:

- **inside** — personal memory, preferences, private context and reflection;
- **between** — context deliberately shared in a collaboration or relationship;
- **beneath** — infrastructure, protocols, models, data and system boundaries;
- **around** — communities, networks, standards and wider ecosystem context.

These are relationship lenses, not a hierarchy and not automatic access-control inheritance.

TOPO's existing Context Packet `scope: private | shared | published` remains a transport field. It is not silently redefined as the complete inside/between/beneath/around model.

### Purpose-bound disclosure

A Context Packet is permission to use selected context for its stated purpose, not a reusable copy of the user's profile.

Consumers must treat a packet as bounded by:

- purpose;
- provenance;
- sensitivity;
- temporal validity/expiry;
- packet scope and permissions.

A new purpose — for example semantic evaluation rather than doing the task — requires a new explicit context request/disclosure.

### No implicit secondary use

Context disclosed to RACK or another local consumer must not silently become:

- canonical practice;
- persistent host memory or standing instructions;
- organisational analytics;
- individual usage/compliance reporting;
- benchmark/evaluation data;
- a shared/team memory store.

Any later shared/team TOPO capability must model shared context as an explicit source/relationship, not as an administrator reading personal memory.

### Learning without surveillance

TOPO may support deliberate contributions from experience — for example a reviewed practice feedback note or a proposal to share a non-sensitive contextual fact.

It must not create behavioural exhaust that lets another party reconstruct an individual's AI usage or private memory history.

## Consequences

- the local RACK bridge remains a disclosure boundary, not a synchronisation channel;
- future sync and team/shared work must preserve separate personal and shared authorities;
- context consumers need to retain handling metadata long enough to enforce purpose boundaries;
- a future protocol version may add explicit relationship/boundary metadata, but the current draft packet remains backwards compatible;
- organisational context systems cannot treat TOPO as an employee-profile database.
