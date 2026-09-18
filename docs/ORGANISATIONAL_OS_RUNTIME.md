# TOPO in the Organisational OS runtime experiment

Date: 2026-09-18  
Status: architectural record / experiment

The canonical cross-project decision is recorded in `tomcwxyz/Organisational-OS` RFC 0002: **AI runtime interoperability and the Orbital experiment**.

## Role

TOPO is the governed context and durable memory node.

Its question is:

> What should this system know for this purpose, and what are we authorised to share?

TOPO is not the execution runtime. It should remain independently useful whether work is performed by Orbital, Codex, Claude Code, Hermes, OpenClaw or another future runtime.

## Relationship to the Orbital fork

`tomcwxyz/Orbital` is being used as a reference runtime/proving ground, not declared as the permanent Good Ship runtime.

Before selected project tasks, Orbital may request a purpose-bound TOPO Context Packet. The request should carry enough scope to let TOPO apply its existing governance-first resolver, for example:

- purpose;
- project/subject;
- task;
- sensitivity ceiling;
- context budget.

The response should remain bounded and provenance-bearing. Orbital should retain packet identity/revision/digest for lineage rather than copying TOPO's canonical store.

Conceptually:

~~~text
TOPO Memory Pages
      │
      ▼
TOPO resolver
      │
      ▼
purpose-bound Context Packet
      │
      ▼
Orbital project/runtime
      │
      ▼
worker agent
~~~

## Return path

Orbital project state is not automatically TOPO memory.

Files such as `PROJECT_STATE.md`, `DECISIONS.md`, `LESSONS.md` and worker `MEMORY.md` are primarily agent/runtime-authored working context. They may be useful sources, but they cannot silently establish durable reviewed TOPO memory.

Preferred return path:

~~~text
runtime interaction / human instruction / approval / artefact
      │
      ▼
TOPO source capture
      │
      ▼
Memory Page proposal
      │
      ▼
human review/edit
      │
      ▼
confirmed durable memory
~~~

Generated interpretation must remain distinguishable from user-authored evidence.

## Organisational OS semantics

TOPO participates primarily through:

- **Context** — answer purpose-bound requests with the minimum useful authorised context;
- **Event** — receive relevant durable organisational events as sources/history where policy permits;
- **Object** — provide references to governed memories, evidence, decisions and relationships where useful;
- **Action** — only for explicit authorised capabilities; context retrieval itself must not imply write authority.

## Relationship to RACK, CRUX and Ship Check

- **RACK** supplies practice. TOPO may provide context that helps select or explain practice, but cannot establish practice automatically.
- **CRUX** records evidence of runtime behaviour. CRUX evidence may become a source for a proposed TOPO memory, but cannot silently write canonical memory.
- **Ship Check** provides implementation inspection. Findings may be evidence, not automatically durable human knowledge.

## First experiment

1. Let Orbital request TOPO context before a real project task.
2. Record packet lineage through delegation.
3. Confirm that only the minimum useful context reaches the worker.
4. Capture the resulting interaction through TOPO's existing governed capture path.
5. Verify that runtime state does not leak into canonical memory without review.

## Invariants

1. TOPO remains local-first, portable and independently useful.
2. Governance filters happen before relevance.
3. Runtime integration does not create a universal organisational profile.
4. Personal context does not become organisational surveillance through connection.
5. Agent-authored summaries do not gain human authority merely by being stored by a runtime.
6. Context packets are disclosures for a purpose, not permission for secondary use.
7. The Orbital adapter should be replaceable by another runtime adapter without changing TOPO's memory model.
