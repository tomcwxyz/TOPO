import type {
  MemoryPage,
  MemoryPageEvent,
  MemoryPageStatus,
  MemoryPageTransition,
} from "@topo/schemas/memory-page";

export interface MemoryPageListFilter {
  status?: MemoryPageStatus;
  subject?: string;
  category?: string;
  sensitivity?: MemoryPage["sensitivity"];
  horizon?: MemoryPage["horizon"];
  limit?: number;
  offset?: number;
}

export interface MemoryPageEventFilter {
  entityId?: string;
  type?: MemoryPageEvent["type"];
  limit?: number;
  offset?: number;
}

export interface MemoryPageStore {
  getMemoryPage(id: string): MemoryPage | undefined;
  listMemoryPages(filter?: MemoryPageListFilter): MemoryPage[];
  putMemoryPage(page: MemoryPage): void;

  getMemoryPageEvent(id: string): MemoryPageEvent | undefined;
  listMemoryPageEvents(filter?: MemoryPageEventFilter): MemoryPageEvent[];
  appendMemoryPageEvent(event: MemoryPageEvent): void;

  applyMemoryPageTransition(transition: MemoryPageTransition): void;

  transaction<T>(work: (store: MemoryPageStore) => T): T;
  close(): void;
}
