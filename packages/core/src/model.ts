export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const EPISTEMIC_TYPES = [
  "assertion",
  "observation",
  "inference",
  "preference",
  "derived-pattern",
] as const;
export type EpistemicType = (typeof EPISTEMIC_TYPES)[number];

export const CLAIM_STATUSES = [
  "candidate",
  "confirmed",
  "rejected",
  "superseded",
  "expired",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const SENSITIVITY_LEVELS = [
  "ordinary",
  "personal",
  "sensitive",
  "restricted",
] as const;
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

export const SOURCE_TYPES = [
  "conversation",
  "document",
  "manual",
  "mcp",
  "import",
  "connector",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ACTOR_TYPES = ["user", "agent", "system", "import"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface Actor {
  type: ActorType;
  id?: string;
}

export interface ClaimProvenance {
  sourceType: SourceType;
  provider?: string;
  sourceId?: string;
  evidence?: string;
  capturedAt: string;
}

export interface MemoryClaim {
  id: string;
  subject: string;
  key: string;
  value: JsonValue;
  category?: string;
  tags: string[];
  epistemicType: EpistemicType;
  confidence: number;
  provenance: ClaimProvenance;
  status: ClaimStatus;
  sensitivity: Sensitivity;
  validFrom?: string;
  validUntil?: string;
  supersedes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemorySource {
  id: string;
  type: SourceType;
  title?: string;
  provider?: string;
  externalId?: string;
  capturedAt: string;
  createdAt: string;
  sensitivity: Sensitivity;
  metadata?: { [key: string]: JsonValue };
}

export const EVENT_TYPES = [
  "source.captured",
  "claim.proposed",
  "claim.confirmed",
  "claim.edited",
  "claim.rejected",
  "claim.superseded",
  "claim.expired",
  "document.generated",
  "document.accepted",
  "context.resolved",
  "context.shared",
  "schema.updated",
] as const;
export type MemoryEventType = (typeof EVENT_TYPES)[number];

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  entityType: "claim" | "source" | "document" | "schema" | "context";
  entityId: string;
  occurredAt: string;
  actor: Actor;
  data?: { [key: string]: JsonValue };
}

export interface ClaimTransition {
  claim: MemoryClaim;
  event: MemoryEvent;
}
