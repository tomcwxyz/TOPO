import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { ALPHA_OWNER } from "./auth.mjs";
import { publicSourceRow } from "./capture.mjs";

function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}
function checkOwner(owner) {
  if (owner !== ALPHA_OWNER) throw new Error("Unsupported alpha owner");
}
export async function saveCapture(owner, capture) {
  checkOwner(owner);
  const sql = database(), id = randomUUID();
  const inserted = await sql`
    INSERT INTO topo_cloud_capture_sources
      (id, owner_id, idempotency_key, source_kind, product, title, source_url, excerpt, text_hash, trust, status, expires_at)
    VALUES (${id}, ${owner}, ${capture.idempotencyKey}, ${capture.source}, ${capture.product},
      ${capture.title}, ${capture.sourceUrl}, ${capture.text}, ${capture.textHash},
      'unverified', 'pending-review', now() + interval '7 days')
    ON CONFLICT (owner_id, idempotency_key) DO NOTHING
    RETURNING id, text_hash`;
  if (inserted.length) return { id: inserted[0].id, status: "pending-review", deduplicated: false };
  const existing = await sql`
    SELECT id, text_hash FROM topo_cloud_capture_sources
    WHERE owner_id = ${owner} AND idempotency_key = ${capture.idempotencyKey}`;
  if (!existing.length || existing[0].text_hash !== capture.textHash) {
    const error = new Error("Idempotency key reused for different source content");
    error.status = 409;
    throw error;
  }
  return { id: existing[0].id, status: "pending-review", deduplicated: true };
}
export async function listCaptures(owner) {
  checkOwner(owner);
  const sql = database();
  const rows = await sql`
    SELECT id, source_kind, product, title, source_url, excerpt, trust, status,
           created_at, expires_at
    FROM topo_cloud_capture_sources
    WHERE owner_id = ${owner} AND status = 'pending-review' AND expires_at > now()
    ORDER BY created_at DESC LIMIT 40`;
  return rows.map(publicSourceRow);
}
export async function deleteCapture(owner, id) {
  checkOwner(owner);
  const sql = database();
  const rows = await sql`
    DELETE FROM topo_cloud_capture_sources WHERE owner_id = ${owner} AND id = ${id}
    RETURNING id`;
  return rows.length > 0;
}
export async function purgeExpiredCaptures() {
  const sql = database();
  const rows = await sql`
    DELETE FROM topo_cloud_capture_sources WHERE expires_at <= now() RETURNING id`;
  return rows.length;
}
