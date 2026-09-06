import assert from "node:assert/strict";
import test from "node:test";
import { scoreCaptureEvaluation } from "./score-capture-eval.mjs";

test("scores useful capture separately from raw extraction volume", () => {
  const score = scoreCaptureEvaluation({
    expectedKeys: ["writing.locale", "project.database", "project.release.preference"],
    proposedKeys: ["writing.locale", "project.database", "conversation.topic"],
    acceptedKeys: ["writing.locale", "project.database"],
    candidatesShown: 4,
    duplicateCandidates: 1,
    reviewSeconds: 30,
  });

  assert.equal(score.truePositives, 2);
  assert.equal(score.falsePositives, 1);
  assert.equal(score.missed, 1);
  assert.equal(score.precision, 2 / 3);
  assert.equal(score.recall, 2 / 3);
  assert.equal(score.memoryYield, 2 / 3);
  assert.equal(score.overreachRate, 1 / 3);
  assert.equal(score.duplicateRate, 1 / 4);
  assert.equal(score.reviewSecondsPerAccepted, 15);
});

test("empty clean conversations do not count as extraction failures", () => {
  const score = scoreCaptureEvaluation({
    expectedKeys: [],
    proposedKeys: [],
    acceptedKeys: [],
    candidatesShown: 0,
    duplicateCandidates: 0,
    reviewSeconds: 0,
  });

  assert.equal(score.precision, 1);
  assert.equal(score.recall, 1);
  assert.equal(score.memoryYield, 1);
  assert.equal(score.overreachRate, 0);
});
