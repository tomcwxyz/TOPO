import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmMemoryPage,
  proposeMemoryPage,
} from "../../core/dist/index.js";
import {
  SqliteMemoryPageStore,
  SqliteMemoryStore,
} from "../dist/index.js";

const time1 = "2026-09-09T20:00:00.000Z";
const time2 = "2026-09-09T20:01:00.000Z";

function source() {
  return {
    id: "source-1",
    type: "conversation",
    title: "Memory Page test",
    provider: "example",
    capturedAt: time1,
    createdAt: time1,
    sensitivity: "ordinary",
  };
}

function proposed(eventId = "memory-event-1") {
  return proposeMemoryPage(
    {
      id: "memory-1",
      subject: "self",
      title: "RACK architecture",
      body: "RACK uses Neon rather than Supabase.",
      tags: ["rack"],
      sensitivity: "ordinary",
      horizon: "project",
      origin: "extracted",
      sourceRefs: [{ sourceId: "source-1", evidence: "Use Neon." }],
    },
    {
      now: time1,
      eventId,
      actor: { type: "agent", id: "capture" },
    },
  );
}

test("Memory Pages persist alongside the existing claim/source store", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-pages-"));
  const path = join(directory, "memory.sqlite");

  try {
    const claims = new SqliteMemoryStore(path);
    claims.putSource(source());
    assert.equal(claims.schemaVersion(), 1);
    claims.close();

    const pages = new SqliteMemoryPageStore(path);
    assert.equal(pages.memoryPageSchemaVersion(), 1);
    pages.applyMemoryPageTransition(proposed());
    assert.equal(pages.getMemoryPage("memory-1").body, "RACK uses Neon rather than Supabase.");
    assert.equal(pages.listMemoryPages({ status: "candidate" }).length, 1);
    assert.equal(pages.listMemoryPageEvents({ entityId: "memory-1" }).length, 1);
    pages.close();

    const reopenedClaims = new SqliteMemoryStore(path);
    assert.equal(reopenedClaims.schemaVersion(), 1);
    assert.equal(reopenedClaims.getSource("source-1").title, "Memory Page test");
    reopenedClaims.close();

    const reopenedPages = new SqliteMemoryPageStore(path);
    assert.equal(reopenedPages.getMemoryPage("memory-1").origin, "extracted");
    reopenedPages.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Memory Page transition writes page and event atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-pages-atomic-"));
  const path = join(directory, "memory.sqlite");

  try {
    const claims = new SqliteMemoryStore(path);
    claims.putSource(source());
    claims.close();

    const pages = new SqliteMemoryPageStore(path);
    const first = proposed("memory-event-1");
    pages.applyMemoryPageTransition(first);

    const confirmed = confirmMemoryPage(first.page, {
      now: time2,
      eventId: "memory-event-1",
      actor: { type: "user" },
    });

    assert.throws(() => pages.applyMemoryPageTransition(confirmed));
    assert.equal(pages.getMemoryPage("memory-1").status, "candidate");
    assert.equal(pages.listMemoryPageEvents({ entityId: "memory-1" }).length, 1);
    pages.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Memory Page source references must resolve to existing TOPO Sources", () => {
  const directory = mkdtempSync(join(tmpdir(), "topo-pages-source-"));
  const path = join(directory, "memory.sqlite");

  try {
    const claims = new SqliteMemoryStore(path);
    claims.close();

    const pages = new SqliteMemoryPageStore(path);
    assert.throws(() => pages.applyMemoryPageTransition(proposed()), /missing source/);
    assert.equal(pages.getMemoryPage("memory-1"), undefined);
    pages.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
