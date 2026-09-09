import { z } from "zod";
import { DOMAIN_CONTRACT_VERSION } from "./index.js";

const nonEmptyString = z.string().trim().min(1);
const dateTime = z.string().datetime({ offset: true });

export const portableMemoryFileSchema = z
  .object({
    id: nonEmptyString,
    path: z.string().regex(/^memories\/[A-Za-z0-9._-]+\.md$/),
    revision: z.number().int().positive(),
  })
  .strict();
export type PortableMemoryFile = z.infer<typeof portableMemoryFileSchema>;

export const topoPortableBundleManifestSchema = z
  .object({
    format: z.literal("topo.bundle"),
    version: z.literal("0.2"),
    contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
    createdAt: dateTime,
    counts: z
      .object({
        sources: z.number().int().nonnegative(),
        memories: z.number().int().nonnegative(),
        annotations: z.number().int().nonnegative(),
        events: z.number().int().nonnegative(),
      })
      .strict(),
    files: z
      .object({
        sources: z.literal("sources.jsonl"),
        annotations: z.literal("annotations.jsonl"),
        events: z.literal("events.jsonl"),
      })
      .strict(),
    memories: z.array(portableMemoryFileSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.counts.memories !== manifest.memories.length) {
      context.addIssue({
        code: "custom",
        path: ["counts", "memories"],
        message: "memory count must match manifest memory entries",
      });
    }

    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const memory of manifest.memories) {
      if (ids.has(memory.id)) {
        context.addIssue({
          code: "custom",
          path: ["memories"],
          message: `duplicate Memory Page id: ${memory.id}`,
        });
      }
      if (paths.has(memory.path)) {
        context.addIssue({
          code: "custom",
          path: ["memories"],
          message: `duplicate Memory Page path: ${memory.path}`,
        });
      }
      ids.add(memory.id);
      paths.add(memory.path);
    }
  });

export type TopoPortableBundleManifest = z.infer<
  typeof topoPortableBundleManifestSchema
>;
