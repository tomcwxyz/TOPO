import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmClaim,
  confirmMemoryPage,
  proposeClaim,
  proposeMemoryPage,
} from "../../core/dist/index.js";
import {
  SqliteMemoryPageStore,
  SqliteMemoryStore,
} from "../../store-node/dist/index.js";
import {
  parsePortableBundle,
  serializePortableBundle,
} from "../dist/portableBundle.js";
import {
  exportPortableBundleFromStores,
  importPortableBundleToStores,
  PortableBundleConflictError,
} from "../dist/portableStore.js";

const time1 = "2026-09-09T20:00:00.000Z";
const time2 = "2026-09-09T20:01:00.000Z";
const time3 = "2026-09-09T20:02:00.000Z";
const time4 = "2026-09-09T20:03:00.000Z";
const time5 = "2026-09-09T20:04:00.000Z";

function source() {
  return {
    id: "source-1",
    type: "conversation",
    title: "RACK architecture discussion",
    provider: "example",
    capturedAt: time1,
    createdAt: time1,
    sensitivity: "ordinary",
  };
}

function openStores(path) {
  const memory = new SqliteMemoryStore(path);
  const pages = new SqliteMemoryPageStore(path);
  return { memory, pages };
}

function closeStores(stores) {
  stores.pages.close();
  stores.memory.close();
}

function seed(stores) {
  stores.memory.putSource(source());

  const proposedClaim = proposeClaim(
    {
      id: "claim-1",
      subject: "self",
      key: "rack.database",
      value: "Neon",
      tags: ["rack", "architecture"],
      epistemicType: "assertion",
      confidence: 1,
      provenance: {
        sourceType: "conversation",
        sourceId: "source-1",
        evidence: "Use Neon, not Supabase.",
        capturedAt: time1,
      },
      sensitivity: "ordinary",
    },
    {
      now: time1,
      eventId: "claim-event-1",
      actor: { type: "agent", id: "capture" },
    },
  );
  stores.memory.applyTransition(proposedClaim);
  stores.memory.applyTransition(
    confirmClaim(proposedClaim.claim, {
      now: time2,
      eventId: "claim-event-2",
      actor: { type: "user" },
    }),
  );

  const proposedPage = proposeMemoryPage(
    {
      id: "memory-1",
      subject: "self",
      title: "RACK architecture",
      summary: "Neon is an intentional RACK architecture choice.",
      body: "RACK uses Neon rather than Supabase. Future architecture work should preserve that choice unless it is deliberately revisited.",
      tags: ["rack", "architecture"],
      sensitivity: "ordinary",
      horizon: "project",
      origin: "extracted",
      sourceRefs: [
        {
          sourceId: "source-1",
          evidence: "Use Neon, not Supabase.",
        },
      ],
      annotationIds: ["claim-1"],
    },
    {
      now: time3,
      eventId: "memory-event-1",
      actor: { type: "agent", id: "capture" },
    },
  );
  stores.pages.applyMemoryPageTransition(proposedPage);
  stores.pages.applyMemoryPageTransition(
    confirmMemoryPage(proposedPage.page, {
      now: time4,
      eventId: "memory-event-2",
      actor: { type: "user" },
    }),
  );
}

test("portable bundle v0.2 round-trips the actual split alpha stores", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "topo-portable-source-"));
  const destinationDir = mkdtempSync(join(tmpdir(), "topo-portable-destination-"));
  const sourceStores = openStores(join(sourceDir, "topo.sqlite"));
  const destinationStores = openStores(join(destinationDir, "topo.sqlite"));

  try {
    seed(sourceStores);
    const bundle = exportPortableBundleFromStores(sourceStores, time5);
    const parsed = parsePortableBundle(serializePortableBundle(bundle));
    importPortableBundleToStores(destinationStores, parsed);

    assert.deepEqual(
      destinationStores.memory.listSources(),
      sourceStores.memory.listSources(),
    );
    assert.deepEqual(
      destinationStores.memory.listClaims(),
      sourceStores.memory.listClaims(),
    );
    assert.deepEqual(
      destinationStores.memory.listEvents(),
      sourceStores.memory.listEvents(),
    );
    assert.deepEqual(
      destinationStores.pages.listMemoryPages(),
      sourceStores.pages.listMemoryPages(),
    );
    assert.deepEqual(
      destinationStores.pages.listMemoryPageEvents(),
      sourceStores.pages.listMemoryPageEvents(),
    );
  } finally {
    closeStores(sourceStores);
    closeStores(destinationStores);
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(destinationDir, { recursive: true, force: true });
  }
});

test("portable import preflights every namespace before modifying the destination", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "topo-portable-source-"));
  const destinationDir = mkdtempSync(join(tmpdir(), "topo-portable-destination-"));
  const sourceStores = openStores(join(sourceDir, "topo.sqlite"));
  const destinationStores = openStores(join(destinationDir, "topo.sqlite"));

  try {
    seed(sourceStores);
    const bundle = exportPortableBundleFromStores(sourceStores, time5);
    destinationStores.memory.putSource(source());

    assert.throws(
      () => importPortableBundleToStores(destinationStores, bundle),
      PortableBundleConflictError,
    );

    assert.equal(destinationStores.memory.listClaims().length, 0);
    assert.equal(destinationStores.memory.listEvents().length, 0);
    assert.equal(destinationStores.pages.listMemoryPages().length, 0);
    assert.equal(destinationStores.pages.listMemoryPageEvents().length, 0);
  } finally {
    closeStores(sourceStores);
    closeStores(destinationStores);
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(destinationDir, { recursive: true, force: true });
  }
});
