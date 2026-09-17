# Context everywhere

TOPO's useful unit for other AI tools is not the whole memory store and not an exported profile. It is a **purpose-bound Context Packet** resolved from governed Memory Pages.

The product contract is:

```text
Memory Pages are durable material.
Context Packets are what AI tools consume.
MCP, local HTTP, adapters and future remote APIs are transports.
```

This keeps TOPO portable and avoids coupling every consumer to TOPO's internal storage representation.

## Local architecture

The canonical local retrieval path is the resolver inside TOPO Desktop:

```text
AI client / CLI / agent
        │
        │ purpose + optional query
        ▼
transport adapter
        │
        ▼
TOPO Desktop loopback service
        │
        ├─ sharing authority
        ├─ review state
        ├─ sensitivity
        ├─ temporal validity
        ├─ subject/project scope
        ├─ relevance
        ├─ freshness
        └─ context budget
        │
        ▼
small Context Packet
        │
        ▼
model context window
```

The local resolver remains the single implementation of Memory Page governance and relevance. Adapters should not reimplement retrieval over SQLite.

### MCP

`topo-mcp` remains a stdio MCP server, but Memory Page-facing tools delegate to the running Desktop resolver rather than opening and interpreting Memory Pages themselves.

Primary tools:

- `topo_context` — resolve a purpose-bound Context Packet;
- `topo_search_pages` — search confirmed, currently-valid Memory Pages;
- `topo_capture_interaction` — queue a completed interaction into TOPO's capture inbox;
- `topo_capabilities` — report the active authority and transport.

Existing claim tools remain as compatibility/advanced interfaces while the representation migration finishes.

The MCP process discovers Desktop through `~/.topo/oos-local.json`, connects only to loopback, and uses the per-run bearer token written by Desktop. A configured MCP sensitivity ceiling is applied as a final disclosure narrowing step; it may never widen Desktop's own sharing boundary.

Desktop keeps **Share context**, **Capture interactions** and **Accept contributions** separate. Context access therefore never silently turns into capture or durable memory authority.

### CLI and agent tools

Tools such as coding CLIs should prefer MCP when they already support it. Codex CLI, Claude Code and Gemini CLI can all launch TOPO as a local stdio MCP server; tested configuration examples live in [MCP](MCP.md).

Scripts and tools that do not host MCP can use the first-class CLI command:

```bash
topo context \
  --subject project:topo \
  --purpose "Continue the implementation" \
  --query "MCP mobile context"
```

`topo context` discovers the running Desktop app and requests the same `/v0/context` Context Packet used by MCP and RACK. `topo oos context` remains as a claim-based compatibility path.

Native agent adapters may continue to use the local `/v0/context`, `/v0/search` and `/v0/capture` endpoints directly.

The desired turn lifecycle is:

```text
agent-native working memory
          │
          ▼
     current turn
      /        \
 RACK practice  TOPO context
      \        /
          ▼
       model call
          │
          ▼
 successful interaction capture
          │
          ▼
 TOPO extraction → review → Memory Page
```

TOPO complements an agent's own short-lived memory; it does not replace it or mirror the whole TOPO store into `MEMORY.md`, `AGENTS.md` or equivalent files.

### Capture is not memory authority

The new MCP capture route deliberately accepts a **completed interaction**, not a finished memory page.

```text
AI interaction
      │
      │ topo_capture_interaction
      ▼
Desktop /v0/capture
      │
      ▼
Capture inbox
      │
      ▼
TOPO extraction
      │
      ▼
Memory Page candidate(s)
      │
      ▼
human review
```

This means an AI client can help TOPO notice potentially useful context without silently deciding what becomes durable memory. Desktop's **Capture interactions** session permission is a separate gate from **Share context**.

## Portable fallback

A TOPO export remains ordinary Markdown plus open metadata. A tool that cannot use MCP or the local service can read explicitly exported Memory Pages from the filesystem.

That is a portability fallback, not the preferred live integration. Live integrations should request only the context needed for the task.

## Remote/cloud boundary

Remote access is an optional layer over the same user-owned memory, not a new canonical memory product.

Target shape:

```text
             local TOPO
        canonical Memory Pages
                 │
          encrypted sync
                 │
        optional TOPO relay
          /       |       \
         /        |        \
 remote MCP   remote API   mobile client
     │            │            │
 cloud agent   web AI       share/review
```

A managed service must preserve these invariants:

1. local use works without an account or cloud service;
2. portable Memory Pages remain sufficient to leave the service;
3. remote access is authenticated and revocable;
4. transport grants do not silently become memory authority;
5. context requests are purpose-bound and sensitivity-bounded;
6. sync encryption and key ownership are designed before remote memory content is stored;
7. team/shared context is a separate relationship/source, not administrator access to private personal memory.

### Remote MCP/API

Do not expose the current loopback endpoint to the network.

A remote gateway should terminate authenticated requests and invoke the same logical context contract:

```text
resolveContext({
  subject,
  purpose,
  query?,
  maxItems?,
  sensitivityCeiling
}) -> ContextPacket
```

The first remote implementation should be read/context only. Contribution, capture and review authority should be added separately and explicitly.

## Mobile

Mobile has two distinct jobs.

### 1. Use TOPO context in mobile AI interactions

Where an AI client can call a remote MCP/API, it can request a TOPO Context Packet for the current task. The client should never receive a broad profile by default.

Where the AI client cannot call TOPO directly, a TOPO mobile client can provide an explicit "Use my context" flow that searches/selects relevant pages and shares a bounded packet/text projection into the target app.

### 2. Capture useful mobile interactions

Do not attempt ambient device-wide monitoring.

Prefer a mobile share extension/action:

```text
AI app / browser / notes
        │
       Share
        │
        ▼
      TOPO
 "Keep this context"
        │
        ▼
 capture source
        │
        ▼
 extraction → Memory Inbox → review
```

Useful mobile actions:

- **Remember this** — submit selected text/conversation as a capture source;
- **Use my context** — request/select relevant Memory Pages for another app;
- **Search TOPO** — search confirmed Memory Pages;
- **Review memories** — govern a small candidate inbox.

Extraction may happen on-device, on the user's desktop after sync, or through an explicitly opted-in managed processor. The choice must be visible because it changes where raw source material is processed.

## Implementation sequence

### CE1 — Local context everywhere

Status: **implemented; live-client dogfooding next**.

- [x] add `topo_context` to MCP;
- [x] add `topo_search_pages` to MCP;
- [x] delegate Memory Page retrieval to TOPO Desktop;
- [x] keep claim tools as compatibility paths;
- [x] expose context mode/transport in capabilities;
- [x] keep MCP stdio-only;
- [x] apply MCP sensitivity as a final narrowing boundary;
- [x] integration-test the Desktop discovery/loopback bridge with a local fixture;
- [x] document current configuration snippets for Codex, Claude Code and Gemini CLI;
- [x] add direct `topo context` CLI access to the Desktop resolver;
- [ ] dogfood the three CLI clients against a real Desktop store and preserve any retrieval misses as evaluation cases.

### CE2 — Capture/contribution parity

Status: **interaction capture implemented; page-first explicit contribution remains**.

- [x] expose `topo_capture_interaction` through MCP using Desktop's capture permission;
- [x] route MCP capture through the existing capture inbox rather than durable memory writes;
- [x] retain a separate Desktop permission boundary for capture;
- [ ] replace claim-shaped `topo_propose_claims` as the primary contribution path with `topo_propose_memory` / captured-source workflows;
- [ ] retain structured claim proposal only for explicit annotation use;
- [ ] ensure no MCP client can confirm durable Memory Pages without separately delegated review authority.

### CE3 — Remote transport specification and prototype

- [ ] define authenticated remote Context Packet API;
- [ ] define encrypted sync envelope and device identity;
- [ ] build a read-only remote context gateway prototype;
- [ ] test revocation, expiry, device loss and offline behaviour;
- [ ] keep local/open-file operation first-class.

### CE4 — Mobile capture and context

- [ ] prototype Android share target first;
- [ ] accept selected text/URLs/conversation exports as capture sources;
- [ ] add mobile Memory Page search and small review inbox;
- [ ] prototype "Use my context" share-out flow;
- [ ] add iOS share extension after the interaction model is proven;
- [ ] only then evaluate a fuller mobile TOPO client.

## Evaluation

The success metric is not "an MCP server exists". The proof is:

> Start a task in one AI tool, have TOPO supply a small relevant Context Packet without manual copying, complete the work, capture useful new context, and later see that reviewed context improve a different AI tool.

Track:

- relevant-page recall;
- forbidden disclosure count (must remain zero);
- average packet size;
- task turns where retrieved context was useful;
- retrievals ignored by the model/user;
- source-to-memory review burden;
- cross-tool reuse rate;
- failures caused by Desktop being closed, sharing disabled or sync unavailable.
