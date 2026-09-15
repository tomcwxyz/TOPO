# Alpha 4 — calm memory UX

## Product intent

TOPO should feel like a memory layer working quietly for the person, not a database or extraction pipeline the person has to operate.

The everyday loop is:

> use AI normally → briefly review what is worth keeping → have the right context available elsewhere

The alpha.3 dogfood surfaced two connected UX failures:

1. confirmed Memory Pages disappear from the default candidate view, so approved memory can feel lost;
2. capture plumbing, local model choice, connection permissions, retrieval evaluation and compatibility tools are all visible together, creating too much work for ordinary use.

Alpha 4 keeps the same governance, provenance, local-first storage and Memory Page architecture underneath, but changes what the user has to see and do.

## Everyday information architecture

### Home

Home answers one question: **is there anything worth my attention?**

It shows:

- a calm all-caught-up state when there is nothing to review;
- a small number of Memory Page suggestions when TOPO has found something worth keeping;
- simple actions: **Keep**, **Not useful**, **Edit**;
- a compact background-processing state such as “Learning from 6 recent conversations…”;
- one unobtrusive retry affordance when some captures could not be fully processed.

Technical extraction failures remain available under details/Advanced, but are not the primary experience.

### Memories

Memories is the obvious home for confirmed memory.

It shows:

- confirmed Memory Pages by default;
- search as the main interaction;
- prose first;
- source/provenance, sensitivity, horizon, revision and history behind progressive disclosure;
- rejected, expired and superseded pages as history rather than peers of current saved memory.

Confirming a Memory Page must make it immediately findable here.

### Connections

Connections explains where TOPO learns from and where it can provide context.

Normal states use plain language, for example:

- ChatGPT browser capture — connected;
- local extraction — ready / processing locally;
- RACK/local tools — can use approved memory this session;
- local agents — capture/suggestion authority enabled or disabled.

Setup and permission actions are shown only when needed.

### Advanced

Advanced preserves the alpha workbench for dogfooding and technical control:

- extractor model selection;
- row-by-row capture queue and raw failure messages;
- Context Preview and retrieval evaluation;
- Structured Claim compatibility tools;
- storage paths and diagnostics.

This keeps proof/debug capability without making it part of ordinary TOPO use.

## Language

Use **memory** in the everyday interface. “Memory Page” remains the architectural and advanced term.

Map internal states to simpler language:

- candidate → needs attention / suggested;
- confirmed → saved;
- rejected → not useful / history;
- superseded → changed / history;
- expired → history.

Keep explicit language when a new page may replace existing context.

## Review card

Default review presentation:

- title;
- concise prose body;
- optional one-line summary;
- Keep / Not useful / Edit;
- “Why did TOPO suggest this?” progressive disclosure.

Evidence, source IDs, sensitivity, horizon, revision, tags and timestamps remain available but do not dominate the card.

Potential changes are deliberately more explicit:

> This looks like something has changed.
>
> Current memory: …
>
> New information: …
>
> Update memory / Keep existing

## Capture and extraction

Capture should mostly disappear once configured.

Rules:

- process newly captured interactions automatically while TOPO is open;
- use TOPO’s recommended extractor model by default;
- do not choose the first arbitrary installed Ollama model;
- model selection belongs in Advanced;
- failures stay recoverable and visible without blocking successfully extracted memory;
- never weaken evidence validation to increase apparent success rate.

The first-run gate should ensure the recommended model is installed rather than treating any local model as sufficient.

## Success criteria for the next alpha

A normal dogfood session should be possible without opening Advanced:

1. use ChatGPT/other supported AI tools normally;
2. open TOPO;
3. see either “all caught up” or a small set of suggestions;
4. keep/reject/edit them quickly;
5. open Memories and immediately find what was kept;
6. allow a connected tool to use approved context without operating retrieval machinery manually.

Advanced remains available for diagnosis and evaluation, but ordinary success must not depend on it.

## Implementation status

Implemented on the alpha.4 branch:

- Home / Memories / Connections / Advanced is now the default desktop information architecture;
- confirmed memories have a dedicated searchable Memories surface and no longer disappear into a status filter;
- review cards use Keep / Not useful / Edit, with evidence and governance behind progressive disclosure;
- capture extraction runs automatically while TOPO is open when the recommended extractor is available;
- first-run setup and the calm Home surface steer normal use to `qwen3:4b`, while arbitrary model choice remains in Advanced;
- the existing technical workbench, raw queue, retrieval evaluation and Structured Claims remain available under Advanced;
- Memory Page extraction now uses short user-evidence aliases, an explicit legal user-evidence boundary, structured JSON Schema output, temperature 0, one bounded repair pass and per-proposal validation;
- a bad sibling proposal no longer forces TOPO to discard a valid grounded Memory Page from the same conversation;
- evidence validation remains strict: assistant-only project state, completion claims and invented evidence are still rejected rather than silently accepted.

Before release, the branch must pass repository validation, Windows/Linux desktop smoke and installer packaging including the Windows Defender scan.
