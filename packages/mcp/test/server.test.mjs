import test from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { SqliteMemoryStore } from "../../store-node/dist/index.js";
import {
  createTopoMcpServer,
  TopoMcpService,
} from "../dist/index.js";

async function harness(options = {}, contextProvider) {
  const store = new SqliteMemoryStore(":memory:");
  const service = new TopoMcpService(store, options);
  const handler = createMcpHandler(() =>
    createTopoMcpServer(service, contextProvider),
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("http://test.local/mcp"),
    {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    },
  );
  const client = new Client(
    { name: "topo-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);

  return {
    store,
    client,
    handler,
    async close() {
      await client.close();
      await handler.close();
      store.close();
    },
  };
}

function textResult(result) {
  const first = result.content?.[0];
  assert.equal(first?.type, "text");
  return JSON.parse(first.text);
}

test("default MCP tool surface is proposal-first", async () => {
  const testHarness = await harness();
  try {
    const listed = await testHarness.client.listTools();
    const names = listed.tools.map((tool) => tool.name);

    assert.equal(names.includes("topo_propose_claims"), true);
    assert.equal(names.includes("topo_search"), true);
    assert.equal(names.includes("topo_context"), false);
    assert.equal(names.includes("topo_capture_interaction"), false);
    assert.equal(names.includes("topo_confirm_candidate"), false);
    assert.equal(names.includes("topo_reject_candidate"), false);
    assert.equal(names.includes("topo_edit_candidate"), false);

    const result = await testHarness.client.callTool({
      name: "topo_propose_claims",
      arguments: {
        claims: [
          {
            key: "writing.locale",
            value: "en-GB",
            epistemicType: "preference",
          },
        ],
      },
    });
    const body = textResult(result);
    assert.equal(body.claims[0].status, "candidate");

    const candidates = textResult(
      await testHarness.client.callTool({
        name: "topo_list_candidates",
        arguments: {},
      }),
    );
    assert.equal(candidates.candidates.length, 1);
  } finally {
    await testHarness.close();
  }
});

test("Memory Page context and capture tools delegate to a context provider", async () => {
  const requests = [];
  const contextProvider = {
    mode: "memory-pages",
    transport: "test-provider",
    async context(request) {
      requests.push(["context", request]);
      return {
        objects: [
          {
            type: "topo.memory_page",
            id: "memory-1",
            value: { title: "TOPO", content: "Useful project context." },
          },
        ],
      };
    },
    async searchPages(request) {
      requests.push(["search", request]);
      return { representation: "memory-page", results: [] };
    },
    async captureInteraction(request) {
      requests.push(["capture", request]);
      return {
        queued: true,
        interactionId: request.interaction.id,
      };
    },
  };
  const testHarness = await harness({}, contextProvider);

  try {
    const listed = await testHarness.client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.equal(names.includes("topo_context"), true);
    assert.equal(names.includes("topo_search_pages"), true);
    assert.equal(names.includes("topo_capture_interaction"), true);

    const capabilities = textResult(
      await testHarness.client.callTool({
        name: "topo_capabilities",
        arguments: {},
      }),
    );
    assert.equal(capabilities.contextMode, "memory-pages");
    assert.equal(capabilities.contextTransport, "test-provider");
    assert.equal(capabilities.interactionCapture, true);

    const context = textResult(
      await testHarness.client.callTool({
        name: "topo_context",
        arguments: {
          subject: "project:topo",
          purpose: "Continue the implementation",
          query: "MCP context",
          maxItems: 6,
        },
      }),
    );
    assert.equal(context.objects[0].id, "memory-1");
    assert.deepEqual(requests[0], [
      "context",
      {
        subject: "project:topo",
        purpose: "Continue the implementation",
        query: "MCP context",
        maxItems: 6,
        requestedBy: "topo-mcp",
      },
    ]);

    await testHarness.client.callTool({
      name: "topo_search_pages",
      arguments: { query: "portable memory", limit: 5 },
    });
    assert.deepEqual(requests[1], [
      "search",
      {
        query: "portable memory",
        limit: 5,
        requestedBy: "topo-mcp",
      },
    ]);

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
      title: "TOPO implementation",
      capturedAt: "2026-09-17T07:00:00.000Z",
      turns: [
        {
          id: "turn-1",
          role: "user",
          content: "Continue implementing TOPO.",
        },
        {
          id: "turn-2",
          role: "assistant",
          content: "Implemented the next tranche.",
        },
      ],
      retention: "review-window",
    };
    const capture = textResult(
      await testHarness.client.callTool({
        name: "topo_capture_interaction",
        arguments: { interaction },
      }),
    );
    assert.equal(capture.queued, true);
    assert.deepEqual(requests[2], [
      "capture",
      {
        interaction,
        requestedBy: "topo-mcp",
      },
    ]);
  } finally {
    await testHarness.close();
  }
});

test("trusted review mode registers authority-changing tools explicitly", async () => {
  const testHarness = await harness({ allowReviewDecisions: true });
  try {
    const listed = await testHarness.client.listTools();
    const names = listed.tools.map((tool) => tool.name);

    assert.equal(names.includes("topo_confirm_candidate"), true);
    assert.equal(names.includes("topo_reject_candidate"), true);
    assert.equal(names.includes("topo_edit_candidate"), true);
  } finally {
    await testHarness.close();
  }
});
