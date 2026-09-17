import test from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createTopoRemoteMcpServer } from "../dist/index.js";

async function harness(provider) {
  const handler = createMcpHandler(() => createTopoRemoteMcpServer(provider));
  const transport = new StreamableHTTPClientTransport(
    new URL("http://test.local/mcp"),
    {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    },
  );
  const client = new Client(
    { name: "topo-remote-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  return {
    client,
    async close() {
      await client.close();
      await handler.close();
    },
  };
}

function textResult(result) {
  const first = result.content?.[0];
  assert.equal(first?.type, "text");
  return JSON.parse(first.text);
}

test("remote MCP exposes only capabilities and purpose-bound context", async () => {
  const requests = [];
  const testHarness = await harness({
    transport: "remote-context-gateway",
    async context(request) {
      requests.push(request);
      return {
        specversion: "0.1-draft",
        id: "packet-remote",
        objects: [{ id: "page-1", type: "topo.memory_page" }],
      };
    },
  });

  try {
    const tools = await testHarness.client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["topo_capabilities", "topo_context"]);

    const capabilities = textResult(
      await testHarness.client.callTool({
        name: "topo_capabilities",
        arguments: {},
      }),
    );
    assert.equal(capabilities.mode, "read-only");
    assert.equal(capabilities.transport, "remote-context-gateway");
    assert.equal(capabilities.search, false);
    assert.equal(capabilities.captureAuthority, false);
    assert.equal(capabilities.contributionAuthority, false);
    assert.equal(capabilities.reviewAuthority, false);

    const packet = textResult(
      await testHarness.client.callTool({
        name: "topo_context",
        arguments: {
          subject: "project:topo",
          purpose: "continue implementation",
          query: "remote MCP",
          maxItems: 5,
        },
      }),
    );
    assert.equal(packet.id, "packet-remote");
    assert.deepEqual(requests, [
      {
        subject: "project:topo",
        purpose: "continue implementation",
        query: "remote MCP",
        maxItems: 5,
        requestedBy: "topo-remote-mcp",
      },
    ]);
  } finally {
    await testHarness.close();
  }
});

test("remote MCP returns provider failures as MCP tool errors", async () => {
  const testHarness = await harness({
    transport: "remote-context-gateway",
    async context() {
      throw new Error("remote grant expired");
    },
  });

  try {
    const result = await testHarness.client.callTool({
      name: "topo_context",
      arguments: { purpose: "test failure" },
    });
    assert.equal(result.isError, true);
    const first = result.content?.[0];
    assert.equal(first?.type, "text");
    assert.match(first.text, /remote grant expired/);
  } finally {
    await testHarness.close();
  }
});
