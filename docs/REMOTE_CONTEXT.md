# Remote context

TOPO remote access is an optional transport over the same governed Context Packet contract used locally. It must not become a second canonical memory store.

The first remote surface is deliberately **read-only**.

```text
remote AI / client
       │
       │ authenticated purpose-bound request
       ▼
remote context gateway
       │
       ├─ grant audience
       ├─ grant expiry
       ├─ exact subject scope
       ├─ action scope
       └─ sensitivity ceiling
       │
       ▼
TOPO context resolver
       │
       ▼
Context Packet
       │
       │ additional grant narrowing
       ▼
remote AI / client
```

The gateway never grants capture, contribution or review authority merely because a client can read context.

## Prototype contract

The CE3 prototype lives in `@topo/oos/remote-gateway` as a fetch-style handler rather than a network listener. This is intentional: the code proves the access boundary without accidentally publishing TOPO Desktop's loopback service.

Routes:

- `GET /v0/capabilities` — declares a read-only context surface;
- `POST /v0/context` — accepts one purpose-bound context request.

There is no remote search endpoint in v0 because global search is much easier to overscope than a subject + purpose request.

There are no capture, contribution or review routes.

### Context request

```json
{
  "subject": "project:topo",
  "purpose": "Continue implementing TOPO's mobile context flow",
  "query": "remote MCP Android share extension",
  "maxItems": 8
}
```

The injected resolver is still responsible for canonical TOPO governance and relevance. The gateway then applies the remote grant's sensitivity ceiling as a second, narrowing-only disclosure boundary.

## Remote grants

The prototype grant is explicit and short-lived:

```json
{
  "version": "topo.remote-grant/0.1",
  "id": "grant-example",
  "audience": "my-topo-gateway",
  "subjects": ["project:topo"],
  "actions": ["context"],
  "maxSensitivity": "ordinary",
  "issuedAt": "2026-09-17T07:00:00Z",
  "expiresAt": "2026-09-17T08:00:00Z"
}
```

Rules:

1. subject scopes are exact in v0 — no wildcards;
2. grants name the gateway audience they are valid for;
3. grants have a fixed issue/expiry window;
4. the only current action is `context`;
5. the grant sensitivity ceiling may narrow but never widen resolver disclosure;
6. a remote grant is not review authority;
7. a remote grant is not permission to retain returned context for another purpose.

## Prototype authentication

`StaticBearerGrantAuthorizer` exists for local/integration prototyping. It stores only a SHA-256 digest of the supplied token in process memory and compares token digests in constant time.

It is **not** the target production authentication system.

A production remote MCP/API should use an OAuth-style delegated grant with:

- PKCE/device authorisation where appropriate;
- short-lived access tokens;
- refresh/re-authorisation separated from access;
- revocation;
- client/audience binding;
- explicit subject and sensitivity scopes;
- auditable grant creation and use.

Bearer credentials must never be written into portable Memory Pages or synced as memory content.

## How a remote resolver gets TOPO context

The gateway contract deliberately does not decide where the resolver runs. There are two viable modes with different availability/privacy trade-offs.

### Mode A — online device relay

**CE3 prototype implemented on `context-everywhere`.**

```text
remote client
     │
     │ remote grant
     ▼
read-only context gateway
     │
     ▼
ephemeral relay broker
     │
     │ short-lived request envelope only
     ▼
device relay endpoint
     ▲
     │ outbound poll / response
     │
user's TOPO device
     │
     ▼
TopoLocalClient
     │
     ▼
Desktop loopback /v0/context
     │
     ▼
local Memory Page resolver
```

The implementation is split deliberately:

- `@topo/oos/remote-relay` — an in-memory broker implementing the remote resolver contract;
- `@topo/oos/remote-relay-http` — the authenticated device-facing relay API;
- `@topo/oos/remote-relay-device` — an outbound device worker;
- `serviceLocalTopoRelayOnce` — composes that worker with the same `TopoLocalClient` used by CLI/MCP.

The relay broker holds only outstanding request envelopes and their transient response promises. It does not persist Memory Pages or Context Packets.

A task is:

```json
{
  "version": "topo.remote-relay-task/0.1",
  "id": "relay-...",
  "action": "context",
  "deviceId": "device-home",
  "createdAt": "2026-09-17T08:00:00Z",
  "expiresAt": "2026-09-17T08:00:20Z",
  "request": {
    "subject": "project:topo",
    "purpose": "Continue implementation",
    "requestedBy": "remote:grant-example",
    "query": "mobile relay",
    "maxItems": 8
  }
}
```

Current prototype protections:

1. pending requests are bounded;
2. requests expire and fail closed;
3. request IDs are single-use;
4. one enrolled device identity must claim and complete a task;
5. a different device cannot complete another device's request;
6. response payload size is bounded;
7. device responses are `Cache-Control: no-store`;
8. device and remote-client credentials are separate authorities;
9. a local sharing refusal is returned as a failure — there is no fallback memory source;
10. the final remote grant still narrows the packet after local resolution.

The device-facing prototype routes are:

- `GET /v0/device/capabilities`;
- `GET /v0/device/next`;
- `POST /v0/device/complete`;
- `POST /v0/device/fail`.

`StaticRelayDeviceAuthorizer` is prototype-only. Production should enrol devices and issue revocable, rotated device credentials rather than long-lived static bearer tokens.

Advantages:

- canonical Memory Pages remain only on the user's device;
- remote infrastructure does not need a memory decryption key;
- the exact same local resolver runs;
- no inbound connection or open port is required on Desktop;
- relay unavailability cannot mutate or corrupt local memory.

Trade-off:

- the user's TOPO device must be online and connected.

The next step for Mode A is not more memory logic. It is transport hardening: replace short polling with an authenticated long-poll/WebSocket/streaming session, add enrolment/revocation, and surface connection state in Desktop.

### Mode B — encrypted synced memory

```text
local TOPO
    │
    │ client-side encryption
    ▼
opaque sync relay
    │
    ▼
authorised remote resolver session
```

This can support remote access when the desktop is offline, but it creates a harder key-management question. The sync service should be able to store opaque ciphertext without possessing a standing plaintext memory key.

Before implementing Mode B, TOPO needs an explicit answer for:

- device identity and enrolment;
- content-key generation and rotation;
- how an authorised remote resolver obtains a time-bounded decryption capability;
- revoking a lost device;
- restoring from backup without giving the service an ambient decryption key;
- conflict/version handling for Memory Pages;
- secure deletion and key retirement.

Do not solve offline access by simply storing plaintext Memory Pages in a managed database.

## Remote MCP

A future remote MCP server can expose the same `topo_context` semantics over Streamable HTTP, but it should sit **outside** TOPO's local process boundary:

```text
MCP client
   │
   ▼
authenticated remote MCP
   │
   ▼
remote context gateway contract
   │
   ▼
resolver mode A or B
```

This lets hosted agents use TOPO without making the Desktop loopback endpoint remotely reachable.

Remote MCP should initially expose only:

- capabilities;
- purpose-bound context retrieval.

Search, capture and contribution should be separate later grants if real use justifies them.

## Mobile relationship

The same remote context grant can eventually support a mobile TOPO client or an AI app capable of calling remote MCP/API.

For a mobile **Use my context** action, the app requests a bounded Context Packet under a short-lived grant, previews what will be shared, then sends that packet/text projection to the target AI tool.

For **Remember this**, mobile capture is a separate write path and must not be smuggled into the read grant.

The online-device relay means the first mobile prototype can work without cloud memory sync while the user's Desktop TOPO is online.

## Threats this boundary is designed to contain

- stolen remote bearer token — short lifetime and revocation in production;
- stolen device credential — separate device enrolment/revocation and no memory write authority;
- token replay — production auth should support stronger client/session binding;
- overscoped client — exact subjects/actions and a sensitivity ceiling;
- gateway compromise — no review/write authority and, in Mode A, no canonical memory at rest;
- accidental network exposure of Desktop — gateway never publishes the loopback endpoint;
- broad profile injection — only purpose-bound context requests exist;
- stale relay work — short expiry and one-time request IDs;
- response substitution — only the device that claimed a task can complete it;
- secondary use — grant/purpose metadata remains visible and auditable.

## Next prototype

With the request lifecycle now implemented, the next CE3 tranche is operational hardening:

1. move from one-shot polling to an authenticated long-lived outbound device session;
2. add device enrolment, rotation and revocation contracts;
3. surface relay connected/disconnected state and explicit remote-sharing consent in Desktop;
4. add request/use audit events without logging Memory Page contents;
5. test disconnect, timeout, duplicate-response, grant-revocation and lost-device scenarios;
6. expose the read-only gateway through a small remote MCP adapter for hosted clients.

Only after that works should TOPO prototype encrypted multi-device sync for offline remote retrieval.
