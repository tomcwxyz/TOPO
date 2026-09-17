import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  TopoCaptureRequest,
  TopoContextProvider,
  TopoContextRequest,
  TopoPageSearchRequest,
} from "@topo/mcp";
import type { Sensitivity } from "@topo/schemas";

interface DiscoveryFile {
  protocol: string;
  endpoint: string;
  token: string;
}

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

function assertLoopback(endpoint: URL): void {
  const host = endpoint.hostname.toLowerCase();
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "[::1]" &&
    host !== "::1"
  ) {
    throw new Error(
      `TOPO Desktop discovery resolved to non-loopback host ${endpoint.hostname}; refusing connection`,
    );
  }
}

export class LocalDesktopContextProvider implements TopoContextProvider {
  readonly mode = "memory-pages" as const;
  readonly transport = "desktop-loopback";

  private readonly discoveryPath: string;
  private readonly maxSensitivity: Sensitivity;

  constructor(options: {
    discoveryPath?: string;
    maxSensitivity: Sensitivity;
  }) {
    this.discoveryPath = resolve(
      options.discoveryPath ??
        process.env.TOPO_LOCAL_DISCOVERY ??
        join(homedir(), ".topo", "oos-local.json"),
    );
    this.maxSensitivity = options.maxSensitivity;
  }

  async context(request: TopoContextRequest): Promise<unknown> {
    const value = await this.post("/v0/context", {
      subject: request.subject,
      purpose: request.purpose,
      requested_by: request.requestedBy ?? "topo-mcp",
      wanted: {
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.maxItems === undefined
          ? {}
          : { max_items: request.maxItems }),
      },
    });
    return filterContextPacket(value, this.maxSensitivity);
  }

  async searchPages(request: TopoPageSearchRequest): Promise<unknown> {
    const value = await this.post("/v0/search", {
      query: request.query,
      requested_by: request.requestedBy ?? "topo-mcp",
      ...(request.category === undefined ? {} : { category: request.category }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return filterPageSearch(value, this.maxSensitivity);
  }

  async captureInteraction(request: TopoCaptureRequest): Promise<unknown> {
    return this.post("/v0/capture", {
      requested_by: request.requestedBy ?? "topo-mcp",
      interaction: request.interaction,
    });
  }

  private discovery(): DiscoveryFile {
    let raw: string;
    try {
      raw = readFileSync(this.discoveryPath, "utf8");
    } catch {
      throw new Error(
        `TOPO Desktop is not discoverable at ${this.discoveryPath}. Open TOPO Desktop and enable the relevant local permission.`,
      );
    }

    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.protocol !== "string" ||
      typeof value.endpoint !== "string" ||
      typeof value.token !== "string"
    ) {
      throw new Error("TOPO Desktop discovery file is invalid");
    }
    if (value.protocol !== "oos-local/0.1") {
      throw new Error(`Unsupported TOPO Desktop protocol: ${value.protocol}`);
    }
    return {
      protocol: value.protocol,
      endpoint: value.endpoint,
      token: value.token,
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const discovery = this.discovery();
    const base = new URL(discovery.endpoint);
    assertLoopback(base);
    const url = new URL(path, `${base.toString().replace(/\/$/, "")}/`);
    assertLoopback(url);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${discovery.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(
        `Could not reach TOPO Desktop: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const text = await response.text();
    let value: unknown = {};
    if (text.trim().length > 0) {
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`TOPO Desktop returned invalid JSON (${response.status})`);
      }
    }

    if (!response.ok) {
      const detail =
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : `HTTP ${response.status}`;
      throw new Error(`TOPO Desktop local request failed: ${detail}`);
    }
    return value;
  }
}
