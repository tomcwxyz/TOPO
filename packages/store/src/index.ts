import type {
  ClaimStatus,
  ClaimTransition,
  MemoryClaim,
  MemoryEvent,
  MemoryEventType,
  MemorySource,
  Sensitivity,
  SourceType,
} from "@topo/schemas";

export interface PageFilter {
  limit?: number;
  offset?: number;
}

export interface ClaimFilter extends PageFilter {
  status?: ClaimStatus;
  category?: string;
  key?: string;
  subject?: string;
}

export interface SourceFilter extends PageFilter {
  type?: SourceType;
  sensitivity?: Sensitivity;
}

export interface EventFilter extends PageFilter {
  entityType?: MemoryEvent["entityType"];
  entityId?: string;
  type?: MemoryEventType;
}

export interface MemoryStore {
  getClaim(id: string): MemoryClaim | undefined;
  listClaims(filter?: ClaimFilter): MemoryClaim[];
  putClaim(claim: MemoryClaim): void;

  getSource(id: string): MemorySource | undefined;
  listSources(filter?: SourceFilter): MemorySource[];
  putSource(source: MemorySource): void;

  getEvent(id: string): MemoryEvent | undefined;
  appendEvent(event: MemoryEvent): void;
  listEvents(filter?: EventFilter): MemoryEvent[];

  applyTransition(transition: ClaimTransition): void;

  transaction<T>(work: (store: MemoryStore) => T): T;
  close(): void;
}
