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

test("CLI can create, review, search, export and import memory", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-cli-"));
  const store = join(directory, "memory.sqlite");
  const restored = join(directory, "restored.sqlite");
  const bundle = join(directory, "bundle");

  try {
    let result = run([
      "--store",
      store,
      "--json",
      "claim",
      "propose",
      "writing.locale",
      "en-GB",
      "--type",
      "preference",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const proposed = JSON.parse(result.stdout);
    assert.equal(proposed.status, "candidate");
    assert.equal(proposed.epistemicType, "preference");

    result = run([
      "--store",
      store,
      "--json",
      "candidate",
      "edit",
      proposed.id,
      "--value",
      "British English",
      "--confidence",
      "0.99",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const edited = JSON.parse(result.stdout);
    assert.equal(edited.status, "candidate");
    assert.equal(edited.value, "British English");
    assert.equal(edited.confidence, 0.99);

    result = run([
      "--store",
      store,
      "--json",
      "candidate",
      "confirm",
      proposed.id,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "confirmed");

    result = run(["--store", store, "--json", "search", "British"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).length, 1);

    result = run(["--store", store, "--json", "search", "en-GB"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).length, 0);

    result = run(["--store", store, "--json", "export", bundle]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).manifest.counts.claims, 1);

    result = run(["--store", restored, "--json", "import", bundle]);
    assert.equal(result.status, 0, result.stderr);

    result = run(["--store", restored, "--json", "status"]);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.confirmed, 1);
    assert.equal(status.candidates, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
