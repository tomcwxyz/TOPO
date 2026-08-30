import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const nonEmptyString = z.string().trim().min(1);
const dateTime = z.string().datetime({ offset: true });

export const epistemicTypeSchema = z.enum([
  "assertion",
  "observation",
  "inference",
  "preference",
  "derived-pattern",
]);
export type EpistemicType = z.infer<typeof epistemicTypeSchema>;
export const EPISTEMIC_TYPES = epistemicTypeSchema.options;

export const claimStatusSchema = z.enum([
  "candidate",
  "confirmed",
  "rejected",
  "superseded",
  "expired",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export const CLAIM_STATUSES = claimStatusSchema.options;

export const sensitivitySchema = z.enum([
  "ordinary",
  "personal",
  "sensitive",
  "restricted",
]);
export type Sensitivity = z.infer<typeof sensitivitySchema>;
export const SENSITIVITY_LEVELS = sensitivitySchema.options;

export const sourceTypeSchema = z.enum([
  "conversation",
  "document",
  "manual",
  "mcp",
  "import",
  "connector",
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;
export const SOURCE_TYPES = sourceTypeSchema.options;

export const actorTypeSchema = z.enum(["user", "agent", "system", "import"]);
export type ActorType = z.infer<typeof actorTypeSchema>;
export const ACTOR_TYPES = actorTypeSchema.options;

export const actorSchema = z
  .object({
    type: actorTypeSchema,
    id: nonEmptyString.optional(),
  })
  .strict();
export type Actor = z.infer<typeof actorSchema>;

export const claimProvenanceSchema = z
  .object({
    sourceType: sourceTypeSchema,
    provider: nonEmptyString.optional(),
    sourceId: nonEmptyString.optional(),
    evidence: nonEmptyString.optional(),
    capturedAt: dateTime,
  })
  .strict();
export type ClaimProvenance = z.infer<typeof claimProvenanceSchema>;

export const memoryClaimSchema = z
  .object({
    id: nonEmptyString,
    subject: nonEmptyString,
    key: nonEmptyString,
    value: jsonValueSchema,
    category: nonEmptyString.optional(),
    tags: z.array(nonEmptyString).refine(
      (tags) => new Set(tags).size === tags.length,
      "tags must be unique",
    ),
    epistemicType: epistemicTypeSchema,
    confidence: z.number().finite().min(0).max(1),
    provenance: claimProvenanceSchema,
    status: claimStatusSchema,
    sensitivity: sensitivitySchema,
    validFrom: dateTime.optional(),
    validUntil: dateTime.optional(),
    supersedes: z.array(nonEmptyString),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      claim.validFrom !== undefined &&
      claim.validUntil !== undefined &&
      Date.parse(claim.validUntil) < Date.parse(claim.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil cannot be before validFrom",
      });
    }
  });
export type MemoryClaim = z.infer<typeof memoryClaimSchema>;

export const memorySourceSchema = z
  .object({
    id: nonEmptyString,
    type: sourceTypeSchema,
    title: nonEmptyString.optional(),
    provider: nonEmptyString.optional(),
    externalId: nonEmptyString.optional(),
    capturedAt: dateTime,
    createdAt: dateTime,
    sensitivity: sensitivitySchema,
    metadata: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();
export type MemorySource = z.infer<typeof memorySourceSchema>;

export const eventTypeSchema = z.enum([
  "source.captured",
  "claim.proposed",
  "claim.confirmed",
  "claim.edited",
  "claim.rejected",
  "claim.superseded",
  "claim.expired",
  "document.generated",
  "document.accepted",
  "context.resolved",
  "context.shared",
  "schema.updated",
]);
export type MemoryEventType = z.infer<typeof eventTypeSchema>;
export const EVENT_TYPES = eventTypeSchema.options;

export const eventEntityTypeSchema = z.enum([
  "claim",
  "source",
  "document",
  "schema",
  "context",
]);

export const memoryEventSchema = z
  .object({
    id: nonEmptyString,
    type: eventTypeSchema,
    entityType: eventEntityTypeSchema,
    entityId: nonEmptyString,
    occurredAt: dateTime,
    actor: actorSchema,
    data: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();
export type MemoryEvent = z.infer<typeof memoryEventSchema>;

export interface ClaimTransition {
  claim: MemoryClaim;
  event: MemoryEvent;
}

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid TOPO data: ${issues.join("; ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function assertSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): asserts value is T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      }),
    );
  }
}

export function isJsonValue(value: unknown): value is JsonValue {
  return jsonValueSchema.safeParse(value).success;
}

export function validateClaim(value: unknown): asserts value is MemoryClaim {
  assertSchema(memoryClaimSchema, value);
}

export function validateSource(value: unknown): asserts value is MemorySource {
  assertSchema(memorySourceSchema, value);
}

export function validateEvent(value: unknown): asserts value is MemoryEvent {
  assertSchema(memoryEventSchema, value);
}
