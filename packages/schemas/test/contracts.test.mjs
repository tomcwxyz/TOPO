import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  memoryClaimSchema,
  memoryEventSchema,
  memorySourceSchema,
} from "../dist/index.js";

const fixtures = fileURLToPath(
  new URL("../../../test-fixtures/domain/", import.meta.url),
);

function read(name) {
  return JSON.parse(readFileSync(new URL(name, `file://${fixtures}/`), "utf8"));
}

test("TypeScript accepts the shared source fixture", () => {
  assert.equal(memorySourceSchema.safeParse(read("source-conversation.json")).success, true);
});

test("TypeScript accepts the shared preference claim fixture", () => {
  assert.equal(memoryClaimSchema.safeParse(read("claim-preference.json")).success, true);
});

test("TypeScript preserves inference as an explicit epistemic type", () => {
  const result = memoryClaimSchema.parse(read("claim-inference.json"));
  assert.equal(result.epistemicType, "inference");
  assert.equal(result.status, "candidate");
});

test("TypeScript accepts the shared event fixture", () => {
  assert.equal(memoryEventSchema.safeParse(read("event-confirmed.json")).success, true);
});
