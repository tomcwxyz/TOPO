import test from "node:test";
import assert from "node:assert/strict";
import {
  createMobileRememberCapture,
  projectContextPacketForMobileShare,
  useMobileContext,
} from "../dist/mobile-share.js";

function packet() {
  return {
    specversion: "0.1-draft",
    id: "ctx-secret-id",
    subject: "project:topo",
    purpose: "private task purpose",
    requested_by: "remote:grant-mobile",
    objects: [
      {
        type: "topo.memory_page",
        id: "page-secret-1",
        value: {
          title: "TOPO architecture",
          summary: "Internal summary",
          content: "Memory Pages are durable material. Context Packets are what AI tools consume.",
          sensitivity: "personal",
          revision: 7,
          source_refs: [{ source_id: "source-secret" }],
        },
      },
      {
        type: "topo.memory_page",
        id: "page-secret-2",
        value: {
          title: "Mobile interaction",
          content: "Use explicit share actions rather than ambient device monitoring.",
          sensitivity: "ordinary",
          revision: 2,
          source_refs: [],
        },
      },
    ],
    evidence_refs: ["source-secret"],
    provenance: {
      derived_from: ["page-secret-1", "page-secret-2"],
      extensions: { page_revisions: { "page-secret-1": 7 } },
    },
  };
}

test("Use my context projection contains only human-readable selected page material", () => {
  const projected = projectContextPacketForMobileShare(packet());

  assert.equal(projected.pageCount, 2);
  assert.equal(projected.truncated, false);
  assert.match(projected.text, /TOPO architecture/);
  assert.match(projected.text, /Memory Pages are durable material/);
  assert.match(projected.text, /Mobile interaction/);

  for (const forbidden of [
    "ctx-secret-id",
    "page-secret-1",
    "page-secret-2",
    "source-secret",
    "private task purpose",
    "personal",
    "revision",
  ]) {
    assert.equal(projected.text.includes(forbidden), false, forbidden);
  }
});

test("Use my context projection obeys page and character budgets", () => {
  const projected = projectContextPacketForMobileShare(packet(), {
    maxPages: 1,
    maxChars: 100,
  });

  assert.equal(projected.pageCount, 1);
  assert.equal(projected.truncated, true);
  assert.equal(projected.text.length <= 100, true);
  assert.equal(projected.text.includes("Mobile interaction"), false);
});

test("Use my context requests bounded TOPO context before creating the share projection", async () => {
  const requests = [];
  const projected = await useMobileContext(
    {
      async context(request) {
        requests.push(request);
        return packet();
      },
    },
    {
      subject: "project:topo",
      purpose: "Continue the mobile prototype",
      query: "share context",
      maxItems: 3,
    },
    { maxPages: 1 },
  );

  assert.deepEqual(requests, [
    {
      subject: "project:topo",
      purpose: "Continue the mobile prototype",
      requestedBy: "topo-mobile",
      query: "share context",
      maxItems: 3,
    },
  ]);
  assert.equal(projected.pageCount, 1);
});

test("Remember this produces a partial-visible capture source, not durable memory", () => {
  const capture = createMobileRememberCapture({
    interactionId: "mobile-test-1",
    turnId: "mobile-u1",
    capturedAt: "2026-09-17T19:00:00.000Z",
    text: "The user explicitly selected this useful context.",
    subject: "project:topo",
    title: "Selected note",
    sourceUrl: "https://example.com/note",
    sourceApp: "com.example.notes",
    provider: "android-share",
    metadata: { selectionLength: 48 },
  });

  assert.equal(capture.id, "mobile-test-1");
  assert.equal(capture.kind, "manual");
  assert.equal(capture.product, "generic");
  assert.equal(capture.client, "mobile");
  assert.equal(capture.mode, "generic");
  assert.equal(capture.captureMethod, "manual");
  assert.equal(capture.fidelity, "partial-visible");
  assert.equal(capture.retention, "review-window");
  assert.equal(capture.subject, "project:topo");
  assert.deepEqual(capture.turns, [
    {
      id: "mobile-u1",
      role: "user",
      content: "The user explicitly selected this useful context.",
    },
  ]);
  assert.deepEqual(capture.metadata, {
    selectionLength: 48,
    "topo.mobile.shareKind": "selected-content",
    "topo.mobile.sourceApp": "com.example.notes",
  });
  assert.equal("memoryPage" in capture, false);
});

test("Remember this rejects empty or extraction-oversized selected text", () => {
  assert.throws(
    () => createMobileRememberCapture({ text: "   " }),
    /requires selected text/,
  );
  assert.throws(
    () => createMobileRememberCapture({ text: "x".repeat(5_001) }),
    /at most 5000 characters/,
  );
});
