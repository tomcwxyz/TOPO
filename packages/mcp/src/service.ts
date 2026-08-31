import { randomUUID } from "node:crypto";
import {
  confirmClaim,
  editCandidateClaim,
  proposeClaim,
  rejectClaim,
  type EditCandidatePatch,
} from "@topo/core";
import type {
  EpistemicType,
  JsonValue,
  MemoryClaim,
  MemoryEvent,
  MemorySource,
  Sensitivity,
} from "@topo/schemas";
import type { ClaimFilter, MemoryStore } from "@topo/store";

const PAGE_SIZE = 500;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 100;

const sensitivityRank: Record<Sensitivity, number> = {
  ordinary: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
};

export interface TopoMcpPolicy {
  maxSensitivity: Sensitivity;
  allowReviewDecisions: boolean;
  agentId: string;
  reviewActorId: string;
}

export interface TopoMcpServiceOptions {
  maxSensitivity?: Sensitivity;
  allowReviewDecisions?: boolean;
  agentId?: string;
  reviewActorId?: string;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface ProposedClaimSpec {
  subject?: string;
  key: string;
  value: JsonValue;
  category?: string;
  tags?: string[];
  epistemicType: EpistemicType;
  confidence?: number;
  evidence?: string;
  sensitivity?: Sensitivity;
  validFrom?: string;
  validUntil?: string;
}

export interface ProposeClaimsRequest {
  sourceTitle?: string;
  sourceProvider?: string;
  sourceReference?: string;
  claims: ProposedClaimSpec[];
}

export interface SearchRequest {
  query: string;
  category?: string;
  limit?: number;
}

export interface ClaimSearchResult {
  claim: MemoryClaim;
  score: number;
}

export class McpAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthorityError";
  }
}

export class McpDisclosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpDisclosureError";
  }
}

function defaultId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RESULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
    throw new RangeError(
      `limit must be an integer between 1 and ${MAX_RESULT_LIMIT}`,
    );
  }
  return value;
}

function maximumSensitivity(values: Sensitivity[]): Sensitivity {
  return values.reduce<Sensitivity>(
    (highest, value) =>
      sensitivityRank[value] > sensitivityRank[highest] ? value : highest,
    "ordinary",
  );
}

function lexicalScore(claim: MemoryClaim, query: string): number {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return 0;

  const key = claim.key.toLocaleLowerCase();
  const category = (claim.category ?? "").toLocaleLowerCase();
  const tags = claim.tags.map((tag) => tag.toLocaleLowerCase());
  const value = JSON.stringify(claim.value).toLocaleLowerCase();

  let score = 0;
  if (key === needle) score += 100;
  else if (key.includes(needle)) score += 45;

  if (category === needle) score += 35;
  else if (category.includes(needle)) score += 15;

  for (const tag of tags) {
    if (tag === needle) score += 25;
    else if (tag.includes(needle)) score += 10;
  }

  if (value.includes(needle)) score += 30;

  for (const token of needle.split(/\s+/).filter(Boolean)) {
    if (key.includes(token)) score += 8;
    if (category.includes(token)) score += 4;
    if (tags.some((tag) => tag.includes(token))) score += 4;
    if (value.includes(token)) score += 5;
  }

  return score;
}

export class TopoMcpService {
  readonly policy: TopoMcpPolicy;

  private readonly store: MemoryStore;
  private readonly clock: () => string;
  private readonly ids: (prefix: string) => string;

  constructor(store: MemoryStore, options: TopoMcpServiceOptions = {}) {
    this.store = store;
    this.policy = {
      maxSensitivity: options.maxSensitivity ?? "personal",
      allowReviewDecisions: options.allowReviewDecisions ?? false,
      agentId: options.agentId ?? "mcp-client",
      reviewActorId: options.reviewActorId ?? "mcp-review-delegation",
    };
    this.clock = options.now ?? (() => new Date().toISOString());
    this.ids = options.createId ?? defaultId;
  }

  capabilities(): {
    mode: "proposal-first";
    maxSensitivity: Sensitivity;
    reviewDecisions: "disabled" | "delegated";
    directConfirmedWrites: false;
    transport: "stdio";
  } {
    return {
      mode: "proposal-first",
      maxSensitivity: this.policy.maxSensitivity,
      reviewDecisions: this.policy.allowReviewDecisions
        ? "delegated"
        : "disabled",
      directConfirmedWrites: false,
      transport: "stdio",
    };
  }

  proposeClaims(request: ProposeClaimsRequest): {
    source: MemorySource;
    claims: MemoryClaim[];
  } {
    if (request.claims.length < 1 || request.claims.length > 50) {
      throw new RangeError("claims must contain between 1 and 50 proposals");
    }

    for (const claim of request.claims) {
      this.assertSensitivityAllowed(claim.sensitivity ?? "ordinary");
    }

    const timestamp = this.clock();
    const sourceSensitivity = maximumSensitivity(
      request.claims.map((claim) => claim.sensitivity ?? "ordinary"),
    );
    const source: MemorySource = {
      id: this.ids("source"),
      type: "mcp",
      ...(request.sourceTitle === undefined
        ? { title: "TOPO MCP proposal" }
        : { title: request.sourceTitle }),
      ...(request.sourceProvider === undefined
        ? {}
        : { provider: request.sourceProvider }),
      ...(request.sourceReference === undefined
        ? {}
        : { externalId: request.sourceReference }),
      capturedAt: timestamp,
      createdAt: timestamp,
      sensitivity: sourceSensitivity,
    };

    const sourceEvent: MemoryEvent = {
      id: this.ids("event"),
      type: "source.captured",
      entityType: "source",
      entityId: source.id,
      occurredAt: timestamp,
      actor: { type: "agent", id: this.policy.agentId },
      data: { claimCount: request.claims.length },
    };

    const transitions = request.claims.map((item) =>
      proposeClaim(
        {
          id: this.ids("claim"),
          subject: item.subject ?? "self",
          key: item.key,
          value: item.value,
          ...(item.category === undefined ? {} : { category: item.category }),
          tags: [...(item.tags ?? [])],
          epistemicType: item.epistemicType,
          confidence: item.confidence ?? 0.8,
          provenance: {
            sourceType: "mcp",
            ...(request.sourceProvider === undefined
              ? {}
              : { provider: request.sourceProvider }),
            sourceId: source.id,
            ...(item.evidence === undefined ? {} : { evidence: item.evidence }),
            capturedAt: timestamp,
          },
          sensitivity: item.sensitivity ?? "ordinary",
          ...(item.validFrom === undefined ? {} : { validFrom: item.validFrom }),
          ...(item.validUntil === undefined ? {} : { validUntil: item.validUntil }),
        },
        {
          now: timestamp,
          eventId: this.ids("event"),
          actor: { type: "agent", id: this.policy.agentId },
        },
      ),
    );

    this.store.transaction(() => {
      this.store.putSource(source);
      this.store.appendEvent(sourceEvent);
      for (const transition of transitions) {
        this.store.applyTransition(transition);
      }
    });

    return {
      source,
      claims: transitions.map((transition) => transition.claim),
    };
  }

  search(request: SearchRequest): ClaimSearchResult[] {
    const limit = boundedLimit(request.limit);
    const results: ClaimSearchResult[] = [];
    const at = this.clock();

    this.eachClaim(
      {
        status: "confirmed",
        ...(request.category === undefined
          ? {}
          : { category: request.category }),
      },
      (claim) => {
        if (!this.canRead(claim) || !this.isCurrentlyValid(claim, at)) return;
        const score = lexicalScore(claim, request.query);
        if (score <= 0) return;

        results.push({ claim, score });
        results.sort(
          (left, right) =>
            right.score - left.score ||
            right.claim.updatedAt.localeCompare(left.claim.updatedAt) ||
            left.claim.id.localeCompare(right.claim.id),
        );
        if (results.length > limit) results.length = limit;
      },
    );

    return results;
  }

  getClaim(id: string): MemoryClaim | undefined {
    const claim = this.store.getClaim(id);
    if (
      claim === undefined ||
      claim.status !== "confirmed" ||
      !this.canRead(claim) ||
      !this.isCurrentlyValid(claim, this.clock())
    ) {
      return undefined;
    }
    return claim;
  }

  listCandidates(limit?: number): MemoryClaim[] {
    const max = boundedLimit(limit);
    const output: MemoryClaim[] = [];

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = this.store.listClaims({
        status: "candidate",
        limit: PAGE_SIZE,
        offset,
      });
      for (const claim of page) {
        if (!this.canRead(claim)) continue;
        output.push(claim);
        if (output.length >= max) return output;
      }
      if (page.length < PAGE_SIZE) return output;
    }
  }

  claimHistory(id: string, limit?: number): MemoryEvent[] {
    const claim = this.store.getClaim(id);
    if (claim === undefined || !this.canRead(claim)) return [];

    const max = boundedLimit(limit);
    const output: MemoryEvent[] = [];

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = this.store.listEvents({
        entityType: "claim",
        entityId: id,
        limit: PAGE_SIZE,
        offset,
      });
      output.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    return output.slice(0, max).reverse();
  }

  editCandidate(id: string, patch: EditCandidatePatch): MemoryClaim {
    this.assertReviewAuthority();
    const claim = this.requireCandidate(id);
    if (patch.sensitivity !== undefined) {
      this.assertSensitivityAllowed(patch.sensitivity);
    }

    const transition = editCandidateClaim(claim, patch, {
      now: this.clock(),
      eventId: this.ids("event"),
      actor: { type: "user", id: this.policy.reviewActorId },
    });
    this.store.applyTransition(transition);
    return transition.claim;
  }

  confirmCandidate(id: string): MemoryClaim {
    this.assertReviewAuthority();
    const claim = this.requireCandidate(id);
    const transition = confirmClaim(claim, {
      now: this.clock(),
      eventId: this.ids("event"),
      actor: { type: "user", id: this.policy.reviewActorId },
    });
    this.store.applyTransition(transition);
    return transition.claim;
  }

  rejectCandidate(id: string): MemoryClaim {
    this.assertReviewAuthority();
    const claim = this.requireCandidate(id);
    const transition = rejectClaim(claim, {
      now: this.clock(),
      eventId: this.ids("event"),
      actor: { type: "user", id: this.policy.reviewActorId },
    });
    this.store.applyTransition(transition);
    return transition.claim;
  }

  private requireCandidate(id: string): MemoryClaim {
    const claim = this.store.getClaim(id);
    if (claim === undefined || claim.status !== "candidate") {
      throw new Error(`Candidate not found: ${id}`);
    }
    this.assertSensitivityAllowed(claim.sensitivity);
    return claim;
  }

  private assertReviewAuthority(): void {
    if (!this.policy.allowReviewDecisions) {
      throw new McpAuthorityError(
        "This MCP connection has not been delegated user review authority",
      );
    }
  }

  private assertSensitivityAllowed(sensitivity: Sensitivity): void {
    if (
      sensitivityRank[sensitivity] >
      sensitivityRank[this.policy.maxSensitivity]
    ) {
      throw new McpDisclosureError(
        `MCP sensitivity ceiling is ${this.policy.maxSensitivity}; ${sensitivity} is not allowed`,
      );
    }
  }

  private canRead(claim: MemoryClaim): boolean {
    return (
      sensitivityRank[claim.sensitivity] <=
      sensitivityRank[this.policy.maxSensitivity]
    );
  }

  private isCurrentlyValid(claim: MemoryClaim, at: string): boolean {
    const time = Date.parse(at);
    if (claim.validFrom !== undefined && Date.parse(claim.validFrom) > time) {
      return false;
    }
    if (claim.validUntil !== undefined && Date.parse(claim.validUntil) < time) {
      return false;
    }
    return true;
  }

  private eachClaim(
    filter: Omit<ClaimFilter, "limit" | "offset">,
    visit: (claim: MemoryClaim) => void,
  ): void {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = this.store.listClaims({
        ...filter,
        limit: PAGE_SIZE,
        offset,
      });
      for (const claim of page) visit(claim);
      if (page.length < PAGE_SIZE) return;
    }
  }
}
