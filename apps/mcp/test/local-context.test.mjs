import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDesktopContextProvider } from "../dist/local-context.js";

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

test("desktop context provider maps context, search and governed capture", async () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-context-provider-"));
  const discoveryPath = join(directory, "oos-local.json");
  const seen = [];

  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer test-token");
    const body = await readBody(request);
    seen.push([request.url, body]);
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/v0/context") {
      response.end(
        JSON.stringify({
          objects: [
            {
              type: "topo.memory_page",
              id: "ordinary-page",
              value: {
                title: "Ordinary",
                content: "Allowed",
                sensitivity: "ordinary",
                source_refs: [{ source_id: "source-ordinary" }],
              },
            },
            {
              type: "topo.memory_page",
              id: "personal-page",
              value: {
                title: "Personal",
                content: "Filtered",
                sensitivity: "personal",
                source_refs: [{ source_id: "source-personal" }],
              },
            },
          ],
          evidence_refs: ["source-ordinary", "source-personal"],
          provenance: {
            derived_from: ["ordinary-page", "personal-page"],
            extensions: {
              page_revisions: {
                "ordinary-page": 1,
                "personal-page": 2,
              },
            },
          },
          extensions: {
            "topo.relevance": {
              "ordinary-page": { score: 2 },
              "personal-page": { score: 8 },
            },
          },
        }),
      );
      return;
    }

    if (request.url === "/v0/search") {
      response.end(
        JSON.stringify({
          representation: "memory-page",
          results: [
            {
              memoryPage: {
                id: "ordinary-page",
                sensitivity: "ordinary",
              },
            },
            {
              memoryPage: {
                id: "personal-page",
                sensitivity: "personal",
              },
            },
          ],
        }),
      );
      return;
    }

    if (request.url === "/v0/capture") {
      response.end(
        JSON.stringify({
          queued: true,
          interactionId: body.interaction.id,
          product: body.interaction.product,
          turns: body.interaction.turns.length,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  try {
    const address = await listen(server);
    assert.equal(typeof address, "object");
    writeFileSync(
      discoveryPath,
      JSON.stringify({
        protocol: "oos-local/0.1",
        endpoint: `http://127.0.0.1:${address.port}`,
        token: "test-token",
      }),
    );

    const provider = new LocalDesktopContextProvider({
      discoveryPath,
      maxSensitivity: "ordinary",
    });

    const context = await provider.context({
      subject: "project:topo",
      purpose: "Continue implementation",
      query: "MCP",
      maxItems: 5,
      requestedBy: "test-client",
    });
    assert.equal(context.objects.length, 1);
    assert.equal(context.objects[0].id, "ordinary-page");
    assert.deepEqual(context.evidence_refs, ["source-ordinary"]);
    assert.deepEqual(context.provenance.derived_from, ["ordinary-page"]);
    assert.deepEqual(context.provenance.extensions.page_revisions, {
      "ordinary-page": 1,
    });
    assert.deepEqual(context.extensions["topo.relevance"], {
      "ordinary-page": { score: 2 },
    });
    assert.equal(context.extensions["topo.mcp_sensitivity_ceiling"], "ordinary");

    const search = await provider.searchPages({
      query: "MCP",
      limit: 10,
      requestedBy: "test-client",
    });
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].memoryPage.id, "ordinary-page");

    const interaction = {
      id: "interaction-1",
      kind: "conversation",
      product: "generic",
      client: "terminal",
      mode: "generic",
      captureMethod: "local-mcp",
      fidelity: "conversation-turns",
      provider: "test-agent",
      subject: "project:topo",
      title: "Continue TOPO",
      capturedAt: "2026-09-17T07:00:00.000Z",
      turns: [
        {
          id: "turn-1",
          role: "user",
          content: "Continue implementing Context everywhere.",
        },
        {
          id: "turn-2",
          role: "assistant",
          content: "Implemented the next tranche.",
        },
      ],
      retention: "review-window",
    };
    const capture = await provider.captureInteraction({
      interaction,
      requestedBy: "test-client",
    });
    assert.equal(capture.queued, true);
    assert.equal(capture.interactionId, "interaction-1");

    assert.deepEqual(seen[0], [
      "/v0/context",
      {
        subject: "project:topo",
        purpose: "Continue implementation",
        requested_by: "test-client",
        wanted: { query: "MCP", max_items: 5 },
      },
    ]);
    assert.deepEqual(seen[1], [
      "/v0/search",
      { query: "MCP", requested_by: "test-client", limit: 10 },
    ]);
    assert.deepEqual(seen[2], [
      "/v0/capture",
      { requested_by: "test-client", interaction },
    ]);
  } finally {
    await close(server);
    rmSync(directory, { recursive: true, force: true });
  }
});
