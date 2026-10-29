import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "topo_cloud_alpha";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const ALPHA_OWNER = "alpha-owner";

function same(a, b) {
  const left = Buffer.from(a ?? "");
  const right = Buffer.from(b ?? "");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function secureSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("TOPO_SESSION_SECRET must contain at least 32 characters");
  }
  return secret;
}

export function passwordMatches(candidate, expected) {
  if (!expected || expected.length < 16) return false;
  if (typeof candidate !== "string") return false;
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  return same(digest(candidate), digest(expected));
}

export function issueSession(secret, now = Date.now()) {
  secureSecret(secret);
  const payload = Buffer.from(JSON.stringify({
    sub: ALPHA_OWNER,
    exp: Math.floor(now / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret || secret.length < 32 || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!same(signature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value.sub !== ALPHA_OWNER || !Number.isSafeInteger(value.exp)) return null;
    if (value.exp <= Math.floor(now / 1000)) return null;
    return ALPHA_OWNER;
  } catch { return null; }
}

export function agentTokenMatches(header, expectedSha256) {
  if (!expectedSha256 || !/^[0-9a-f]{64}$/i.test(expectedSha256)) return false;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(token)) return false;
  return same(createHash("sha256").update(token).digest("hex"), expectedSha256.toLowerCase());
}

export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
