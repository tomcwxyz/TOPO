# TOPO local alpha releases

TOPO's distributable desktop builds are intentionally labelled **local alpha** while the capture → review → recall loop is being dogfooded.

The release experience should nevertheless be ordinary desktop software: install it, open it, follow a short first-run setup, then use TOPO. Normal users should not need Node, npm, Rust, Cargo, PowerShell, Bash or TOPO's CLI.

## Current version

`0.1.1-alpha.1`

## User-facing scope

The installer-first alpha includes:

- the native TOPO desktop memory manager;
- the canonical local SQLite store at `~/.topo/topo.sqlite`;
- a guided first-run setup screen;
- private local extraction through Ollama;
- one-click installation of TOPO's recommended local model once Ollama is available;
- packaged Chrome / Edge / Chromium capture companion setup on Windows and Linux;
- purpose-bound Context Packet generation and the local context boundary used by RACK;
- the existing proposal-first MCP and advanced CLI interfaces for integrations/development, without requiring either for normal desktop use.

## First run

A clean install should present three understandable steps:

1. **TOPO ready** — the local store is created automatically.
2. **Private local extraction** — TOPO checks for Ollama. On Windows it opens the normal Ollama installer flow. On Linux the release includes a pinned, checksum-verified official Ollama install script which TOPO launches behind the desktop's graphical PolicyKit authorisation prompt. Once the engine is available, TOPO can install its recommended model without a terminal command.
3. **Browser capture** — TOPO installs/registers its native messaging bridge in user space. Chromium browsers still require their one explicit extension permission step; TOPO opens the exact extension folder for selection.

No setup screen should instruct a normal user to paste a command into a terminal.

## Distribution

The manual **Local alpha desktop release** workflow builds:

- **Windows x64:** a per-user NSIS installer;
- **Linux x64:** Debian package and AppImage.

It creates a draft GitHub pre-release for inspection before publication.

### Windows trust requirement

User-facing Windows releases **must be Authenticode signed** and timestamped. The release workflow fails closed when the signing certificate, password or timestamp URL is absent, and it verifies the Authenticode signature on the packaged installer after the build.

Unsigned Windows installers are restricted to a short-lived internal GitHub Actions smoke-test artefact. They are not published as normal TOPO downloads and users should never be told to bypass SmartScreen or Windows Defender to install TOPO.

For pilot/public distribution where the goal is **no SmartScreen warning**, use a signing route that receives immediate/high Microsoft reputation — preferably an EV code-signing certificate or Azure Artifact Signing — rather than assuming a new OV certificate will be warning-free. A normal OV certificate may still need time or Microsoft review to build SmartScreen reputation.

The installer package smoke test also requests a Microsoft Defender custom scan of the built `.exe` whenever Defender is enabled on the hosted Windows runner. A clean-machine Defender test remains mandatory before publication because hosted runners cannot substitute for real end-user machines and no publisher can guarantee that every endpoint-security product will never produce a false positive.

Current PFX-based release workflow secrets:

- `WINDOWS_CERTIFICATE` — base64-encoded PFX/PKCS#12 signing certificate;
- `WINDOWS_CERTIFICATE_PASSWORD` — certificate password;
- `WINDOWS_TIMESTAMP_URL` — RFC3161/Authenticode timestamp service supplied by the certificate provider.

If TOPO moves to Azure Artifact Signing, replace the PFX import step with Tauri's `signCommand`/Artifact Signing route rather than weakening the release gate.

### Linux trust requirement

The Linux packages do not require a terminal-based post-install step. Browser-native-messaging registration happens from TOPO in the user's config directories. The Ollama Linux installer bundled into the release is pinned to a known release and verified by SHA-256 during the build before it is packaged.

## Release steps

1. Ensure `main` is green.
2. Confirm the version is identical in:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/src-tauri/tauri.conf.json`
3. Confirm a high-reputation Windows signing route and its required secrets are configured.
4. Run **Local alpha desktop release** from `main`.
5. Supply version `0.1.1-alpha.1` and confirmation `RELEASE`.
6. Inspect the draft release, its verified signer identity and package artefacts before publishing.
7. Test first run on a clean Windows account and a clean Linux desktop using only the graphical setup path.
8. Confirm Windows SmartScreen/Defender does not require a bypass on the actual release artefact.
9. Exercise capture, extraction, review and recall with a disposable or backed-up TOPO store first.

## Alpha quality gates

Do not broaden distribution until we have exercised:

- clean install/uninstall on Windows and Linux;
- no user-facing terminal instructions in first run;
- Windows signature verification and warning-free clean-machine SmartScreen/Defender behaviour;
- Ollama detection and local-model installation;
- browser companion registration and extension capture;
- a normal day's captured interactions through the review inbox;
- capture quality against `docs/CAPTURE_EVALUATION.md`;
- purpose-bound context preview and correct recall elsewhere;
- RACK consuming that context in a real prompt build;
- restricted context not crossing the boundary by default;
- backup/recovery behaviour for the local store.

The release machinery should follow product evidence, not lead it.
