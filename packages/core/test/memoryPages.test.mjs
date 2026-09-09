import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmMemoryPage,
  editCandidateMemoryPage,
  proposeCompatibilityPageFromClaim,
  proposeMemoryPage,
} from "../dist/index.js";

const time1 = "2026-09-09T20:00:00.000Z";
const time2 = "2026-09-09T20:01:00.000Z";

function proposedPage() {
  return proposeMemoryPage(
    {
      id: "memory-1",
      subject: "self",
      title: "RACK architecture",
      body: "RACK uses Neon rather than Supabase.",
      tags: ["rack", "architecture"],
      sensitivity: "ordinary",
      horizon: "project",
      origin: "extracted",
      sourceRefs: [
        {
          sourceId: "source-1",
          evidence: "not Supabase, use Neon",
          turnIds: ["turn-1"],
        },
      ],
    },
    {
      now: time1,
      eventId: "memory-event-1",
      actor: { type: "agent", id: "capture" },
    },
  );
}

test("Memory Page lifecycle keeps prose canonical and review authority explicit", () => {
  const proposed = proposedPage();
  assert.equal(proposed.page.status, "candidate");
  assert.equal(proposed.page.revision, 1);
  assert.equal(proposed.event.type, "memory.proposed");

  const edited = editCandidateMemoryPage(
    proposed.page,
    {
      body: "RACK deliberately uses Neon rather than Supabase.",
      summary: "Neon is an intentional RACK architecture choice.",
    },
    {
      now: time2,
      eventId: "memory-event-2",
      actor: { type: "user" },
    },
  );

  assert.equal(edited.page.revision, 2);
  assert.equal(edited.event.type, "memory.edited");
  assert.match(edited.page.body, /deliberately uses Neon/);

  const confirmed = confirmMemoryPage(edited.page, {
    now: "2026-09-09T20:02:00.000Z",
    eventId: "memory-event-3",
    actor: { type: "user" },
  });

  assert.equal(confirmed.page.status, "confirmed");
  assert.equal(confirmed.page.revision, 3);
});

test("Memory Page confirmation remains user-governed by default", () => {
  const proposed = proposedPage();
  assert.throws(() =>
    confirmMemoryPage(proposed.page, {
      now: time2,
      eventId: "memory-event-2",
      actor: { type: "agent", id: "capture" },
    }),
  );
});

test("existing Claims can become provisional compatibility pages without becoming evidence", () => {
  const page = proposeCompatibilityPageFromClaim(
    {
      id: "claim-1",
      subject: "self",
      key: "rack.database",
      value: "Neon",
      tags: ["rack"],
      epistemicType: "assertion",
      confidence: 1,
      provenance: {
        sourceType: "conversation",
        sourceId: "source-1",
        evidence: "Use Neon, not Supabase.",
        capturedAt: time1,
      },
      status: "confirmed",
      sensitivity: "ordinary",
      supersedes: [],
      createdAt: time1,
      updatedAt: time1,
    },
    {
      id: "memory-compat-1",
      now: time2,
      title: "RACK database choice",
      horizon: "project",
    },
  );

  assert.equal(page.status, "candidate");
  assert.equal(page.origin, "compatibility");
  assert.deepEqual(page.annotationIds, ["claim-1"]);
  assert.deepEqual(page.sourceRefs, [
    { sourceId: "source-1", evidence: "Use Neon, not Supabase." },
  ]);
  assert.equal(page.body, "rack.database: Neon");
});
