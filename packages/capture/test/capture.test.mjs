import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCaptureExtractionPrompt,
  compareProposalToConfirmedClaims,
  normaliseCapturedInteraction,
  prepareCaptureBatch,
} from "../dist/index.js";

const baseInteraction = {
  id: "capture-1",
  kind: "conversation",
  product: "chatgpt",
  client: "web",
  mode: "chat",
  provider: "openai",
  subject: "self",
  title: "TOPO planning",
  capturedAt: "2026-08-31T20:00:00.000Z",
  turns: [
    {
      id: "u1",
      role: "user",
      content: "  Please use British English in future.  ",
    },
    {
      id: "a1",
      role: "assistant",
      content: "Understood.",
    },
    {
      id: "empty",
      role: "assistant",
      content: "   ",
    },
  ],
};

test("normaliseCapturedInteraction trims content and drops empty turns", () => {
  const interaction = normaliseCapturedInteraction(baseInteraction);
  assert.equal(interaction.turns.length, 2);
  assert.equal(interaction.turns[0].content, "Please use British English in future.");
  assert.equal(interaction.retention, "review-window");
  assert.equal(interaction.product, "chatgpt");
  assert.equal(interaction.client, "web");
  assert.equal(interaction.mode, "chat");
});

test("capture proposals become governed candidates with user evidence", () => {
  let sequence = 0;
  const batch = prepareCaptureBatch(
    baseInteraction,
    [
      {
        key: "writing.locale",
        value: "en-GB",
        category: "writing",
        epistemicType: "preference",
        confidence: 0.99,
        evidenceTurnIds: ["u1"],
        evidence: "Please use British English in future.",
        horizon: "durable",
      },
    ],
    {
      now: "2026-08-31T20:01:00.000Z",
      actor: { type: "agent", id: "capture-extractor" },
      createId: (prefix) => `${prefix}-${++sequence}`,
    },
  );

  assert.equal(batch.transitions.length, 1);
  assert.equal(batch.transitions[0].claim.status, "candidate");
  assert.equal(batch.transitions[0].claim.provenance.sourceId, batch.source.id);
  assert.deepEqual(
    batch.source.metadata["topo.capture.evidenceTurns"].map((turn) => turn.id),
    ["u1"],
  );
  assert.equal(batch.source.metadata["topo.capture.turns"], undefined);
  assert.equal(batch.source.metadata["topo.capture.product"], "chatgpt");
  assert.equal(batch.source.metadata["topo.capture.client"], "web");
  assert.equal(batch.source.metadata["topo.capture.mode"], "chat");
});

test("assistant-only evidence cannot create a memory proposal", () => {
  let sequence = 0;
  assert.throws(
    () =>
      prepareCaptureBatch(
        baseInteraction,
        [
          {
            key: "writing.locale",
            value: "en-GB",
            epistemicType: "inference",
            confidence: 0.7,
            evidenceTurnIds: ["a1"],
            evidence: "Understood.",
          },
        ],
        {
          now: "2026-08-31T20:01:00.000Z",
          actor: { type: "agent", id: "capture-extractor" },
          createId: (prefix) => `${prefix}-${++sequence}`,
        },
      ),
    /user-authored/,
  );
});

test("exactly repeated memory is treated as supporting evidence", () => {
  const result = compareProposalToConfirmedClaims(
    {
      key: "writing.locale",
      value: "en-GB",
      epistemicType: "preference",
      confidence: 0.9,
      evidenceTurnIds: ["u1"],
      evidence: "British English",
    },
    [
      {
        id: "claim-existing",
        subject: "self",
        key: "writing.locale",
        value: "en-GB",
        tags: [],
        epistemicType: "preference",
        confidence: 1,
        provenance: {
          sourceType: "manual",
          capturedAt: "2026-08-01T00:00:00.000Z",
        },
        status: "confirmed",
        sensitivity: "ordinary",
        supersedes: [],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  );

  assert.equal(result, "supporting-evidence");
});

test("extraction prompt is conservative about questions and agent output", () => {
  const prompt = buildCaptureExtractionPrompt();
  assert.match(prompt, /Questions are weak evidence/);
  assert.match(prompt, /user-authored evidence/);
  assert.match(prompt, /candidate memories only/);
});
