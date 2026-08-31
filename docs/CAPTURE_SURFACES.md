# Capture surfaces: ChatGPT, Claude and desktop clients

_Last reviewed: 31 August 2026._

TOPO should model an AI interaction by **product + client + mode**, not by provider name alone.

Examples:

- ChatGPT / web / chat
- ChatGPT / desktop / work
- Claude / web / chat
- Claude / desktop / cowork
- Claude / chrome-sidepanel / cowork
- Hermes / agent-runtime / agent

The capture method and evidence fidelity are recorded separately because the same logical conversation may be observed in different ways.

## Why this matters

The same account can now move between browser, desktop and mobile while the interaction itself may be ordinary chat, a long-running work task, coding work or research.

Capture must therefore answer:

1. What product produced this interaction?
2. Which client observed it?
3. Which mode was active?
4. How did TOPO receive it?
5. How complete is the evidence?
6. Is this the same cloud conversation already captured elsewhere?

These answers affect extraction confidence, retention, deduplication and the UI shown to the person reviewing memory.

---

## ChatGPT

The current ChatGPT desktop application on macOS and Windows contains **Chat**, **Work** and **Codex**. Chat and cloud Work conversations can move between web, mobile and desktop. Desktop can also create local chats that stay on the computer.

### ChatGPT / web / Chat

**Primary capture:** browser extension.

**Method:** `browser-extension`

**Fidelity:** `conversation-turns`

This is the strongest ambient route for ordinary ChatGPT use. Capture completed stable turns, not streaming DOM mutations.

Temporary/private chat modes should be excluded by default when detectable.

### ChatGPT / web / Work

**Primary capture:** browser extension.

**Method:** `browser-extension`

**Fidelity:** usually `conversation-turns`; use `task-summary` when only the final task result is available.

Work is multi-step and may involve tools, files, web activity and scheduled/triggered work. TOPO should not ingest all tool traces as personal memory evidence.

Default evidence policy:

- user steering messages are evidence;
- assistant responses may provide context but are not evidence about the user;
- tool calls are operational history, not personal memory;
- file contents are not captured merely because Work used a file;
- a finished deliverable may be retained as source context only when separately enabled.

### ChatGPT / desktop / Chat

There is currently no documented post-turn lifecycle hook for third-party local software.

TOPO should therefore use a layered approach.

**Ambient option:** TOPO Desktop Observer.

- macOS: Accessibility API.
- Windows: UI Automation.
- Read text from the ChatGPT accessibility tree only after explicit per-app consent.
- No screenshots or OCR.
- Prefer the foreground/pinned ChatGPT conversation rather than scanning unrelated windows.
- Record `desktop-observer` and `conversation-turns` or `partial-visible` fidelity.

**Integration option:** ChatGPT plugin/app.

Plugins and apps can provide TOPO retrieval and explicit capture tools in ChatGPT and Work. This is valuable for:

- “remember this”;
- “what do you know about this project?”;
- proposing a task-end summary.

It is **not** treated as ambient capture because current plugin invocation is model/user mediated rather than a guaranteed post-turn event.

**Catch-up option:** import/sync later.

Cloud Chat conversations are account-backed, so TOPO can reconcile them later when an official/export route is used.

### ChatGPT / desktop / Work

Use the same observer + plugin pattern as desktop Chat, with additional rules for long-running work.

The observer should capture:

- user requests;
- user steering/corrections;
- final conversational responses.

It should ignore by default:

- internal tool traces;
- browser action logs;
- local file contents;
- terminal output;
- data from other desktop apps that Work was allowed to inspect.

Those other artefacts may become separate TOPO Sources only through a connector explicitly enabled for that data.

### ChatGPT desktop local chats

OpenAI documents that local desktop chats stay on the computer.

These are important for TOPO because they will not be recoverable through ordinary cloud catch-up.

**Preferred route:** Desktop Observer.

If the user disables desktop observation, TOPO should accept that these conversations are intentionally absent from memory unless manually imported.

### ChatGPT / mobile / Chat or Work

No ambient TOPO client exists initially.

Use:

- remote app/plugin for explicit retrieval and capture where available;
- later account-history catch-up/import;
- deduplication against the same conversation already captured on web/desktop.

### ChatGPT / Codex

Codex is a distinct product mode with its own history and local development context.

TOPO should integrate primarily through:

- RACK practice/context;
- plugins/MCP where supported;
- later Codex-specific lifecycle integration if a stable event interface is available.

Do not make coding logs personal memory by default. Prefer durable project decisions, user preferences and repeated working patterns.

---

## Claude

Claude now has ordinary **Chat** and **Cowork** in a shared home across desktop, web and mobile. Cowork cloud sessions follow the account across devices.

Claude Desktop also has a strong local MCP distribution route through Desktop Extensions / MCP Bundles.

### Claude / web / Chat

**Primary capture:** browser extension.

**Method:** `browser-extension`

**Fidelity:** `conversation-turns`

Use the same evidence and privacy rules as ChatGPT web capture.

### Claude / web / Cowork

**Primary capture:** browser extension where the rendered session exposes stable user/assistant turns.

**Secondary integration:** remote MCP connector for retrieval and explicit memory actions.

Cowork is long-running and can coordinate tools/subagents. Capture should focus on:

- the initial user task;
- meaningful user steering;
- user corrections/decisions;
- the final conversational outcome.

Do not treat subagent/tool traces as evidence about the user.

When the browser only exposes a high-level finished result, record `task-summary` fidelity rather than pretending a full transcript was captured.

### Claude / desktop / Chat

Claude Desktop can run local MCP servers through installable Desktop Extensions / MCP Bundles.

This should become a first-class TOPO integration.

**Local MCP bundle provides:**

- search/retrieve TOPO context;
- explicit “remember this” proposal;
- propose a task/conversation summary;
- capability and sensitivity inspection.

The MCP bundle does **not** by itself provide a guaranteed transcript lifecycle event.

For fully ambient capture, use the same TOPO Desktop Observer pattern as ChatGPT.

This gives us two complementary channels:

~~~text
Claude Desktop
   |                     |
   | local MCP           | Accessibility/UI observer
   v                     v
TOPO retrieval       ambient interaction capture
+ explicit memory         |
   |                      |
   +-----------> TOPO <---+
~~~

### Claude / desktop / Cowork

Claude documents that plugins containing local MCP servers work through the desktop app. Cowork can therefore use a local TOPO MCP bundle for retrieval and explicit proposals.

For ambient capture:

- Desktop Observer captures user steering and visible final responses;
- plugin skill can propose a task-end memory summary when the TOPO plugin is active;
- these are separate capture methods and should deduplicate to the same Source where possible.

Cowork cloud sessions may continue across devices, so the source identity must be account/session based when a stable external ID is available rather than tied to one device.

### Claude / Chrome side panel / Cowork

Claude in Chrome runs Cowork in another extension's side panel.

A normal webpage content script cannot inspect another extension's private side panel, so the TOPO browser extension must not attempt to scrape it.

Use:

- remote MCP connector for explicit retrieval/proposals;
- cloud session catch-up/import later;
- optional desktop accessibility observation only if the side panel is exposed cleanly by the OS accessibility tree.

This is not an initial ambient-capture target.

### Claude / mobile / Chat or Cowork

Use remote connectors for explicit interactions and account/session catch-up later.

Cowork cloud sessions can move between mobile, web and desktop, so TOPO must merge multiple observations of the same session instead of creating separate memories.

### Claude Code

Claude Code is structurally closer to Hermes/OpenClaw than Claude Chat.

Where stable lifecycle hooks are available, prefer hooks over terminal/UI observation.

Capture:

- user instructions;
- accepted project decisions;
- explicit corrections;
- session-end summaries.

Do not store raw command/tool logs as canonical user memory.

---

## Desktop Observer

Desktop observation is the common fallback for products that do not expose a reliable post-turn integration hook.

It is deliberately narrower than screen recording.

### Rules

- Explicit opt-in per application.
- Visible persistent capture state in TOPO.
- macOS Accessibility API and Windows UI Automation first.
- Linux AT-SPI later where useful.
- No screenshots by default.
- No OCR.
- No keystroke logging.
- No password/secure-field access.
- Do not inspect unrelated applications merely because an AI tool can access them.
- Prefer foreground or explicitly pinned conversation windows.
- Detect product privacy/incognito/temporary modes where possible and pause automatically.
- Allow “do not capture this conversation” from TOPO without disabling the whole application.
- Keep raw observed text only for the review window unless full-source retention is enabled.

If role attribution or conversation boundaries are uncertain, mark the capture `partial-visible` and make extraction more conservative.

---

## Cross-surface deduplication

A single cloud conversation may be seen by:

- browser capture;
- desktop observer;
- a task-end MCP proposal;
- later history import.

These are **observations of one Source**, not four Sources.

Identity strategy:

1. provider conversation/session ID when available;
2. product account/workspace + project + provider ID;
3. deterministic fallback fingerprint from stable title, first user turn hash and coarse start time.

Turn identity should use provider turn/message IDs when available, otherwise a hash over role + normalized content + local sequence.

On overlap:

- merge evidence observations;
- prefer higher-fidelity capture;
- retain provenance for each observation method;
- do not show duplicate candidates to the user.

---

## Native memory and TOPO

ChatGPT and Claude both have provider-native memory/personalisation features.

TOPO should not scrape those memory stores or accept a model saying “I remember that…” as evidence about the user.

Provider-native memory is another AI system's derived state.

If a user explicitly says:

> Yes, remember that I prefer British English.

that user-authored statement can support a TOPO candidate.

If the assistant merely says:

> You prefer British English.

that is not enough.

---

## Initial implementation order

1. Shared product/client/mode/method/fidelity contract.
2. Browser Chat adapters for ChatGPT + Claude.
3. Browser Work/Cowork mode detection and task-boundary tests.
4. TOPO Desktop Observer proof-of-concept on Windows and macOS.
5. Claude Desktop local MCP Bundle.
6. ChatGPT plugin/app for retrieval and explicit memory; do not depend on it for ambient capture.
7. Cross-surface source/turn deduplication.
8. Mobile/cloud catch-up and official export importers.
