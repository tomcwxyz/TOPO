#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const DISCOVERY_PATH = join(homedir(), ".topo", "oos-local.json");
const REQUESTED_BY = "claude-desktop";
const REQUEST_TIMEOUT_MS = 10_000;

type Discovery = {
  protocol: string;
  endpoint: string;
  token: string;
};

const epistemicType = z.enum([
  "assertion",
  "observation",
  "inference",
  "preference",
  "derived-pattern",
]);

const sensitivity = z.enum(["ordinary", "personal"]);

const proposal = z.object({
  subject: z.string().min(1).optional(),
  key: z.string().min(1),
  value: z.json(),
  category: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).max(50).optional(),
  epistemicType,
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().min(1).optional(),
  sensitivity: sensitivity.optional(),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
});

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

async function readDiscovery(): Promise<Discovery> {
  let raw: string;
  try {
    raw = await readFile(DISCOVERY_PATH, "utf8");
  } catch {
    throw new Error(
      "TOPO Desktop is not running. Open TOPO Desktop before using the TOPO Claude connection.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("TOPO local discovery file is invalid.");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("protocol" in value) ||
    !("endpoint" in value) ||
    !("token" in value)
  ) {
    throw new Error("TOPO local discovery file is incomplete.");
  }

  const discovery = value as Record<string, unknown>;
  if (
    typeof discovery.protocol !== "string" ||
    !discovery.protocol.startsWith("oos-local/") ||
    typeof discovery.endpoint !== "string" ||
    typeof discovery.token !== "string" ||
    discovery.token.length < 16
  ) {
    throw new Error("TOPO local discovery file failed validation.");
  }

  const endpoint = new URL(discovery.endpoint);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (endpoint.protocol !== "http:" || !loopbackHosts.has(endpoint.hostname)) {
    throw new Error("TOPO refused a non-loopback local discovery endpoint.");
  }

  return {
    protocol: discovery.protocol,
    endpoint: endpoint.origin,
    token: discovery.token,
  };
}

async function callTopo(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<unknown> {
  const discovery = await readDiscovery();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(new URL(path, discovery.endpoint), {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${discovery.token}`,
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      const error =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as Record<string, unknown>).error === "string"
          ? String((payload as Record<string, unknown>).error)
          : `TOPO returned HTTP ${response.status}`;
      throw new Error(error);
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TOPO local request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "topo-claude-desktop",
    version: "0.1.0",
  });

  server.registerTool(
    "topo_capabilities",
    {
      description:
        "Check which TOPO local permissions are currently enabled. Use this when a TOPO tool says access is disabled.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await callTopo("/v0/capabilities"));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "topo_context",
    {
      description:
        "Request purpose-bound confirmed TOPO context for the current task. Use only context relevant to the stated purpose; this is not a full profile dump.",
      inputSchema: z.object({
        subject: z.string().min(1).default("self"),
        purpose: z.string().min(1),
        maxItems: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (input) => {
      try {
        return result(
          await callTopo("/v0/context", {
            method: "POST",
            body: {
              subject: input.subject,
              purpose: input.purpose,
              requested_by: REQUESTED_BY,
              wanted: {
                ...(input.maxItems === undefined
                  ? {}
                  : { max_items: input.maxItems }),
              },
            },
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "topo_search",
    {
      description:
        "Search confirmed, currently-valid TOPO memory. Prefer topo_context when the request has a clear task purpose.",
      inputSchema: z.object({
        query: z.string().min(1),
        category: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (input) => {
      try {
        return result(
          await callTopo("/v0/search", {
            method: "POST",
            body: {
              query: input.query,
              requested_by: REQUESTED_BY,
              ...(input.category === undefined
                ? {}
                : { category: input.category }),
              ...(input.limit === undefined ? {} : { limit: input.limit }),
            },
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "topo_propose_claims",
    {
      description:
        "Propose reviewable candidate memories to TOPO. This never confirms memory. Use when the user explicitly asks Claude to remember something, or when the interaction clearly establishes durable or project context worth offering for review. Do not propose secrets or speculative personal facts.",
      inputSchema: z.object({
        sourceTitle: z.string().min(1).optional(),
        sourceReference: z.string().min(1).optional(),
        claims: z.array(proposal).min(1).max(50),
      }),
    },
    async (input) => {
      try {
        return result(
          await callTopo("/v0/proposals", {
            method: "POST",
            body: {
              requestedBy: REQUESTED_BY,
              sourceTitle:
                input.sourceTitle ?? "Claude Desktop memory proposal",
              sourceProvider: "anthropic",
              ...(input.sourceReference === undefined
                ? {}
                : { sourceReference: input.sourceReference }),
              claims: input.claims,
            },
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

try {
  serveStdio(() => createServer());
} catch (error) {
  process.stderr.write(
    `TOPO Claude Desktop: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
