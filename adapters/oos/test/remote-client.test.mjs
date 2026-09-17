import test from "node:test";
import assert from "node:assert/strict";
import { TopoRemoteContextClient } from "../dist/remote-client.js";

const token = "remote-access-token";

test("remote client sends a purpose-bound HTTPS request without forwarding requester identity", async () => {
  const seen = [];
  const client = new TopoRemoteContextClient({
    baseUrl: "https://relay.example/topo/",
    accessToken: token,
    fetch: async (url, init) => {
      seen.push([url.toString(), init]);
      return new Response(
        JSON.stringify({ specversion: "0.1-draft", id: "packet-1", objects: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const packet = await client.context({
    subject: "project:topo",
    purpose: "continue implementation",
    query: "remote MCP",
    maxItems: 5,
    requestedBy: "topo-remote-mcp",
  });

  assert.equal(packet.id, "packet-1");
  assert.equal(seen.length, 1);
  const [url, init] = seen[0];
  assert.equal(url, "https://relay.example/topo/v0/context");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(init.body), {
    subject: "project:topo",
    purpose: "continue implementation",
    query: "remote MCP",
    maxItems: 5,
  });
});

test("remote client refuses plaintext non-loopback gateways and URL credentials", () => {
  assert.throws(
    () =>
      new TopoRemoteContextClient({
        baseUrl: "http://relay.example",
        accessToken: token,
      }),
    /requires HTTPS/,
  );
  assert.throws(
    () =>
      new TopoRemoteContextClient({
        baseUrl: "https://user:pass@relay.example",
        accessToken: token,
      }),
    /must not contain credentials/,
  );

  assert.doesNotThrow(
    () =>
      new TopoRemoteContextClient({
        baseUrl: "http://127.0.0.1:8787",
        accessToken: token,
      }),
  );
});

test("remote client surfaces grant errors without accepting oversized responses", async () => {
  const denied = new TopoRemoteContextClient({
    baseUrl: "https://relay.example",
    accessToken: token,
    fetch: async () =>
      new Response(
        JSON.stringify({ error: "grant does not allow this subject" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
  });
  await assert.rejects(
    denied.context({ subject: "project:other", purpose: "test" }),
    /grant does not allow this subject/,
  );

  const oversized = new TopoRemoteContextClient({
    baseUrl: "https://relay.example",
    accessToken: token,
    maxResponseBytes: 32,
    fetch: async () =>
      new Response(JSON.stringify({ content: "x".repeat(100) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(
    oversized.context({ subject: "self", purpose: "test" }),
    /size limit/,
  );
});
