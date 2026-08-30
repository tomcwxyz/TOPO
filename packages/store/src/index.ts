import type {
  ClaimStatus,
  ClaimTransition,
  MemoryClaim,
  MemoryEvent,
  MemoryEventType,
  MemorySource,
} from "@topo/schemas";

export interface ClaimFilter {
  status?: ClaimStatus;
  category?: string;
  key?: string;
  subject?: string;
  limit?: number;
}

export interface EventFilter {
  entityType?: MemoryEvent["entityType"];
  entityId?: string;
  type?: MemoryEventType;
  limit?: number;
}

export interface MemoryStore {
  getClaim(id: string): MemoryClaim | undefined;
  listClaims(filter?: ClaimFilter): MemoryClaim[];
  putClaim(claim: MemoryClaim): void;

  getSource(id: string): MemorySource | undefined;
  putSource(source: MemorySource): void;

  appendEvent(event: MemoryEvent): void;
  listEvents(filter?: EventFilter): MemoryEvent[];

  applyTransition(transition: ClaimTransition): void;

  transaction<T>(work: (store: MemoryStore) => T): T;
  close(): void;
}
