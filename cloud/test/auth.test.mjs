import test from "node:test";
import assert from "node:assert/strict";
import { issueSession, verifySession, passwordMatches, agentTokenMatches, isSameOrigin } from "../lib/auth.mjs";
import { createHash } from "node:crypto";

const secret = "0123456789abcdef0123456789abcdef";
test("session validates, rejects tampering and expires", () => {
  const token = issueSession(secret, 1000000);
  assert.equal(verifySession(token, secret, 1000000), "alpha-owner");
  assert.equal(verifySession(token + "bad", secret, 1000000), null);
  assert.equal(verifySession(token, secret, 1000000 + 8 * 24 * 3600 * 1000), null);
});
test("password and agent credential comparison", () => {
  assert.equal(passwordMatches("not-so-secret-password", "not-so-secret-password"), true);
  assert.equal(passwordMatches("wrong", "not-so-secret-password"), false);
  const key = "this_is_a_long_agent_secret_token_123456789";
  const hash = createHash("sha256").update(key).digest("hex");
  assert.equal(agentTokenMatches("Bearer " + key, hash), true);
  assert.equal(agentTokenMatches("Bearer wrong-key", hash), false);
});
test("cross-origin submission blocked for session requests", () => {
  const request = (origin) => ({
    url: "https://topo.example.com/api/captures",
    headers: { get: (name) => name === "origin" ? origin : null },
  });
  assert.equal(isSameOrigin(request("https://topo.example.com")), true);
  assert.equal(isSameOrigin(request("https://attacker.example.com")), false);
  assert.equal(isSameOrigin(request(null)), false);
});
