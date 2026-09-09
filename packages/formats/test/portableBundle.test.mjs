import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPortableBundle,
  parsePortableBundle,
  serializePortableBundle,
} from "../dist/portableBundle.js";

const fixtures = fileURLToPath(
  new URL("../../../test-fixtures/domain/", import.meta.url),
);

function read(name) {
  return JSON.parse(readFileSync(new URL(name, `file://${fixtures}/`), "utf8"));
}

function portableFixture() {
  const memory = {
    ...read("memory-page-project.json"),
    annotationIds: ["claim-preference-1"],
  };
  const memoryEvent = {
    id: "memory-event-confirmed-1",
    type: "memory.confirmed",
    entityType: "memory",
    entityId: memory.id,
    occurredAt: "2026-09-09T20:30:00.000Z",
    actor: { type: "user" },
    data: { revision: memory.revision },
  };

  return createPortableBundle({
    createdAt: "2026-09-09T21:00:00.000Z",
    sources: [read("source-conversation.json")],
    memories: [memory],
    annotations: [read("claim-preference.json")],
    events: [read("event-confirmed.json"), memoryEvent],
  });
}

test("portable bundle v0.2 round-trips Markdown memories and structured annotations", () => {
  const bundle = portableFixture();
  const files = serializePortableBundle(bundle);
  const parsed = parsePortableBundle(files);

  assert.deepEqual(parsed, bundle);
  assert.equal(bundle.manifest.version, "0.2");
  assert.equal(bundle.manifest.counts.memories, 1);
  assert.equal(bundle.manifest.counts.annotations, 1);
  assert.equal(bundle.manifest.memories[0].path, "memories/rack-architecture--memory-1.md");
  assert.match(files["memories/rack-architecture--memory-1.md"], /RACK uses Neon rather than Supabase/);
  assert.match(files["annotations.jsonl"], /claim-preference-1/);
});

test("portable bundle requires every Memory Page source to travel with it", () => {
  const bundle = portableFixture();
  assert.throws(
    () =>
      createPortableBundle({
        createdAt: bundle.manifest.createdAt,
        sources: [],
        memories: bundle.memories,
        annotations: bundle.annotations,
        events: [],
      }),
    /references missing source source-1/,
  );
});

test("portable bundle requires linked annotations to travel with a Memory Page", () => {
  const bundle = portableFixture();
  assert.throws(
    () =>
      createPortableBundle({
        createdAt: bundle.manifest.createdAt,
        sources: bundle.sources,
        memories: bundle.memories,
        annotations: [],
        events: [],
      }),
    /references missing annotation claim-preference-1/,
  );
});

test("portable bundle rejects a Markdown file whose identity no longer matches its manifest", () => {
  const files = serializePortableBundle(portableFixture());
  const path = "memories/rack-architecture--memory-1.md";
  files[path] = files[path].replace('id: "memory-1"', 'id: "memory-other"');
  assert.throws(() => parsePortableBundle(files), /does not match manifest id/);
});

test("portable bundle rejects a page revision mismatch", () => {
  const files = serializePortableBundle(portableFixture());
  const path = "memories/rack-architecture--memory-1.md";
  files[path] = files[path].replace("revision: 2", "revision: 3");
  assert.throws(() => parsePortableBundle(files), /does not match manifest revision/);
});
