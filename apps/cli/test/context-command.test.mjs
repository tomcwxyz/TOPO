import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";
import { registerOosCommands } from "../dist/oos.js";

test("topo context delegates purpose-bound retrieval to TOPO Desktop", async () => {
  const requests = [];
  const output = [];
  const errors = [];
  const program = new Command();
  program.name("topo");

  registerOosCommands(program, {
    openStore() {
      throw new Error("legacy store should not be opened");
    },
    write(value) {
      output.push(value);
    },
    writeError(value) {
      errors.push(value);
    },
    desktopContext: {
      async context(request) {
        requests.push(request);
        return {
          specversion: "0.1-draft",
          subject: request.subject,
          purpose: request.purpose,
          objects: [
            {
              type: "topo.memory_page",
              id: "page-1",
              value: { title: "Context everywhere", content: "Use Context Packets." },
            },
          ],
        };
      },
    },
  });

  await program.parseAsync([
    "node",
    "topo",
    "context",
    "--subject",
    "project:topo",
    "--purpose",
    "continue implementation",
    "--query",
    "MCP mobile",
    "--requester",
    "codex",
    "--max-items",
    "7",
  ]);

  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [
    {
      subject: "project:topo",
      purpose: "continue implementation",
      query: "MCP mobile",
      requestedBy: "codex",
      maxItems: 7,
    },
  ]);

  const packet = JSON.parse(output.join(""));
  assert.equal(packet.objects[0].type, "topo.memory_page");
  assert.equal(packet.objects[0].id, "page-1");
});
