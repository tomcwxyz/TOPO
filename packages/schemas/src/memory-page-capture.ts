import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const dateTime = z.string().datetime({ offset: true });

const jsonValueSchema: z.ZodType<
  string | number | boolean | null | unknown[] | { [key: string]: unknown }
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const sensitivitySchema = z.enum([
  "ordinary",
  "personal",
  "sensitive",
  "restricted",
]);

const horizonSchema = z.enum(["durable", "project", "temporary"]);

const epistemicTypeSchema = z.enum([
  "assertion",
  "observation",
  "inference",
  "preference",
  "derived-pattern",
]);

export const memoryPageAnnotationProposalSchema = z
  .object({
    key: nonEmptyString,
    value: jsonValueSchema,
    category: nonEmptyString.optional(),
    tags: z
      .array(nonEmptyString)
      .refine((tags) => new Set(tags).size === tags.length, "tags must be unique")
      .optional(),
    epistemicType: epistemicTypeSchema,
    confidence: z.number().finite().min(0).max(1),
    sensitivity: sensitivitySchema.optional(),
  })
  .strict();

export type MemoryPageAnnotationProposal = z.infer<
  typeof memoryPageAnnotationProposalSchema
>;

export const extractedMemoryPageProposalSchema = z
  .object({
    title: nonEmptyString,
    summary: nonEmptyString.optional(),
    body: nonEmptyString,
    category: nonEmptyString.optional(),
    tags: z
      .array(nonEmptyString)
      .refine((tags) => new Set(tags).size === tags.length, "tags must be unique")
      .optional(),
    sensitivity: sensitivitySchema.optional(),
    horizon: horizonSchema.optional(),
    evidenceTurnIds: z
      .array(nonEmptyString)
      .min(1)
      .refine(
        (turnIds) => new Set(turnIds).size === turnIds.length,
        "evidenceTurnIds must be unique",
      ),
    evidence: nonEmptyString,
    validFrom: dateTime.optional(),
    validUntil: dateTime.optional(),
    annotations: z.array(memoryPageAnnotationProposalSchema).max(8).optional(),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (
      proposal.validFrom !== undefined &&
      proposal.validUntil !== undefined &&
      Date.parse(proposal.validUntil) < Date.parse(proposal.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil cannot be before validFrom",
      });
    }
  });

export type ExtractedMemoryPageProposal = z.infer<
  typeof extractedMemoryPageProposalSchema
>;

export function validateExtractedMemoryPageProposal(
  value: unknown,
): asserts value is ExtractedMemoryPageProposal {
  const result = extractedMemoryPageProposalSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid TOPO Memory Page proposal: ${result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message}`;
        })
        .join("; ")}`,
    );
  }
}
