import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function scoreCaptureEvaluation(evaluation) {
  const expected = new Set(evaluation.expectedKeys ?? []);
  const proposed = new Set(evaluation.proposedKeys ?? []);
  const accepted = new Set(evaluation.acceptedKeys ?? []);

  const truePositives = [...proposed].filter((key) => expected.has(key)).length;
  const falsePositives = [...proposed].filter((key) => !expected.has(key)).length;
  const missed = [...expected].filter((key) => !proposed.has(key)).length;

  const precision = proposed.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositives / proposed.size;
  const recall = expected.size === 0 ? 1 : truePositives / expected.size;
  const memoryYield = proposed.size === 0 ? 1 : accepted.size / proposed.size;
  const overreachRate = proposed.size === 0 ? 0 : falsePositives / proposed.size;
  const duplicateRate = evaluation.candidatesShown > 0
    ? (evaluation.duplicateCandidates ?? 0) / evaluation.candidatesShown
    : 0;
  const reviewSecondsPerAccepted = accepted.size > 0
    ? (evaluation.reviewSeconds ?? 0) / accepted.size
    : null;

  return {
    expected: expected.size,
    proposed: proposed.size,
    accepted: accepted.size,
    truePositives,
    falsePositives,
    missed,
    precision,
    recall,
    memoryYield,
    overreachRate,
    duplicateRate,
    reviewSecondsPerAccepted,
  };
}

export function formatScore(score) {
  const percent = (value) => `${Math.round(value * 1000) / 10}%`;
  return [
    `precision: ${percent(score.precision)}`,
    `recall: ${percent(score.recall)}`,
    `memory yield: ${percent(score.memoryYield)}`,
    `overreach: ${percent(score.overreachRate)}`,
    `duplicate rate: ${percent(score.duplicateRate)}`,
    score.reviewSecondsPerAccepted === null
      ? "review seconds / accepted: n/a"
      : `review seconds / accepted: ${Math.round(score.reviewSecondsPerAccepted * 10) / 10}`,
  ].join("\n");
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/score-capture-eval.mjs <evaluation.json>");
    process.exitCode = 1;
  } else {
    const evaluation = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const score = scoreCaptureEvaluation(evaluation);
    console.log(formatScore(score));
    console.log(JSON.stringify(score));
  }
}
