import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MEMORY_PAGE_MARKDOWN_FORMAT,
  memoryPageFilename,
  parseMemoryPageMarkdown,
  renderMemoryPageMarkdown,
} from "../dist/memoryMarkdown.js";

const fixtures = fileURLToPath(
  new URL("../../../test-fixtures/domain/", import.meta.url),
);

function memoryPageFixture() {
  return JSON.parse(
    readFileSync(new URL("memory-page-project.json", `file://${fixtures}/`), "utf8"),
  );
}

test("Memory Page Markdown round-trips identity, governance, provenance and prose", () => {
  const original = memoryPageFixture();
  const markdown = renderMemoryPageMarkdown(original);
  const parsed = parseMemoryPageMarkdown(markdown);

  assert.deepEqual(parsed, original);
  assert.match(markdown, /^---\ntopo: "topo\.memory-page\/0\.1"/);
  assert.match(markdown, /source_refs: \[/);
  assert.match(markdown, /\n---\n\nRACK uses Neon rather than Supabase\./);
});

test("Memory Page Markdown is deterministic", () => {
  const page = memoryPageFixture();
  assert.equal(renderMemoryPageMarkdown(page), renderMemoryPageMarkdown(page));
});

test("portable filename remains readable while retaining stable identity", () => {
  const page = memoryPageFixture();
  assert.equal(
    memoryPageFilename(page),
    "rack-architecture--memory-1.md",
  );
});

test("parser rejects files without TOPO Memory Page identity", () => {
  assert.throws(
    () => parseMemoryPageMarkdown("---\nid: \"memory-1\"\n---\n\nHello\n"),
    /Missing Memory Page frontmatter key: topo/,
  );
});

test("parser rejects unknown future format versions rather than guessing", () => {
  const markdown = renderMemoryPageMarkdown(memoryPageFixture()).replace(
    JSON.stringify(MEMORY_PAGE_MARKDOWN_FORMAT),
    JSON.stringify("topo.memory-page/9.9"),
  );
  assert.throws(() => parseMemoryPageMarkdown(markdown), /Unsupported Memory Page Markdown format/);
});

test("parser rejects unknown frontmatter keys so governance is not silently lost", () => {
  const markdown = renderMemoryPageMarkdown(memoryPageFixture()).replace(
    "status: \"confirmed\"",
    "status: \"confirmed\"\nsecret_policy: \"ignore\"",
  );
  assert.throws(() => parseMemoryPageMarkdown(markdown), /Unknown Memory Page frontmatter key/);
});
