import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopoLocalClient } from "../dist/local-client.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

test("shared local client maps context and capture through authenticated loopback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-local-client-"));
  const discoveryPath = join(directory, "oos-local.json");
  const seen = [];

  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer local-token");
    const body = await readBody(request);
    seen.push([request.url, body]);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  try {
    const address = await listen(server);
    assert.equal(typeof address, "object");
    writeFileSync(
      discoveryPath,
      JSON.stringify({
        protocol: "oos-local/0.1",
        endpoint: `http://127.0.0.1:${address.port}`,
        token: "local-token",
      }),
    );

    const client = new TopoLocalClient({ discoveryPath });
    await client.context({
      subject: "project:topo",
      purpose: "continue implementation",
      requestedBy: "test",
      query: "context",
      maxItems: 4,
    });

    const interaction = {
      id: "interaction-1",
      kind: "conversation",
      product: "generic",
      client: "terminal",
      mode: "generic",
      captureMethod: "local-mcp",
      fidelity: "conversation-turns",
      provider: "test",
      subject: "project:topo",
      capturedAt: "2026-09-17T07:00:00.000Z",
      turns: [{ id: "u1", role: "user", content: "Remember this interaction." }],
      retention: "review-window",
    };
    await client.captureInteraction({
      requestedBy: "test",
      interaction,
    });

    assert.deepEqual(seen[0], [
      "/v0/context",
      {
        subject: "project:topo",
        purpose: "continue implementation",
        requested_by: "test",
        wanted: { query: "context", max_items: 4 },
      },
    ]);
    assert.deepEqual(seen[1], [
      "/v0/capture",
      { requested_by: "test", interaction },
    ]);
  } finally {
    await close(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shared local client refuses non-loopback discovery endpoints", async () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-local-client-"));
  const discoveryPath = join(directory, "oos-local.json");
  let fetched = false;

  try {
    writeFileSync(
      discoveryPath,
      JSON.stringify({
        protocol: "oos-local/0.1",
        endpoint: "https://example.com",
        token: "must-not-be-sent",
      }),
    );

    const client = new TopoLocalClient({
      discoveryPath,
      fetch: async () => {
        fetched = true;
        throw new Error("fetch should not run");
      },
    });

    await assert.rejects(
      () =>
        client.context({
          subject: "self",
          purpose: "test",
          requestedBy: "test",
        }),
      /non-loopback host/,
    );
    assert.equal(fetched, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
