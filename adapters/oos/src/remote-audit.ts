export type RemoteContextAuditOutcome =
  | "requested"
  | "completed"
  | "denied"
  | "failed";

export interface RemoteContextAuditEvent {
  version: "topo.remote-audit/0.1";
  requestId: string;
  at: string;
  audience: string;
  action: "context";
  outcome: RemoteContextAuditOutcome;
  grantId?: string;
  subject?: string;
  code?: string;
  sensitivityCeiling?: string;
  objectCount?: number;
  responseBytes?: number;
}

export interface RemoteContextAuditSink {
  record(event: RemoteContextAuditEvent): void | Promise<void>;
}

export interface InMemoryRemoteContextAuditOptions {
  maxEntries?: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error("maxEntries must be a positive integer");
  }
  return resolved;
}

/**
 * Bounded audit sink for integration/dogfood use.
 *
 * It records only the already-redacted RemoteContextAuditEvent contract. It is
 * not a source-of-truth memory store and deliberately has no persistence.
 */
export class InMemoryRemoteContextAuditSink implements RemoteContextAuditSink {
  private readonly maxEntries: number;
  private readonly entries: RemoteContextAuditEvent[] = [];

  constructor(options: InMemoryRemoteContextAuditOptions = {}) {
    this.maxEntries = positiveInteger(options.maxEntries, 250);
  }

  record(event: RemoteContextAuditEvent): void {
    this.entries.push(structuredClone(event));
    while (this.entries.length > this.maxEntries) this.entries.shift();
  }

  list(): RemoteContextAuditEvent[] {
    return structuredClone(this.entries);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export function remoteResponseMetrics(value: unknown): {
  objectCount: number;
  responseBytes: number;
} {
  const encoded = JSON.stringify(value);
  const responseBytes =
    encoded === undefined ? 0 : Buffer.byteLength(encoded, "utf8");
  const objectCount =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).objects)
      ? ((value as Record<string, unknown>).objects as unknown[]).length
      : 0;
  return { objectCount, responseBytes };
}
