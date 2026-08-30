import Database from "better-sqlite3";
import {
  validateClaim,
  validateEvent,
  validateSource,
  type ClaimTransition,
  type JsonValue,
  type MemoryClaim,
  type MemoryEvent,
  type MemorySource,
} from "@topo/schemas";
import type {
  ClaimFilter,
  EventFilter,
  MemoryStore,
} from "@topo/store";

const SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

type SqlValue = string | number | null;

interface ClaimRow {
  id: string;
  subject: string;
  claim_key: string;
  value_json: string;
  category: string | null;
  tags_json: string;
  epistemic_type: MemoryClaim["epistemicType"];
  confidence: number;
  source_type: MemoryClaim["provenance"]["sourceType"];
  provider: string | null;
  source_id: string | null;
  evidence: string | null;
  source_captured_at: string;
  status: MemoryClaim["status"];
  sensitivity: MemoryClaim["sensitivity"];
  valid_from: string | null;
  valid_until: string | null;
  supersedes_json: string;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  id: string;
  type: MemorySource["type"];
  title: string | null;
  provider: string | null;
  external_id: string | null;
  captured_at: string;
  created_at: string;
  sensitivity: MemorySource["sensitivity"];
  metadata_json: string | null;
}

interface EventRow {
  id: string;
  type: MemoryEvent["type"];
  entity_type: MemoryEvent["entityType"];
  entity_id: string;
  occurred_at: string;
  actor_type: MemoryEvent["actor"]["type"];
  actor_id: string | null;
  data_json: string | null;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function optionalString(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

export class SqliteMemoryStore implements MemoryStore {
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

  schemaVersion(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };

    return Number(row.version);
  }

  getClaim(id: string): MemoryClaim | undefined {
    const row = this.db
      .prepare("SELECT * FROM claims WHERE id = ?")
      .get(id) as ClaimRow | undefined;

    return row === undefined ? undefined : this.claimFromRow(row);
  }

  listClaims(filter: ClaimFilter = {}): MemoryClaim[] {
    const clauses: string[] = [];
    const params: Record<string, SqlValue> = {
      limit: boundedLimit(filter.limit),
    };

    if (filter.status !== undefined) {
      clauses.push("status = @status");
      params.status = filter.status;
    }
    if (filter.category !== undefined) {
      clauses.push("category = @category");
      params.category = filter.category;
    }
    if (filter.key !== undefined) {
      clauses.push("claim_key = @claimKey");
      params.claimKey = filter.key;
    }
    if (filter.subject !== undefined) {
      clauses.push("subject = @subject");
      params.subject = filter.subject;
    }

    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.db
      .prepare(
        `SELECT * FROM claims ${where}
         ORDER BY updated_at DESC, id ASC
         LIMIT @limit`,
      )
      .all(params) as ClaimRow[];

    return rows.map((row) => this.claimFromRow(row));
  }

  putClaim(claim: MemoryClaim): void {
    validateClaim(claim);

    this.db
      .prepare(
        `INSERT INTO claims (
          id, subject, claim_key, value_json, category, tags_json,
          epistemic_type, confidence,
          source_type, provider, source_id, evidence, source_captured_at,
          status, sensitivity, valid_from, valid_until, supersedes_json,
          created_at, updated_at
        ) VALUES (
          @id, @subject, @claimKey, @valueJson, @category, @tagsJson,
          @epistemicType, @confidence,
          @sourceType, @provider, @sourceId, @evidence, @sourceCapturedAt,
          @status, @sensitivity, @validFrom, @validUntil, @supersedesJson,
          @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          subject = excluded.subject,
          claim_key = excluded.claim_key,
          value_json = excluded.value_json,
          category = excluded.category,
          tags_json = excluded.tags_json,
          epistemic_type = excluded.epistemic_type,
          confidence = excluded.confidence,
          source_type = excluded.source_type,
          provider = excluded.provider,
          source_id = excluded.source_id,
          evidence = excluded.evidence,
          source_captured_at = excluded.source_captured_at,
          status = excluded.status,
          sensitivity = excluded.sensitivity,
          valid_from = excluded.valid_from,
          valid_until = excluded.valid_until,
          supersedes_json = excluded.supersedes_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run({
        id: claim.id,
        subject: claim.subject,
        claimKey: claim.key,
        valueJson: JSON.stringify(claim.value),
        category: claim.category ?? null,
        tagsJson: JSON.stringify(claim.tags),
        epistemicType: claim.epistemicType,
        confidence: claim.confidence,
        sourceType: claim.provenance.sourceType,
        provider: claim.provenance.provider ?? null,
        sourceId: claim.provenance.sourceId ?? null,
        evidence: claim.provenance.evidence ?? null,
        sourceCapturedAt: claim.provenance.capturedAt,
        status: claim.status,
        sensitivity: claim.sensitivity,
        validFrom: claim.validFrom ?? null,
        validUntil: claim.validUntil ?? null,
        supersedesJson: JSON.stringify(claim.supersedes),
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
      });
  }

  getSource(id: string): MemorySource | undefined {
    const row = this.db
      .prepare("SELECT * FROM sources WHERE id = ?")
      .get(id) as SourceRow | undefined;

    return row === undefined ? undefined : this.sourceFromRow(row);
  }

  putSource(source: MemorySource): void {
    validateSource(source);

    this.db
      .prepare(
        `INSERT INTO sources (
          id, type, title, provider, external_id, captured_at,
          created_at, sensitivity, metadata_json
        ) VALUES (
          @id, @type, @title, @provider, @externalId, @capturedAt,
          @createdAt, @sensitivity, @metadataJson
        )
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          provider = excluded.provider,
          external_id = excluded.external_id,
          captured_at = excluded.captured_at,
          created_at = excluded.created_at,
          sensitivity = excluded.sensitivity,
          metadata_json = excluded.metadata_json`,
      )
      .run({
        id: source.id,
        type: source.type,
        title: source.title ?? null,
        provider: source.provider ?? null,
        externalId: source.externalId ?? null,
        capturedAt: source.capturedAt,
        createdAt: source.createdAt,
        sensitivity: source.sensitivity,
        metadataJson:
          source.metadata === undefined ? null : JSON.stringify(source.metadata),
      });
  }

  appendEvent(event: MemoryEvent): void {
    validateEvent(event);

    this.db
      .prepare(
        `INSERT INTO events (
          id, type, entity_type, entity_id, occurred_at,
          actor_type, actor_id, data_json
        ) VALUES (
          @id, @type, @entityType, @entityId, @occurredAt,
          @actorType, @actorId, @dataJson
        )`,
      )
      .run({
        id: event.id,
        type: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        occurredAt: event.occurredAt,
        actorType: event.actor.type,
        actorId: event.actor.id ?? null,
        dataJson: event.data === undefined ? null : JSON.stringify(event.data),
      });
  }

  listEvents(filter: EventFilter = {}): MemoryEvent[] {
    const clauses: string[] = [];
    const params: Record<string, SqlValue> = {
      limit: boundedLimit(filter.limit),
    };

    if (filter.entityType !== undefined) {
      clauses.push("entity_type = @entityType");
      params.entityType = filter.entityType;
    }
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
        `SELECT * FROM events ${where}
         ORDER BY occurred_at DESC, id ASC
         LIMIT @limit`,
      )
      .all(params) as EventRow[];

    return rows.map((row) => this.eventFromRow(row));
  }

  applyTransition(transition: ClaimTransition): void {
    validateClaim(transition.claim);
    validateEvent(transition.event);

    if (
      transition.event.entityType !== "claim" ||
      transition.event.entityId !== transition.claim.id
    ) {
      throw new Error("Claim transition event must reference the same claim");
    }

    const apply = this.db.transaction(() => {
      this.putClaim(transition.claim);
      this.appendEvent(transition.event);
    });

    apply();
  }

  transaction<T>(work: (store: MemoryStore) => T): T {
    const run = this.db.transaction(() => work(this));
    return run();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;`,
    );

    if (this.schemaVersion() >= 1) return;

    const migrateV1 = this.db.transaction(() => {
      this.db.exec(
        `CREATE TABLE sources (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN (
            'conversation', 'document', 'manual', 'mcp', 'import', 'connector'
          )),
          title TEXT,
          provider TEXT,
          external_id TEXT,
          captured_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          sensitivity TEXT NOT NULL CHECK (sensitivity IN (
            'ordinary', 'personal', 'sensitive', 'restricted'
          )),
          metadata_json TEXT
        ) STRICT;

        CREATE TABLE claims (
          id TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          claim_key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          category TEXT,
          tags_json TEXT NOT NULL,
          epistemic_type TEXT NOT NULL CHECK (epistemic_type IN (
            'assertion', 'observation', 'inference', 'preference', 'derived-pattern'
          )),
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          source_type TEXT NOT NULL CHECK (source_type IN (
            'conversation', 'document', 'manual', 'mcp', 'import', 'connector'
          )),
          provider TEXT,
          source_id TEXT REFERENCES sources(id) ON DELETE RESTRICT,
          evidence TEXT,
          source_captured_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'candidate', 'confirmed', 'rejected', 'superseded', 'expired'
          )),
          sensitivity TEXT NOT NULL CHECK (sensitivity IN (
            'ordinary', 'personal', 'sensitive', 'restricted'
          )),
          valid_from TEXT,
          valid_until TEXT,
          supersedes_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          entity_type TEXT NOT NULL CHECK (entity_type IN (
            'claim', 'source', 'document', 'schema', 'context'
          )),
          entity_id TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          actor_type TEXT NOT NULL CHECK (actor_type IN (
            'user', 'agent', 'system', 'import'
          )),
          actor_id TEXT,
          data_json TEXT
        ) STRICT;

        CREATE INDEX claims_status_idx ON claims(status);
        CREATE INDEX claims_category_idx ON claims(category);
        CREATE INDEX claims_key_idx ON claims(claim_key);
        CREATE INDEX claims_source_idx ON claims(source_id);
        CREATE INDEX events_entity_idx ON events(entity_type, entity_id);
        CREATE INDEX events_type_idx ON events(type);
        CREATE INDEX events_occurred_idx ON events(occurred_at);`,
      );

      this.db
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(SCHEMA_VERSION, new Date().toISOString());
    });

    migrateV1();
  }

  private claimFromRow(row: ClaimRow): MemoryClaim {
    const claim: MemoryClaim = {
      id: row.id,
      subject: row.subject,
      key: row.claim_key,
      value: parseJson<JsonValue>(row.value_json),
      ...(row.category === null ? {} : { category: row.category }),
      tags: parseJson<string[]>(row.tags_json),
      epistemicType: row.epistemic_type,
      confidence: row.confidence,
      provenance: {
        sourceType: row.source_type,
        ...(row.provider === null ? {} : { provider: row.provider }),
        ...(row.source_id === null ? {} : { sourceId: row.source_id }),
        ...(row.evidence === null ? {} : { evidence: row.evidence }),
        capturedAt: row.source_captured_at,
      },
      status: row.status,
      sensitivity: row.sensitivity,
      ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
      ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
      supersedes: parseJson<string[]>(row.supersedes_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    validateClaim(claim);
    return claim;
  }

  private sourceFromRow(row: SourceRow): MemorySource {
    const source: MemorySource = {
      id: row.id,
      type: row.type,
      ...(row.title === null ? {} : { title: row.title }),
      ...(row.provider === null ? {} : { provider: row.provider }),
      ...(row.external_id === null ? {} : { externalId: row.external_id }),
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      sensitivity: row.sensitivity,
      ...(row.metadata_json === null
        ? {}
        : { metadata: parseJson<{ [key: string]: JsonValue }>(row.metadata_json) }),
    };

    validateSource(source);
    return source;
  }

  private eventFromRow(row: EventRow): MemoryEvent {
    const event: MemoryEvent = {
      id: row.id,
      type: row.type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
      actor: {
        type: row.actor_type,
        ...(row.actor_id === null ? {} : { id: row.actor_id }),
      },
      ...(row.data_json === null
        ? {}
        : { data: parseJson<{ [key: string]: JsonValue }>(row.data_json) }),
    };

    validateEvent(event);
    return event;
  }
}
