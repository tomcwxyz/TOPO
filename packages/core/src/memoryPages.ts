import type {
  Actor,
  JsonValue,
  MemoryClaim,
  Sensitivity,
} from "@topo/schemas";
import {
  validateMemoryPage,
  type MemoryPage,
  type MemoryPageEvent,
  type MemoryPageOrigin,
  type MemoryPageSourceRef,
  type MemoryPageTransition,
} from "@topo/schemas/memory-page";
import { InvalidTransitionError } from "./lifecycle.js";

export interface MemoryPageTransitionContext {
  now: string;
  eventId: string;
  actor: Actor;
}

export interface ProposeMemoryPageInput {
  id: string;
  subject: string;
  title: string;
  summary?: string;
  body: string;
  category?: string;
  tags?: string[];
  sensitivity: Sensitivity;
  horizon: MemoryPage["horizon"];
  origin: MemoryPageOrigin;
  sourceRefs: MemoryPageSourceRef[];
  annotationIds?: string[];
  validFrom?: string;
  validUntil?: string;
  supersedes?: string[];
}

export interface EditMemoryPagePatch {
  subject?: string;
  title?: string;
  summary?: string | null;
  body?: string;
  category?: string | null;
  tags?: string[];
  sensitivity?: Sensitivity;
  horizon?: MemoryPage["horizon"];
  sourceRefs?: MemoryPageSourceRef[];
  annotationIds?: string[];
  validFrom?: string | null;
  validUntil?: string | null;
}

function clonePage(page: MemoryPage): MemoryPage {
  return {
    ...page,
    tags: [...page.tags],
    sourceRefs: page.sourceRefs.map((reference) => ({
      ...reference,
      ...(reference.turnIds === undefined
        ? {}
        : { turnIds: [...reference.turnIds] }),
    })),
    annotationIds: [...page.annotationIds],
    supersedes: [...page.supersedes],
  };
}

function jsonSnapshot(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function eventForPage(
  page: MemoryPage,
  type: MemoryPageEvent["type"],
  context: MemoryPageTransitionContext,
  data?: Record<string, JsonValue>,
): MemoryPageEvent {
  return {
    id: context.eventId,
    type,
    entityType: "memory",
    entityId: page.id,
    occurredAt: context.now,
    actor: { ...context.actor },
    ...(data === undefined ? {} : { data }),
  };
}

export function proposeMemoryPage(
  input: ProposeMemoryPageInput,
  context: MemoryPageTransitionContext,
): MemoryPageTransition {
  const page: MemoryPage = {
    id: input.id,
    subject: input.subject,
    title: input.title,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    body: input.body,
    ...(input.category === undefined ? {} : { category: input.category }),
    tags: [...(input.tags ?? [])],
    status: "candidate",
    sensitivity: input.sensitivity,
    horizon: input.horizon,
    origin: input.origin,
    sourceRefs: input.sourceRefs.map((reference) => ({
      ...reference,
      ...(reference.turnIds === undefined
        ? {}
        : { turnIds: [...reference.turnIds] }),
    })),
    annotationIds: [...(input.annotationIds ?? [])],
    ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    supersedes: [...(input.supersedes ?? [])],
    revision: 1,
    createdAt: context.now,
    updatedAt: context.now,
  };

  validateMemoryPage(page);
  return {
    page,
    event: eventForPage(page, "memory.proposed", context),
  };
}

export function editCandidateMemoryPage(
  page: MemoryPage,
  patch: EditMemoryPagePatch,
  context: MemoryPageTransitionContext,
): MemoryPageTransition {
  validateMemoryPage(page);
  if (page.status !== "candidate") {
    throw new InvalidTransitionError(
      `Only candidate Memory Pages can be edited; ${page.id} is ${page.status}`,
    );
  }
  if (context.actor.type !== "user") {
    throw new InvalidTransitionError(
      "Editing a Memory Page candidate requires a user actor in the default trust model",
    );
  }

  const next = clonePage(page);
  const changes: Record<string, JsonValue> = {};

  const change = (
    field: string,
    before: unknown,
    after: unknown,
    apply: () => void,
  ): void => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    changes[field] = {
      from: jsonSnapshot(before),
      to: jsonSnapshot(after),
    };
    apply();
  };

  if (patch.subject !== undefined) {
    change("subject", page.subject, patch.subject, () => {
      next.subject = patch.subject!;
    });
  }
  if (patch.title !== undefined) {
    change("title", page.title, patch.title, () => {
      next.title = patch.title!;
    });
  }
  if (patch.summary !== undefined) {
    change("summary", page.summary ?? null, patch.summary, () => {
      if (patch.summary === null) delete next.summary;
      else next.summary = patch.summary!;
    });
  }
  if (patch.body !== undefined) {
    change("body", page.body, patch.body, () => {
      next.body = patch.body!;
    });
  }
  if (patch.category !== undefined) {
    change("category", page.category ?? null, patch.category, () => {
      if (patch.category === null) delete next.category;
      else next.category = patch.category!;
    });
  }
  if (patch.tags !== undefined) {
    change("tags", page.tags, patch.tags, () => {
      next.tags = [...patch.tags!];
    });
  }
  if (patch.sensitivity !== undefined) {
    change("sensitivity", page.sensitivity, patch.sensitivity, () => {
      next.sensitivity = patch.sensitivity!;
    });
  }
  if (patch.horizon !== undefined) {
    change("horizon", page.horizon, patch.horizon, () => {
      next.horizon = patch.horizon!;
    });
  }
  if (patch.sourceRefs !== undefined) {
    change("sourceRefs", page.sourceRefs, patch.sourceRefs, () => {
      next.sourceRefs = patch.sourceRefs!.map((reference) => ({
        ...reference,
        ...(reference.turnIds === undefined
          ? {}
          : { turnIds: [...reference.turnIds] }),
      }));
    });
  }
  if (patch.annotationIds !== undefined) {
    change("annotationIds", page.annotationIds, patch.annotationIds, () => {
      next.annotationIds = [...patch.annotationIds!];
    });
  }
  if (patch.validFrom !== undefined) {
    change("validFrom", page.validFrom ?? null, patch.validFrom, () => {
      if (patch.validFrom === null) delete next.validFrom;
      else next.validFrom = patch.validFrom!;
    });
  }
  if (patch.validUntil !== undefined) {
    change("validUntil", page.validUntil ?? null, patch.validUntil, () => {
      if (patch.validUntil === null) delete next.validUntil;
      else next.validUntil = patch.validUntil!;
    });
  }

  if (Object.keys(changes).length === 0) {
    throw new InvalidTransitionError("Memory Page edit did not change any fields");
  }

  next.revision += 1;
  next.updatedAt = context.now;
  validateMemoryPage(next);

  return {
    page: next,
    event: eventForPage(next, "memory.edited", context, {
      revision: next.revision,
      changes,
    }),
  };
}

export function confirmMemoryPage(
  page: MemoryPage,
  context: MemoryPageTransitionContext,
): MemoryPageTransition {
  validateMemoryPage(page);
  if (page.status !== "candidate") {
    throw new InvalidTransitionError(
      `Only candidate Memory Pages can be confirmed; ${page.id} is ${page.status}`,
    );
  }
  if (context.actor.type !== "user") {
    throw new InvalidTransitionError(
      "Confirming a Memory Page requires a user actor in the default trust model",
    );
  }

  const next = clonePage(page);
  next.status = "confirmed";
  next.revision += 1;
  next.updatedAt = context.now;
  validateMemoryPage(next);

  return {
    page: next,
    event: eventForPage(next, "memory.confirmed", context, {
      fromStatus: "candidate",
      toStatus: "confirmed",
      revision: next.revision,
    }),
  };
}

export function rejectMemoryPage(
  page: MemoryPage,
  context: MemoryPageTransitionContext,
): MemoryPageTransition {
  validateMemoryPage(page);
  if (page.status !== "candidate") {
    throw new InvalidTransitionError(
      `Only candidate Memory Pages can be rejected; ${page.id} is ${page.status}`,
    );
  }
  if (context.actor.type !== "user") {
    throw new InvalidTransitionError(
      "Rejecting a Memory Page requires a user actor in the default trust model",
    );
  }

  const next = clonePage(page);
  next.status = "rejected";
  next.revision += 1;
  next.updatedAt = context.now;
  validateMemoryPage(next);

  return {
    page: next,
    event: eventForPage(next, "memory.rejected", context, {
      fromStatus: "candidate",
      toStatus: "rejected",
      revision: next.revision,
    }),
  };
}

export function expireMemoryPage(
  page: MemoryPage,
  context: MemoryPageTransitionContext,
): MemoryPageTransition {
  validateMemoryPage(page);
  if (page.status !== "confirmed") {
    throw new InvalidTransitionError(
      `Only confirmed Memory Pages can expire; ${page.id} is ${page.status}`,
    );
  }

  const next = clonePage(page);
  next.status = "expired";
  next.revision += 1;
  next.updatedAt = context.now;
  validateMemoryPage(next);

  return {
    page: next,
    event: eventForPage(next, "memory.expired", context, {
      fromStatus: "confirmed",
      toStatus: "expired",
      revision: next.revision,
    }),
  };
}

export function supersedeMemoryPage(
  existing: MemoryPage,
  replacement: MemoryPage,
  context: MemoryPageTransitionContext,
): MemoryPageTransition {
  validateMemoryPage(existing);
  validateMemoryPage(replacement);

  if (existing.status !== "confirmed") {
    throw new InvalidTransitionError(
      `Only confirmed Memory Pages can be superseded; ${existing.id} is ${existing.status}`,
    );
  }
  if (replacement.status !== "confirmed") {
    throw new InvalidTransitionError(
      "A replacement Memory Page must be confirmed before it supersedes another page",
    );
  }
  if (!replacement.supersedes.includes(existing.id)) {
    throw new InvalidTransitionError(
      `Replacement ${replacement.id} does not declare that it supersedes ${existing.id}`,
    );
  }

  const next = clonePage(existing);
  next.status = "superseded";
  next.revision += 1;
  next.updatedAt = context.now;
  validateMemoryPage(next);

  return {
    page: next,
    event: eventForPage(next, "memory.superseded", context, {
      replacementId: replacement.id,
      revision: next.revision,
    }),
  };
}

function renderClaimValue(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export interface ClaimCompatibilityPageOptions {
  id: string;
  now: string;
  title?: string;
  horizon?: MemoryPage["horizon"];
}

export function proposeCompatibilityPageFromClaim(
  claim: MemoryClaim,
  options: ClaimCompatibilityPageOptions,
): MemoryPage {
  const sourceId = claim.provenance.sourceId;
  if (sourceId === undefined) {
    throw new InvalidTransitionError(
      `Claim ${claim.id} cannot become a compatibility Memory Page without a source reference`,
    );
  }

  const page: MemoryPage = {
    id: options.id,
    subject: claim.subject,
    title: options.title ?? claim.category ?? claim.key,
    body: `${claim.key}: ${renderClaimValue(claim.value)}`,
    ...(claim.category === undefined ? {} : { category: claim.category }),
    tags: [...claim.tags],
    status: "candidate",
    sensitivity: claim.sensitivity,
    horizon:
      options.horizon ?? (claim.validUntil === undefined ? "durable" : "temporary"),
    origin: "compatibility",
    sourceRefs: [
      {
        sourceId,
        ...(claim.provenance.evidence === undefined
          ? {}
          : { evidence: claim.provenance.evidence }),
      },
    ],
    annotationIds: [claim.id],
    ...(claim.validFrom === undefined ? {} : { validFrom: claim.validFrom }),
    ...(claim.validUntil === undefined ? {} : { validUntil: claim.validUntil }),
    supersedes: [],
    revision: 1,
    createdAt: options.now,
    updatedAt: options.now,
  };

  validateMemoryPage(page);
  return page;
}
