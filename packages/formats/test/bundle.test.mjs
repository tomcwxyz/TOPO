import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmClaim,
  proposeClaim,
} from "../../core/dist/index.js";
import { SqliteMemoryStore } from "../../store-node/dist/index.js";
import {
  BundleConflictError,
  BundleValidationError,
  exportBundle,
  importBundle,
  parseBundle,
  serializeBundle,
} from "../dist/index.js";

const time1 = "2026-08-30T18:00:00.000Z";
const time2 = "2026-08-30T18:01:00.000Z";
const time3 = "2026-08-30T18:02:00.000Z";

function source(id = "source-1") {
  return {
    id,
    type: "conversation",
    title: "Test conversation",
    provider: "example",
    capturedAt: time1,
    createdAt: time1,
    sensitivity: "ordinary",
  };
}

function seed(store) {
  store.putSource(source());

  const proposed = proposeClaim(
    {
      id: "claim-1",
      subject: "self",
      key: "writing.locale",
      value: "en-GB",
      tags: ["writing"],
      epistemicType: "preference",
      confidence: 0.98,
      provenance: {
        sourceType: "conversation",
        sourceId: "source-1",
        evidence: "Please use British English.",
        capturedAt: time1,
      },
      sensitivity: "ordinary",
    },
    {
      now: time1,
      eventId: "event-1",
      actor: { type: "agent", id: "capture" },
    },
  );
  store.applyTransition(proposed);

  const confirmed = confirmClaim(proposed.claim, {
    now: time2,
    eventId: "event-2",
    actor: { type: "user" },
  });
  store.applyTransition(confirmed);
}

test("native bundle round-trips independently of SQLite layout", () => {
  const sourceStore = new SqliteMemoryStore(":memory:");
  seed(sourceStore);

  const exported = exportBundle(sourceStore, time3);
  assert.deepEqual(exported.manifest.counts, {
    sources: 1,
    claims: 1,
    events: 2,
  });

  const files = serializeBundle(exported);
  const parsed = parseBundle(files);

  const destination = new SqliteMemoryStore(":memory:");
  importBundle(destination, parsed);

  assert.deepEqual(destination.listSources(), sourceStore.listSources());
  assert.deepEqual(destination.listClaims(), sourceStore.listClaims());
  assert.deepEqual(destination.listEvents(), sourceStore.listEvents());

  sourceStore.close();
  destination.close();
});

test("export paginates instead of silently truncating at a query limit", () => {
  const store = new SqliteMemoryStore(":memory:");

  store.transaction(() => {
    for (let index = 0; index < 1005; index += 1) {
      store.putSource(
        source(`source-${String(index).padStart(4, "0")}`),
      );
    }
  });

  const bundle = exportBundle(store, time3);
  assert.equal(bundle.sources.length, 1005);
  assert.equal(bundle.manifest.counts.sources, 1005);

  store.close();
});

test("import rejects existing IDs before modifying the destination", () => {
  const sourceStore = new SqliteMemoryStore(":memory:");
  seed(sourceStore);
  const bundle = exportBundle(sourceStore, time3);

  const destination = new SqliteMemoryStore(":memory:");
  destination.putSource(source("source-existing"));

  importBundle(destination, {
    ...bundle,
    sources: bundle.sources.map((value) => ({
      ...value,
      id: value.id === "source-1" ? "source-new" : value.id,
    })),
    claims: bundle.claims.map((claim) => ({
      ...claim,
      provenance: { ...claim.provenance, sourceId: "source-new" },
    })),
  });

  const before = destination.listClaims().length;

  assert.throws(
    () => importBundle(destination, bundle),
    BundleConflictError,
  );
  assert.equal(destination.listClaims().length, before);

  sourceStore.close();
  destination.close();
});

test("parse rejects incomplete provenance rather than accepting a partial export", () => {
  const store = new SqliteMemoryStore(":memory:");
  seed(store);

  const files = serializeBundle(exportBundle(store, time3));
  const claim = JSON.parse(files["claims.jsonl"].trim());
  claim.provenance.sourceId = "missing-source";
  files["claims.jsonl"] = `${JSON.stringify(claim)}\n`;

  assert.throws(() => parseBundle(files), BundleValidationError);
  store.close();
});

test("parse rejects a bundle with a missing required file", () => {
  const store = new SqliteMemoryStore(":memory:");
  seed(store);

  const files = serializeBundle(exportBundle(store, time3));
  delete files["events.jsonl"];

  assert.throws(() => parseBundle(files), BundleValidationError);
  store.close();
});

test("serialization rejects invalid records even when TypeScript is bypassed", () => {
  const store = new SqliteMemoryStore(":memory:");
  seed(store);

  const bundle = exportBundle(store, time3);
  bundle.claims[0].confidence = 2;

  assert.throws(() => serializeBundle(bundle), BundleValidationError);
  store.close();
});
