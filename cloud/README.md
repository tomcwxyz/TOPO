# TOPO Cloud — mobile and agent capture alpha

This is a **standalone Next.js 15 + React 19** application, separate from the existing TOPO monorepo workspaces, so the desktop release dependencies are not affected.

**Scope now:** password-gated single-owner source inbox, mobile paste and installed Android PWA share receiver, authenticated agent capture-only POST, deduplication, delete and seven-day expiry. **Not yet available:** Memory Page extraction/review, cloud Context Packets, ChatGPT plugin, agent connection management or multi-user login. No cloud memory has been established by this code.

## Local development

1. From this directory run \`npm install\` with Node 22+, then commit the resulting \`package-lock.json\` before using a shared build/deployment pipeline.
2. Copy \`.env.example\` to \`.env.local\`. Configure a **dedicated** Neon database, an alpha access password (16+ chars), and a random 32+ character session secret.
3. Apply \`db/001_capture_sources.sql\` to the dedicated database.
4. Run \`npm test\` and \`npm run dev\` and open http://localhost:3000.
5. Do not expose the alpha to the public internet. Require an additional Vercel deployment access gate while authentication and rate limiting are basic.
6. In a deployed HTTPS environment, register and install the PWA in Chrome on Android. Select TOPO from the OS sharing chooser. Only explicitly shared text can be captured.
7. Configure \`CRON_SECRET\` (32+ characters) and enable the provided daily Vercel cron so source expiry results in actual deletion.

## Integration request

\`POST /api/captures\` with \`Authorization: Bearer <secret>\`, JSON content, and \`consent: true\`. The server stores only a pending unverified source. Set \`TOPO_AGENT_TOKEN_SHA256\` to the lowercase SHA-256 hex digest of the secret, not the secret itself.

The bearer integration cannot read, confirm or delete sources. Do not distribute one shared token to multiple agents beyond this controlled single-owner test. Per-provider credentials, revocation, scopes and full auditing belong in C3.

## Security and design notes

- No public sign-up or multi-user support.
- No AI extraction calls in this first slice.
- Incoming agent/WhatsApp summaries are unverified, regardless of their content.
- No full transcript stored by default; only the explicitly submitted excerpt. Avoid uploading secrets.
- Service worker stages OS-shared text in local IndexedDB; no sensitive GET query parameters.
- Do not install as a real-data service before adding rate limits, trusted authentication, PWA icon tests, database policies and privacy review.
- Remaining work and quality gates: [docs/CLOUD_CAPTURE.md](../docs/CLOUD_CAPTURE.md).
