# Mobile TOPO

TOPO mobile should begin as a **small context-and-capture surface**, not a second full memory application.

The useful mobile interactions are:

1. **Use my context** — ask TOPO for a bounded Context Packet, reduce it to readable text, then explicitly share/paste that into another AI app.
2. **Remember this** — take text the user explicitly selected/shared into TOPO and create a capture source for later extraction and review.

Neither action gives the target AI app direct access to the user's whole TOPO store.

## Core interaction model

```text
                    TOPO Desktop online
                           │
                           │ outbound relay session
                           ▼
                    remote context gateway
                           ▲
                           │ authenticated grant
                           │
mobile TOPO ───────────────┘
    │
    ├─ Use my context
    │      │
    │      ▼
    │ purpose-bound Context Packet
    │      │
    │      ▼
    │ share-safe text projection
    │      │
    │      ▼
    │ Android share sheet / paste
    │      │
    │      ▼
    │ ChatGPT / Claude / Gemini / other app
    │
    └─ Remember this
           ▲
           │ Android share target
           │
      selected text / URL / note
           │
           ▼
      CapturedInteraction
           │
           ▼
      TOPO capture pipeline
           │
           ▼
      extraction → review → Memory Page
```

The first mobile prototype can therefore work while the user's Desktop TOPO is online. Encrypted multi-device sync is not required to prove the interaction model.

## Shared implementation contracts

The transport-neutral primitives live in `@topo/oos/mobile-share`.

### Use my context

`useMobileContext(client, request)` asks a TOPO context client for a normal bounded Context Packet, then calls `projectContextPacketForMobileShare`.

The projection contains only:

- a short explanatory preamble;
- Memory Page titles;
- the already-bounded page excerpts selected by TOPO.

It deliberately strips:

- Memory Page IDs;
- source IDs and source references;
- revision numbers;
- sensitivity labels;
- TOPO provenance structures;
- the original purpose/query text;
- internal relevance/ranking data.

This matters because the target AI app needs **useful context**, not TOPO's internal governance metadata.

Default projection limits:

- at most 6 pages;
- at most 6,000 characters.

The Context Packet is already bounded by the TOPO resolver before this second projection is applied.

### Remember this

`createMobileRememberCapture` converts explicitly selected text into the ordinary `CapturedInteraction` contract:

```json
{
  "kind": "manual",
  "product": "generic",
  "client": "mobile",
  "mode": "generic",
  "captureMethod": "manual",
  "fidelity": "partial-visible",
  "retention": "review-window"
}
```

The selected text is represented as one user-authored evidence turn.

This is intentionally **not** a Memory Page proposal. TOPO still performs extraction, duplicate/change comparison and human review before durable memory is created.

The first contract caps a single selected-text capture at 5,000 characters, matching the current page-extraction evidence window rather than silently accepting content the extractor will truncate.

## Android-first prototype

Android is the first native target because its share intents make both directions easy to test with existing AI and notes apps.

### A. Remember this — inbound share target

TOPO registers for plain-text shares.

Conceptual flow:

```text
User selects text in another app
        │
        ▼
Share → TOPO
        │
        ▼
TOPO preview
  - selected text
  - subject/project
  - source app/URL when available
        │
        ▼
Remember this
        │
        ▼
CapturedInteraction queued
```

The preview is important: receiving a share intent is not itself consent to create a capture.

Initial accepted material:

- `text/plain` selected text;
- optional shared URL;
- optional title/source-app identifier.

Do not start with arbitrary attachments, screenshots or background clipboard observation. Those can be evaluated after the selected-text workflow is proven.

### B. Use my context — outbound share

The mobile surface asks for:

- subject/project;
- a short purpose/task description;
- optional search terms.

Then:

```text
TOPO remote context request
        │
        ▼
Desktop local resolver
        │
        ▼
remote grant narrowing
        │
        ▼
mobile share projection
        │
        ▼
preview exactly what will leave TOPO
        │
        ▼
Share / copy
```

The preview should show the **final projected text**, not just a page count.

A future convenience action can remember the target application for one tap, but the first prototype should always surface the system share sheet.

## Remote authority

Mobile **Use my context** uses the read-only remote grant model.

A mobile grant should initially be:

- action: `context` only;
- exact subject scopes;
- ordinary sensitivity by default;
- short lived;
- revocable;
- audience-bound to the TOPO remote gateway.

Mobile **Remember this** is a different authority. It must not be added to a read grant merely for convenience.

The first Remember-this prototype can use one of three routes, in this order of preference:

1. mobile app stores the capture locally until it can securely hand it to an enrolled TOPO device;
2. an explicit capture relay queues encrypted/transient source material for that device;
3. managed extraction only after a separate opt-in design.

Do not turn the read-only context gateway into a generic remote write endpoint.

## Offline behaviour

With the online-device relay architecture:

- **Use my context** clearly reports that the user's TOPO device is offline/unavailable;
- previously retrieved Context Packets are not silently reused for a different purpose;
- **Remember this** can retain the user's explicit pending capture locally on the phone until delivery is possible.

Offline remote retrieval from the full memory store belongs to the later encrypted-sync/key-management work.

## Privacy and safety properties

The mobile prototype should preserve these rules:

1. no ambient clipboard monitoring;
2. no background reading of other applications;
3. no implicit capture from opening the share target;
4. preview what will be shared out of TOPO;
5. capture source and context-read grants remain different authorities;
6. source app names/URLs are provenance metadata, not memory content by themselves;
7. remote audit records contain request metadata/counts, not Memory Page contents;
8. no Memory Page can become confirmed without the normal TOPO review boundary.

## Product surface

The smallest useful Android TOPO UI is only four surfaces:

- **Use my context**
- **Remember this** share preview
- **Pending captures**
- **Connection** — which TOPO device is available and whether remote sharing is active

Memory Page editing/review can remain Desktop-first for the initial mobile experiment. A small review inbox should only be added after people demonstrably want to govern memories away from Desktop.

## Evaluation

The mobile experiment should answer behavioural questions before it expands:

- Do people choose **Use my context** instead of manually copying old chats/notes?
- Is the generated context small enough to inspect before sharing?
- Does the target AI actually make use of it?
- What proportion of **Remember this** captures produce useful review candidates?
- How often is Desktop being offline a real blocker?
- Do users understand the difference between sharing context and remembering source material?

Useful metrics should not contain source or Memory Page text.

## Implementation sequence

### MBL1 — transport-neutral contract

Implemented on `context-everywhere`:

- [x] Context Packet → bounded mobile share projection;
- [x] strip TOPO internal IDs/provenance from share text;
- [x] selected-text → `CapturedInteraction` contract;
- [x] mobile capture stays source-first/review-required;
- [x] tests for projection limits and capture shape.

### MBL2 — Android shell

Next:

- [ ] thin Android application shell;
- [ ] `ACTION_SEND` plain-text share target;
- [ ] Remember-this preview/confirm screen;
- [ ] Use-my-context form + remote client;
- [ ] final share-text preview;
- [ ] outbound Android share sheet;
- [ ] connection/offline state.

### MBL3 — pending mobile capture delivery

- [ ] local encrypted pending-capture queue;
- [ ] enrolled-device delivery contract;
- [ ] retry/expiry controls;
- [ ] visible delivery state;
- [ ] no remote durable Memory Page writes.

### MBL4 — evaluate before expanding

Only after the basic interactions are useful:

- [ ] small mobile review inbox;
- [ ] iOS share extension;
- [ ] URL/document capture expansion;
- [ ] offline encrypted memory sync if online-device availability proves insufficient.
