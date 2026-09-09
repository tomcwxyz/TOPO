import type { MemoryStore } from "@topo/store";
import type { MemoryPageStore } from "@topo/store/memory-pages";
import {
  createPortableBundle,
  serializePortableBundle,
  type TopoPortableBundle,
} from "./portableBundle.js";

const PAGE_SIZE = 1000;

export interface PortableBundleStores {
  memory: MemoryStore;
  pages: MemoryPageStore;
}

export class PortableBundleConflictError extends Error {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    super(`TOPO portable bundle conflicts with existing memory: ${conflicts.join(", ")}`);
    this.name = "PortableBundleConflictError";
    this.conflicts = conflicts;
  }
}

function allPages<T>(read: (offset: number, limit: number) => T[]): T[] {
  const output: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = read(offset, PAGE_SIZE);
    output.push(...page);
    if (page.length < PAGE_SIZE) return output;
  }
}

export function exportPortableBundleFromStores(
  stores: PortableBundleStores,
  createdAt: string,
): TopoPortableBundle {
  const canonical = stores.memory.transaction(() => ({
    sources: allPages((offset, limit) =>
      stores.memory.listSources({ offset, limit }),
    ),
    annotations: allPages((offset, limit) =>
      stores.memory.listClaims({ offset, limit }),
    ),
    events: allPages((offset, limit) =>
      stores.memory.listEvents({ offset, limit }),
    ),
  }));

  const pageSnapshot = stores.pages.transaction(() => ({
    memories: allPages((offset, limit) =>
      stores.pages.listMemoryPages({ offset, limit }),
    ),
    events: allPages((offset, limit) =>
      stores.pages.listMemoryPageEvents({ offset, limit }),
    ),
  }));

  return createPortableBundle({
    createdAt,
    sources: canonical.sources,
    memories: pageSnapshot.memories,
    annotations: canonical.annotations,
    events: [...canonical.events, ...pageSnapshot.events],
  });
}

function preflightConflicts(
  stores: PortableBundleStores,
  bundle: TopoPortableBundle,
): string[] {
  const conflicts: string[] = [];

  for (const source of bundle.sources) {
    if (stores.memory.getSource(source.id) !== undefined) {
      conflicts.push(`source:${source.id}`);
    }
  }
  for (const annotation of bundle.annotations) {
    if (stores.memory.getClaim(annotation.id) !== undefined) {
      conflicts.push(`annotation:${annotation.id}`);
    }
  }
  for (const memory of bundle.memories) {
    if (stores.pages.getMemoryPage(memory.id) !== undefined) {
      conflicts.push(`memory:${memory.id}`);
    }
  }
  for (const event of bundle.events) {
    if (
      stores.memory.getEvent(event.id) !== undefined ||
      stores.pages.getMemoryPageEvent(event.id) !== undefined
    ) {
      conflicts.push(`event:${event.id}`);
    }
  }

  return conflicts;
}

/**
 * Conservatively import a validated portable bundle into the current split
 * alpha stores.
 *
 * The complete bundle and all destination IDs are checked before the first
 * write. Sources/annotations are committed before Memory Pages because page
 * persistence verifies source references. The two alpha store adapters do not
 * yet share one cross-store transaction, so this function deliberately avoids
 * claiming stronger atomicity than the current architecture provides.
 */
export function importPortableBundleToStores(
  stores: PortableBundleStores,
  bundle: TopoPortableBundle,
): void {
  // Serialisation performs the full contract/integrity validation without
  // depending on the destination stores.
  serializePortableBundle(bundle);

  const conflicts = preflightConflicts(stores, bundle);
  if (conflicts.length > 0) {
    throw new PortableBundleConflictError(conflicts);
  }

  const canonicalEvents = bundle.events.filter(
    (event) => event.entityType !== "memory",
  );
  const pageEvents = bundle.events.filter(
    (event) => event.entityType === "memory",
  );

  stores.memory.transaction(() => {
    for (const source of bundle.sources) stores.memory.putSource(source);
    for (const annotation of bundle.annotations) stores.memory.putClaim(annotation);
    for (const event of canonicalEvents) stores.memory.appendEvent(event);
  });

  stores.pages.transaction(() => {
    for (const memory of bundle.memories) stores.pages.putMemoryPage(memory);
    for (const event of pageEvents) stores.pages.appendMemoryPageEvent(event);
  });
}
