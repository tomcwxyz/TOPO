# Capture alpha test — Windows + Chrome/Edge

This is the first end-to-end TOPO capture test path.

The goal is:

> Install TOPO, prepare its bundled browser companion, use ChatGPT, Claude or Gemini normally, see TOPO capture the conversation locally, process it with a local Ollama model, then review the resulting candidate memories.

Nothing in this test automatically confirms memory.

## Prerequisites

- Windows 10/11
- Chrome or Edge
- TOPO Windows test installer
- Ollama running locally with at least one model installed

You do **not** need Node.js, npm, Rust, Cargo or a TOPO source checkout to run the packaged alpha test.

The initial extraction path uses local Ollama deliberately. Captured transcripts do not need to be sent to an external model provider.

## 1. Install TOPO

Download and run the current **TOPO Windows test** installer.

Windows SmartScreen may warn because test builds are not yet code-signed.

Open TOPO after installation.

## 2. Prepare browser capture

In TOPO Desktop, find **Ambient capture** and choose **Prepare browser capture**.

TOPO will:

1. copy the bundled `topo-native-host.exe` to a stable local application folder;
2. copy the bundled browser extension to a stable local folder;
3. register the Native Messaging host for Chrome and Edge for the current Windows user;
4. show the browser-extension folder and its fixed alpha extension ID.

No PowerShell, Cargo build, extension-ID copy/paste or manual registry command is required.

## 3. Load the bundled extension once

Chrome does not allow an unpublished local extension to be silently installed by a normal desktop application. Until the TOPO companion is published through the Chrome/Edge stores, one browser step remains.

In Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. In TOPO, choose **Open extension folder**.
5. Select that `browser-extension` folder in Chrome.

In Edge use `edge://extensions` and the equivalent controls.

The packaged alpha extension has a fixed development ID, so TOPO can register Native Messaging before you load it.

Restart the browser if it was already open while browser capture was prepared.

## 4. Confirm Ollama

TOPO Desktop should show **Local extractor** in the Ambient capture panel.

If Ollama is running, TOPO lists the models it can use.

If no model is installed, install one with Ollama before continuing.

## 5. Enable capture

Open one of:

- https://chatgpt.com
- https://claude.ai
- https://gemini.google.com

The TOPO control appears at the bottom-right of supported conversation pages.

Click it to enable capture for that product.

The states mean:

- **TOPO capture paused** — capture is disabled for this product.
- **TOPO capture on** — enabled; no delivery has happened yet.
- **TOPO capture on · local** — a snapshot was accepted by the local native host.
- **TOPO capture on · N queued** — capture is enabled but the native host was unavailable; snapshots remain queued in extension storage.

Queued snapshots should flush when the native host becomes available again.

## 6. Have a small test conversation

Use a deliberately obvious, non-sensitive test such as:

~~~text
For this project, please always use British English. We use SQLite locally and I prefer changes to stay as reviewable candidates until I approve them.
~~~

Continue for another turn or two so the page settles.

Do not use passwords, API keys or other secrets in a capture test.

## 7. Confirm the raw interaction reached TOPO

In TOPO Desktop, press **Refresh** in Ambient capture.

You should see an item such as:

~~~text
chatgpt · web · chat
<conversation title>
4 turns · conversation-turns
~~~

This is source material, not memory.

The native host writes pending snapshots to:

~~~text
~/.topo/capture-inbox/
~~~

## 8. Extract locally

Choose an Ollama model in the Local extractor control and press **Extract N waiting**.

TOPO will:

1. call local Ollama;
2. require evidence from user-authored turn IDs;
3. discard secret-like keys;
4. compare proposals against current memory;
5. create new candidates, add supporting evidence, or flag potential changes;
6. move the processed raw snapshot out of the pending inbox.

## 9. Review

Candidate cards should show:

- epistemic type;
- confidence;
- captured evidence;
- source/provider;
- sensitivity;
- whether the candidate would replace an existing memory.

Confirm or reject candidates manually.

If a potential-change candidate is confirmed, TOPO supersedes the prior confirmed claim and records the transition in the audit event log.

## What to check in the first test

Record whether:

- TOPO prepares browser capture without a source checkout or developer tools;
- the extension loads with the fixed alpha ID shown by TOPO;
- the extension identifies the correct AI product;
- the indicator reaches `local`;
- turn count looks plausible;
- the source title is correct;
- Ollama proposes only genuinely useful memory;
- evidence quotes really came from user turns;
- duplicate preferences become supporting evidence rather than duplicate candidates;
- a changed preference is presented as a potential change;
- rejecting a candidate leaves canonical memory unchanged.

## Known alpha limitations

- the browser companion is bundled but still requires **Load unpacked** until it is published in Chrome/Edge extension stores;
- selectors for hosted AI products may change and need adapter diagnostics;
- desktop ChatGPT/Claude ambient capture is designed but not yet implemented through OS accessibility;
- capture processing is manual from the desktop for this first test; automatic local extraction should follow after the end-to-end behaviour is trusted.

## Developer fallback

The source-build route remains available for development and diagnostics, but it is not the normal alpha tester path. Developers can still build the extension, native host and Tauri app from the repository when debugging packaging or browser integration.
