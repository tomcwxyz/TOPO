import type {
  Actor,
  ClaimProvenance,
  ClaimTransition,
  EpistemicType,
  JsonValue,
  MemoryClaim,
  MemoryEvent,
  Sensitivity,
} from "./model.js";
import { validateClaim, validateEvent } from "./validation.js";

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export interface TransitionContext {
  now: string;
  eventId: string;
  actor: Actor;
}

export interface ProposeClaimInput {
  id: string;
  subject: string;
  key: string;
  value: JsonValue;
  category?: string;
  tags?: string[];
  epistemicType: EpistemicType;
  confidence: number;
  provenance: ClaimProvenance;
  sensitivity: Sensitivity;
  validFrom?: string;
  validUntil?: string;
  supersedes?: string[];
}

export interface EditCandidatePatch {
  subject?: string;
  key?: string;
  value?: JsonValue;
  category?: string | null;
  tags?: string[];
  epistemicType?: EpistemicType;
  confidence?: number;
  sensitivity?: Sensitivity;
  validFrom?: string | null;
  validUntil?: string | null;
}

function cloneClaim(claim: MemoryClaim): MemoryClaim {
  return {
    ...claim,
    tags: [...claim.tags],
    supersedes: [...claim.supersedes],
    provenance: { ...claim.provenance },
  };
}

function eventFor(
  claim: MemoryClaim,
  type: MemoryEvent["type"],
  context: TransitionContext,
  data?: MemoryEvent["data"],
): MemoryEvent {
  const event: MemoryEvent = {
    id: context.eventId,
    type,
    entityType: "claim",
    entityId: claim.id,
    occurredAt: context.now,
    actor: { ...context.actor },
    ...(data === undefined ? {} : { data }),
  };
  validateEvent(event);
  return event;
}

export function proposeClaim(
  input: ProposeClaimInput,
  context: TransitionContext,
): ClaimTransition {
  const claim: MemoryClaim = {
    id: input.id,
    subject: input.subject,
    key: input.key,
    value: input.value,
    ...(input.category === undefined ? {} : { category: input.category }),
    tags: [...(input.tags ?? [])],
    epistemicType: input.epistemicType,
    confidence: input.confidence,
    provenance: { ...input.provenance },
    status: "candidate",
    sensitivity: input.sensitivity,
    ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    supersedes: [...(input.supersedes ?? [])],
    createdAt: context.now,
    updatedAt: context.now,
  };

  validateClaim(claim);
  return { claim, event: eventFor(claim, "claim.proposed", context) };
}

export function editCandidateClaim(
  claim: MemoryClaim,
  patch: EditCandidatePatch,
  context: TransitionContext,
): ClaimTransition {
  validateClaim(claim);
  if (claim.status !== "candidate") {
    throw new InvalidTransitionError(
      `Only candidate claims can be edited; ${claim.id} is ${claim.status}`,
    );
  }
  if (context.actor.type !== "user") {
    throw new InvalidTransitionError(
      "Editing a candidate requires a user actor in the default trust model",
    );
  }

  const next = cloneClaim(claim);
  const changes: Record<string, JsonValue> = {};

  const change = (
    field: string,
    before: JsonValue,
    after: JsonValue,
    apply: () => void,
  ): void => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    changes[field] = { from: before, to: after };
    apply();
  };

  if (patch.subject !== undefined) {
    change("subject", claim.subject, patch.subject, () => {
      next.subject = patch.subject!;
    });
  }
  if (patch.key !== undefined) {
    change("key", claim.key, patch.key, () => {
      next.key = patch.key!;
    });
  }
  if (patch.value !== undefined) {
    change("value", claim.value, patch.value, () => {
      next.value = patch.value!;
    });
  }
  if (patch.category !== undefined) {
    change("category", claim.category ?? null, patch.category, () => {
      if (patch.category === null) delete next.category;
      else next.category = patch.category;
    });
  }
  if (patch.tags !== undefined) {
    change("tags", claim.tags, patch.tags, () => {
      next.tags = [...patch.tags!];
    });
  }
  if (patch.epistemicType !== undefined) {
    change("epistemicType", claim.epistemicType, patch.epistemicType, () => {
      next.epistemicType = patch.epistemicType!;
    });
  }
  if (patch.confidence !== undefined) {
    change("confidence", claim.confidence, patch.confidence, () => {
      next.confidence = patch.confidence!;
    });
  }
  if (patch.sensitivity !== undefined) {
    change("sensitivity", claim.sensitivity, patch.sensitivity, () => {
      next.sensitivity = patch.sensitivity!;
    });
  }
  if (patch.validFrom !== undefined) {
    change("validFrom", claim.validFrom ?? null, patch.validFrom, () => {
      if (patch.validFrom === null) delete next.validFrom;
      else next.validFrom = patch.validFrom;
    });
  }
  if (patch.validUntil !== undefined) {
    change("validUntil", claim.validUntil ?? null, patch.validUntil, () => {
      if (patch.validUntil === null) delete next.validUntil;
      else next.validUntil = patch.validUntil;
    });
  }

  if (Object.keys(changes).length === 0) {
    throw new InvalidTransitionError("Candidate edit did not change any fields");
  }

  next.updatedAt = context.now;
  validateClaim(next);

  return {
    claim: next,
    event: eventFor(next, "claim.edited", context, { changes }),
  };
}

export function confirmClaim(
  claim: MemoryClaim,
  context: TransitionContext,
): ClaimTransition {
  validateClaim(claim);
  if (claim.status !== "candidate") {
    throw new InvalidTransitionError(
      `Only candidate claims can be confirmed; ${claim.id} is ${claim.status}`,
    );
  }
  if (context.actor.type !== "user") {
    throw new InvalidTransitionError(
      "Confirming a candidate requires a user actor in the default trust model",
    );
  }

  const next = cloneClaim(claim);
  next.status = "confirmed";
  next.updatedAt = context.now;
  validateClaim(next);

  return {
    claim: next,
    event: eventFor(next, "claim.confirmed", context, {
      fromStatus: "candidate",
      toStatus: "confirmed",
    }),
  };
}

export function rejectClaim(
  claim: MemoryClaim,
  context: TransitionContext,
): ClaimTransition {
  validateClaim(claim);
  if (claim.status !== "candidate") {
    throw new InvalidTransitionError(
      `Only candidate claims can be rejected; ${claim.id} is ${claim.status}`,
    );
  }
  if (context.actor.type !== "user") {
    throw new InvalidTransitionError(
      "Rejecting a candidate requires a user actor in the default trust model",
    );
  }

  const next = cloneClaim(claim);
  next.status = "rejected";
  next.updatedAt = context.now;
  validateClaim(next);

  return {
    claim: next,
    event: eventFor(next, "claim.rejected", context, {
      fromStatus: "candidate",
      toStatus: "rejected",
    }),
  };
}

export function expireClaim(
  claim: MemoryClaim,
  context: TransitionContext,
): ClaimTransition {
  validateClaim(claim);
  if (claim.status !== "confirmed") {
    throw new InvalidTransitionError(
      `Only confirmed claims can expire; ${claim.id} is ${claim.status}`,
    );
  }

  const next = cloneClaim(claim);
  next.status = "expired";
  next.updatedAt = context.now;
  validateClaim(next);

  return {
    claim: next,
    event: eventFor(next, "claim.expired", context, {
      fromStatus: "confirmed",
      toStatus: "expired",
    }),
  };
}

export function supersedeClaim(
  existing: MemoryClaim,
  replacement: MemoryClaim,
  context: TransitionContext,
): ClaimTransition {
  validateClaim(existing);
  validateClaim(replacement);

  if (existing.status !== "confirmed") {
    throw new InvalidTransitionError(
      `Only confirmed claims can be superseded; ${existing.id} is ${existing.status}`,
    );
  }
  if (replacement.status !== "confirmed") {
    throw new InvalidTransitionError(
      "A replacement must be confirmed before it supersedes another claim",
    );
  }
  if (!replacement.supersedes.includes(existing.id)) {
    throw new InvalidTransitionError(
      `Replacement ${replacement.id} does not declare that it supersedes ${existing.id}`,
    );
  }

  const next = cloneClaim(existing);
  next.status = "superseded";
  next.updatedAt = context.now;
  validateClaim(next);

  return {
    claim: next,
    event: eventFor(next, "claim.superseded", context, {
      replacementId: replacement.id,
    }),
  };
}
