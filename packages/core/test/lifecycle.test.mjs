import test from "node:test";
import assert from "node:assert/strict";
import {
  InvalidTransitionError,
  ValidationError,
  confirmClaim,
  editCandidateClaim,
  expireClaim,
  proposeClaim,
  rejectClaim,
  supersedeClaim,
  validateClaim,
} from "../dist/index.js";

const time1 = "2026-08-30T17:30:00.000Z";
const time2 = "2026-08-30T17:31:00.000Z";
const time3 = "2026-08-30T17:32:00.000Z";

function candidate(overrides = {}) {
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
        sourceId: "conversation-1",
        evidence: "Please use British English.",
        capturedAt: time1,
      },
      sensitivity: "ordinary",
      ...overrides,
    },
    {
      now: time1,
      eventId: "event-1",
      actor: { type: "agent", id: "capture" },
    },
  );
}

test("machine proposals are candidates, not confirmed memory", () => {
  const result = candidate();
  assert.equal(result.claim.status, "candidate");
  assert.equal(result.event.type, "claim.proposed");
  assert.equal(result.event.actor.type, "agent");
});

test("confirmation preserves epistemic type instead of turning an inference into fact", () => {
  const proposed = candidate({ epistemicType: "inference", confidence: 0.99 });
  const confirmed = confirmClaim(proposed.claim, {
    now: time2,
    eventId: "event-2",
    actor: { type: "user" },
  });

  assert.equal(confirmed.claim.status, "confirmed");
  assert.equal(confirmed.claim.epistemicType, "inference");
  assert.equal(confirmed.event.data.fromStatus, "candidate");
});

test("a user can edit a candidate without losing its epistemic type or provenance", () => {
  const proposed = candidate({ epistemicType: "inference", confidence: 0.6 });
  const edited = editCandidateClaim(
    proposed.claim,
    {
      value: "software architecture",
      confidence: 0.75,
      category: "work",
    },
    {
      now: time2,
      eventId: "event-edit",
      actor: { type: "user" },
    },
  );

  assert.equal(edited.claim.status, "candidate");
  assert.equal(edited.claim.epistemicType, "inference");
  assert.equal(edited.claim.value, "software architecture");
  assert.equal(edited.claim.confidence, 0.75);
  assert.equal(edited.claim.category, "work");
  assert.equal(
    edited.claim.provenance.sourceId,
    proposed.claim.provenance.sourceId,
  );
  assert.equal(edited.event.type, "claim.edited");
  assert.deepEqual(edited.event.data.changes.value, {
    from: "en-GB",
    to: "software architecture",
  });
});

test("candidate edits require a user and an actual change", () => {
  const proposed = candidate();

  assert.throws(
    () =>
      editCandidateClaim(
        proposed.claim,
        { value: "en-US" },
        {
          now: time2,
          eventId: "event-edit",
          actor: { type: "agent" },
        },
      ),
    InvalidTransitionError,
  );

  assert.throws(
    () =>
      editCandidateClaim(
        proposed.claim,
        { value: "en-GB" },
        {
          now: time2,
          eventId: "event-edit",
          actor: { type: "user" },
        },
      ),
    InvalidTransitionError,
  );
});

test("an agent cannot confirm a candidate under the default trust model", () => {
  const proposed = candidate();

  assert.throws(
    () =>
      confirmClaim(proposed.claim, {
        now: time2,
        eventId: "event-2",
        actor: { type: "agent" },
      }),
    InvalidTransitionError,
  );
});

test("rejection is a terminal review decision for the candidate", () => {
  const proposed = candidate();
  const rejected = rejectClaim(proposed.claim, {
    now: time2,
    eventId: "event-2",
    actor: { type: "user" },
  });

  assert.equal(rejected.claim.status, "rejected");
  assert.throws(
    () =>
      confirmClaim(rejected.claim, {
        now: time3,
        eventId: "event-3",
        actor: { type: "user" },
      }),
    InvalidTransitionError,
  );
});

test("confirmed claims can expire", () => {
  const proposed = candidate();
  const confirmed = confirmClaim(proposed.claim, {
    now: time2,
    eventId: "event-2",
    actor: { type: "user" },
  });
  const expired = expireClaim(confirmed.claim, {
    now: time3,
    eventId: "event-3",
    actor: { type: "system" },
  });

  assert.equal(expired.claim.status, "expired");
  assert.equal(expired.event.type, "claim.expired");
});

test("supersession requires a confirmed replacement that explicitly references the old claim", () => {
  const oldProposed = candidate({ id: "old", value: "Supabase" });
  const oldConfirmed = confirmClaim(oldProposed.claim, {
    now: time2,
    eventId: "event-old",
    actor: { type: "user" },
  });

  const replacementProposed = candidate({
    id: "new",
    value: "Neon",
    supersedes: ["old"],
  });
  const replacementConfirmed = confirmClaim(replacementProposed.claim, {
    now: time2,
    eventId: "event-new",
    actor: { type: "user" },
  });

  const superseded = supersedeClaim(
    oldConfirmed.claim,
    replacementConfirmed.claim,
    {
      now: time3,
      eventId: "event-supersede",
      actor: { type: "user" },
    },
  );

  assert.equal(superseded.claim.status, "superseded");
  assert.equal(superseded.event.data.replacementId, "new");
});

test("runtime validation rejects confidence outside 0..1", () => {
  const invalid = candidate().claim;
  invalid.confidence = 1.5;

  assert.throws(() => validateClaim(invalid), ValidationError);
});

test("runtime validation rejects non-JSON memory values", () => {
  const invalid = candidate().claim;
  invalid.value = /** @type {any} */ (() => "nope");

  assert.throws(() => validateClaim(invalid), ValidationError);
});
