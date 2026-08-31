import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmClaim,
  proposeClaim,
} from "../../core/dist/index.js";
import { SqliteMemoryStore } from "../dist/index.js";

const time1 = "2026-08-30T18:00:00.000Z";
const time2 = "2026-08-30T18:01:00.000Z";

function source() {
  return {
    id: "source-1",
    type: "conversation",
    title: "Test conversation",
    provider: "example",
    capturedAt: time1,
    createdAt: time1,
    sensitivity: "ordinary",
    metadata: { platform: "test" },
  };
}

function proposed(eventId = "event-proposed") {
  return proposeClaim(
    {
      id: "claim-1",
      subject: "self",
      key: "writing.locale",
      value: "en-GB",
      tags: ["writing"],
      epistemicType: "preference",
      confidence: 0.95,
      provenance: {
        sourceType: "conversation",
        sourceId: "source-1",
        evidence: "Use British English.",
        capturedAt: time1,
      },
      sensitivity: "ordinary",
    },
    {
      now: time1,
      eventId,
      actor: { type: "agent", id: "capture" },
    },
  );
}

test("initialises schema and round-trips sources, claims and events", () => {
  const store = new SqliteMemoryStore(":memory:");

  assert.equal(store.schemaVersion(), 1);
  store.putSource(source());
  store.applyTransition(proposed());

  assert.deepEqual(store.getSource("source-1"), source());
  assert.equal(store.getClaim("claim-1").status, "candidate");
  assert.equal(store.listClaims({ status: "candidate" }).length, 1);
  assert.equal(store.listEvents({ entityId: "claim-1" }).length, 1);

  store.close();
});

test("claim update and event append are atomic", () => {
  const store = new SqliteMemoryStore(":memory:");
  store.putSource(source());

  const first = proposed("event-1");
  store.applyTransition(first);

  const confirmed = confirmClaim(first.claim, {
    now: time2,
    eventId: "event-1",
    actor: { type: "user" },
  });

  assert.throws(() => store.applyTransition(confirmed));
  assert.equal(store.getClaim("claim-1").status, "candidate");
  assert.equal(store.listEvents({ entityId: "claim-1" }).length, 1);

  store.close();
});

test("source references are enforced by SQLite", () => {
  const store = new SqliteMemoryStore(":memory:");

  assert.throws(() => store.applyTransition(proposed()));
  assert.equal(store.getClaim("claim-1"), undefined);

  store.close();
});

test("file-backed stores survive close and reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-store-"));
  const path = join(directory, "memory.sqlite");

  try {
    const first = new SqliteMemoryStore(path);
    first.putSource(source());
    first.applyTransition(proposed());
    first.close();

    const reopened = new SqliteMemoryStore(path);
    assert.equal(reopened.schemaVersion(), 1);
    assert.equal(reopened.getClaim("claim-1").value, "en-GB");
    assert.equal(reopened.listEvents({ type: "claim.proposed" }).length, 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supports paginated source/event reads and direct event lookup", () => {
  const store = new SqliteMemoryStore(":memory:");
  store.putSource(source());
  store.putSource({ ...source(), id: "source-2", title: "Second" });
  store.applyTransition(proposed());

  assert.equal(store.listSources({ limit: 1, offset: 0 }).length, 1);
  assert.equal(store.listSources({ limit: 1, offset: 1 }).length, 1);
  assert.equal(store.listSources({ limit: 1, offset: 2 }).length, 0);
  assert.equal(store.getEvent("event-proposed").type, "claim.proposed");
  assert.equal(store.listEvents({ limit: 1, offset: 1 }).length, 0);

  store.close();
});

test("event reads preserve insertion order when timestamps are identical", () => {
  const store = new SqliteMemoryStore(":memory:");
  store.putSource(source());

  const first = proposed("event-z");
  store.applyTransition(first);
  const confirmed = confirmClaim(first.claim, {
    now: time1,
    eventId: "event-a",
    actor: { type: "user", id: "reviewer" },
  });
  store.applyTransition(confirmed);

  const events = store.listEvents({ entityId: "claim-1" });
  assert.deepEqual(
    events.map((event) => event.id),
    ["event-a", "event-z"],
  );

  store.close();
});
