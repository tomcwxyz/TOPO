# Capture alpha test — Windows + Chrome/Edge

This is the first end-to-end TOPO capture test path.

The goal is:

> Use ChatGPT, Claude or Gemini normally in a Chromium browser, see TOPO capture a conversation locally, process it with a local Ollama model, then review the resulting candidate memories in TOPO Desktop.

Nothing in this test automatically confirms memory.

## Prerequisites

- Windows 10/11
- Node.js 22+
- Rust toolchain
- Chrome or Edge
- Ollama running locally with at least one model installed

The initial extraction path uses local Ollama deliberately. Captured transcripts do not need to be sent to an external model provider.

## 1. Install repository dependencies

From the TOPO repository:

~~~powershell
npm install
~~~

## 2. Build the capture extension

~~~powershell
npm run build --workspace @topo/extension
~~~

The unpacked extension will be in:

~~~text
apps/extension/dist
~~~

## 3. Load the extension

In Chrome:

1. Open chrome://extensions.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select apps/extension/dist.
5. Copy the extension ID shown by Chrome.

In Edge use edge://extensions and the equivalent developer/load-unpacked controls.

Keep the extension loaded from this same directory so its development ID remains stable.

## 4. Register the native capture bridge

From PowerShell in the repository root:

~~~powershell
.\scripts\register-topo-native-host.ps1 -ExtensionId <YOUR_EXTENSION_ID> -Browser Chrome
~~~

For Edge:

~~~powershell
.\scripts\register-topo-native-host.ps1 -ExtensionId <YOUR_EXTENSION_ID> -Browser Edge
~~~

For both:

~~~powershell
.\scripts\register-topo-native-host.ps1 -ExtensionId <YOUR_EXTENSION_ID> -Browser Both
~~~

The script builds topo-native-host.exe, writes a Native Messaging manifest under %LOCALAPPDATA%\TOPO\native-messaging, and registers it for the current Windows user.

Restart the browser after registration.

## 5. Start TOPO Desktop

~~~powershell
npm run dev:desktop
~~~

The desktop should show the **Ambient capture** panel.

If Ollama is running, the Local extractor control should list installed models.

## 6. Enable capture

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

## 7. Have a small test conversation

Use a deliberately obvious, non-sensitive test such as:

~~~text
For this project, please always use British English. We use SQLite locally and I prefer changes to stay as reviewable candidates until I approve them.
~~~

Continue for another turn or two so the page settles.

Do not use passwords, API keys or other secrets in a capture test.

## 8. Confirm the raw interaction reached TOPO

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

## 9. Extract locally

Choose an Ollama model in the Local extractor control and press **Extract N waiting**.

TOPO will:

1. call local Ollama;
2. require evidence from user-authored turn IDs;
3. discard secret-like keys;
4. compare proposals against current memory;
5. create new candidates, add supporting evidence, or flag potential changes;
6. move the processed raw snapshot out of the pending inbox.

## 10. Review

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

- the extension identifies the correct product;
- ChatGPT Work / Claude Cowork mode is detected correctly when used;
- the indicator reaches local;
- turn count looks plausible;
- the source title is correct;
- Ollama proposes only genuinely useful memory;
- evidence quotes really came from user turns;
- duplicate preferences become supporting evidence rather than duplicate candidates;
- a changed preference is presented as a potential change;
- rejecting a candidate leaves canonical memory unchanged.

## Known alpha limitations

- selectors for hosted AI products may change and need adapter diagnostics;
- desktop ChatGPT/Claude capture is designed but not yet implemented through OS accessibility;
- Claude Desktop local MCP packaging is not yet part of this alpha;
- Chrome/Edge Native Messaging registration is currently a development script rather than part of the TOPO installer;
- capture processing is manual from the desktop for this first test; automatic local extraction will follow after the end-to-end behaviour is trusted.
