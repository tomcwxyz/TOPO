import { createHash, randomUUID } from "node:crypto";

const sources = new Set(["manual", "mobile-share", "agent-tool"]);
const products = new Set(["chatgpt", "claude", "gemini", "copilot", "whatsapp-agent", "other"]);
export const CAPTURE_MAX_CHARS = 24000;
export const PENDING_SOURCE_DAYS = 7;

function optionalString(value, name, maximum) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new Error(name + " must be a string no longer than " + maximum + " characters");
  }
  return value.trim() || null;
}

export function parseSourceSubmission(body, { agent = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected a capture object");
  }
  if (body.consent !== true) throw new Error("Explicit capture consent is required");
  if (!sources.has(body.source)) throw new Error("Unrecognised capture source");
  if (!products.has(body.product)) throw new Error("Unrecognised product");
  if (agent && body.source !== "agent-tool") throw new Error("Agent tokens may only submit agent-tool sources");
  if (!agent && body.source === "agent-tool") throw new Error("Agent-tool sources require an agent credential");
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > CAPTURE_MAX_CHARS) {
    throw new Error("Text must contain 1–24000 characters");
  }
  const sourceUrl = optionalString(body.sourceUrl, "sourceUrl", 2048);
  if (sourceUrl) {
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { throw new Error("Invalid source URL"); }
    if (parsed.protocol !== "https:") throw new Error("Source URL must use HTTPS");
    if (parsed.username || parsed.password) throw new Error("Source URL must not contain credentials");
  }
  const key = optionalString(body.idempotencyKey, "idempotencyKey", 128) ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    throw new Error("Idempotency key must be 8–128 letters, numbers, dashes or underscores");
  }
  const text = body.text.trim();
  return {
    idempotencyKey: key,
    source: body.source,
    product: body.product,
    title: optionalString(body.title, "title", 180),
    sourceUrl,
    text,
    textHash: createHash("sha256").update(JSON.stringify({
      source: body.source, product: body.product, text, sourceUrl,
    })).digest("hex"),
    trust: "unverified",
    status: "pending-review",
  };
}

export function publicSourceRow(row) {
  return {
    id: row.id,
    title: row.title,
    source: row.source_kind,
    product: row.product,
    text: row.excerpt,
    sourceUrl: row.source_url,
    status: row.status,
    trust: row.trust,
    capturedAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
