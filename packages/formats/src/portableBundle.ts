import {
  DOMAIN_CONTRACT_VERSION,
  memoryClaimSchema,
  memoryEventSchema,
  memorySourceSchema,
  type MemoryClaim,
  type MemoryEvent,
  type MemorySource,
} from "@topo/schemas";
import {
  memoryPageEventSchema,
  memoryPageSchema,
  type MemoryPage,
  type MemoryPageEvent,
} from "@topo/schemas/memory-page";
import {
  topoPortableBundleManifestSchema,
  type TopoPortableBundleManifest,
} from "@topo/schemas/portable-bundle";
import {
  memoryPageFilename,
  parseMemoryPageMarkdown,
  renderMemoryPageMarkdown,
} from "./memoryMarkdown.js";

export const PORTABLE_BUNDLE_VERSION = "0.2" as const;
export const PORTABLE_BUNDLE_FILES = {
  manifest: "manifest.json",
  sources: "sources.jsonl",
  annotations: "annotations.jsonl",
  events: "events.jsonl",
} as const;

export type PortableMemoryEvent = MemoryEvent | MemoryPageEvent;

export interface TopoPortableBundle {
  manifest: TopoPortableBundleManifest;
  sources: MemorySource[];
  memories: MemoryPage[];
  annotations: MemoryClaim[];
  events: PortableMemoryEvent[];
}

export type TopoPortableBundleFiles = Record<string, string>;

export class PortableBundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortableBundleValidationError";
  }
}

function toJsonl(values: unknown[]): string {
  if (values.length === 0) return "";
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function parseJsonl<T>(
  content: string,
  file: string,
  parse: (value: unknown) => T,
): T[] {
  const output: T[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new PortableBundleValidationError(
        `${file} line ${index + 1} is not valid JSON: ${String(error)}`,
      );
    }
    try {
      output.push(parse(raw));
    } catch (error) {
      throw new PortableBundleValidationError(
        `${file} line ${index + 1} does not match the TOPO contract: ${String(error)}`,
      );
    }
  }
  return output;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function byEvent(left: PortableMemoryEvent, right: PortableMemoryEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}

function assertUniqueIds(label: string, values: Array<{ id: string }>): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new PortableBundleValidationError(`${label} contains duplicate id ${value.id}`);
    }
    seen.add(value.id);
  }
}

function parsePortableEvent(value: unknown): PortableMemoryEvent {
  const pageEvent = memoryPageEventSchema.safeParse(value);
  if (pageEvent.success) return pageEvent.data;
  return memoryEventSchema.parse(value);
}

function validateIntegrity(bundle: TopoPortableBundle): void {
  try {
    topoPortableBundleManifestSchema.parse(bundle.manifest);
    bundle.sources.forEach((source) => memorySourceSchema.parse(source));
    bundle.memories.forEach((memory) => memoryPageSchema.parse(memory));
    bundle.annotations.forEach((annotation) => memoryClaimSchema.parse(annotation));
    bundle.events.forEach((event) => parsePortableEvent(event));
  } catch (error) {
    throw new PortableBundleValidationError(
      `portable bundle record does not match the TOPO contract: ${String(error)}`,
    );
  }

  assertUniqueIds("sources.jsonl", bundle.sources);
  assertUniqueIds("Memory Pages", bundle.memories);
  assertUniqueIds("annotations.jsonl", bundle.annotations);
  assertUniqueIds("events.jsonl", bundle.events);

  if (bundle.manifest.counts.sources !== bundle.sources.length) {
    throw new PortableBundleValidationError("manifest source count does not match sources.jsonl");
  }
  if (bundle.manifest.counts.memories !== bundle.memories.length) {
    throw new PortableBundleValidationError("manifest memory count does not match memories/");
  }
  if (bundle.manifest.counts.annotations !== bundle.annotations.length) {
    throw new PortableBundleValidationError(
      "manifest annotation count does not match annotations.jsonl",
    );
  }
  if (bundle.manifest.counts.events !== bundle.events.length) {
    throw new PortableBundleValidationError("manifest event count does not match events.jsonl");
  }

  const sourceIds = new Set(bundle.sources.map((source) => source.id));
  const memoryIds = new Set(bundle.memories.map((memory) => memory.id));
  const annotationIds = new Set(bundle.annotations.map((annotation) => annotation.id));
  const manifestMemories = new Map(bundle.manifest.memories.map((entry) => [entry.id, entry]));

  for (const memory of bundle.memories) {
    const manifestEntry = manifestMemories.get(memory.id);
    if (manifestEntry === undefined) {
      throw new PortableBundleValidationError(`memory ${memory.id} is missing from manifest`);
    }
    if (manifestEntry.revision !== memory.revision) {
      throw new PortableBundleValidationError(
        `memory ${memory.id} revision does not match manifest`,
      );
    }
    for (const reference of memory.sourceRefs) {
      if (!sourceIds.has(reference.sourceId)) {
        throw new PortableBundleValidationError(
          `memory ${memory.id} references missing source ${reference.sourceId}`,
        );
      }
    }
    for (const annotationId of memory.annotationIds) {
      if (!annotationIds.has(annotationId)) {
        throw new PortableBundleValidationError(
          `memory ${memory.id} references missing annotation ${annotationId}`,
        );
      }
    }
    for (const supersededId of memory.supersedes) {
      if (!memoryIds.has(supersededId)) {
        throw new PortableBundleValidationError(
          `memory ${memory.id} supersedes missing memory ${supersededId}`,
        );
      }
    }
  }

  for (const annotation of bundle.annotations) {
    const sourceId = annotation.provenance.sourceId;
    if (sourceId !== undefined && !sourceIds.has(sourceId)) {
      throw new PortableBundleValidationError(
        `annotation ${annotation.id} references missing source ${sourceId}`,
      );
    }
    for (const supersededId of annotation.supersedes) {
      if (!annotationIds.has(supersededId)) {
        throw new PortableBundleValidationError(
          `annotation ${annotation.id} supersedes missing annotation ${supersededId}`,
        );
      }
    }
  }

  for (const event of bundle.events) {
    if (event.entityType === "memory" && !memoryIds.has(event.entityId)) {
      throw new PortableBundleValidationError(
        `event ${event.id} references missing memory ${event.entityId}`,
      );
    }
    if (event.entityType === "claim" && !annotationIds.has(event.entityId)) {
      throw new PortableBundleValidationError(
        `event ${event.id} references missing annotation ${event.entityId}`,
      );
    }
    if (event.entityType === "source" && !sourceIds.has(event.entityId)) {
      throw new PortableBundleValidationError(
        `event ${event.id} references missing source ${event.entityId}`,
      );
    }
  }
}

export interface CreatePortableBundleInput {
  createdAt: string;
  sources: MemorySource[];
  memories: MemoryPage[];
  annotations?: MemoryClaim[];
  events?: PortableMemoryEvent[];
}

export function createPortableBundle(input: CreatePortableBundleInput): TopoPortableBundle {
  const sources = [...input.sources].sort(byId);
  const memories = [...input.memories].sort(byId);
  const annotations = [...(input.annotations ?? [])].sort(byId);
  const events = [...(input.events ?? [])].sort(byEvent);
  const memoryEntries = memories.map((memory) => ({
    id: memory.id,
    path: `memories/${memoryPageFilename(memory)}`,
    revision: memory.revision,
  }));

  const manifest = topoPortableBundleManifestSchema.parse({
    format: "topo.bundle",
    version: PORTABLE_BUNDLE_VERSION,
    contractVersion: DOMAIN_CONTRACT_VERSION,
    createdAt: input.createdAt,
    counts: {
      sources: sources.length,
      memories: memories.length,
      annotations: annotations.length,
      events: events.length,
    },
    files: {
      sources: PORTABLE_BUNDLE_FILES.sources,
      annotations: PORTABLE_BUNDLE_FILES.annotations,
      events: PORTABLE_BUNDLE_FILES.events,
    },
    memories: memoryEntries,
  });

  const bundle = { manifest, sources, memories, annotations, events };
  validateIntegrity(bundle);
  return bundle;
}

export function serializePortableBundle(
  bundle: TopoPortableBundle,
): TopoPortableBundleFiles {
  validateIntegrity(bundle);
  const files: TopoPortableBundleFiles = {
    [PORTABLE_BUNDLE_FILES.manifest]: `${JSON.stringify(bundle.manifest, null, 2)}\n`,
    [PORTABLE_BUNDLE_FILES.sources]: toJsonl(bundle.sources),
    [PORTABLE_BUNDLE_FILES.annotations]: toJsonl(bundle.annotations),
    [PORTABLE_BUNDLE_FILES.events]: toJsonl(bundle.events),
  };

  const memories = new Map(bundle.memories.map((memory) => [memory.id, memory]));
  for (const entry of bundle.manifest.memories) {
    const memory = memories.get(entry.id);
    if (memory === undefined) {
      throw new PortableBundleValidationError(`manifest references missing memory ${entry.id}`);
    }
    files[entry.path] = renderMemoryPageMarkdown(memory);
  }

  return files;
}

export function parsePortableBundle(files: TopoPortableBundleFiles): TopoPortableBundle {
  const required = (path: string): string => {
    const content = files[path];
    if (typeof content !== "string") {
      throw new PortableBundleValidationError(`${path} is missing from the TOPO bundle`);
    }
    return content;
  };

  let manifest: TopoPortableBundleManifest;
  try {
    manifest = topoPortableBundleManifestSchema.parse(
      JSON.parse(required(PORTABLE_BUNDLE_FILES.manifest)),
    );
  } catch (error) {
    throw new PortableBundleValidationError(
      `manifest.json does not match TOPO portable bundle v0.2: ${String(error)}`,
    );
  }

  const sources = parseJsonl(
    required(manifest.files.sources),
    manifest.files.sources,
    (value) => memorySourceSchema.parse(value),
  );
  const annotations = parseJsonl(
    required(manifest.files.annotations),
    manifest.files.annotations,
    (value) => memoryClaimSchema.parse(value),
  );
  const events = parseJsonl(
    required(manifest.files.events),
    manifest.files.events,
    parsePortableEvent,
  );
  const memories = manifest.memories.map((entry) => {
    const memory = parseMemoryPageMarkdown(required(entry.path));
    if (memory.id !== entry.id) {
      throw new PortableBundleValidationError(
        `${entry.path} id ${memory.id} does not match manifest id ${entry.id}`,
      );
    }
    if (memory.revision !== entry.revision) {
      throw new PortableBundleValidationError(
        `${entry.path} revision ${memory.revision} does not match manifest revision ${entry.revision}`,
      );
    }
    return memory;
  });

  const bundle = { manifest, sources, memories, annotations, events };
  validateIntegrity(bundle);
  return bundle;
}
