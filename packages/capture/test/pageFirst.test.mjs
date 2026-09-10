import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MEMORY_PAGE_PROPOSALS,
  buildMemoryPageExtractionPrompt,
  compareMemoryPageProposal,
  extractMemoryPageProposals,
  preparePageFirstCaptureBatch,
} from "../dist/pageFirst.js";

const interaction = {
  id: "capture-page-1",
  kind: "conversation",
  product: "chatgpt",
  client: "web",
  mode: "work",
  captureMethod: "browser-extension",
  fidelity: "conversation-turns",
  provider: "openai",
  subject: "self",
  title: "RACK architecture",
  capturedAt: "2026-09-10T05:30:00.000Z",
  turns: [
    {
      id: "u1",
      role: "user",
      content: "RACK uses Neon rather than Supabase. Keep local projects account-free.",
    },
    {
      id: "a1",
      role: "assistant",
      content: "I will keep that architecture in mind.",
    },
  ],
};

const rackProposal = {
  title: "RACK architecture decisions",
  summary: "Keep the managed and local architecture deliberately distinct.",
  body: "RACK uses Neon rather than Supabase. Managed work can use Neon-backed services, while local projects should remain account-free.",
  category: "rack",
  tags: ["rack", "architecture"],
  sensitivity: "ordinary",
  horizon: "project",
  evidenceTurnIds: ["u1"],
  evidence: "RACK uses Neon rather than Supabase.",
  annotations: [
    {
      key: "rack.database",
      value: "Neon",
      epistemicType: "assertion",
      confidence: 0.99,
    },
  ],
};

function existingPage(overrides = {}) {
  return {
    id: "memory-existing",
    subject: "self",
    title: "RACK architecture decisions",
    body: "RACK uses Neon rather than Supabase. Managed work can use Neon-backed services, while local projects should remain account-free.",
    category: "rack",
    tags: ["rack", "architecture"],
    status: "confirmed",
    sensitivity: "ordinary",
    horizon: "project",
    origin: "manual",
    sourceRefs: [{ sourceId: "source-old", evidence: "Existing evidence" }],
    annotationIds: [],
    supersedes: [],
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("page-first prompt asks for coherent prose rather than atomic fact volume", () => {
  const prompt = buildMemoryPageExtractionPrompt();
  assert.match(prompt, /primary memory object is a short prose Memory Page/);
  assert.match(prompt, /prefer fewer/);
  assert.match(prompt, /Do not split closely related context/);
  assert.match(prompt, /include structured annotations when/);
  assert.match(prompt, new RegExp(`at most ${MAX_MEMORY_PAGE_PROPOSALS}`));
});

test("provider contract validates user-grounded Memory Page proposals", async () => {
  const proposals = await extractMemoryPageProposals(
    {
      id: "test-provider",
      extract: ({ prompt, interaction: normalised }) => {
        assert.match(prompt, /Memory Page/);
        assert.equal(normalised.turns.length, 2);
        return { proposals: [rackProposal] };
      },
    },
    interaction,
  );

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].title, "RACK architecture decisions");
  assert.equal(proposals[0].annotations.length, 1);
});

test("page evidence must be present in a cited user turn", async () => {
  await assert.rejects(
    () =>
      extractMemoryPageProposals(
        {
          id: "bad-evidence",
          extract: () => ({
            proposals: [
              {
                ...rackProposal,
                evidence: "This sentence was never said by the user.",
              },
            ],
          }),
        },
        interaction,
      ),
    /evidence is not present/,
  );
});

test("assistant-only evidence cannot ground a Memory Page", async () => {
  await assert.rejects(
    () =>
      extractMemoryPageProposals(
        {
          id: "assistant-evidence",
          extract: () => ({
            proposals: [
              {
                ...rackProposal,
                evidenceTurnIds: ["a1"],
                evidence: "I will keep that architecture in mind.",
              },
            ],
          }),
        },
        interaction,
      ),
    /user-authored/,
  );
});

test("extractor cannot spray an interaction into too many Memory Pages", async () => {
  await assert.rejects(
    () =>
      extractMemoryPageProposals(
        {
          id: "spray",
          extract: () => ({
            proposals: Array.from(
              { length: MAX_MEMORY_PAGE_PROPOSALS + 1 },
              (_, index) => ({ ...rackProposal, title: `Page ${index}` }),
            ),
          }),
        },
        interaction,
      ),
    /maximum is/,
  );
});

test("comparison distinguishes duplicates, supporting evidence, changes and new context", () => {
  assert.equal(
    compareMemoryPageProposal("self", rackProposal, [existingPage()]).comparison,
    "duplicate",
  );

  const supporting = {
    ...rackProposal,
    title: "RACK architecture",
    body: "RACK uses Neon rather than Supabase, and local projects remain account-free.",
  };
  assert.equal(
    compareMemoryPageProposal("self", supporting, [existingPage()]).comparison,
    "supporting-evidence",
  );

  const change = {
    ...rackProposal,
    body: "RACK should move managed data from Neon to a different database while retaining the same project architecture boundary.",
  };
  assert.equal(
    compareMemoryPageProposal("self", change, [existingPage()]).comparison,
    "potential-change",
  );

  const newContext = {
    ...rackProposal,
    title: "Workshop facilitation preferences",
    body: "Prefer practical workshop sessions with time for participants to explore independently.",
    category: "facilitation",
    tags: ["workshops"],
  };
  assert.equal(
    compareMemoryPageProposal("self", newContext, [existingPage()]).comparison,
    "new",
  );
});

test("batch suppresses exact duplicates but keeps reviewable changes and annotation drafts", () => {
  let sequence = 0;
  const changed = {
    ...rackProposal,
    body: "RACK should use Postgres through Neon and keep local projects account-free, but the managed authentication approach may change.",
  };
  const batch = preparePageFirstCaptureBatch(
    interaction,
    [rackProposal, changed],
    [existingPage()],
    {
      now: "2026-09-10T05:31:00.000Z",
      actor: { type: "agent", id: "capture-extractor" },
      extractor: "ollama:qwen3:4b",
      createId: (prefix) => `${prefix}-${++sequence}`,
    },
  );

  assert.equal(batch.duplicateProposalsSuppressed, 1);
  assert.equal(batch.pageTransitions.length, 1);
  const transition = batch.pageTransitions[0];
  assert.equal(transition.page.status, "candidate");
  assert.deepEqual(transition.page.supersedes, ["memory-existing"]);
  assert.equal(transition.page.annotationIds.length, 0);
  assert.equal(transition.event.data.comparison, "potential-change");
  assert.equal(transition.event.data.extractor, "ollama:qwen3:4b");
  assert.equal(transition.event.data.proposedAnnotations.length, 1);
  assert.equal(batch.source.metadata["topo.capture.representation"], "memory-page");
});

test("incomplete capture cannot add inferred structured annotations", () => {
  let sequence = 0;
  assert.throws(
    () =>
      preparePageFirstCaptureBatch(
        { ...interaction, fidelity: "partial-visible" },
        [
          {
            ...rackProposal,
            annotations: [
              {
                key: "rack.pattern",
                value: "local-first",
                epistemicType: "inference",
                confidence: 0.7,
              },
            ],
          },
        ],
        [],
        {
          now: "2026-09-10T05:31:00.000Z",
          actor: { type: "agent", id: "capture-extractor" },
          createId: (prefix) => `${prefix}-${++sequence}`,
        },
      ),
    /cannot propose inferred annotation/,
  );
});
