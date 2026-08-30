# Initial Threat Model

This is a living foundation document, not a claim that TOPO is already hardened.

## Assets

TOPO may hold:

- personal facts and preferences;
- sensitive or restricted claims;
- source excerpts and conversation/document identifiers;
- derived profiles/documents;
- change history;
- model/provider credentials;
- MCP/API credentials;
- exports/backups.

The event log and provenance graph can be as sensitive as the current claim values.

## Trust boundaries

### Local application boundary
Other local processes may attempt to read the store, call a local service or inspect temporary files.

### Browser extension boundary
Captured page content and extension storage are exposed to browser/extension security constraints and hostile page content.

### AI provider boundary
Sending source text to a cloud model discloses that source to the provider before any post-processing or PII filter can help.

### MCP/client boundary
A connected AI client can request context and propose changes. It should receive no more authority or sensitivity scope than granted.

### Import boundary
Conversation archives, Markdown/OKF bundles and documents are untrusted input and may contain prompt-injection-like instructions or misleading provenance.

### Future sync/hosted boundary
Multi-device or multi-user features add authentication, authorisation, tenancy and server-operator trust concerns. They are explicitly out of the first core.

## Initial attacker/misuse cases

1. **Silent memory poisoning** — an AI inference is persisted as established truth.
   - Mitigation: proposal-first writes, epistemic type, provenance, review.

2. **Context over-disclosure** — a client receives unrelated sensitive memory.
   - Mitigation: sensitivity scopes, purpose-aware retrieval, explicit visibility, audit of context sharing.

3. **Unauthorised local/remote client** — a service is exposed beyond loopback without adequate auth.
   - Mitigation: loopback default; refuse non-loopback without explicit secure configuration.

4. **Cloud disclosure misunderstood as local privacy** — source content is sent to a remote model even if extracted claims are later filtered.
   - Mitigation: disclose provider boundary before processing; support local models; pre-redact where appropriate.

5. **Derived-content feedback loop** — generated summaries become evidence and amplify an error.
   - Mitigation: derived documents are projections linked to source claim IDs and cannot establish claims by themselves.

6. **Malicious import/content instructions** — imported text attempts to alter extraction or agent behaviour.
   - Mitigation: treat imports as data, not instructions; structured extraction prompts; candidate review; preserve source identity.

7. **History leakage** — deleted/superseded sensitive values remain exposed in changelogs/backups.
   - Mitigation: include audit/history in sensitivity and encryption design; document retention semantics.

8. **Credential leakage** — provider or MCP keys appear in query strings, logs or exports.
   - Mitigation: never put secrets in URLs; separate secret storage from portable memory bundles.

9. **Accidental source-control disclosure** — a local SQLite memory store is created inside a project and committed.
   - Mitigation: TOPO's own repository ignores SQLite/WAL/SHM files and `.topo/`; documentation should tell client projects to do the same; desktop should default storage to the OS application-data directory.

10. **Plaintext bundle disclosure** — a native export is copied, synced or shared more broadly than intended.
   - Mitigation: treat bundles as sensitive personal data; keep credentials out of bundles; make encrypted/signed bundles an explicit later design decision rather than implying v0.1 exports are encrypted.

11. **Partial or destructive import** — an invalid or conflicting bundle leaves the destination memory half-written or silently overwrites established records.
   - Mitigation: validate the complete bundle before import; check conflicts and write inside one transaction; v0.1 rejects existing IDs instead of overwriting them.

12. **MCP authority laundering** — an AI invokes a review tool and the adapter records it as a user decision merely because it arrived over MCP.
   - Mitigation: normal MCP connections are agent-authority only; edit/confirm/reject tools are absent unless the server operator explicitly delegates review authority; delegated decisions carry a distinct audit actor ID.

13. **MCP sensitivity escalation** — a client retrieves or creates data above the disclosure scope the user intended for that connection.
   - Mitigation: enforce a server-side maximum sensitivity on both reads and proposals; default to `personal`; require explicit configuration for `sensitive` or `restricted`.

## Security invariants for v0.1

- No required network service for core operation.
- Any HTTP service binds to loopback by default.
- Non-loopback operation cannot be unauthenticated.
- Machine-created claims are candidates by default.
- Context resolution enforces sensitivity, not only UI display.
- Portable exports do not include provider credentials.
- Derived documents retain claim provenance.
- Cloud-provider use is explicit to the user.

## Open decisions

Before implementation reaches the relevant areas, decide:

- embedded DB choice and at-rest encryption design;
- OS/browser secret storage strategy;
- deletion vs immutable audit semantics for restricted data;
- localhost client authentication model;
- signed/encrypted portable bundle options;
- secure browser-to-local-service pairing.
