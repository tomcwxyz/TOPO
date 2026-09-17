import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { EditCandidatePatch } from "@topo/core";
import {
  capturedInteractionSchema,
  type CapturedInteraction,
  type JsonValue,
} from "@topo/schemas";
import { TopoMcpService } from "./service.js";

export interface TopoContextRequest {
  subject: string;
  purpose: string;
  query?: string;
  maxItems?: number;
  requestedBy?: string;
}

export interface TopoPageSearchRequest {
  query: string;
  category?: string;
  limit?: number;
  requestedBy?: string;
}

export interface TopoCaptureRequest {
  interaction: CapturedInteraction;
  requestedBy?: string;
}

/**
 * A context provider deliberately sits above TOPO's persistence representation.
 * The preferred implementation delegates to the running TOPO Desktop resolver,
 * so MCP, RACK and local agent adapters all share one governance/retrieval path.
 *
 * Capture is optional because it requires a separate, explicit Desktop session
 * permission. A context-capable client must not silently gain capture authority.
 */
export interface TopoContextProvider {
  readonly mode: "memory-pages";
  readonly transport: string;
  context(request: TopoContextRequest): Promise<unknown>;
  searchPages(request: TopoPageSearchRequest): Promise<unknown>;
  captureInteraction?(request: TopoCaptureRequest): Promise<unknown>;
}

const epistemicType = z.enum([
  "assertion",
  "observation",
  "inference",
  "preference",
  "derived-pattern",
]);

const sensitivity = z.enum([
  "ordinary",
  "personal",
  "sensitive",
  "restricted",
]);

const proposedClaim = z.object({
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

export function createTopoMcpServer(
  service: TopoMcpService,
  contextProvider?: TopoContextProvider,
): McpServer {
  const server = new McpServer({
    name: "topo",
    version: "0.1.0",
  });

  server.registerTool(
    "topo_capabilities",
    {
      description:
        "Show this TOPO connection's memory authority, sensitivity ceiling, context mode, capture support and transport policy.",
      inputSchema: z.object({}),
    },
    async () =>
      result({
        ...service.capabilities(),
        contextMode: contextProvider?.mode ?? "legacy-claims",
        contextTransport: contextProvider?.transport ?? null,
        interactionCapture: contextProvider?.captureInteraction !== undefined,
      }),
  );

  if (contextProvider !== undefined) {
    server.registerTool(
      "topo_context",
      {
        description:
          "Resolve a small purpose-bound Context Packet from governed TOPO Memory Pages for the current task. Prefer this over broad memory/profile injection.",
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
            await contextProvider.context({
              subject: input.subject,
              purpose: input.purpose,
              ...(input.query === undefined ? {} : { query: input.query }),
              ...(input.maxItems === undefined
                ? {}
                : { maxItems: input.maxItems }),
              requestedBy: "topo-mcp",
            }),
          );
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "topo_search_pages",
      {
        description:
          "Search confirmed, currently-valid TOPO Memory Pages through the canonical desktop resolver. Use topo_context when the task purpose is known.",
        inputSchema: z.object({
          query: z.string().min(1),
          category: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async (input) => {
        try {
          return result(
            await contextProvider.searchPages({
              query: input.query,
              ...(input.category === undefined
                ? {}
                : { category: input.category }),
              ...(input.limit === undefined ? {} : { limit: input.limit }),
              requestedBy: "topo-mcp",
            }),
          );
        } catch (error) {
          return failure(error);
        }
      },
    );

    if (contextProvider.captureInteraction !== undefined) {
      server.registerTool(
        "topo_capture_interaction",
        {
          description:
            "Submit a completed AI interaction to TOPO's governed capture inbox. This queues source material for TOPO extraction/review; it does not directly create confirmed memory.",
          inputSchema: z.object({
            interaction: capturedInteractionSchema,
          }),
        },
        async ({ interaction }) => {
          try {
            return result(
              await contextProvider.captureInteraction?.({
                interaction,
                requestedBy: "topo-mcp",
              }),
            );
          } catch (error) {
            return failure(error);
          }
        },
      );
    }
  }

  server.registerTool(
    "topo_propose_claims",
    {
      description:
        "Propose one or more candidate memory claims. This is a legacy/structured compatibility path; proposals are reviewable and are never silently confirmed.",
      inputSchema: z.object({
        sourceTitle: z.string().min(1).optional(),
        sourceProvider: z.string().min(1).optional(),
        sourceReference: z.string().min(1).optional(),
        claims: z.array(proposedClaim).min(1).max(50),
      }),
    },
    async (input) => {
      try {
        return result(
          service.proposeClaims({
            ...(input.sourceTitle === undefined
              ? {}
              : { sourceTitle: input.sourceTitle }),
            ...(input.sourceProvider === undefined
              ? {}
              : { sourceProvider: input.sourceProvider }),
            ...(input.sourceReference === undefined
              ? {}
              : { sourceReference: input.sourceReference }),
            claims: input.claims.map((claim) => ({
              ...(claim.subject === undefined ? {} : { subject: claim.subject }),
              key: claim.key,
              value: claim.value as JsonValue,
              ...(claim.category === undefined ? {} : { category: claim.category }),
              ...(claim.tags === undefined ? {} : { tags: claim.tags }),
              epistemicType: claim.epistemicType,
              ...(claim.confidence === undefined
                ? {}
                : { confidence: claim.confidence }),
              ...(claim.evidence === undefined ? {} : { evidence: claim.evidence }),
              ...(claim.sensitivity === undefined
                ? {}
                : { sensitivity: claim.sensitivity }),
              ...(claim.validFrom === undefined
                ? {}
                : { validFrom: claim.validFrom }),
              ...(claim.validUntil === undefined
                ? {}
                : { validUntil: claim.validUntil }),
            })),
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
        "Search confirmed, currently-valid legacy structured TOPO claims within this connection's sensitivity ceiling. Prefer topo_context/topo_search_pages for Memory Page context.",
      inputSchema: z.object({
        query: z.string().min(1),
        category: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (input) => {
      try {
        return result(
          service.search({
            query: input.query,
            ...(input.category === undefined ? {} : { category: input.category }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "topo_get_claim",
    {
      description:
        "Retrieve one confirmed, currently-valid legacy structured claim by ID if it is within this connection's sensitivity ceiling.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
    },
    async ({ id }) => result({ claim: service.getClaim(id) ?? null }),
  );

  server.registerTool(
    "topo_list_candidates",
    {
      description:
        "List candidate legacy structured claims awaiting review within this connection's sensitivity ceiling.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ limit }) => {
      try {
        return result({
          candidates: service.listCandidates(limit),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "topo_claim_history",
    {
      description:
        "Read the audit events for a legacy structured claim within this connection's sensitivity ceiling.",
      inputSchema: z.object({
        id: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ id, limit }) => {
      try {
        return result({
          events: service.claimHistory(id, limit),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (service.policy.allowReviewDecisions) {
    server.registerTool(
      "topo_edit_candidate",
      {
        description:
          "Edit a candidate under explicitly delegated review authority. This tool is absent from normal proposal-first connections.",
        inputSchema: z.object({
          id: z.string().min(1),
          subject: z.string().min(1).optional(),
          key: z.string().min(1).optional(),
          value: z.json().optional(),
          category: z.string().min(1).nullable().optional(),
          tags: z.array(z.string().min(1)).max(50).optional(),
          epistemicType: epistemicType.optional(),
          confidence: z.number().min(0).max(1).optional(),
          sensitivity: sensitivity.optional(),
          validFrom: z.string().datetime({ offset: true }).nullable().optional(),
          validUntil: z.string().datetime({ offset: true }).nullable().optional(),
        }),
      },
      async (input) => {
        try {
          const patch: EditCandidatePatch = {
            ...(input.subject === undefined ? {} : { subject: input.subject }),
            ...(input.key === undefined ? {} : { key: input.key }),
            ...(input.value === undefined
              ? {}
              : { value: input.value as JsonValue }),
            ...(input.category === undefined ? {} : { category: input.category }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
            ...(input.epistemicType === undefined
              ? {}
              : { epistemicType: input.epistemicType }),
            ...(input.confidence === undefined
              ? {}
              : { confidence: input.confidence }),
            ...(input.sensitivity === undefined
              ? {}
              : { sensitivity: input.sensitivity }),
            ...(input.validFrom === undefined
              ? {}
              : { validFrom: input.validFrom }),
            ...(input.validUntil === undefined
              ? {}
              : { validUntil: input.validUntil }),
          };
          return result({ claim: service.editCandidate(input.id, patch) });
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "topo_confirm_candidate",
      {
        description:
          "Confirm a candidate under explicitly delegated user review authority.",
        inputSchema: z.object({
          id: z.string().min(1),
        }),
      },
      async ({ id }) => {
        try {
          return result({ claim: service.confirmCandidate(id) });
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "topo_reject_candidate",
      {
        description:
          "Reject a candidate under explicitly delegated user review authority.",
        inputSchema: z.object({
          id: z.string().min(1),
        }),
      },
      async ({ id }) => {
        try {
          return result({ claim: service.rejectCandidate(id) });
        } catch (error) {
          return failure(error);
        }
      },
    );
  }

  return server;
}
