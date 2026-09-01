import type {
  JsonValue,
  MemoryClaim,
  Sensitivity,
} from "@topo/schemas";
import type { MemoryStore } from "@topo/store";

export interface OosContextRequest {
  subject: string;
  purpose: string;
  requestedBy: string;
  query?: string;
  categories?: string[];
  keys?: string[];
}

export interface OosContextObject {
  type: string;
  id: string;
  value: Record<string, unknown>;
}

export interface OosContextPacket {
  specversion: "0.1-draft";
  id: string;
  subject: string;
  purpose: string;
  requested_by: string;
  objects: OosContextObject[];
  evidence_refs: string[];
  scope: "private" | "shared" | "published";
  generated_at: string;
  expires_at: string | null;
  permissions: string[];
  provenance: {
    source_type: "application";
    source_id: string;
    created_by: {
      type: "system";
      id: "topo";
    };
    method: "generated";
    assertion_type: "interpretation";
    confidence: "high";
    created_at: string;
    derived_from: string[];
    extensions: Record<string, unknown>;
  };
  extensions: Record<string, unknown>;
}

export interface OosContextResolutionOptions {
  packetId: string;
  now: string;
  scope?: OosContextPacket["scope"];
  maxItems?: number;
  allowedSensitivity?: Sensitivity[];
  permissions?: string[];
  expiresAt?: string | null;
}

export interface OosNodeCapabilityManifest {
  protocol: "oos/0.1-draft";
  node: {
    id: "topo";
    name: "TOPO";
    version: string | null;
  };
  provides: string[];
  emits: string[];
  accepts: string[];
  queries: string[];
  actions: string[];
  extensions: Record<string, unknown>;
}

export const topoOosManifest: OosNodeCapabilityManifest = {
  protocol: "oos/0.1-draft",
  node: {
    id: "topo",
    name: "TOPO",
    version: "0.1",
  },
  provides: ["context", "memory_claim"],
  emits: [],
  accepts: [],
  queries: ["context"],
  actions: [],
  extensions: {
    status: "context-provider-only",
    note:
      "TOPO does not yet ingest arbitrary OOS operational objects into canonical memory claims.",
  },
};

const DEFAULT_ALLOWED_SENSITIVITY: Sensitivity[] = [
  "ordinary",
  "personal",
];

const DEFAULT_MAX_ITEMS = 20;
const PAGE_SIZE = 500;
const MAX_SCAN = 5000;

function ensureDateTime(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  return parsed;
}

function isTemporallyValid(claim: MemoryClaim, nowMs: number): boolean {
  if (
    claim.validFrom !== undefined &&
    ensureDateTime(claim.validFrom, "claim.validFrom") > nowMs
  ) {
    return false;
  }

  if (
    claim.validUntil !== undefined &&
    ensureDateTime(claim.validUntil, "claim.validUntil") < nowMs
  ) {
    return false;
  }

  return true;
}

function selectedByRequest(
  claim: MemoryClaim,
  request: OosContextRequest,
): boolean {
  if (
    request.categories !== undefined &&
    request.categories.length > 0 &&
    (claim.category === undefined ||
      !request.categories.includes(claim.category))
  ) {
    return false;
  }

  if (
    request.keys !== undefined &&
    request.keys.length > 0 &&
    !request.keys.includes(claim.key)
  ) {
    return false;
  }

  return true;
}

const PURPOSE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "please", "should",
  "that", "the", "this", "to", "what", "with",
]);

type ClaimRelevance = {
  score: number;
  fields: string[];
};

function lexicalTerms(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter(
      (term) =>
        term.length > 1 &&
        !PURPOSE_STOP_WORDS.has(term),
    );
}

function requestTerms(request: OosContextRequest): string[] {
  return Array.from(
    new Set([
      ...lexicalTerms(request.purpose),
      ...lexicalTerms(request.query ?? ""),
    ]),
  );
}

function termSet(value: string): Set<string> {
  return new Set(lexicalTerms(value));
}

function claimRelevance(
  claim: MemoryClaim,
  terms: string[],
): ClaimRelevance {
  if (terms.length === 0) return { score: 0, fields: [] };

  const key = termSet(claim.key);
  const category = termSet(claim.category ?? "");
  const tags = termSet(claim.tags.join(" "));
  const value = termSet(JSON.stringify(claim.value));

  let score = 0;
  const fields = new Set<string>();
  for (const term of terms) {
    if (key.has(term)) {
      score += 8;
      fields.add("key");
    }
    if (category.has(term)) {
      score += 5;
      fields.add("category");
    }
    if (tags.has(term)) {
      score += 4;
      fields.add("tags");
    }
    if (value.has(term)) {
      score += 2;
      fields.add("value");
    }
  }

  return { score, fields: [...fields] };
}

function compareClaims(
  relevance: Map<string, ClaimRelevance>,
  a: MemoryClaim,
  b: MemoryClaim,
): number {
  const score = (relevance.get(b.id)?.score ?? 0) - (relevance.get(a.id)?.score ?? 0);
  if (score !== 0) return score;

  const updated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (updated !== 0) return updated;
  return b.confidence - a.confidence;
}

function readConfirmedClaims(
  store: MemoryStore,
  subject: string,
): MemoryClaim[] {
  const claims: MemoryClaim[] = [];

  for (let offset = 0; offset < MAX_SCAN; offset += PAGE_SIZE) {
    const page = store.listClaims({
      status: "confirmed",
      subject,
      offset,
      limit: PAGE_SIZE,
    });
    claims.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return claims;
}

function claimValue(claim: MemoryClaim): Record<string, unknown> {
  return {
    subject: claim.subject,
    key: claim.key,
    value: claim.value as JsonValue,
    ...(claim.category === undefined ? {} : { category: claim.category }),
    tags: claim.tags,
    epistemicType: claim.epistemicType,
    confidence: claim.confidence,
    provenance: claim.provenance,
    status: claim.status,
    sensitivity: claim.sensitivity,
    ...(claim.validFrom === undefined ? {} : { validFrom: claim.validFrom }),
    ...(claim.validUntil === undefined ? {} : { validUntil: claim.validUntil }),
    supersedes: claim.supersedes,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

export function resolveOosContext(
  store: MemoryStore,
  request: OosContextRequest,
  options: OosContextResolutionOptions,
): OosContextPacket {
  const nowMs = ensureDateTime(options.now, "options.now");
  const allowedSensitivity =
    options.allowedSensitivity ?? DEFAULT_ALLOWED_SENSITIVITY;
  const maxItems = Math.max(
    1,
    Math.min(options.maxItems ?? DEFAULT_MAX_ITEMS, 200),
  );

  const eligibleClaims = readConfirmedClaims(store, request.subject)
    .filter((claim) => allowedSensitivity.includes(claim.sensitivity))
    .filter((claim) => isTemporallyValid(claim, nowMs))
    .filter((claim) => selectedByRequest(claim, request));

  const terms = requestTerms(request);
  const relevance = new Map(
    eligibleClaims.map((claim) => [claim.id, claimRelevance(claim, terms)]),
  );
  const claims = eligibleClaims
    .sort((a, b) => compareClaims(relevance, a, b))
    .slice(0, maxItems);

  const objects: OosContextObject[] = claims.map((claim) => ({
    type: "topo.memory_claim",
    id: claim.id,
    value: claimValue(claim),
  }));

  const evidenceRefs = Array.from(
    new Set(
      claims
        .map((claim) => claim.provenance.sourceId)
        .filter((sourceId): sourceId is string => sourceId !== undefined),
    ),
  );

  return {
    specversion: "0.1-draft",
    id: options.packetId,
    subject: request.subject,
    purpose: request.purpose,
    requested_by: request.requestedBy,
    objects,
    evidence_refs: evidenceRefs,
    scope: options.scope ?? "private",
    generated_at: options.now,
    expires_at: options.expiresAt ?? null,
    permissions: options.permissions ?? ["local-use-only"],
    provenance: {
      source_type: "application",
      source_id: `topo:context:${options.packetId}`,
      created_by: {
        type: "system",
        id: "topo",
      },
      method: "generated",
      assertion_type: "interpretation",
      confidence: "high",
      created_at: options.now,
      derived_from: claims.map((claim) => claim.id),
      extensions: {},
    },
    extensions: {
      "topo.selection":
        terms.length > 0
          ? "confirmed+subject+temporal+sensitivity+purpose-lexical-rank-v1"
          : "confirmed+subject+temporal+sensitivity+recency",
      "topo.scanned_limit": MAX_SCAN,
      "topo.query_supplied": Boolean(request.query?.trim()),
      "topo.relevance": Object.fromEntries(
        claims
          .map((claim) => [claim.id, relevance.get(claim.id) ?? { score: 0, fields: [] }])
          .filter(([, result]) => (result as ClaimRelevance).score > 0),
      ),
    },
  };
}
