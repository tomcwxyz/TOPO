import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { TopoContextRequest } from "./server.js";

export interface TopoRemoteContextProvider {
  readonly transport: string;
  context(request: TopoContextRequest): Promise<unknown>;
}

function result(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function failure(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

/**
 * Minimal MCP surface for hosted/remote clients.
 *
 * It deliberately does not reuse the local MCP server because that surface also
 * carries legacy claim search/proposal tools. Remote v0 is read-only and
 * purpose-bound: capabilities plus topo_context, nothing else.
 */
export function createTopoRemoteMcpServer(
  provider: TopoRemoteContextProvider,
): McpServer {
  const server = new McpServer({
    name: "topo-remote",
    version: "0.1.0",
  });

  server.registerTool(
    "topo_capabilities",
    {
      description:
        "Show the authority of this remote TOPO connection. Remote v0 is read-only and purpose-bound.",
      inputSchema: z.object({}),
    },
    async () =>
      result({
        mode: "read-only",
        representation: "memory-pages",
        transport: provider.transport,
        tools: ["topo_context"],
        search: false,
        captureAuthority: false,
        contributionAuthority: false,
        reviewAuthority: false,
      }),
  );

  server.registerTool(
    "topo_context",
    {
      description:
        "Resolve a small purpose-bound Context Packet from the user's governed TOPO Memory Pages through an authenticated remote grant.",
      inputSchema: z.object({
        subject: z.string().min(1).default("self"),
        purpose: z.string().min(1),
        query: z.string().min(1).optional(),
        maxItems: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (input) => {
      try {
        return result(
          await provider.context({
            subject: input.subject,
            purpose: input.purpose,
            ...(input.query === undefined ? {} : { query: input.query }),
            ...(input.maxItems === undefined
              ? {}
              : { maxItems: input.maxItems }),
            requestedBy: "topo-remote-mcp",
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
