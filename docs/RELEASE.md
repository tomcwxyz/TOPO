# TOPO local alpha releases

TOPO's distributable desktop builds are intentionally labelled **local alpha** while the capture → review → recall loop is being dogfooded.

The release experience should nevertheless be ordinary desktop software: install it, open it, follow a short first-run setup, then use TOPO. Normal users should not need Node, npm, Rust, Cargo, PowerShell, Bash or TOPO's CLI.

## Current version

`0.1.1-alpha.4`

## User-facing scope

Alpha 4 is a controlled Windows-first dogfood build. The installer includes:

- the calm Home / Memories / Connections / Advanced desktop shell;
- the canonical local SQLite store at `~/.topo/topo.sqlite`;
- a guided first-run setup screen;
- private local extraction through Ollama with a cancellable in-flight request;
- one-click installation of TOPO's recommended `qwen3:4b` local model once Ollama is available;
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

TOPO has two deliberately different distribution paths during alpha.

### Canonical alpha distribution: visible GitHub prereleases

The **Desktop alpha release** workflow (`.github/workflows/local-alpha-release.yml`) is the canonical way to distribute a TOPO alpha. A manual run from `main`:

- checks that the requested version matches the desktop source;
- re-runs repository validation;
- builds **Windows x64** (NSIS), **macOS** (DMG) and **Linux x64** (Debian + AppImage);
- scans the Windows binaries with Microsoft Defender;
- creates SHA-256 checksum files;
- publishes one visible GitHub **pre-release** only after all platform builds succeed.

GitHub Releases is therefore the place testers should go to find TOPO installers. Actions artefacts are not the product distribution surface.

Windows and macOS alpha packages are currently unsigned, so operating-system trust warnings may appear. The release notes state this explicitly. Users should not disable endpoint security to install TOPO.

Trusted Windows signing and macOS signing/notarisation remain hard gates before TOPO is presented as a stable or wider public distribution. Track the Windows gate in **issue #42: `[BLOCKER BEFORE PUBLIC RELEASE] Add trusted Windows code signing`**.

### Internal packaging smoke tests

The **installer-package-smoke** workflow (`.github/workflows/windows-test-installer.yml`) remains a development check. It produces short-lived Actions artefacts for package verification during pull requests and targeted testing. Those artefacts are not canonical releases and should not be linked as the normal way to install TOPO.

### Windows trust requirement

The visible alpha prerelease is allowed to be unsigned, but Windows releases intended for wider/pilot/public distribution **must be Authenticode signed** and timestamped.

For broader distribution where the goal is to minimise SmartScreen warnings, use a trusted signing route such as Azure Artifact Signing or another suitable public-trust code-signing service. Signing reduces trust friction but no publisher can guarantee that every endpoint-security product will never produce a false positive.

Both the package smoke test and the alpha release workflow require a Microsoft Defender scan of the built Windows binaries. A clean-machine Defender/SmartScreen test remains mandatory before wider publication because hosted runners cannot substitute for real end-user machines.

When trusted signing is introduced, add it to the build stage before the release assets are collected, and verify the resulting Authenticode signature before the publish job can run. Do not weaken the one-release-after-all-builds-succeed model.

### Linux trust requirement

The Linux packages do not require a terminal-based post-install step. Browser-native-messaging registration happens from TOPO in the user's config directories. The Ollama Linux installer bundled into the release is pinned to a known release and verified by SHA-256 during the build before it is packaged.

## Alpha release steps

1. Ensure the alpha candidate is green and merged to `main`.
2. Confirm the version is identical in:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/src-tauri/tauri.conf.json`
3. Run **Desktop alpha release** from `main`.
4. Supply the desktop version and confirmation `RELEASE`.
5. Wait for Windows, macOS and Linux packaging to complete. The workflow only creates the release once all three succeed.
6. Open the new entry on the repository's **Releases** page and confirm the expected installers and checksum files are present.
7. Test first run on clean Windows and macOS accounts, plus a clean Linux desktop where practical.
8. Exercise the normal loop without opening Advanced: capture → Home review → Memories → approved context in another local tool.
9. Confirm **Stop extraction** cancels an in-flight local request and leaves the captured interaction retryable.
10. Record installer/trust problems separately from TOPO product behaviour; unsigned trust warnings are expected during the alpha phase.

## Stable/wider release gate

Before TOPO is presented as stable or distributed beyond controlled alpha testing:

1. configure a trusted Windows signing route and verify Authenticode signatures;
2. add appropriate macOS signing/notarisation;
3. check SmartScreen, Defender and Gatekeeper behaviour on the actual release artefacts;
4. keep the multi-platform build and one-release publication model used by the alpha workflow.

## Alpha quality gates

Do not broaden distribution until we have exercised:

- clean install/uninstall on Windows, macOS and Linux;
- no user-facing terminal instructions in first run;
- Windows signature verification and clean-machine SmartScreen/Defender behaviour before wider distribution;
- macOS signing/notarisation and Gatekeeper behaviour before wider distribution;
- Ollama detection and local-model installation;
- browser companion registration and extension capture;
- a normal day's captured interactions producing a small, governable Home review queue;
- capture quality against `docs/CAPTURE_EVALUATION.md`;
- purpose-bound context preview and correct recall elsewhere;
- RACK consuming that context in a real prompt build;
- restricted context not crossing the boundary by default;
- backup/recovery behaviour for the local store.

The release machinery should follow product evidence, not lead it.
