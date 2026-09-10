import { proposeMemoryPage } from "@topo/core";
import type {
  Actor,
  CaptureFidelity,
  CapturedInteraction,
  CapturedTurn,
  JsonValue,
  MemoryEvent,
  MemorySource,
  Sensitivity,
} from "@topo/schemas";
import {
  extractedMemoryPageProposalSchema,
  type ExtractedMemoryPageProposal,
  type MemoryPageAnnotationProposal,
} from "@topo/schemas/memory-page-capture";
import type {
  MemoryPage,
  MemoryPageTransition,
} from "@topo/schemas/memory-page";
import {
  normaliseCapturedInteraction,
  type CapturedInteractionInput,
} from "./index.js";

export const MAX_MEMORY_PAGE_PROPOSALS = 4;

export type MemoryPageProposalComparison =
  | "new"
  | "duplicate"
  | "supporting-evidence"
  | "potential-change";

export interface MemoryPageComparisonResult {
  comparison: MemoryPageProposalComparison;
  relatedMemoryIds: string[];
}

export interface MemoryPageExtractionRequest {
  interaction: CapturedInteraction;
  prompt: string;
}

export interface MemoryPageExtractionProvider {
  readonly id: string;
  extract(request: MemoryPageExtractionRequest): Promise<unknown> | unknown;
}

export interface PageFirstCapturePreparationContext {
  now: string;
  actor: Actor;
  extractor?: string;
  createId: (prefix: "source" | "memory" | "event") => string;
}

export interface PreparedPageFirstCaptureBatch {
  interaction: CapturedInteraction;
  source: MemorySource;
  sourceEvent: MemoryEvent;
  pageTransitions: MemoryPageTransition[];
  comparisons: Array<{
    memoryId: string;
    comparison: MemoryPageProposalComparison;
    relatedMemoryIds: string[];
  }>;
  duplicateProposalsSuppressed: number;
}

const sensitivityRank: Record<Sensitivity, number> = {
  ordinary: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

function jsonSnapshot(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function requireDateTime(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO date-time`);
  }
  return value;
}

function normaliseText(value: string): string {
  return value
    .toLocaleLowerCase("en-GB")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normaliseText(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

function jaccard(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function tagOverlap(left: string[] | undefined, right: string[]): number {
  const a = new Set((left ?? []).map(normaliseText).filter(Boolean));
  const b = new Set(right.map(normaliseText).filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tag of a) {
    if (b.has(tag)) intersection += 1;
  }
  return intersection / Math.min(a.size, b.size);
}

function activeMemoryPages(subject: string, pages: MemoryPage[]): MemoryPage[] {
  return pages.filter(
    (page) =>
      page.subject === subject &&
      (page.status === "candidate" || page.status === "confirmed"),
  );
}

export function compareMemoryPageProposal(
  subject: string,
  proposal: ExtractedMemoryPageProposal,
  pages: MemoryPage[],
): MemoryPageComparisonResult {
  const active = activeMemoryPages(subject, pages);
  const proposalTitle = normaliseText(proposal.title);
  const proposalBody = normaliseText(proposal.body);

  const exact = active.filter(
    (page) =>
      normaliseText(page.title) === proposalTitle &&
      normaliseText(page.body) === proposalBody,
  );
  if (exact.length > 0) {
    return {
      comparison: "duplicate",
      relatedMemoryIds: exact.map((page) => page.id),
    };
  }

  const supporting = active.filter((page) => {
    const bodySimilarity = jaccard(page.body, proposal.body);
    const titleSimilarity = jaccard(page.title, proposal.title);
    const categoryMatches =
      proposal.category !== undefined &&
      page.category !== undefined &&
      normaliseText(proposal.category) === normaliseText(page.category);
    return (
      bodySimilarity >= 0.82 ||
      (titleSimilarity >= 0.75 && bodySimilarity >= 0.62) ||
      (categoryMatches && tagOverlap(proposal.tags, page.tags) >= 0.75 && bodySimilarity >= 0.6)
    );
  });
  if (supporting.length > 0) {
    return {
      comparison: "supporting-evidence",
      relatedMemoryIds: supporting.map((page) => page.id),
    };
  }

  const possibleChanges = active.filter((page) => {
    const sameTitle = normaliseText(page.title) === proposalTitle;
    const strongTitle = jaccard(page.title, proposal.title) >= 0.72;
    const categoryMatches =
      proposal.category !== undefined &&
      page.category !== undefined &&
      normaliseText(proposal.category) === normaliseText(page.category);
    const tagsMatch = tagOverlap(proposal.tags, page.tags) >= 0.5;
    return sameTitle || (strongTitle && (categoryMatches || tagsMatch));
  });

  if (possibleChanges.length > 0) {
    return {
      comparison: "potential-change",
      relatedMemoryIds: possibleChanges.map((page) => page.id),
    };
  }

  return { comparison: "new", relatedMemoryIds: [] };
}

function evidenceTurns(
  interaction: CapturedInteraction,
  proposal: ExtractedMemoryPageProposal,
): CapturedTurn[] {
  const byId = new Map(interaction.turns.map((turn) => [turn.id, turn]));
  return proposal.evidenceTurnIds.map((turnId) => {
    const turn = byId.get(turnId);
    if (turn === undefined) {
      throw new Error(`Memory Page proposal references unknown evidence turn ${turnId}`);
    }
    return turn;
  });
}

function validateProposalAgainstInteraction(
  interaction: CapturedInteraction,
  proposal: ExtractedMemoryPageProposal,
): ExtractedMemoryPageProposal {
  const parsed = extractedMemoryPageProposalSchema.parse(proposal);
  const turns = evidenceTurns(interaction, parsed);
  const userTurns = turns.filter((turn) => turn.role === "user");
  if (userTurns.length === 0) {
    throw new Error(
      `Memory Page proposal '${parsed.title}' is not grounded in a user-authored turn`,
    );
  }

  const evidence = normaliseText(parsed.evidence);
  if (
    evidence.length > 0 &&
    !userTurns.some((turn) => normaliseText(turn.content).includes(evidence))
  ) {
    throw new Error(
      `Memory Page proposal '${parsed.title}' evidence is not present in its cited user turn`,
    );
  }

  const incomplete =
    interaction.fidelity === "task-summary" ||
    interaction.fidelity === "partial-visible";
  if (incomplete) {
    const unsupportedAnnotation = parsed.annotations?.find(
      (annotation) =>
        annotation.epistemicType !== "assertion" &&
        annotation.epistemicType !== "preference",
    );
    if (unsupportedAnnotation !== undefined) {
      throw new Error(
        `${interaction.fidelity} capture cannot propose inferred annotation ${unsupportedAnnotation.key}`,
      );
    }
  }

  return parsed;
}

function parseProviderOutput(value: unknown): ExtractedMemoryPageProposal[] {
  let raw: unknown;
  if (Array.isArray(value)) {
    raw = value;
  } else if (
    typeof value === "object" &&
    value !== null &&
    "proposals" in value
  ) {
    raw = (value as { proposals?: unknown }).proposals;
  } else {
    throw new Error("Memory Page extractor must return an array or { proposals: [...] }");
  }

  if (!Array.isArray(raw)) {
    throw new Error("Memory Page extractor proposals must be an array");
  }
  if (raw.length > MAX_MEMORY_PAGE_PROPOSALS) {
    throw new Error(
      `Memory Page extractor returned ${raw.length} proposals; maximum is ${MAX_MEMORY_PAGE_PROPOSALS}`,
    );
  }
  return raw.map((proposal) => extractedMemoryPageProposalSchema.parse(proposal));
}

export async function extractMemoryPageProposals(
  provider: MemoryPageExtractionProvider,
  rawInteraction: CapturedInteractionInput,
): Promise<ExtractedMemoryPageProposal[]> {
  const interaction = normaliseCapturedInteraction(rawInteraction);
  const prompt = buildMemoryPageExtractionPrompt(interaction.fidelity);
  const output = await provider.extract({ interaction, prompt });
  return parseProviderOutput(output).map((proposal) =>
    validateProposalAgainstInteraction(interaction, proposal),
  );
}

function maximumSensitivity(
  proposals: ExtractedMemoryPageProposal[],
): Sensitivity {
  let maximum: Sensitivity = "ordinary";
  for (const proposal of proposals) {
    const values: Sensitivity[] = [proposal.sensitivity ?? "ordinary"];
    for (const annotation of proposal.annotations ?? []) {
      values.push(annotation.sensitivity ?? proposal.sensitivity ?? "ordinary");
    }
    for (const value of values) {
      if (sensitivityRank[value] > sensitivityRank[maximum]) maximum = value;
    }
  }
  return maximum;
}

function sourceType(interaction: CapturedInteraction): MemorySource["type"] {
  if (interaction.kind === "imported-conversation") return "import";
  if (interaction.kind === "manual") return "manual";
  return "conversation";
}

function sourceMetadata(
  interaction: CapturedInteraction,
  proposals: ExtractedMemoryPageProposal[],
): Record<string, JsonValue> {
  const evidenceIds = new Set(
    proposals.flatMap((proposal) => proposal.evidenceTurnIds),
  );
  const evidence = interaction.turns
    .filter((turn) => evidenceIds.has(turn.id))
    .map((turn) => jsonSnapshot(turn));

  return {
    "topo.capture.kind": interaction.kind,
    "topo.capture.product": interaction.product,
    "topo.capture.client": interaction.client,
    "topo.capture.mode": interaction.mode,
    "topo.capture.method": interaction.captureMethod,
    "topo.capture.fidelity": interaction.fidelity,
    "topo.capture.retention": interaction.retention,
    "topo.capture.turnCount": interaction.turns.length,
    "topo.capture.representation": "memory-page",
    "topo.capture.evidenceTurns": evidence,
    ...(interaction.sourceUrl === undefined
      ? {}
      : { "topo.capture.sourceUrl": interaction.sourceUrl }),
    ...(interaction.metadata ?? {}),
    ...(interaction.retention === "full-source"
      ? { "topo.capture.turns": interaction.turns.map((turn) => jsonSnapshot(turn)) }
      : {}),
  };
}

function annotationData(
  annotations: MemoryPageAnnotationProposal[] | undefined,
): JsonValue | undefined {
  if (annotations === undefined || annotations.length === 0) return undefined;
  return jsonSnapshot(annotations);
}

export function preparePageFirstCaptureBatch(
  rawInteraction: CapturedInteractionInput,
  rawProposals: ExtractedMemoryPageProposal[],
  existingPages: MemoryPage[],
  context: PageFirstCapturePreparationContext,
): PreparedPageFirstCaptureBatch {
  const interaction = normaliseCapturedInteraction(rawInteraction);
  requireDateTime(context.now, "context.now");

  if (rawProposals.length > MAX_MEMORY_PAGE_PROPOSALS) {
    throw new Error(
      `Page-first capture accepts at most ${MAX_MEMORY_PAGE_PROPOSALS} proposals per interaction`,
    );
  }

  const proposals = rawProposals.map((proposal) =>
    validateProposalAgainstInteraction(interaction, proposal),
  );
  const sourceId = context.createId("source");
  const source: MemorySource = {
    id: sourceId,
    type: sourceType(interaction),
    ...(interaction.title === undefined ? {} : { title: interaction.title }),
    provider: interaction.provider,
    ...(interaction.externalId === undefined
      ? {}
      : { externalId: interaction.externalId }),
    capturedAt: interaction.capturedAt,
    createdAt: context.now,
    sensitivity: maximumSensitivity(proposals),
    metadata: sourceMetadata(interaction, proposals),
  };

  const sourceEvent: MemoryEvent = {
    id: context.createId("event"),
    type: "source.captured",
    entityType: "source",
    entityId: source.id,
    occurredAt: context.now,
    actor: { ...context.actor },
    data: {
      captureProduct: interaction.product,
      captureClient: interaction.client,
      captureMode: interaction.mode,
      captureMethod: interaction.captureMethod,
      captureFidelity: interaction.fidelity,
      captureKind: interaction.kind,
      representation: "memory-page",
      proposalCount: proposals.length,
      retention: interaction.retention,
    },
  };

  const pageTransitions: MemoryPageTransition[] = [];
  const comparisons: PreparedPageFirstCaptureBatch["comparisons"] = [];
  let duplicateProposalsSuppressed = 0;

  for (const proposal of proposals) {
    const comparison = compareMemoryPageProposal(
      interaction.subject,
      proposal,
      existingPages,
    );
    if (comparison.comparison === "duplicate") {
      duplicateProposalsSuppressed += 1;
      continue;
    }

    const memoryId = context.createId("memory");
    const supersedes =
      comparison.comparison === "potential-change"
        ? comparison.relatedMemoryIds.filter((id) =>
            existingPages.some(
              (page) => page.id === id && page.status === "confirmed",
            ),
          )
        : [];

    const transition = proposeMemoryPage(
      {
        id: memoryId,
        subject: interaction.subject,
        title: proposal.title.trim(),
        ...(proposal.summary === undefined
          ? {}
          : { summary: proposal.summary.trim() }),
        body: proposal.body.trim(),
        ...(proposal.category === undefined
          ? {}
          : { category: proposal.category.trim() }),
        tags: [...(proposal.tags ?? [])],
        sensitivity: proposal.sensitivity ?? "ordinary",
        horizon: proposal.horizon ?? "durable",
        origin: "extracted",
        sourceRefs: [
          {
            sourceId: source.id,
            evidence: proposal.evidence.trim(),
            turnIds: [...proposal.evidenceTurnIds],
          },
        ],
        ...(proposal.validFrom === undefined
          ? {}
          : { validFrom: proposal.validFrom }),
        ...(proposal.validUntil === undefined
          ? {}
          : { validUntil: proposal.validUntil }),
        supersedes,
      },
      {
        now: context.now,
        eventId: context.createId("event"),
        actor: { ...context.actor },
      },
    );

    const proposedAnnotations = annotationData(proposal.annotations);
    transition.event.data = {
      comparison: comparison.comparison,
      relatedMemoryIds: jsonSnapshot(comparison.relatedMemoryIds),
      ...(context.extractor === undefined ? {} : { extractor: context.extractor }),
      ...(proposedAnnotations === undefined
        ? {}
        : { proposedAnnotations }),
    };
    pageTransitions.push(transition);
    comparisons.push({
      memoryId,
      comparison: comparison.comparison,
      relatedMemoryIds: [...comparison.relatedMemoryIds],
    });
  }

  return {
    interaction,
    source,
    sourceEvent,
    pageTransitions,
    comparisons,
    duplicateProposalsSuppressed,
  };
}

export function buildMemoryPageExtractionPrompt(
  fidelity: CaptureFidelity = "conversation-turns",
): string {
  const fidelityRules =
    fidelity === "task-summary" || fidelity === "partial-visible"
      ? [
          "- This source is incomplete. Only propose pages that restate context directly supported by user-authored evidence.",
          "- Do not infer patterns, motivations or personal characteristics from incomplete capture.",
          "- Any structured annotations must be assertion or preference only.",
        ]
      : [];

  return [
    "You are identifying a small number of coherent pieces of user-owned context that may materially improve future AI interactions.",
    "",
    "The primary memory object is a short prose Memory Page, not a collection of atomic facts.",
    "",
    "Rules:",
    `- Return at most ${MAX_MEMORY_PAGE_PROPOSALS} Memory Pages, and prefer fewer. One or two useful pages is better than a spray of facts.`,
    "- Each page should capture one coherent thing worth remembering: a project decision, useful preference in context, working relationship, recurring pattern, current circumstance, or background that will improve future work.",
    "- Write the body as concise natural prose that remains useful if copied into an ordinary Markdown note.",
    "- Do not split closely related context into separate pages merely because several facts are present.",
    "- Every page must cite at least one USER turn ID. Assistant, system and tool turns may provide context but are not evidence about the user.",
    "- Evidence must be a short excerpt copied from one of the cited USER turns.",
    "- Questions are weak evidence. Do not turn a question into a fact about the user unless the user explicitly states that fact.",
    "- Use durable for stable preferences/enduring context, project for active project context, and temporary for short-lived circumstances.",
    "- Only include structured annotations when a machine-readable key/value materially helps deterministic filtering, temporal comparison or interoperability.",
    "- Do not create annotations just to duplicate every sentence in the page.",
    "- Do not extract passwords, authentication tokens, API keys, financial credentials or other secrets.",
    "- Be conservative with sensitive personal data and mark sensitivity explicitly.",
    ...fidelityRules,
    "",
    "Return JSON only using this shape:",
    "{",
    '  "proposals": [',
    "    {",
    '      "title": "Short useful title",',
    '      "summary": "Optional one-line summary",',
    '      "body": "Concise coherent prose memory.",',
    '      "category": "optional-category",',
    '      "tags": ["optional", "tags"],',
    '      "sensitivity": "ordinary",',
    '      "horizon": "project",',
    '      "evidenceTurnIds": ["u1"],',
    '      "evidence": "verbatim user excerpt",',
    '      "validFrom": "optional RFC3339 date-time",',
    '      "validUntil": "optional RFC3339 date-time",',
    '      "annotations": [',
    "        {",
    '          "key": "optional.machine.key",',
    '          "value": "machine-readable value",',
    '          "epistemicType": "preference",',
    '          "confidence": 0.98',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "Omit optional fields rather than returning null. If nothing is genuinely worth remembering, return {\"proposals\":[]}.",
  ].join("\n");
}
