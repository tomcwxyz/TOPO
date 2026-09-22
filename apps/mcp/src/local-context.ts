import type {
  TopoCaptureRequest,
  TopoContextProvider,
  TopoContextRequest,
  TopoPageSearchRequest,
} from "@topo/mcp";
import {
  narrowContextPacket,
  narrowPageSearch,
} from "@topo/oos/context-filter";
import { TopoLocalClient } from "@topo/oos/local-client";
import type { Sensitivity } from "@topo/schemas";

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
    return narrowContextPacket(
      value,
      this.maxSensitivity,
      "topo.mcp_sensitivity_ceiling",
    );
  }

  async searchPages(request: TopoPageSearchRequest): Promise<unknown> {
    const value = await this.client.searchPages({
      query: request.query,
      requestedBy: request.requestedBy ?? "topo-mcp",
      ...(request.category === undefined ? {} : { category: request.category }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return narrowPageSearch(
      value,
      this.maxSensitivity,
      "mcpSensitivityCeiling",
    );
  }

  async captureInteraction(request: TopoCaptureRequest): Promise<unknown> {
    return this.client.captureInteraction({
      requestedBy: request.requestedBy ?? "topo-mcp",
      interaction: request.interaction,
    });
  }
}
