import {
  ACTOR_TYPES,
  CLAIM_STATUSES,
  EPISTEMIC_TYPES,
  EVENT_TYPES,
  SENSITIVITY_LEVELS,
  SOURCE_TYPES,
  type Actor,
  type JsonValue,
  type MemoryClaim,
  type MemoryEvent,
  type MemorySource,
} from "./model.js";

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid TOPO data: ${issues.join("; ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, seen));
  }

  return Object.values(value as Record<string, unknown>).every((item) =>
    isJsonValue(item, seen),
  );
}

function validateActor(
  value: unknown,
  path: string,
  issues: string[],
): value is Actor {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }
  if (!isEnumValue(ACTOR_TYPES, value.type)) {
    issues.push(`${path}.type is invalid`);
  }
  if (value.id !== undefined && !isNonEmptyString(value.id)) {
    issues.push(`${path}.id must be a non-empty string`);
  }
  return issues.length === 0;
}

export function validateClaim(claim: unknown): asserts claim is MemoryClaim {
  const issues: string[] = [];
  if (!isRecord(claim)) {
    throw new ValidationError(["claim must be an object"]);
  }

  if (!isNonEmptyString(claim.id)) issues.push("id must be a non-empty string");
  if (!isNonEmptyString(claim.subject)) {
    issues.push("subject must be a non-empty string");
  }
  if (!isNonEmptyString(claim.key)) {
    issues.push("key must be a non-empty string");
  }
  if (!isJsonValue(claim.value)) issues.push("value must be JSON-compatible");
  if (claim.category !== undefined && !isNonEmptyString(claim.category)) {
    issues.push("category must be a non-empty string");
  }
  if (!Array.isArray(claim.tags) || !claim.tags.every(isNonEmptyString)) {
    issues.push("tags must be an array of non-empty strings");
  }
  if (
    Array.isArray(claim.tags) &&
    new Set(claim.tags).size !== claim.tags.length
  ) {
    issues.push("tags must be unique");
  }
  if (!isEnumValue(EPISTEMIC_TYPES, claim.epistemicType)) {
    issues.push("epistemicType is invalid");
  }
  if (
    typeof claim.confidence !== "number" ||
    !Number.isFinite(claim.confidence) ||
    claim.confidence < 0 ||
    claim.confidence > 1
  ) {
    issues.push("confidence must be between 0 and 1");
  }
  if (!isEnumValue(CLAIM_STATUSES, claim.status)) {
    issues.push("status is invalid");
  }
  if (!isEnumValue(SENSITIVITY_LEVELS, claim.sensitivity)) {
    issues.push("sensitivity is invalid");
  }
  if (
    !Array.isArray(claim.supersedes) ||
    !claim.supersedes.every(isNonEmptyString)
  ) {
    issues.push("supersedes must be an array of non-empty strings");
  }
  if (!isIsoDate(claim.createdAt)) {
    issues.push("createdAt must be a valid date-time");
  }
  if (!isIsoDate(claim.updatedAt)) {
    issues.push("updatedAt must be a valid date-time");
  }
  if (claim.validFrom !== undefined && !isIsoDate(claim.validFrom)) {
    issues.push("validFrom must be a valid date-time");
  }
  if (claim.validUntil !== undefined && !isIsoDate(claim.validUntil)) {
    issues.push("validUntil must be a valid date-time");
  }
  if (
    isIsoDate(claim.validFrom) &&
    isIsoDate(claim.validUntil) &&
    Date.parse(claim.validUntil) < Date.parse(claim.validFrom)
  ) {
    issues.push("validUntil cannot be before validFrom");
  }

  if (!isRecord(claim.provenance)) {
    issues.push("provenance must be an object");
  } else {
    if (!isEnumValue(SOURCE_TYPES, claim.provenance.sourceType)) {
      issues.push("provenance.sourceType is invalid");
    }
    if (
      claim.provenance.provider !== undefined &&
      !isNonEmptyString(claim.provenance.provider)
    ) {
      issues.push("provenance.provider must be a non-empty string");
    }
    if (
      claim.provenance.sourceId !== undefined &&
      !isNonEmptyString(claim.provenance.sourceId)
    ) {
      issues.push("provenance.sourceId must be a non-empty string");
    }
    if (
      claim.provenance.evidence !== undefined &&
      !isNonEmptyString(claim.provenance.evidence)
    ) {
      issues.push("provenance.evidence must be a non-empty string");
    }
    if (!isIsoDate(claim.provenance.capturedAt)) {
      issues.push("provenance.capturedAt must be a valid date-time");
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);
}

export function validateSource(source: unknown): asserts source is MemorySource {
  const issues: string[] = [];
  if (!isRecord(source)) {
    throw new ValidationError(["source must be an object"]);
  }

  if (!isNonEmptyString(source.id)) issues.push("id must be a non-empty string");
  if (!isEnumValue(SOURCE_TYPES, source.type)) issues.push("type is invalid");
  if (source.title !== undefined && !isNonEmptyString(source.title)) {
    issues.push("title must be a non-empty string");
  }
  if (source.provider !== undefined && !isNonEmptyString(source.provider)) {
    issues.push("provider must be a non-empty string");
  }
  if (
    source.externalId !== undefined &&
    !isNonEmptyString(source.externalId)
  ) {
    issues.push("externalId must be a non-empty string");
  }
  if (!isIsoDate(source.capturedAt)) {
    issues.push("capturedAt must be a valid date-time");
  }
  if (!isIsoDate(source.createdAt)) {
    issues.push("createdAt must be a valid date-time");
  }
  if (!isEnumValue(SENSITIVITY_LEVELS, source.sensitivity)) {
    issues.push("sensitivity is invalid");
  }
  if (
    source.metadata !== undefined &&
    (!isRecord(source.metadata) || !isJsonValue(source.metadata))
  ) {
    issues.push("metadata must be a JSON-compatible object");
  }

  if (issues.length > 0) throw new ValidationError(issues);
}

export function validateEvent(event: unknown): asserts event is MemoryEvent {
  const issues: string[] = [];
  if (!isRecord(event)) {
    throw new ValidationError(["event must be an object"]);
  }

  if (!isNonEmptyString(event.id)) issues.push("id must be a non-empty string");
  if (!isEnumValue(EVENT_TYPES, event.type)) issues.push("type is invalid");
  if (
    !["claim", "source", "document", "schema", "context"].includes(
      String(event.entityType),
    )
  ) {
    issues.push("entityType is invalid");
  }
  if (!isNonEmptyString(event.entityId)) {
    issues.push("entityId must be a non-empty string");
  }
  if (!isIsoDate(event.occurredAt)) {
    issues.push("occurredAt must be a valid date-time");
  }
  validateActor(event.actor, "actor", issues);
  if (
    event.data !== undefined &&
    (!isRecord(event.data) || !isJsonValue(event.data))
  ) {
    issues.push("data must be a JSON-compatible object");
  }

  if (issues.length > 0) throw new ValidationError(issues);
}
