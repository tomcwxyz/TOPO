import { createHash, timingSafeEqual } from "node:crypto";
import type { Sensitivity } from "@topo/schemas";
import { narrowContextPacket } from "./context-filter.js";

export type RemoteContextAction = "context";

export interface RemoteContextGrant {
  version: "topo.remote-grant/0.1";
  id: string;
  audience: string;
  subjects: string[];
  actions: RemoteContextAction[];
  maxSensitivity: Sensitivity;
  issuedAt: string;
  expiresAt: string;
}

export interface RemoteContextRequest {
  subject: string;
  purpose: string;
  query?: string;
  maxItems?: number;
}

export interface RemoteContextResolver {
  context(request: {
    subject: string;
    purpose: string;
    requestedBy: string;
    query?: string;
    maxItems?: number;
  }): Promise<unknown>;
}

export interface RemoteContextAuthorizer {
  authorise(authorization: string | null): Promise<RemoteContextGrant | undefined>;
}

export interface RemoteContextGatewayOptions {
  audience: string;
  resolver: RemoteContextResolver;
  authorizer: RemoteContextAuthorizer;
  now?: () => string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function validateGrant(grant: RemoteContextGrant): void {
  if (
    grant.version !== "topo.remote-grant/0.1" ||
    grant.id.trim().length === 0 ||
    grant.audience.trim().length === 0 ||
    grant.subjects.length === 0 ||
    grant.subjects.some((subject) => subject.trim().length === 0) ||
    grant.actions.length === 0
  ) {
    throw new Error("Invalid TOPO remote context grant");
  }

  const issued = validDate(grant.issuedAt);
  const expires = validDate(grant.expiresAt);
  if (issued === undefined || expires === undefined || expires <= issued) {
    throw new Error("Invalid TOPO remote context grant lifetime");
  }
}

function parseContextRequest(value: unknown): RemoteContextRequest {
  if (!isRecord(value)) throw new Error("request body must be an object");

  const subject = typeof value.subject === "string" ? value.subject.trim() : "";
  const purpose = typeof value.purpose === "string" ? value.purpose.trim() : "";
  const query =
    typeof value.query === "string" && value.query.trim().length > 0
      ? value.query.trim()
      : undefined;
  const maxItems = value.maxItems;

  if (subject.length === 0 || purpose.length === 0) {
    throw new Error("subject and purpose are required");
  }
  if (
    maxItems !== undefined &&
    (!Number.isInteger(maxItems) || Number(maxItems) < 1 || Number(maxItems) > 100)
  ) {
    throw new Error("maxItems must be an integer between 1 and 100");
  }

  return {
    subject,
    purpose,
    ...(query === undefined ? {} : { query }),
    ...(maxItems === undefined ? {} : { maxItems: Number(maxItems) }),
  };
}

function subjectAllowed(grant: RemoteContextGrant, subject: string): boolean {
  // v0 deliberately avoids wildcard grants. A remote client must receive an
  // explicit subject scope for every context domain it may request.
  return grant.subjects.includes(subject);
}

/**
 * Create a fetch-style, read-only remote context handler.
 *
 * The handler owns grant enforcement and an additional sensitivity ceiling, but
 * delegates actual memory governance/relevance to the injected TOPO resolver.
 * It does not expose capture, contribution or review authority.
 */
export function createRemoteContextHandler(
  options: RemoteContextGatewayOptions,
): (request: Request) => Promise<Response> {
  const clock = options.now ?? (() => new Date().toISOString());

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/v0/capabilities") {
      return json({
        protocol: "topo.remote-context/0.1",
        audience: options.audience,
        mode: "read-only",
        actions: ["context"],
        contributionAuthority: false,
        captureAuthority: false,
        reviewAuthority: false,
      });
    }

    if (request.method !== "POST" || url.pathname !== "/v0/context") {
      return json({ error: "not found" }, 404);
    }

    const grant = await options.authorizer.authorise(
      request.headers.get("Authorization"),
    );
    if (grant === undefined) {
      return json({ error: "unauthorised", code: "TOPO_REMOTE_UNAUTHORISED" }, 401);
    }

    try {
      validateGrant(grant);
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
          code: "TOPO_REMOTE_INVALID_GRANT",
        },
        401,
      );
    }

    if (grant.audience !== options.audience) {
      return json(
        { error: "grant audience does not match this gateway", code: "TOPO_REMOTE_AUDIENCE" },
        403,
      );
    }

    const now = validDate(clock());
    const issued = validDate(grant.issuedAt);
    const expires = validDate(grant.expiresAt);
    if (
      now === undefined ||
      issued === undefined ||
      expires === undefined ||
      now < issued ||
      now >= expires
    ) {
      return json({ error: "grant is not currently valid", code: "TOPO_REMOTE_EXPIRED" }, 401);
    }

    if (!grant.actions.includes("context")) {
      return json(
        { error: "grant does not allow context retrieval", code: "TOPO_REMOTE_SCOPE" },
        403,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "request body must be valid JSON" }, 400);
    }

    let input: RemoteContextRequest;
    try {
      input = parseContextRequest(body);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    if (!subjectAllowed(grant, input.subject)) {
      return json(
        { error: "grant does not allow this subject", code: "TOPO_REMOTE_SUBJECT_SCOPE" },
        403,
      );
    }

    try {
      const packet = await options.resolver.context({
        subject: input.subject,
        purpose: input.purpose,
        requestedBy: `remote:${grant.id}`,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
      });

      return json(
        narrowContextPacket(
          packet,
          grant.maxSensitivity,
          "topo.remote_grant_sensitivity_ceiling",
        ),
      );
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
          code: "TOPO_REMOTE_RESOLVER_ERROR",
        },
        502,
      );
    }
  };
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Minimal bearer authorizer for the CE3 prototype.
 *
 * Production remote MCP should use a proper OAuth/device-grant flow with
 * revocation. This helper exists for local/integration prototyping and stores
 * only a SHA-256 digest of the supplied token in memory.
 */
export class StaticBearerGrantAuthorizer implements RemoteContextAuthorizer {
  private readonly digest: Buffer;
  private readonly grant: RemoteContextGrant;

  constructor(token: string, grant: RemoteContextGrant) {
    if (token.trim().length < 32) {
      throw new Error("Remote prototype bearer tokens must contain at least 32 characters");
    }
    validateGrant(grant);
    this.digest = tokenDigest(token);
    this.grant = structuredClone(grant);
  }

  async authorise(
    authorization: string | null,
  ): Promise<RemoteContextGrant | undefined> {
    if (authorization === null || !authorization.startsWith("Bearer ")) {
      return undefined;
    }
    const token = authorization.slice("Bearer ".length);
    const candidate = tokenDigest(token);
    if (
      candidate.length !== this.digest.length ||
      !timingSafeEqual(candidate, this.digest)
    ) {
      return undefined;
    }
    return structuredClone(this.grant);
  }
}
