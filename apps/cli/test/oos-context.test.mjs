import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
  });
}

test("CLI exposes confirmed TOPO memory as a purpose-bound OOS Context Packet", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-oos-cli-"));
  const store = join(directory, "memory.sqlite");

  try {
    let result = run([
      "--store",
      store,
      "--json",
      "claim",
      "add",
      "writing.locale",
      "en-GB",
      "--subject",
      "project:rack",
      "--type",
      "preference",
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = run([
      "--store",
      store,
      "oos",
      "context",
      "--subject",
      "project:rack",
      "--purpose",
      "review implementation",
      "--requester",
      "rack",
      "--key",
      "writing.locale",
    ]);

    assert.equal(result.status, 0, result.stderr);
    const packet = JSON.parse(result.stdout);

    assert.equal(packet.specversion, "0.1-draft");
    assert.equal(packet.subject, "project:rack");
    assert.equal(packet.purpose, "review implementation");
    assert.equal(packet.requested_by, "rack");
    assert.equal(packet.scope, "private");
    assert.deepEqual(packet.permissions, ["local-use-only"]);
    assert.equal(packet.objects.length, 1);
    assert.equal(packet.objects[0].type, "topo.memory_claim");
    assert.equal(packet.objects[0].value.key, "writing.locale");
    assert.equal(packet.objects[0].value.value, "en-GB");
    assert.equal(packet.provenance.created_by.id, "topo");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("OOS context defaults exclude restricted memory", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-oos-sensitive-"));
  const store = join(directory, "memory.sqlite");

  try {
    let result = run([
      "--store",
      store,
      "--json",
      "claim",
      "add",
      "private.note",
      "secret",
      "--subject",
      "project:rack",
      "--sensitivity",
      "restricted",
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = run([
      "--store",
      store,
      "oos",
      "context",
      "--subject",
      "project:rack",
      "--purpose",
      "review implementation",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).objects.length, 0);

    result = run([
      "--store",
      store,
      "oos",
      "context",
      "--subject",
      "project:rack",
      "--purpose",
      "authorised review",
      "--sensitivity",
      "ordinary",
      "personal",
      "restricted",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).objects.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
