import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));

test("stdio server negotiates MCP and exposes safe default capabilities", async () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-mcp-"));
  const store = join(directory, "memory.sqlite");
  const discovery = join(directory, "missing-discovery.json");
  const client = new Client(
    { name: "stdio-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );

  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [server, "--store", store, "--discovery", discovery],
      }),
    );

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.equal(names.includes("topo_context"), true);
    assert.equal(names.includes("topo_search_pages"), true);
    assert.equal(names.includes("topo_propose_claims"), true);
    assert.equal(names.includes("topo_confirm_candidate"), false);

    const capabilities = await client.callTool({
      name: "topo_capabilities",
      arguments: {},
    });
    const first = capabilities.content?.[0];
    assert.equal(first?.type, "text");
    const parsed = JSON.parse(first.text);
    assert.equal(parsed.mode, "proposal-first");
    assert.equal(parsed.reviewDecisions, "disabled");
    assert.equal(parsed.maxSensitivity, "personal");
    assert.equal(parsed.transport, "stdio");
    assert.equal(parsed.contextMode, "memory-pages");
    assert.equal(parsed.contextTransport, "desktop-loopback");

    const context = await client.callTool({
      name: "topo_context",
      arguments: { purpose: "test desktop discovery failure" },
    });
    assert.equal(context.isError, true);
    const errorText = context.content?.[0];
    assert.equal(errorText?.type, "text");
    assert.match(errorText.text, /TOPO Desktop is not discoverable/);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
