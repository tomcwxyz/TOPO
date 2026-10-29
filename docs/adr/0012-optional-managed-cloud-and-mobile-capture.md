# ADR 0012 — Optional TOPO Cloud and cross-device capture

- **Status:** Proposed (feature branch)
- **Date:** 29 October 2026
- **Supersedes:** nothing
- **Complements:** ADR 0003 (local first), 0009 (ambient capture/governed memory), 0010 (personal context boundaries), 0011 (Memory Pages)

## Decision

Add an **optional managed TOPO node**, not a replacement for the account-free desktop application. The cloud and desktop retain the canonical Memory Page, source, evidence, event, disclosure and portable-bundle contracts. A hosted adapter must not establish its own weaker memory-governance rules.

The first cloud release is a deliberately **single-person, access-gated alpha**, not a public multi-tenant service. It receives explicitly shared excerpts from mobile apps and authorised agent tools into a source inbox. Source capture is **not confirmation of a Memory Page**. No cross-tool retrieval is permitted until governed confirmed Memory Pages and their authorisation boundary have been ported and tested.

## Invariants

1. Local TOPO remains fully usable with no account, remote service or cloud AI.
2. Incoming mobile shares, agent summaries and tool output are **unverified sources**. They cannot silently become user-authored evidence or confirmed memory.
3. User review, sensitivity, provenance, temporal validity and source retention remain first-class.
4. No ambient access to ChatGPT mobile, WhatsApp or another application's private conversations is claimed. Integrations require explicit user sharing or a provider-supported tool/hook.
5. Each connection separately grants capture and context-read privileges; revocation and source exclusions must be testable.
6. Sensitive content never appears in query strings, server logs, analytics, client telemetry, or third-party model calls by default.
7. Remote capture must be authenticated, bounded, idempotent and scoped. Agent-supplied source labels are claims, not authority.
8. Canonical memory remains exportable as Markdown plus governance/evidence metadata; cloud indexes are disposable.
9. Account deletion, source expiry and audit trails must be designed before a public multi-user launch.
10. Cloud access cannot silently weaken the local sharing policy. No implicit local-to-cloud synchronisation.

## Delivery sequence

**C1 (this branch):** isolated Next.js cloud alpha; private owner sign-in; Android installed-PWA share target keeping shared content out of URLs and off the server until deliberate submission; bounded authenticated agent capture endpoint; 7-day pending-source retention; database migration; automated capture/auth tests; no AI processing, memory confirmation or third-party reads.

**C2:** adapter to the existing canonical Memory Page extraction/review pipeline; explicit cloud extraction opt-in and model disclosure, proposal quality evaluation, source removal after review; review UI and useful import/export.

**C3:** per-user identity with provider-backed auth, database tenancy enforcement, per-connection scoped tokens, revocation, deletion, backup/restore, rate limiting, abuse controls and operational monitoring.

**C4:** MCP plugin with bounded context reads and explicit memory proposals; verify availability and UX independently on ChatGPT mobile rather than presuming developer-mode MCP works there. WhatsApp agents require provider-supported integration or user forwarding. Cross-tool recall is a separate permission from capture.

**C5:** optional local/cloud migration or sync with encryption, conflict resolution and user-selected sharing. Never make local use depend on the cloud.

## Rejected approaches

- Building a remote relay or remote MCP before a user can capture and review something useful.
- Treating a shared conversation excerpt as a verified user-authored turn.
- Persisting source text directly from an unauthenticated OS share target POST.
- Placing shared text in GET parameters (browser history, access logs and referrers).
- Automatic capture of WhatsApp or ChatGPT mobile conversations without a supported source integration.
- Creating a second independent canonical memory implementation in cloud.
