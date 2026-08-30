import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { EditCandidatePatch } from "@topo/core";
import type { JsonValue } from "@topo/schemas";
import { TopoMcpService } from "./service.js";

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

export function createTopoMcpServer(service: TopoMcpService): McpServer {
  const server = new McpServer({
    name: "topo",
    version: "0.1.0",
  });

  server.registerTool(
    "topo_capabilities",
    {
      description:
        "Show this TOPO connection's memory authority, sensitivity ceiling and transport policy.",
      inputSchema: z.object({}),
    },
    async () => result(service.capabilities()),
  );

  server.registerTool(
    "topo_propose_claims",
    {
      description:
        "Propose one or more candidate memory claims. Proposals are reviewable and are never silently confirmed.",
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
        "Search confirmed, currently-valid TOPO claims within this connection's sensitivity ceiling. This is scoped retrieval, not a full-profile dump.",
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
        "Retrieve one confirmed, currently-valid claim by ID if it is within this connection's sensitivity ceiling.",
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
        "List candidate memory claims awaiting review within this connection's sensitivity ceiling.",
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
        "Read the audit events for a claim within this connection's sensitivity ceiling.",
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
