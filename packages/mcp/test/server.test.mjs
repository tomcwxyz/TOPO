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

async function harness(options = {}) {
  const store = new SqliteMemoryStore(":memory:");
  const service = new TopoMcpService(store, options);
  const handler = createMcpHandler(() => createTopoMcpServer(service));
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
