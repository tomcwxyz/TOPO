import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerOosCommands } from "../dist/oos.js";

test("topo capture validates and delegates a CapturedInteraction to Desktop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-cli-capture-"));
  const input = join(directory, "interaction.json");
  const requests = [];
  const output = [];
  const errors = [];
  const program = new Command();
  program.name("topo");

  const interaction = {
    id: "interaction-cli-1",
    kind: "conversation",
    product: "generic",
    client: "terminal",
    mode: "generic",
    captureMethod: "manual",
    fidelity: "conversation-turns",
    provider: "cli-test",
    subject: "project:topo",
    capturedAt: "2026-09-17T07:30:00.000Z",
    turns: [
      {
        id: "u1",
        role: "user",
        content: "Use TOPO context in another tool.",
      },
      {
        id: "a1",
        role: "assistant",
        content: "The interaction can enter the governed capture inbox.",
      },
    ],
    retention: "review-window",
  };
  writeFileSync(input, JSON.stringify(interaction), "utf8");

  try {
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
        async context() {
          throw new Error("context should not be called");
        },
        async captureInteraction(request) {
          requests.push(request);
          return {
            queued: true,
            interactionId: request.interaction.id,
          };
        },
      },
    });

    await program.parseAsync([
      "node",
      "topo",
      "capture",
      input,
      "--requester",
      "manual-test",
    ]);

    assert.deepEqual(errors, []);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      interaction,
      requestedBy: "manual-test",
    });
    assert.deepEqual(JSON.parse(output.join("")), {
      queued: true,
      interactionId: "interaction-cli-1",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
