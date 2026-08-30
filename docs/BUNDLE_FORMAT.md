# TOPO native bundle format

TOPO's native portable format is deliberately independent of SQLite, IndexedDB, Tauri and any hosted service.

## v0.1 layout

```text
topo-bundle/
├── manifest.json
├── sources.jsonl
├── claims.jsonl
└── events.jsonl
```

Future versions may add `schema.json`, `documents/` and other explicitly versioned files. Readers must use the manifest version rather than assuming their presence.

## manifest.json

The manifest identifies:

- `format: "topo.bundle"`
- bundle `version`
- TOPO domain `contractVersion`
- export creation time
- record counts
- canonical filenames

## JSONL records

Each non-empty line is one complete JSON object conforming to the corresponding TOPO domain contract.

JSONL is used because it is:

- inspectable with ordinary tools;
- streamable for large stores;
- friendly to diffs and recovery;
- independent of a database engine.

## Completeness and integrity

A native export includes every source, claim and event in the store, including rejected, superseded and expired claims. Export pagination must never silently truncate at an implementation query limit.

A v0.1 bundle is self-contained:

- every claim `provenance.sourceId` must identify a source in the bundle;
- every `supersedes` reference must identify a claim in the bundle;
- claim/source events must identify records in the bundle;
- IDs must be unique within each record type;
- manifest counts must match the files.

## Import conflicts

v0.1 imports are additive and conservative.

If any source, claim or event ID already exists in the destination store, the whole import fails before writing anything. TOPO does not silently overwrite existing memory during import.

A later version may add explicit merge/conflict-resolution modes, but they must remain reviewable.

## Secrets

A TOPO bundle contains context and provenance. It must not contain model-provider API keys, MCP bearer tokens, encryption passphrases or other application credentials.

Bundles should therefore be treated as potentially sensitive personal data even though credentials are excluded.
