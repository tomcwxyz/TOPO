# Predecessor Migration Map

TOPO consolidates lessons from earlier memory experiments. None is the canonical base.

## mymemory

### Preserve / rework
- candidate/staging review UX
- structured provenance and confidence
- import workflows for AI histories/documents
- selective disclosure / share-pack concepts
- provider abstraction
- preference depth/tier ideas

### Do not inherit
- mixed legacy context/fact models
- server receipt of user encryption keys
- key/password material in URL query parameters
- unencrypted staging paths
- privacy claims stronger than the actual server-side processing boundary

## llm-memory-extractor

### Preserve / rework
- browser site adapters and capture mechanics
- local-first standalone mode
- configurable extraction schema
- provider abstraction and local-model support
- candidate review UI
- category documents and About Me
- diff/version UX
- filesystem sync
- OKF import/export

### Replace
- IndexedDB as the universal canonical model
- confidence as the main distinction between evidence and inference
- extraction rules that infer personal/professional facts from questions too aggressively
- timestamp-only “merged fact” detection
- post-extraction PII filtering presented as if it protects cloud disclosure
- plaintext API-key storage without an explicit threat-model decision
- imported documents replacing derived state without stronger provenance/review

## mymemory-mcp-server

### Preserve / rework
- draft/candidate workflow
- MCP tools/resources
- search and relevance foundations
- stale/expiry review
- provider/source attribution
- schema customisation
- category visibility
- audit/changelog ideas
- stdio and optional HTTP transports

### Replace
- one flat JSON file as the long-term canonical store
- direct writes that default to confirmed
- broad `memory://profile` injection
- `relevant` visibility that is not actually relevance-aware
- optional authentication on non-loopback HTTP
- incomplete document history/provenance
- string-only fact model where richer claim metadata is required

## myAImemory

Historical public snapshot of the earlier MyMemory work. It should not be migrated independently.

## Migration rule

Features move into TOPO by behaviour and tests, not by copying whole architectural layers.

When porting a feature:

1. identify the user value;
2. map it to the TOPO domain model;
3. write/adjust tests for the intended semantics;
4. port the smallest useful implementation;
5. discard predecessor-specific storage/auth assumptions;
6. record provenance/migration compatibility where user data is involved.
