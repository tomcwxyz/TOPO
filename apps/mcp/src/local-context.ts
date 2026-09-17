import type {
  TopoCaptureRequest,
  TopoContextProvider,
  TopoContextRequest,
  TopoPageSearchRequest,
} from "@topo/mcp";
import { TopoLocalClient } from "@topo/oos/local-client";
import type { Sensitivity } from "@topo/schemas";

const sensitivityRank: Record<Sensitivity, number> = {
  ordinary: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sensitivityOf(value: unknown): Sensitivity | undefined {
  if (
    value === "ordinary" ||
    value === "personal" ||
    value === "sensitive" ||
    value === "restricted"
  ) {
    return value;
  }
  return undefined;
}

function allowed(value: unknown, ceiling: Sensitivity): boolean {
  const sensitivity = sensitivityOf(value);
  return (
    sensitivity !== undefined &&
    sensitivityRank[sensitivity] <= sensitivityRank[ceiling]
  );
}

function filterContextPacket(value: unknown, ceiling: Sensitivity): unknown {
  if (!isRecord(value) || !Array.isArray(value.objects)) return value;

  const objects = value.objects.filter((item) => {
    if (!isRecord(item) || !isRecord(item.value)) return false;
    return allowed(item.value.sensitivity, ceiling);
  });
  const selectedIds = new Set(
    objects
      .map((item) => (isRecord(item) ? item.id : undefined))
      .filter((id): id is string => typeof id === "string"),
  );
  const evidenceRefs = new Set<string>();
  for (const item of objects) {
    if (!isRecord(item) || !isRecord(item.value)) continue;
    const sourceRefs = item.value.source_refs;
    if (!Array.isArray(sourceRefs)) continue;
    for (const sourceRef of sourceRefs) {
      if (!isRecord(sourceRef)) continue;
      const sourceId = sourceRef.source_id;
      if (typeof sourceId === "string") evidenceRefs.add(sourceId);
    }
  }

  const provenance = isRecord(value.provenance)
    ? {
        ...value.provenance,
        derived_from: Array.isArray(value.provenance.derived_from)
          ? value.provenance.derived_from.filter(
              (id): id is string =>
                typeof id === "string" && selectedIds.has(id),
            )
          : value.provenance.derived_from,
        extensions: isRecord(value.provenance.extensions)
          ? {
              ...value.provenance.extensions,
              page_revisions: isRecord(
                value.provenance.extensions.page_revisions,
              )
                ? Object.fromEntries(
                    Object.entries(
                      value.provenance.extensions.page_revisions,
                    ).filter(([id]) => selectedIds.has(id)),
                  )
                : value.provenance.extensions.page_revisions,
            }
          : value.provenance.extensions,
      }
    : value.provenance;

  const extensions = isRecord(value.extensions)
    ? {
        ...value.extensions,
        "topo.relevance": isRecord(value.extensions["topo.relevance"])
          ? Object.fromEntries(
              Object.entries(value.extensions["topo.relevance"]).filter(([id]) =>
                selectedIds.has(id),
              ),
            )
          : value.extensions["topo.relevance"],
        "topo.mcp_sensitivity_ceiling": ceiling,
      }
    : value.extensions;

  return {
    ...value,
    objects,
    evidence_refs: [...evidenceRefs],
    provenance,
    extensions,
  };
}

function filterPageSearch(value: unknown, ceiling: Sensitivity): unknown {
  if (!isRecord(value) || !Array.isArray(value.results)) return value;
  return {
    ...value,
    results: value.results.filter((item) => {
      if (!isRecord(item) || !isRecord(item.memoryPage)) return false;
      return allowed(item.memoryPage.sensitivity, ceiling);
    }),
    mcpSensitivityCeiling: ceiling,
  };
}

export class LocalDesktopContextProvider implements TopoContextProvider {
  readonly mode = "memory-pages" as const;
  readonly transport = "desktop-loopback";

  private readonly client: TopoLocalClient;
  private readonly maxSensitivity: Sensitivity;

  constructor(options: {
    discoveryPath?: string;
    maxSensitivity: Sensitivity;
  }) {
    this.client = new TopoLocalClient({
      ...(options.discoveryPath === undefined
        ? {}
        : { discoveryPath: options.discoveryPath }),
    });
    this.maxSensitivity = options.maxSensitivity;
  }

  async context(request: TopoContextRequest): Promise<unknown> {
    const value = await this.client.context({
      subject: request.subject,
      purpose: request.purpose,
      requestedBy: request.requestedBy ?? "topo-mcp",
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.maxItems === undefined
        ? {}
        : { maxItems: request.maxItems }),
    });
    return filterContextPacket(value, this.maxSensitivity);
  }

  async searchPages(request: TopoPageSearchRequest): Promise<unknown> {
    const value = await this.client.searchPages({
      query: request.query,
      requestedBy: request.requestedBy ?? "topo-mcp",
      ...(request.category === undefined ? {} : { category: request.category }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return filterPageSearch(value, this.maxSensitivity);
  }

  async captureInteraction(request: TopoCaptureRequest): Promise<unknown> {
    return this.client.captureInteraction({
      requestedBy: request.requestedBy ?? "topo-mcp",
      interaction: request.interaction,
    });
  }
}
