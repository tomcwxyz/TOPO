import { proposeClaim } from "@topo/core";
import {
  validateCapturedInteraction,
  validateExtractedMemoryProposal,
} from "@topo/schemas";
import type {
  Actor,
  CapturedInteraction,
  CapturedTurn,
  ClaimTransition,
  ExtractedMemoryProposal,
  JsonValue,
  MemoryClaim,
  MemoryEvent,
  MemorySource,
  Sensitivity,
  SourceRetention,
} from "@topo/schemas";

export type {
  CaptureKind,
  CaptureRole,
  CaptureSurface,
  CapturedInteraction,
  CapturedTurn,
  ExtractedMemoryProposal,
  MemoryHorizon,
  SourceRetention,
} from "@topo/schemas";

export type CapturedInteractionInput = Omit<CapturedInteraction, "retention"> & {
  retention?: SourceRetention;
};

export type ProposalComparison =
  | "new"
  | "supporting-evidence"
  | "potential-change";

export interface CapturePreparationContext {
  now: string;
  actor: Actor;
  createId: (prefix: "source" | "claim" | "event") => string;
}

export interface PreparedCaptureBatch {
  interaction: CapturedInteraction;
  source: MemorySource;
  sourceEvent: MemoryEvent;
  transitions: ClaimTransition[];
}

const sensitivityRank: Record<Sensitivity, number> = {
  ordinary: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  return trimmed;
}

function requireDateTime(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO date-time`);
  }
  return value;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normaliseCapturedInteraction(
  input: CapturedInteractionInput,
): CapturedInteraction {
  const seen = new Set<string>();
  const turns = input.turns
    .map((turn) => ({
      ...turn,
      id: requireNonEmpty(turn.id, "turn.id"),
      content: turn.content.trim(),
      ...(turn.occurredAt === undefined
        ? {}
        : { occurredAt: requireDateTime(turn.occurredAt, "turn.occurredAt") }),
    }))
    .filter((turn) => turn.content.length > 0);

  for (const turn of turns) {
    if (seen.has(turn.id)) {
      throw new Error(`Duplicate turn id: ${turn.id}`);
    }
    seen.add(turn.id);
  }

  if (turns.length === 0) {
    throw new Error("Captured interaction must contain at least one non-empty turn");
  }

  if (!turns.some((turn) => turn.role === "user")) {
    throw new Error("Captured interaction must contain at least one user turn");
  }

  const normalised: CapturedInteraction = {
    ...input,
    id: requireNonEmpty(input.id, "interaction.id"),
    provider: requireNonEmpty(input.provider, "interaction.provider"),
    subject: requireNonEmpty(input.subject, "interaction.subject"),
    ...(input.title === undefined
      ? {}
      : { title: requireNonEmpty(input.title, "interaction.title") }),
    ...(input.externalId === undefined
      ? {}
      : { externalId: requireNonEmpty(input.externalId, "interaction.externalId") }),
    ...(input.sourceUrl === undefined
      ? {}
      : { sourceUrl: requireNonEmpty(input.sourceUrl, "interaction.sourceUrl") }),
    capturedAt: requireDateTime(input.capturedAt, "interaction.capturedAt"),
    turns,
    retention: input.retention ?? "review-window",
    ...(input.metadata === undefined
      ? {}
      : { metadata: cloneJson(input.metadata) }),
  };
  validateCapturedInteraction(normalised);
  return normalised;
}

function referencedTurns(
  interaction: CapturedInteraction,
  proposals: ExtractedMemoryProposal[],
): CapturedTurn[] {
  const wanted = new Set(proposals.flatMap((proposal) => proposal.evidenceTurnIds));
  return interaction.turns.filter((turn) => wanted.has(turn.id));
}

function maximumSensitivity(
  proposals: ExtractedMemoryProposal[],
): Sensitivity {
  return proposals.reduce<Sensitivity>((highest, proposal) => {
    const value = proposal.sensitivity ?? "ordinary";
    return sensitivityRank[value] > sensitivityRank[highest] ? value : highest;
  }, "ordinary");
}

function sourceMetadata(
  interaction: CapturedInteraction,
  proposals: ExtractedMemoryProposal[],
): Record<string, JsonValue> {
  const metadata: Record<string, JsonValue> = {
    "topo.capture.kind": interaction.kind,
    "topo.capture.surface": interaction.surface,
    "topo.capture.retention": interaction.retention ?? "review-window",
    "topo.capture.turnCount": interaction.turns.length,
    "topo.capture.evidenceTurns": referencedTurns(interaction, proposals).map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      ...(turn.occurredAt === undefined ? {} : { occurredAt: turn.occurredAt }),
    })),
    ...(interaction.sourceUrl === undefined
      ? {}
      : { "topo.capture.sourceUrl": interaction.sourceUrl }),
    ...(interaction.metadata ?? {}),
  };

  if ((interaction.retention ?? "review-window") === "full-source") {
    metadata["topo.capture.turns"] = interaction.turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      ...(turn.occurredAt === undefined ? {} : { occurredAt: turn.occurredAt }),
    }));
  }

  return metadata;
}

function validateProposal(
  interaction: CapturedInteraction,
  proposal: ExtractedMemoryProposal,
): void {
  validateExtractedMemoryProposal(proposal);
  requireNonEmpty(proposal.key, "proposal.key");
  requireNonEmpty(proposal.evidence, "proposal.evidence");

  if (
    !Number.isFinite(proposal.confidence) ||
    proposal.confidence < 0 ||
    proposal.confidence > 1
  ) {
    throw new Error("proposal.confidence must be between 0 and 1");
  }

  if (proposal.evidenceTurnIds.length === 0) {
    throw new Error("proposal.evidenceTurnIds must contain at least one turn");
  }

  const byId = new Map(interaction.turns.map((turn) => [turn.id, turn]));
  const evidenceTurns = proposal.evidenceTurnIds.map((id) => {
    const turn = byId.get(id);
    if (!turn) throw new Error(`Unknown evidence turn: ${id}`);
    return turn;
  });

  if (!evidenceTurns.some((turn) => turn.role === "user")) {
    throw new Error(
      "A memory proposal must be grounded in at least one user-authored turn",
    );
  }

  if (
    (proposal.epistemicType === "assertion" ||
      proposal.epistemicType === "preference") &&
    evidenceTurns.every((turn) => turn.role !== "user")
  ) {
    throw new Error(
      `${proposal.epistemicType} proposals require user-authored evidence`,
    );
  }

  if (proposal.validUntil !== undefined) {
    requireDateTime(proposal.validUntil, "proposal.validUntil");
  }
}

export function prepareCaptureBatch(
  rawInteraction: CapturedInteraction,
  proposals: ExtractedMemoryProposal[],
  context: CapturePreparationContext,
): PreparedCaptureBatch {
  const interaction = normaliseCapturedInteraction(rawInteraction);
  requireDateTime(context.now, "context.now");

  for (const proposal of proposals) validateProposal(interaction, proposal);

  const sourceId = context.createId("source");
  const source: MemorySource = {
    id: sourceId,
    type:
      interaction.kind === "imported-conversation"
        ? "import"
        : interaction.kind === "manual"
          ? "manual"
          : "conversation",
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
      captureSurface: interaction.surface,
      captureKind: interaction.kind,
      proposalCount: proposals.length,
      retention: interaction.retention ?? "review-window",
    },
  };

  const transitions = proposals.map((proposal) =>
    proposeClaim(
      {
        id: context.createId("claim"),
        subject: interaction.subject,
        key: proposal.key.trim(),
        value: cloneJson(proposal.value),
        ...(proposal.category === undefined
          ? {}
          : { category: proposal.category.trim() }),
        tags: [...(proposal.tags ?? [])],
        epistemicType: proposal.epistemicType,
        confidence: proposal.confidence,
        provenance: {
          sourceType: source.type,
          provider: interaction.provider,
          sourceId: source.id,
          evidence: proposal.evidence.trim(),
          capturedAt: interaction.capturedAt,
        },
        sensitivity: proposal.sensitivity ?? "ordinary",
        ...(proposal.validUntil === undefined
          ? {}
          : { validUntil: proposal.validUntil }),
      },
      {
        now: context.now,
        eventId: context.createId("event"),
        actor: { ...context.actor },
      },
    ),
  );

  return { interaction, source, sourceEvent, transitions };
}

export function persistCaptureBatch(
  batch: PreparedCaptureBatch,
  store: {
    transaction<T>(work: () => T): T;
    putSource(source: MemorySource): void;
    appendEvent(event: MemoryEvent): void;
    applyTransition(transition: ClaimTransition): void;
  },
): void {
  store.transaction(() => {
    store.putSource(batch.source);
    store.appendEvent(batch.sourceEvent);
    for (const transition of batch.transitions) {
      store.applyTransition(transition);
    }
  });
}

export function compareProposalToConfirmedClaims(
  proposal: ExtractedMemoryProposal,
  claims: MemoryClaim[],
): ProposalComparison {
  const sameKey = claims.filter(
    (claim) => claim.status === "confirmed" && claim.key === proposal.key.trim(),
  );

  if (
    sameKey.some(
      (claim) => JSON.stringify(claim.value) === JSON.stringify(proposal.value),
    )
  ) {
    return "supporting-evidence";
  }

  return sameKey.length > 0 ? "potential-change" : "new";
}

export function buildCaptureExtractionPrompt(): string {
  return [
    "You are identifying durable user context that may be worth remembering across future AI interactions.",
    "",
    "Governance rules:",
    "- Produce candidate memories only. The user will review them before they become established memory.",
    "- Ground every proposal in user-authored evidence. Assistant, system and tool messages may provide context but are not evidence about the user.",
    "- Questions are weak evidence. Do not turn a question into a personal fact unless the user explicitly discloses that fact in the same turn or nearby user-authored context.",
    "- Keep assertion, preference, observation, inference and derived-pattern distinct. Confidence never changes the epistemic type.",
    "- Prefer memories that would materially improve a future interaction. Do not extract trivia merely because it is present.",
    "- Use durable for stable preferences or enduring context, project for current project-specific context, and temporary for short-lived circumstances.",
    "- Temporary memories should include validUntil where the conversation provides a reasonable boundary. Do not invent dates.",
    "- Do not extract passwords, API keys, authentication tokens, financial credentials or other secrets.",
    "- Be conservative with sensitive personal data and mark sensitivity explicitly.",
    "",
    "Return JSON only as an array of objects with:",
    "key, value, category?, tags?, epistemicType, confidence, sensitivity?, horizon?, evidenceTurnIds, evidence, validUntil?.",
    "",
    "If nothing is genuinely worth remembering, return [].",
  ].join("\n");
}
