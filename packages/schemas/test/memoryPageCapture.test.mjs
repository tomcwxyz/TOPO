import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  extractedMemoryPageProposalSchema,
  memoryPageAnnotationProposalSchema,
} from "../dist/memory-page-capture.js";

const fixtures = fileURLToPath(
  new URL("../../../test-fixtures/domain/", import.meta.url),
);

function read(name) {
  return JSON.parse(readFileSync(new URL(name, `file://${fixtures}/`), "utf8"));
}

test("TypeScript accepts the shared Memory Page proposal fixture", () => {
  const proposal = extractedMemoryPageProposalSchema.parse(
    read("memory-page-proposal-project.json"),
  );
  assert.equal(proposal.title, "RACK architecture decisions");
  assert.equal(proposal.horizon, "project");
  assert.equal(proposal.annotations.length, 1);
  assert.equal(proposal.annotations[0].key, "rack.database");
});

test("annotation proposal requires a bounded confidence", () => {
  const fixture = read("memory-page-proposal-project.json");
  const annotation = { ...fixture.annotations[0], confidence: 1.2 };
  assert.equal(memoryPageAnnotationProposalSchema.safeParse(annotation).success, false);
});

test("Memory Page proposal rejects temporal inversion", () => {
  const fixture = read("memory-page-proposal-project.json");
  const result = extractedMemoryPageProposalSchema.safeParse({
    ...fixture,
    validFrom: "2026-09-10T10:00:00.000Z",
    validUntil: "2026-09-09T10:00:00.000Z",
  });
  assert.equal(result.success, false);
});
