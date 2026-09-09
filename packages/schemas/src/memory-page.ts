import { z } from "zod";
import type { Actor, JsonValue } from "./index.js";

const nonEmptyString = z.string().trim().min(1);
const dateTime = z.string().datetime({ offset: true });

const memoryPageSensitivitySchema = z.enum([
  "ordinary",
  "personal",
  "sensitive",
  "restricted",
]);

const memoryPageHorizonSchema = z.enum([
  "durable",
  "project",
  "temporary",
]);

export const memoryPageStatusSchema = z.enum([
  "candidate",
  "confirmed",
  "rejected",
  "superseded",
  "expired",
]);
export type MemoryPageStatus = z.infer<typeof memoryPageStatusSchema>;
export const MEMORY_PAGE_STATUSES = memoryPageStatusSchema.options;

export const memoryPageOriginSchema = z.enum([
  "manual",
  "extracted",
  "imported",
  "compatibility",
]);
export type MemoryPageOrigin = z.infer<typeof memoryPageOriginSchema>;

export const memoryPageSourceRefSchema = z
  .object({
    sourceId: nonEmptyString,
    evidence: nonEmptyString.optional(),
    turnIds: z
      .array(nonEmptyString)
      .refine(
        (turnIds) => new Set(turnIds).size === turnIds.length,
        "turnIds must be unique",
      )
      .optional(),
  })
  .strict();
export type MemoryPageSourceRef = z.infer<typeof memoryPageSourceRefSchema>;

export const memoryPageSchema = z
  .object({
    id: nonEmptyString,
    subject: nonEmptyString,
    title: nonEmptyString,
    summary: nonEmptyString.optional(),
    body: nonEmptyString,
    category: nonEmptyString.optional(),
    tags: z.array(nonEmptyString).refine(
      (tags) => new Set(tags).size === tags.length,
      "tags must be unique",
    ),
    status: memoryPageStatusSchema,
    sensitivity: memoryPageSensitivitySchema,
    horizon: memoryPageHorizonSchema,
    origin: memoryPageOriginSchema,
    sourceRefs: z.array(memoryPageSourceRefSchema).min(1),
    annotationIds: z.array(nonEmptyString).refine(
      (ids) => new Set(ids).size === ids.length,
      "annotationIds must be unique",
    ),
    validFrom: dateTime.optional(),
    validUntil: dateTime.optional(),
    supersedes: z.array(nonEmptyString).refine(
      (ids) => new Set(ids).size === ids.length,
      "supersedes must be unique",
    ),
    revision: z.number().int().positive(),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .strict()
  .superRefine((page, context) => {
    if (
      page.validFrom !== undefined &&
      page.validUntil !== undefined &&
      Date.parse(page.validUntil) < Date.parse(page.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil cannot be before validFrom",
      });
    }

    if (page.supersedes.includes(page.id)) {
      context.addIssue({
        code: "custom",
        path: ["supersedes"],
        message: "a Memory Page cannot supersede itself",
      });
    }
  });
export type MemoryPage = z.infer<typeof memoryPageSchema>;

export type MemoryPageEventType =
  | "memory.proposed"
  | "memory.confirmed"
  | "memory.edited"
  | "memory.rejected"
  | "memory.superseded"
  | "memory.expired";

export interface MemoryPageEvent {
  id: string;
  type: MemoryPageEventType;
  entityType: "memory";
  entityId: string;
  occurredAt: string;
  actor: Actor;
  data?: Record<string, JsonValue>;
}

export interface MemoryPageTransition {
  page: MemoryPage;
  event: MemoryPageEvent;
}

export function validateMemoryPage(value: unknown): asserts value is MemoryPage {
  const result = memoryPageSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid TOPO Memory Page: ${result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message}`;
        })
        .join("; ")}`,
    );
  }
}
