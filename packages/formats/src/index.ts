import {
  DOMAIN_CONTRACT_VERSION,
  memoryClaimSchema,
  memoryEventSchema,
  memorySourceSchema,
  topoBundleManifestSchema,
  type MemoryClaim,
  type MemoryEvent,
  type MemorySource,
  type TopoBundleManifest,
} from "@topo/schemas";
import type { MemoryStore } from "@topo/store";

const BUNDLE_FORMAT = "topo.bundle" as const;
const BUNDLE_VERSION = "0.1" as const;
const PAGE_SIZE = 1000;

export const BUNDLE_FILES = {
  manifest: "manifest.json",
  sources: "sources.jsonl",
  claims: "claims.jsonl",
  events: "events.jsonl",
} as const;

export interface TopoBundle {
  manifest: TopoBundleManifest;
  sources: MemorySource[];
  claims: MemoryClaim[];
  events: MemoryEvent[];
}

export type TopoBundleFiles = Record<
  (typeof BUNDLE_FILES)[keyof typeof BUNDLE_FILES],
  string
>;

export class BundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleValidationError";
  }
}

export class BundleConflictError extends Error {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    super(`TOPO bundle conflicts with existing memory: ${conflicts.join(", ")}`);
    this.name = "BundleConflictError";
    this.conflicts = conflicts;
  }
}

function allPages<T>(
  read: (offset: number, limit: number) => T[],
): T[] {
  const output: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = read(offset, PAGE_SIZE);
    output.push(...page);
    if (page.length < PAGE_SIZE) return output;
  }
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function byEventOrder(left: MemoryEvent, right: MemoryEvent): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.id.localeCompare(right.id)
  );
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
  const lines = content.split(/\r?\n/);
  const output: T[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new BundleValidationError(
        `${file} line ${index + 1} is not valid JSON: ${String(error)}`,
      );
    }

    try {
      output.push(parse(value));
    } catch (error) {
      throw new BundleValidationError(
        `${file} line ${index + 1} does not match the TOPO contract: ${String(error)}`,
      );
    }
  }

  return output;
}

function assertUniqueIds(
  label: string,
  values: Array<{ id: string }>,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new BundleValidationError(
        `${label} contains duplicate id ${value.id}`,
      );
    }
    seen.add(value.id);
  }
}

function validateIntegrity(bundle: TopoBundle): void {
  try {
    topoBundleManifestSchema.parse(bundle.manifest);
    for (const source of bundle.sources) memorySourceSchema.parse(source);
    for (const claim of bundle.claims) memoryClaimSchema.parse(claim);
    for (const event of bundle.events) memoryEventSchema.parse(event);
  } catch (error) {
    throw new BundleValidationError(
      `bundle record does not match the TOPO contract: ${String(error)}`,
    );
  }

  assertUniqueIds("sources.jsonl", bundle.sources);
  assertUniqueIds("claims.jsonl", bundle.claims);
  assertUniqueIds("events.jsonl", bundle.events);

  if (bundle.manifest.counts.sources !== bundle.sources.length) {
    throw new BundleValidationError("manifest source count does not match sources.jsonl");
  }
  if (bundle.manifest.counts.claims !== bundle.claims.length) {
    throw new BundleValidationError("manifest claim count does not match claims.jsonl");
  }
  if (bundle.manifest.counts.events !== bundle.events.length) {
    throw new BundleValidationError("manifest event count does not match events.jsonl");
  }

  const sourceIds = new Set(bundle.sources.map((source) => source.id));
  const claimIds = new Set(bundle.claims.map((claim) => claim.id));

  for (const claim of bundle.claims) {
    const sourceId = claim.provenance.sourceId;
    if (sourceId !== undefined && !sourceIds.has(sourceId)) {
      throw new BundleValidationError(
        `claim ${claim.id} references missing source ${sourceId}`,
      );
    }
    for (const supersededId of claim.supersedes) {
      if (!claimIds.has(supersededId)) {
        throw new BundleValidationError(
          `claim ${claim.id} supersedes missing claim ${supersededId}`,
        );
      }
    }
  }

  for (const event of bundle.events) {
    if (event.entityType === "claim" && !claimIds.has(event.entityId)) {
      throw new BundleValidationError(
        `event ${event.id} references missing claim ${event.entityId}`,
      );
    }
    if (event.entityType === "source" && !sourceIds.has(event.entityId)) {
      throw new BundleValidationError(
        `event ${event.id} references missing source ${event.entityId}`,
      );
    }
  }
}

export function exportBundle(
  store: MemoryStore,
  createdAt: string,
): TopoBundle {
  const snapshot = store.transaction(() => {
    const sources = allPages((offset, limit) =>
      store.listSources({ offset, limit }),
    ).sort(byId);
    const claims = allPages((offset, limit) =>
      store.listClaims({ offset, limit }),
    ).sort(byId);
    const events = allPages((offset, limit) =>
      store.listEvents({ offset, limit }),
    ).sort(byEventOrder);

    return { sources, claims, events };
  });

  const manifest = topoBundleManifestSchema.parse({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    contractVersion: DOMAIN_CONTRACT_VERSION,
    createdAt,
    counts: {
      sources: snapshot.sources.length,
      claims: snapshot.claims.length,
      events: snapshot.events.length,
    },
    files: {
      sources: BUNDLE_FILES.sources,
      claims: BUNDLE_FILES.claims,
      events: BUNDLE_FILES.events,
    },
  });

  return { manifest, ...snapshot };
}

export function serializeBundle(bundle: TopoBundle): TopoBundleFiles {
  validateIntegrity(bundle);

  return {
    [BUNDLE_FILES.manifest]: `${JSON.stringify(bundle.manifest, null, 2)}\n`,
    [BUNDLE_FILES.sources]: toJsonl(bundle.sources),
    [BUNDLE_FILES.claims]: toJsonl(bundle.claims),
    [BUNDLE_FILES.events]: toJsonl(bundle.events),
  };
}

export function parseBundle(files: TopoBundleFiles): TopoBundle {
  const required = (name: keyof TopoBundleFiles): string => {
    const content = (files as Partial<TopoBundleFiles>)[name];
    if (typeof content !== "string") {
      throw new BundleValidationError(`${name} is missing from the TOPO bundle`);
    }
    return content;
  };

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(required(BUNDLE_FILES.manifest));
  } catch (error) {
    throw new BundleValidationError(
      `manifest.json is not valid JSON: ${String(error)}`,
    );
  }

  let manifest: TopoBundleManifest;
  try {
    manifest = topoBundleManifestSchema.parse(manifestValue);
  } catch (error) {
    throw new BundleValidationError(
      `manifest.json does not match the TOPO bundle contract: ${String(error)}`,
    );
  }

  const bundle: TopoBundle = {
    manifest,
    sources: parseJsonl(
      required(BUNDLE_FILES.sources),
      BUNDLE_FILES.sources,
      (value) => memorySourceSchema.parse(value),
    ),
    claims: parseJsonl(
      required(BUNDLE_FILES.claims),
      BUNDLE_FILES.claims,
      (value) => memoryClaimSchema.parse(value),
    ),
    events: parseJsonl(
      required(BUNDLE_FILES.events),
      BUNDLE_FILES.events,
      (value) => memoryEventSchema.parse(value),
    ),
  };

  validateIntegrity(bundle);
  return bundle;
}

export function importBundle(
  store: MemoryStore,
  bundle: TopoBundle,
): void {
  validateIntegrity(bundle);

  store.transaction(() => {
    const conflicts: string[] = [];
    for (const source of bundle.sources) {
      if (store.getSource(source.id) !== undefined) {
        conflicts.push(`source:${source.id}`);
      }
    }
    for (const claim of bundle.claims) {
      if (store.getClaim(claim.id) !== undefined) {
        conflicts.push(`claim:${claim.id}`);
      }
    }
    for (const event of bundle.events) {
      if (store.getEvent(event.id) !== undefined) {
        conflicts.push(`event:${event.id}`);
      }
    }

    if (conflicts.length > 0) {
      throw new BundleConflictError(conflicts);
    }

    for (const source of bundle.sources) store.putSource(source);
    for (const claim of bundle.claims) store.putClaim(claim);
    for (const event of bundle.events) store.appendEvent(event);
  });
}
