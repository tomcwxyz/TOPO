import assert from "node:assert/strict";
import test from "node:test";
import { resolveOosContext, topoOosManifest } from "../dist/index.js";

function claim(overrides = {}) {
  return {
    id: "claim-1",
    subject: "project:rack",
    key: "writing.locale",
    value: "en-GB",
    tags: ["writing"],
    epistemicType: "preference",
    confidence: 1,
    provenance: {
      sourceType: "manual",
      sourceId: "source-1",
      capturedAt: "2026-08-30T10:00:00Z",
    },
    status: "confirmed",
    sensitivity: "ordinary",
    supersedes: [],
    createdAt: "2026-08-30T10:00:00Z",
    updatedAt: "2026-08-31T08:00:00Z",
    ...overrides,
  };
}

function storeWith(claims) {
  return {
    getClaim(id) {
      return claims.find((item) => item.id === id);
    },
    listClaims(filter = {}) {
      let result = claims.slice();
      if (filter.status) result = result.filter((item) => item.status === filter.status);
      if (filter.subject) result = result.filter((item) => item.subject === filter.subject);
      if (filter.category) result = result.filter((item) => item.category === filter.category);
      if (filter.key) result = result.filter((item) => item.key === filter.key);
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? result.length;
      return result.slice(offset, offset + limit);
    },
    putClaim() {},
    getSource() { return undefined; },
    listSources() { return []; },
    putSource() {},
    getEvent() { return undefined; },
    appendEvent() {},
    listEvents() { return []; },
    applyTransition() {},
    transaction(work) { return work(this); },
    close() {},
  };
}

test("TOPO advertises context provision without claiming event ingestion", () => {
  assert.deepEqual(topoOosManifest.provides, ["context", "memory_claim"]);
  assert.deepEqual(topoOosManifest.emits, []);
  assert.deepEqual(topoOosManifest.accepts, []);
});

test("resolves confirmed, purpose-bound local context into an OOS packet", () => {
  const store = storeWith([
    claim(),
    claim({
      id: "claim-2",
      subject: "project:rack",
      key: "project.phase",
      value: "pilot",
      provenance: {
        sourceType: "connector",
        sourceId: "flowlance:project:1",
        capturedAt: "2026-08-31T07:30:00Z",
      },
      updatedAt: "2026-08-31T08:30:00Z",
    }),
  ]);

  const packet = resolveOosContext(
    store,
    {
      subject: "project:rack",
      purpose: "review implementation",
      requestedBy: "rack",
      keys: ["writing.locale", "project.phase"],
    },
    {
      packetId: "ctx-1",
      now: "2026-08-31T09:00:00Z",
    },
  );

  assert.equal(packet.scope, "private");
  assert.deepEqual(packet.permissions, ["local-use-only"]);
  assert.equal(packet.objects.length, 2);
  assert.equal(packet.objects[0].id, "claim-2");
  assert.deepEqual(packet.evidence_refs.sort(), [
    "flowlance:project:1",
    "source-1",
  ]);
  assert.deepEqual(packet.provenance.derived_from, ["claim-2", "claim-1"]);
});

test("filters expired and restricted claims by default", () => {
  const store = storeWith([
    claim({
      id: "expired",
      validUntil: "2026-08-30T00:00:00Z",
    }),
    claim({
      id: "restricted",
      sensitivity: "restricted",
    }),
    claim({
      id: "current",
      key: "current",
    }),
  ]);

  const packet = resolveOosContext(
    store,
    {
      subject: "project:rack",
      purpose: "review implementation",
      requestedBy: "rack",
    },
    {
      packetId: "ctx-2",
      now: "2026-08-31T09:00:00Z",
    },
  );

  assert.deepEqual(packet.objects.map((item) => item.id), ["current"]);
});

test("can explicitly allow restricted context", () => {
  const store = storeWith([
    claim({
      id: "restricted",
      sensitivity: "restricted",
    }),
  ]);

  const packet = resolveOosContext(
    store,
    {
      subject: "project:rack",
      purpose: "authorised review",
      requestedBy: "rack",
    },
    {
      packetId: "ctx-3",
      now: "2026-08-31T09:00:00Z",
      allowedSensitivity: ["ordinary", "restricted"],
      permissions: ["local-use-only", "restricted-authorised"],
    },
  );

  assert.equal(packet.objects.length, 1);
  assert.deepEqual(packet.permissions, [
    "local-use-only",
    "restricted-authorised",
  ]);
});
