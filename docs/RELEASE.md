# TOPO local alpha releases

TOPO's first distributable builds are intentionally labelled **local alpha**.

The purpose is to test the product and the TOPO ↔ RACK context loop before investing in signed pilot distribution, automatic updates or managed infrastructure.

## Current version

`0.1.0-alpha.1`

## Scope

The local alpha includes:

- the native TOPO desktop memory manager;
- the canonical local SQLite store at `~/.topo/topo.sqlite`;
- CLI claim/review/search/import/export workflows;
- Organisational OS Context Packet generation;
- the local context boundary used by RACK.

MCP is included once its proposal-first integration has passed and merged.

## Distribution

The manual **Local alpha desktop release** workflow builds:

- Windows x64 NSIS installer;
- Linux x64 Debian package and AppImage.

It creates a **draft GitHub pre-release** for inspection before publication.

These early packages are not code-signed. Windows SmartScreen and similar operating-system warnings are expected. Do not present this as a general-public installer.

macOS packaging is deliberately deferred until we either configure appropriate signing/notarisation or decide that a deliberately unsigned developer build is worth distributing.

## Release steps

1. Ensure `main` is green.
2. Confirm the version is identical in:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/src-tauri/tauri.conf.json`
3. Run the **Local alpha desktop release** workflow from `main`.
4. Supply version `0.1.0-alpha.1` and confirmation `ALPHA`.
5. Inspect the draft release and installers before publishing it.
6. Test with a disposable or backed-up TOPO store first.

## Promotion criteria

Do not move from local alpha to a signed pilot release until we have exercised:

- create/edit/confirm/reject memory in the desktop;
- CLI and desktop against the same store;
- proposal-first MCP against the same store;
- purpose-bound context preview;
- RACK consuming that context in a real prompt build;
- restricted context not crossing the boundary by default;
- build provenance recording which Context Packet influenced output;
- backup/recovery behaviour for the local store.

The release machinery should follow product evidence, not lead it.
