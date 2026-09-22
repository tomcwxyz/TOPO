import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { CapturedInteraction, JsonValue } from "@topo/schemas";

export interface TopoLocalContextRequest {
  subject: string;
  purpose: string;
  requestedBy: string;
  query?: string;
  maxItems?: number;
}

export interface TopoLocalSearchRequest {
  query: string;
  requestedBy: string;
  category?: string;
  limit?: number;
}

export interface TopoLocalCaptureRequest {
  interaction: CapturedInteraction;
  requestedBy: string;
}

interface DiscoveryFile {
  protocol: string;
  endpoint: string;
  token: string;
}

export interface TopoLocalClientOptions {
  discoveryPath?: string;
  fetch?: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function desktopAcceptsCaptureDirectly(interaction: CapturedInteraction): boolean {
  return (
    interaction.kind === "agent-session" &&
    interaction.mode === "agent" &&
    interaction.captureMethod === "agent-hook" &&
    interaction.client === "agent-runtime" &&
    (interaction.product === "hermes" ||
      interaction.product === "openclaw" ||
      interaction.product === "generic")
  );
}

/**
 * Desktop's current local capture endpoint has a deliberately narrow agent-hook
 * trust contract. MCP/CLI callers may describe their actual source more
 * precisely (for example Claude + terminal + local-mcp). Adapt only the
 * transport envelope needed by Desktop and preserve the original capture
 * identity in metadata so provenance is not silently discarded.
 */
export function toDesktopCaptureEnvelope(
  interaction: CapturedInteraction,
): CapturedInteraction {
  if (desktopAcceptsCaptureDirectly(interaction)) return interaction;

  const originalCapture: { [key: string]: JsonValue } = {
    kind: interaction.kind,
    product: interaction.product,
    client: interaction.client,
    mode: interaction.mode,
    captureMethod: interaction.captureMethod,
  };

  return {
    ...interaction,
    kind: "agent-session",
    product:
      interaction.product === "hermes" ||
      interaction.product === "openclaw" ||
      interaction.product === "generic"
        ? interaction.product
        : "generic",
    client: "agent-runtime",
    mode: "agent",
    captureMethod: "agent-hook",
    metadata: {
      ...(interaction.metadata ?? {}),
      "topo.local.originalCapture": originalCapture,
    },
  };
}

/**
 * Client for TOPO Desktop's authenticated, per-run loopback service.
 *
 * This is deliberately transport-only. It does not interpret Memory Pages,
 * widen sensitivity, or make review decisions. Callers may narrow returned
 * material further, but TOPO Desktop remains the canonical governance resolver.
 */
export class TopoLocalClient {
  private readonly discoveryPath: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: TopoLocalClientOptions = {}) {
    this.discoveryPath = resolve(
      options.discoveryPath ??
        process.env.TOPO_LOCAL_DISCOVERY ??
        join(homedir(), ".topo", "oos-local.json"),
    );
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async context(request: TopoLocalContextRequest): Promise<unknown> {
    return this.post("/v0/context", {
      subject: request.subject,
      purpose: request.purpose,
      requested_by: request.requestedBy,
      wanted: {
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.maxItems === undefined
          ? {}
          : { max_items: request.maxItems }),
      },
    });
  }

  async searchPages(request: TopoLocalSearchRequest): Promise<unknown> {
    return this.post("/v0/search", {
      query: request.query,
      requested_by: request.requestedBy,
      ...(request.category === undefined ? {} : { category: request.category }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
  }

  async captureInteraction(request: TopoLocalCaptureRequest): Promise<unknown> {
    return this.post("/v0/capture", {
      requested_by: request.requestedBy,
      interaction: toDesktopCaptureEnvelope(request.interaction),
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

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("TOPO Desktop discovery file is invalid JSON");
    }

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
      response = await this.fetcher(url, {
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
