# TOPO Cloud — mobile and agent capture alpha

This feature is being built on \`feat/cloud-mobile-agent-capture\` as an **optional** alternative to the current local-only desktop workflow. The first deliverable is an **authenticated cloud source inbox**, not a claim that the whole TOPO memory engine has been ported. See [ADR 0012](adr/0012-optional-managed-cloud-and-mobile-capture.md).

## User journeys

### ChatGPT on Android (or another sharing app)

1. Install the TOPO Cloud PWA from a supported Android browser.
2. Select **Share** in the source app (or copy and paste relevant text if the app does not share text).
3. Select TOPO in Android's sharing chooser. Its service worker accepts the POST locally, stores the shared text in a temporary browser inbox, and opens the capture review form.
4. Sign in if needed, check/edit source, title and text, explicitly submit.
5. See a pending, **unverified** source in TOPO Cloud. It is not yet a durable memory; later extraction and user review will propose Memory Pages.

Some apps share only a link rather than conversation text. TOPO never assumes that it may fetch private conversation contents from such a link. A PWA share target requires installation and browser support; manual paste remains available.

### WhatsApp agents (Muse / Instinct or others)

Where the provider exposes an authorised outbound tool or hook, it can POST explicit source evidence to TOPO Cloud using a scoped integration credential. A chat partner cannot read other WhatsApp chats. The sender must clearly distinguish user-authored turns from its own interpretation; the first alpha records all supplied excerpts as unverified and pending review.

### ChatGPT plugin / other MCP consumers

Design a pair of future capabilities: \`topo_capture\` (submit evidence for review) and \`topo_context\` (request narrowly authorised confirmed context). These require separate grants. A custom MCP server that works on the ChatGPT web surface is not proof of mobile availability. Test current platform support before promising any automatic mobile capture. Tool invocation is not a guaranteed post-conversation lifecycle event.

## First slice: API contract

\`POST /api/captures\`, authenticated with the owner session or \`Authorization: Bearer <token>\` for the single-person test agent.

Body:

\`\`\`json
{
  "source": "mobile-share",
  "product": "chatgpt",
  "title": "Planning TOPO Cloud",
  "text": "Relevant text deliberately shared by the user",
  "sourceUrl": "https://chatgpt.com/",
  "idempotencyKey": "43bb8b6e-ff87-47f1-b5f7-447a2bf69076",
  "consent": true
}
\`\`\`

Success is \`201 {id,status:"pending-review",deduplicated:false}\`, or \`200\` with \`deduplicated:true\` for the same key and content. A key reused with different content fails with \`409\`. Content is bounded to 24,000 characters; default source retention is seven days. The endpoint does not run extraction, confirm memory or publish context. Do not send secrets. No permissive CORS.

\`GET /api/captures\` requires the signed-in browser session; \`DELETE /api/captures/:id\` deletes a pending source. The cloud alpha schema is separate from canonical local SQLite until the Memory Page adapter is implemented.

## Deployment boundary

**Not production-ready.** The starter is intentionally **single owner only**, using an alpha password and signed HttpOnly session cookie. It must run behind an additional access-controlled deployment while it is being exercised; it does not provide multi-user tenancy, sign-up, OAuth, per-agent scopes, abuse prevention, or a production identity provider. The optional agent bearer is an interim single-owner credential, never a public integration.

The \`cloud/\` directory is a separate Next.js app and intentionally not a root npm workspace, to avoid changing the desktop's pinned release dependencies. Install cloud dependencies in that directory and commit a generated lockfile before promoting it to a deployable shared CI target.

For Neon, apply \`cloud/db/001_capture_sources.sql\` to a dedicated cloud database, set the environment variables in \`cloud/.env.example\`, and deploy the \`cloud/\` project root. Database access must be TLS, and deployment access protection must remain on.

## Acceptance / evidence

- [ ] Manual paste and installed Android PWA share deliver the expected text without putting it into the URL.
- [ ] Sharing when signed out preserves a draft locally until the person signs in and explicitly submits.
- [ ] Unauthorised, cross-origin, malformed and oversized requests are refused.
- [ ] Agent capture uses an explicit credential and cannot obtain context by default.
- [ ] Replays are idempotent and conflicting replays fail.
- [ ] Pending sources are clearly separate from Memory Pages; no AI-generated memories are auto-confirmed.
- [ ] Expired sources are deleted by a scheduled worker, not merely hidden.
- [ ] No upload of raw transcript or personal details to logs/analytics.
- [ ] Desktop capture/review/retrieval and existing CI remain unaffected.
- [ ] Cloud-only branch is reviewed for privacy, security and retention before any real personal data is uploaded.

Next: reuse \`@topo/capture\` page-first extractor and \`@topo/core\` Memory Page lifecycle behind provider-independent adapters, then implement review and an authorised Context Packet endpoint.
