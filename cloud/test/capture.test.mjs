import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceSubmission, CAPTURE_MAX_CHARS } from "../lib/capture.mjs";

const valid = { source: "mobile-share", product: "chatgpt", text: "A user-shared excerpt",
  idempotencyKey: "mob_12345678", consent: true };

test("mobile share is pending and unverified, not confirmed memory", () => {
  const result = parseSourceSubmission(valid);
  assert.equal(result.status, "pending-review");
  assert.equal(result.trust, "unverified");
  assert.equal(result.source, "mobile-share");
  assert.equal(result.text, valid.text);
});
test("requires explicit consent", () => {
  assert.throws(() => parseSourceSubmission({ ...valid, consent: false }), /consent/);
});
test("rejects oversized and empty text", () => {
  assert.throws(() => parseSourceSubmission({ ...valid, text: "x".repeat(CAPTURE_MAX_CHARS + 1) }), /24000/);
  assert.throws(() => parseSourceSubmission({ ...valid, text: "  " }), /24000/);
});
test("agent source cannot impersonate manual capture", () => {
  assert.throws(() => parseSourceSubmission({ ...valid, source: "agent-tool" }), /agent credential/);
  assert.throws(() => parseSourceSubmission(valid, { agent: true }), /Agent tokens/);
  assert.equal(parseSourceSubmission({ ...valid, source: "agent-tool" }, { agent: true }).trust, "unverified");
});
test("rejects non-HTTPS source URLs and credentials", () => {
  assert.throws(() => parseSourceSubmission({ ...valid, sourceUrl: "http://chatgpt.com" }), /HTTPS/);
  assert.throws(() => parseSourceSubmission({ ...valid, sourceUrl: "https://abc:secret@example.com" }), /credentials/);
});
test("stable fingerprint for replays and changes when evidence changes", () => {
  const a = parseSourceSubmission(valid);
  assert.equal(a.textHash, parseSourceSubmission(valid).textHash);
  assert.notEqual(a.textHash, parseSourceSubmission({ ...valid, text: "Changed" }).textHash);
});
