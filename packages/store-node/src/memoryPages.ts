import Database from "better-sqlite3";
import {
  validateMemoryPage,
  type MemoryPage,
  type MemoryPageEvent,
  type MemoryPageTransition,
} from "@topo/schemas/memory-page";
import type {
  MemoryPageEventFilter,
  MemoryPageListFilter,
  MemoryPageStore,
} from "@topo/store/memory-pages";

const MEMORY_PAGE_SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

const MEMORY_PAGE_EVENT_TYPES = new Set<MemoryPageEvent["type"]>([
  "memory.proposed",
  "memory.confirmed",
  "memory.edited",
  "memory.rejected",
  "memory.superseded",
  "memory.expired",
]);

type SqlValue = string | number | null;

interface MemoryPageRow {
  id: string;
  subject: string;
  title: string;
  summary: string | null;
  body: string;
  category: string | null;
  tags_json: string;
  status: MemoryPage["status"];
  sensitivity: MemoryPage["sensitivity"];
  horizon: MemoryPage["horizon"];
  origin: MemoryPage["origin"];
  source_refs_json: string;
  annotation_ids_json: string;
  valid_from: string | null;
  valid_until: string | null;
  supersedes_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface MemoryPageEventRow {
  id: string;
  type: MemoryPageEvent["type"];
  entity_id: string;
  occurred_at: string;
  actor_type: MemoryPageEvent["actor"]["type"];
  actor_id: string | null;
  data_json: string | null;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function boundedOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  return value;
}

function validateMemoryPageEvent(event: MemoryPageEvent): void {
  if (!event.id.trim()) throw new Error("Memory Page event id is required");
  if (!MEMORY_PAGE_EVENT_TYPES.has(event.type)) {
    throw new Error(`Unsupported Memory Page event type: ${event.type}`);
  }
  if (event.entityType !== "memory") {
    throw new Error("Memory Page event entityType must be memory");
  }
  if (!event.entityId.trim()) {
    throw new Error("Memory Page event entityId is required");
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    throw new Error("Memory Page event occurredAt must be a date-time");
  }
}

export class SqliteMemoryPageStore implements MemoryPageStore {
  private readonly db: Database.Database;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    if (path !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
    }

    this.migrate();
  }

  memoryPageSchemaVersion(): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM memory_page_schema_migrations",
      )
      .get() as { version: number };

    return Number(row.version);
  }

  getMemoryPage(id: string): MemoryPage | undefined {
    const row = this.db
      .prepare("SELECT * FROM memory_pages WHERE id = ?")
      .get(id) as MemoryPageRow | undefined;

    return row === undefined ? undefined : this.pageFromRow(row);
  }

  listMemoryPages(filter: MemoryPageListFilter = {}): MemoryPage[] {
    const clauses: string[] = [];
    const params: Record<string, SqlValue> = {
      limit: boundedLimit(filter.limit),
      offset: boundedOffset(filter.offset),
    };

    if (filter.status !== undefined) {
      clauses.push("status = @status");
      params.status = filter.status;
    }
    if (filter.subject !== undefined) {
      clauses.push("subject = @subject");
      params.subject = filter.subject;
    }
    if (filter.category !== undefined) {
      clauses.push("category = @category");
      params.category = filter.category;
    }
    if (filter.sensitivity !== undefined) {
      clauses.push("sensitivity = @sensitivity");
      params.sensitivity = filter.sensitivity;
    }
    if (filter.horizon !== undefined) {
      clauses.push("horizon = @horizon");
      params.horizon = filter.horizon;
    }

    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_pages ${where}
         ORDER BY updated_at DESC, id ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params) as MemoryPageRow[];

    return rows.map((row) => this.pageFromRow(row));
  }

  putMemoryPage(page: MemoryPage): void {
    validateMemoryPage(page);
    this.assertSourcesExist(page);

    this.db
      .prepare(
        `INSERT INTO memory_pages (
          id, subject, title, summary, body, category, tags_json,
          status, sensitivity, horizon, origin, source_refs_json,
          annotation_ids_json, valid_from, valid_until, supersedes_json,
          revision, created_at, updated_at
        ) VALUES (
          @id, @subject, @title, @summary, @body, @category, @tagsJson,
          @status, @sensitivity, @horizon, @origin, @sourceRefsJson,
          @annotationIdsJson, @validFrom, @validUntil, @supersedesJson,
          @revision, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          subject = excluded.subject,
          title = excluded.title,
          summary = excluded.summary,
          body = excluded.body,
          category = excluded.category,
          tags_json = excluded.tags_json,
          status = excluded.status,
          sensitivity = excluded.sensitivity,
          horizon = excluded.horizon,
          origin = excluded.origin,
          source_refs_json = excluded.source_refs_json,
          annotation_ids_json = excluded.annotation_ids_json,
          valid_from = excluded.valid_from,
          valid_until = excluded.valid_until,
          supersedes_json = excluded.supersedes_json,
          revision = excluded.revision,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run({
        id: page.id,
        subject: page.subject,
        title: page.title,
        summary: page.summary ?? null,
        body: page.body,
        category: page.category ?? null,
        tagsJson: JSON.stringify(page.tags),
        status: page.status,
        sensitivity: page.sensitivity,
        horizon: page.horizon,
        origin: page.origin,
        sourceRefsJson: JSON.stringify(page.sourceRefs),
        annotationIdsJson: JSON.stringify(page.annotationIds),
        validFrom: page.validFrom ?? null,
        validUntil: page.validUntil ?? null,
        supersedesJson: JSON.stringify(page.supersedes),
        revision: page.revision,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      });
  }

  getMemoryPageEvent(id: string): MemoryPageEvent | undefined {
    const row = this.db
      .prepare("SELECT * FROM memory_page_events WHERE id = ?")
      .get(id) as MemoryPageEventRow | undefined;

    return row === undefined ? undefined : this.eventFromRow(row);
  }

  listMemoryPageEvents(
    filter: MemoryPageEventFilter = {},
  ): MemoryPageEvent[] {
    const clauses: string[] = [];
    const params: Record<string, SqlValue> = {
      limit: boundedLimit(filter.limit),
      offset: boundedOffset(filter.offset),
    };

    if (filter.entityId !== undefined) {
      clauses.push("entity_id = @entityId");
      params.entityId = filter.entityId;
    }
    if (filter.type !== undefined) {
      clauses.push("type = @type");
      params.type = filter.type;
    }

    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_page_events ${where}
         ORDER BY occurred_at DESC, rowid DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params) as MemoryPageEventRow[];

    return rows.map((row) => this.eventFromRow(row));
  }

  appendMemoryPageEvent(event: MemoryPageEvent): void {
    validateMemoryPageEvent(event);

    this.db
      .prepare(
        `INSERT INTO memory_page_events (
          id, type, entity_id, occurred_at, actor_type, actor_id, data_json
        ) VALUES (
          @id, @type, @entityId, @occurredAt, @actorType, @actorId, @dataJson
        )`,
      )
      .run({
        id: event.id,
        type: event.type,
        entityId: event.entityId,
        occurredAt: event.occurredAt,
        actorType: event.actor.type,
        actorId: event.actor.id ?? null,
        dataJson: event.data === undefined ? null : JSON.stringify(event.data),
      });
  }

  applyMemoryPageTransition(transition: MemoryPageTransition): void {
    validateMemoryPage(transition.page);
    validateMemoryPageEvent(transition.event);

    if (transition.event.entityId !== transition.page.id) {
      throw new Error(
        "Memory Page transition event must reference the same Memory Page",
      );
    }

    const apply = this.db.transaction(() => {
      this.putMemoryPage(transition.page);
      this.appendMemoryPageEvent(transition.event);
    });
    apply();
  }

  transaction<T>(work: (store: MemoryPageStore) => T): T {
    const run = this.db.transaction(() => work(this));
    return run();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS memory_page_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;`,
    );

    if (this.memoryPageSchemaVersion() >= MEMORY_PAGE_SCHEMA_VERSION) return;

    const migrateV1 = this.db.transaction(() => {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS memory_pages (
          id TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT,
          body TEXT NOT NULL,
          category TEXT,
          tags_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'candidate', 'confirmed', 'rejected', 'superseded', 'expired'
          )),
          sensitivity TEXT NOT NULL CHECK (sensitivity IN (
            'ordinary', 'personal', 'sensitive', 'restricted'
          )),
          horizon TEXT NOT NULL CHECK (horizon IN (
            'durable', 'project', 'temporary'
          )),
          origin TEXT NOT NULL CHECK (origin IN (
            'manual', 'extracted', 'imported', 'compatibility'
          )),
          source_refs_json TEXT NOT NULL,
          annotation_ids_json TEXT NOT NULL,
          valid_from TEXT,
          valid_until TEXT,
          supersedes_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS memory_page_events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN (
            'memory.proposed', 'memory.confirmed', 'memory.edited',
            'memory.rejected', 'memory.superseded', 'memory.expired'
          )),
          entity_id TEXT NOT NULL REFERENCES memory_pages(id) ON DELETE RESTRICT,
          occurred_at TEXT NOT NULL,
          actor_type TEXT NOT NULL CHECK (actor_type IN (
            'user', 'agent', 'system', 'import'
          )),
          actor_id TEXT,
          data_json TEXT
        ) STRICT;

        CREATE INDEX IF NOT EXISTS memory_pages_status_idx
          ON memory_pages(status);
        CREATE INDEX IF NOT EXISTS memory_pages_subject_idx
          ON memory_pages(subject);
        CREATE INDEX IF NOT EXISTS memory_pages_category_idx
          ON memory_pages(category);
        CREATE INDEX IF NOT EXISTS memory_pages_updated_idx
          ON memory_pages(updated_at);
        CREATE INDEX IF NOT EXISTS memory_page_events_entity_idx
          ON memory_page_events(entity_id);
        CREATE INDEX IF NOT EXISTS memory_page_events_type_idx
          ON memory_page_events(type);`,
      );

      this.db
        .prepare(
          `INSERT INTO memory_page_schema_migrations (version, applied_at)
           VALUES (?, ?)`,
        )
        .run(MEMORY_PAGE_SCHEMA_VERSION, new Date().toISOString());
    });

    migrateV1();
  }

  private assertSourcesExist(page: MemoryPage): void {
    const sourcesTable = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sources'",
      )
      .get() as { name: string } | undefined;

    if (sourcesTable === undefined) {
      throw new Error(
        "Memory Pages require the existing TOPO source store to be initialised first",
      );
    }

    const findSource = this.db.prepare("SELECT id FROM sources WHERE id = ?");
    for (const reference of page.sourceRefs) {
      if (findSource.get(reference.sourceId) === undefined) {
        throw new Error(
          `Memory Page ${page.id} references missing source ${reference.sourceId}`,
        );
      }
    }
  }

  private pageFromRow(row: MemoryPageRow): MemoryPage {
    const page: MemoryPage = {
      id: row.id,
      subject: row.subject,
      title: row.title,
      ...(row.summary === null ? {} : { summary: row.summary }),
      body: row.body,
      ...(row.category === null ? {} : { category: row.category }),
      tags: parseJson<string[]>(row.tags_json),
      status: row.status,
      sensitivity: row.sensitivity,
      horizon: row.horizon,
      origin: row.origin,
      sourceRefs: parseJson<MemoryPage["sourceRefs"]>(row.source_refs_json),
      annotationIds: parseJson<string[]>(row.annotation_ids_json),
      ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
      ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
      supersedes: parseJson<string[]>(row.supersedes_json),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    validateMemoryPage(page);
    return page;
  }

  private eventFromRow(row: MemoryPageEventRow): MemoryPageEvent {
    const event: MemoryPageEvent = {
      id: row.id,
      type: row.type,
      entityType: "memory",
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
      actor: {
        type: row.actor_type,
        ...(row.actor_id === null ? {} : { id: row.actor_id }),
      },
      ...(row.data_json === null
        ? {}
        : { data: parseJson<NonNullable<MemoryPageEvent["data"]>>(row.data_json) }),
    };

    validateMemoryPageEvent(event);
    return event;
  }
}
